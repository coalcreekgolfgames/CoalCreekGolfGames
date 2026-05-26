import React, { useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { BrandWatermarkBackground } from '@/components/BrandWatermarkBackground';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { PlayerCard, PlayerCardGrid } from '@/components/round/PlayerCardGrid';
import { AppButton } from '@/components/ui/AppButton';
import { PlayerBottomNav } from '@/components/navigation/PlayerBottomNav';
import { RoundHeader } from '@/components/round/RoundHeader';
import { SectionCard } from '@/components/ui/SectionCard';
import { holes } from '@/constants/course';
import { holeImages } from '@/constants/holeImages';
import {
  bbbWinnerLabel,
  ensureGroupScoresForHole,
  isBingoBangoBongoRound,
  summarizeBingoBangoBongo,
  type BingoBangoBongoCategory,
} from '@/lib/bingoBangoBongo';
import { deleteBbbHoleSync } from '@/lib/bbbBackend';
import { determineNassauHoleResult } from '@/lib/nassau';
import { deleteSkinsHoleSync } from '@/lib/skinsBackend';
import { loadDraftRound, saveDraftRound } from '@/lib/localRound';
import { getGroupRoundOfficialScoringGuard } from '@/lib/groupRoundCompanions';
import {
  drainActiveRegularRoundSync,
  getRegularRoundBackendGameType,
  getRegularRoundBackendStatusDetail,
  queueRegularRoundHoleSync,
  shouldRetryRegularRoundSyncNow,
} from '@/lib/regularRoundBackendSync';
import { finalizeHoleStats } from '@/lib/roundStats';
import { getSkinsCarryoverForHole, isSkinsRound, resolveSkinsHole, summarizeSkins } from '@/lib/skins';
import { getHuntersForHole, getWolfForHole } from '@/lib/wolf';
import {
  applyStablefordToHole,
  computeStablefordHoleScore,
  countStablefordScoredHoles,
  describeStablefordMode,
  getStablefordModifiedPresetSummary,
  getStablefordRoundTotal,
  getStablefordSpecialHoleRule,
  isStablefordRound,
  requiresStablefordHoleOut,
} from '@/lib/stableford';
import {
  deleteTournamentHoleScore,
  ensureTournamentDraftTeamContext,
  getPendingScoreSyncSummary,
  getNextHoleNumber,
  getPreviousHoleNumber,
  isFirstHoleInSequence,
  isLastHoleInSequence,
  markTournamentHoleScoreSyncFailed,
  markTournamentHoleScoreSynced,
  queueTournamentHoleScoreSync,
  removeTournamentHoleScoreSync,
  retryPendingTournamentHoleSyncs,
  syncTournamentHoleScore,
} from '@/lib/tournamentRoundSync';
import { useAuth } from '@/providers/AuthProvider';
import type { HoleDraft, LocalRoundDraft, WolfHoleDecisionDraft } from '@/types/round';

const DEBUG_BRANDING = false;

function formatHandicapNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

type StepKey =
  | 'driveSafe'
  | 'drivePenalty'
  | 'hitGreen'
  | 'girMissPenalty'
  | 'nearGreen'
  | 'bbbBingo'
  | 'bbbBango'
  | 'bbbBongo'
  | 'bbbScores'
  | 'skinsScores'
  | 'standardGroupScores'
  | 'score'
  | 'opponentScore'
  | 'putts'
  | 'save';

type HoleSaveStatus = 'idle' | 'saving' | 'saved';

function binaryComplete(value: boolean | null | undefined) {
  return typeof value === 'boolean';
}

function scoreComplete(value: number | null | undefined) {
  return typeof value === 'number' && value > 0;
}

function isIronmanRound(round: LocalRoundDraft | null) {
  return round?.tournamentFormat === 'ironman_team_scramble' || round?.tournamentScoringMode === 'team_vs_team';
}

function isScrambleRound(round: LocalRoundDraft | null) {
  return round?.tournamentFormat === 'scramble' || round?.tournamentScoringMode === 'team';
}

function isCrossCardDualScoreRound(round: LocalRoundDraft | null) {
  return (
    round?.roundMode === 'tournament' &&
    round?.tournamentFormat === 'individual_stroke_play' &&
    round?.tournamentScoringFormat !== 'stableford' &&
    !!round?.tournamentCrossCardTargetUserId
  );
}

function formatTeeTime(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`1970-01-01T${value}`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function buildScoreOptions(maxScore: number) {
  return Array.from({ length: maxScore }, (_, index) => index + 1);
}

function formatRelativeToPar(value: number) {
  if (value === 0) return 'E';
  return value > 0 ? `+${value}` : `${value}`;
}

function getParticipantInitials(name: string) {
  const parts = name
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return 'P';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

function bumpScore(current: number | null | undefined, delta: number) {
  const base = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  return Math.max(1, base + delta);
}

function buildDefaultGroupScores(
  hole: HoleDraft,
  participants: Array<{ id: string }>,
  defaultScore: number,
) {
  const scoreByParticipantId = new Map(
    (hole.groupScores ?? []).map((entry) => [entry.participantId, entry.score]),
  );

  return participants.map((participant) => {
    const existingScore = scoreByParticipantId.get(participant.id);
    return {
      participantId: participant.id,
      score: typeof existingScore === 'number' && existingScore > 0 ? existingScore : defaultScore,
    };
  });
}

function sameParticipantSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const ids = new Set(a);
  return b.every((participantId) => ids.has(participantId));
}

export default function HoleEditorScreen() {
  const params = useLocalSearchParams<{ hole: string }>();
  const holeNumber = Number(params.hole ?? '1');
  const { user, loading: authLoading } = useAuth();
  const [round, setRound] = useState<LocalRoundDraft | null>(null);
  const [imageMode, setImageMode] = useState<'fairway' | 'green'>('fairway');
  const [stepIndex, setStepIndex] = useState(0);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [deletingHole, setDeletingHole] = useState(false);
  const [retryingSync, setRetryingSync] = useState(false);
  const [checkingEntryAccess, setCheckingEntryAccess] = useState(true);
  const [entryBlockedMessage, setEntryBlockedMessage] = useState<string | null>(null);
  const [holeSaveStatus, setHoleSaveStatus] = useState<HoleSaveStatus>('idle');

  const applyRegularRoundSyncUiState = (nextRound: LocalRoundDraft) => {
    const status = nextRound.regularRoundBackendSync?.status ?? null;
    if (status === 'sync_failed' || status === 'retry_scheduled' || status === 'cancelled') {
      setSyncMessage(getRegularRoundBackendStatusDetail(nextRound));
      return;
    }
    setSyncMessage(null);
  };

  const kickOffBackgroundRegularRoundSync = (nextRound: LocalRoundDraft, trigger: string, queuedHoleNumber?: number | null) => {
    if (!user?.id || !getRegularRoundBackendGameType(nextRound)) return;

    const pendingCount = nextRound.regularRoundBackendSync?.chunks?.filter((chunk) => chunk.status !== 'synced' && chunk.status !== 'cancelled').length ?? 0;
    if (__DEV__) {
      console.debug('[regular-round-sync] background_sync_pending_count', {
        roundLocalId: nextRound.id,
        backendRoundId: nextRound.backendRoundId ?? null,
        pendingCount,
      });
    }

    void drainActiveRegularRoundSync({
      userId: user.id,
      trigger,
      queuedHoleNumber,
      onUpdate: (updatedRound) => {
        setRound(updatedRound);
        applyRegularRoundSyncUiState(updatedRound);
      },
    }).catch((error: any) => {
      console.error(error?.message ?? 'Background regular round sync failed');
    });
  };

  const requireOfficialGroupRoundAccess = async (draft: LocalRoundDraft | null | undefined) => {
    const guard = await getGroupRoundOfficialScoringGuard({
      round: draft,
      userId: user?.id,
      authLoading,
    });

    if (guard.status === 'allow_official') return true;
    if (guard.redirectRoute) {
      router.replace(guard.redirectRoute as any);
      return false;
    }
    Alert.alert('Round unavailable', guard.message ?? 'This shared group round is not available for official scoring on this device.');
    return false;
  };

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      if (authLoading) {
        if (isMounted) {
          setCheckingEntryAccess(true);
          setEntryBlockedMessage(null);
        }
        return;
      }

      const draft = await loadDraftRound();
      if (!draft) {
        router.replace('/round/start');
        return;
      }

      let nextDraft = draft;

      if (draft.roundMode === 'tournament' && draft.tournamentId && user?.id) {
        const hydrated = await ensureTournamentDraftTeamContext({
          round: draft,
          userId: user.id,
        });
        nextDraft = hydrated.round;
        await saveDraftRound(nextDraft);

        if (hydrated.missingTeamContext) {
          Alert.alert(
            'Tournament assignment needed',
            hydrated.round.lastSyncError ?? 'Your team assignment is not available yet.',
            [{ text: 'Back to tournament', onPress: () => router.replace(`/tournament/${draft.tournamentId}/yardage`) }],
          );
          return;
        }
      }

      const guard = await getGroupRoundOfficialScoringGuard({
        round: nextDraft,
        userId: user?.id,
        authLoading,
      });

      if (guard.status !== 'allow_official') {
        if (guard.redirectRoute) {
          router.replace(guard.redirectRoute as any);
          return;
        }
        if (isMounted) {
          setCheckingEntryAccess(false);
          setEntryBlockedMessage(guard.message ?? 'This shared group round is unavailable.');
        }
        return;
      }

      if (
        nextDraft.roundMode === 'tournament' &&
        nextDraft.backendRoundId &&
        user?.id &&
        (nextDraft.pendingScoreSyncs?.length ?? 0) > 0
      ) {
        const retried = await retryPendingTournamentHoleSyncs({
          round: nextDraft,
          userId: user.id,
        });
        nextDraft = retried.round;
        await saveDraftRound(nextDraft);

        if (isMounted) {
          if (retried.syncedCount > 0 && retried.failedCount === 0) {
            setSyncMessage(`Synced ${retried.syncedCount} queued hole score${retried.syncedCount === 1 ? '' : 's'}.`);
          } else if (retried.syncedCount > 0 || retried.failedCount > 0) {
            setSyncMessage(`Synced ${retried.syncedCount}, still pending ${getPendingScoreSyncSummary(nextDraft).pendingCount}.`);
          }
        }
      }

      if (isMounted) {
        setRound(nextDraft);
        setCheckingEntryAccess(false);
        setEntryBlockedMessage(null);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [authLoading, user?.id]);

  const courseHole = holes.find((item) => item.hole === holeNumber);
  const state = useMemo(() => round?.holes.find((item) => item.hole === holeNumber), [round, holeNumber]);

  const ironman = isIronmanRound(round);
  const scramble = isScrambleRound(round);
  const crossCardDualScore = isCrossCardDualScoreRound(round);
  const bbbRound = isBingoBangoBongoRound(round);
  const skinsRound = isSkinsRound(round);
  const nassauRound = round?.roundMode === 'casual_group' && round?.groupGameMode === 'nassau';
  const wolfRound = round?.roundMode === 'casual_group' && round?.groupGameMode === 'wolf';
  const standardGroupRound = round?.roundMode === 'casual_group' && !bbbRound && !skinsRound;
  const statsEnabled = round?.statsEnabled !== false && !ironman && !scramble;
  const stablefordRound = isStablefordRound(round) && !ironman && !scramble;
  const stablefordRule = getStablefordSpecialHoleRule(round, holeNumber);
  const mustHoleOut = requiresStablefordHoleOut(round, holeNumber);
  const stablefordPreview =
    round && stablefordRound && scoreComplete(state?.score)
      ? computeStablefordHoleScore(round, holeNumber, Number(state?.score))
      : null;
  const stablefordRunningTotal = stablefordRound ? getStablefordRoundTotal(round) : null;
  const stablefordScoredHoles = stablefordRound ? countStablefordScoredHoles(round) : 0;
  const stablefordModeLabel = stablefordRound ? describeStablefordMode(round) : null;
  const stablefordModifiedPresetSummary = stablefordRound ? getStablefordModifiedPresetSummary(round) : null;
  const scoreOptions = stablefordRound && (stablefordRule?.track_stroke_tally || mustHoleOut)
    ? buildScoreOptions(16)
    : buildScoreOptions(10);
  const groupParticipants = useMemo(() => round?.group?.participants ?? [], [round?.group?.participants]);
  const nassauParticipantIds = useMemo(
    () => Array.from(new Set((round?.nassauParticipantIds ?? []).filter((value) => typeof value === 'string' && value.trim().length > 0))),
    [round?.nassauParticipantIds],
  );
  const wolfParticipantIds = useMemo(
    () => Array.from(new Set((round?.wolfParticipantIds ?? []).filter((value) => typeof value === 'string' && value.trim().length > 0))),
    [round?.wolfParticipantIds],
  );
  const wolfOrderParticipantIds = useMemo(() => {
    if (wolfParticipantIds.length === 0) return [];

    const configuredOrder = Array.isArray(round?.wolfOrderParticipantIds)
      ? round!.wolfOrderParticipantIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const seen = new Set<string>();
    const nextOrder: string[] = [];

    configuredOrder.forEach((participantId) => {
      if (!wolfParticipantIds.includes(participantId) || seen.has(participantId)) return;
      seen.add(participantId);
      nextOrder.push(participantId);
    });

    wolfParticipantIds.forEach((participantId) => {
      if (seen.has(participantId)) return;
      seen.add(participantId);
      nextOrder.push(participantId);
    });

    return nextOrder;
  }, [round?.wolfOrderParticipantIds, wolfParticipantIds]);
  const standardGroupHoleScores = useMemo(
    () => standardGroupRound && state ? ensureGroupScoresForHole(state, groupParticipants) : [],
    [groupParticipants, standardGroupRound, state],
  );
  const nassauHoleScores = useMemo(
    () => nassauRound
      ? standardGroupHoleScores.filter((entry) => (
          nassauParticipantIds.length === 0 || nassauParticipantIds.includes(entry.participantId)
        ))
      : [],
    [nassauParticipantIds, nassauRound, standardGroupHoleScores],
  );
  const bbbHoleScores = useMemo(
    () => bbbRound && state ? ensureGroupScoresForHole(state, groupParticipants) : [],
    [bbbRound, groupParticipants, state],
  );
  const bbbSummary = bbbRound && round ? summarizeBingoBangoBongo(round) : null;
  const skinsHoleScores = useMemo(
    () => skinsRound && state ? ensureGroupScoresForHole(state, groupParticipants) : [],
    [groupParticipants, skinsRound, state],
  );
  const skinsSummary = skinsRound && round ? summarizeSkins(round) : null;
  const skinsCarryoverCount = skinsRound && round ? getSkinsCarryoverForHole(round, holeNumber) : 1;
  const skinsPreview = skinsRound
    ? resolveSkinsHole(
        skinsHoleScores.map((entry) => ({ participantId: entry.participantId, score: entry.score ?? null })),
        skinsCarryoverCount,
      )
      : null;
  const wolfCurrentParticipantId = useMemo(
    () => wolfRound ? getWolfForHole(wolfOrderParticipantIds, holeNumber) : null,
    [holeNumber, wolfOrderParticipantIds, wolfRound],
  );
  const wolfCurrentParticipant = useMemo(
    () => groupParticipants.find((participant) => participant.id === wolfCurrentParticipantId) ?? null,
    [groupParticipants, wolfCurrentParticipantId],
  );
  const wolfCurrentDecision = useMemo(() => {
    if (!round || !wolfRound || !wolfCurrentParticipantId) return null;

    const holeDecision = round.wolfHoleDecisions?.[holeNumber];
    const partnerParticipantId = holeDecision?.partnerParticipantId ?? state?.wolfPartnerParticipantId ?? null;
    const isLoneWolf = holeDecision?.isLoneWolf ?? (state?.wolfIsLoneWolf === true);
    const isBlindWolf = holeDecision?.isBlindWolf ?? (state?.wolfIsBlindWolf === true);

    if (partnerParticipantId) {
      return {
        wolfParticipantId: holeDecision?.wolfParticipantId ?? wolfCurrentParticipantId,
        partnerParticipantId,
        isLoneWolf: false,
        isBlindWolf: false,
      } satisfies WolfHoleDecisionDraft;
    }

    if (isLoneWolf) {
      return {
        wolfParticipantId: holeDecision?.wolfParticipantId ?? wolfCurrentParticipantId,
        partnerParticipantId: null,
        isLoneWolf: true,
        isBlindWolf,
      } satisfies WolfHoleDecisionDraft;
    }

    return null;
  }, [holeNumber, round, state?.wolfIsBlindWolf, state?.wolfIsLoneWolf, state?.wolfPartnerParticipantId, wolfCurrentParticipantId, wolfRound]);
  const wolfPartnerOptions = useMemo(() => {
    if (!wolfRound || !wolfCurrentParticipantId) return [];
    return groupParticipants.filter((participant) => participant.id !== wolfCurrentParticipantId);
  }, [groupParticipants, wolfCurrentParticipantId, wolfRound]);
  const wolfHunters = useMemo(() => {
    if (!wolfRound || !wolfCurrentParticipantId || wolfOrderParticipantIds.length !== 4) return [];
    const hunterIds = getHuntersForHole(
      wolfOrderParticipantIds,
      wolfCurrentParticipantId,
      wolfCurrentDecision?.partnerParticipantId ?? null,
      wolfCurrentDecision?.isLoneWolf === true,
    );
    return hunterIds
      .map((participantId) => groupParticipants.find((participant) => participant.id === participantId))
      .filter(Boolean) as typeof groupParticipants;
  }, [groupParticipants, wolfCurrentDecision?.isLoneWolf, wolfCurrentDecision?.partnerParticipantId, wolfCurrentParticipantId, wolfOrderParticipantIds, wolfRound]);
  const sharedStatSteps = useMemo<StepKey[]>(() => {
    if (!state || !courseHole || !statsEnabled) return [];

    const result: StepKey[] = ['driveSafe'];

    if (state.driveSafe === false) {
      result.push('drivePenalty');
    }

    const autoGirFromPar3SafeDrive = courseHole.par === 3 && state.driveSafe === true;

    if (!autoGirFromPar3SafeDrive) {
      result.push('hitGreen');

      if (state.hitGreen === false) {
        result.push('girMissPenalty');
        if (state.girMissPenalty === false) {
          result.push('nearGreen');
        }
      }
    }

    result.push('putts');
    return result;
  }, [courseHole, state, statsEnabled]);
  const bbbScoreRelativeByParticipant = useMemo(() => {
    if (!bbbRound || !round) return new Map<string, number>();

    const parByHole = new Map<number, number>(holes.map((item) => [Number(item.hole), item.par]));
    const totals = new Map<string, number>();

    round.holes.forEach((hole) => {
      const par = parByHole.get(hole.hole);
      if (!par) return;

      ensureGroupScoresForHole(hole, groupParticipants).forEach((entry) => {
        if (!scoreComplete(entry.score)) return;
        totals.set(entry.participantId, (totals.get(entry.participantId) ?? 0) + (Number(entry.score) - par));
      });
    });

    return totals;
  }, [bbbRound, round, groupParticipants]);

  const steps = useMemo<StepKey[]>(() => {
    if (!state || !courseHole) return [];
    if (bbbRound) {
      return [
        'bbbBingo',
        'bbbBango',
        'bbbBongo',
        ...sharedStatSteps,
        'bbbScores',
        'save',
      ];
    }
    if (skinsRound) {
      return [
        ...sharedStatSteps,
        'skinsScores',
        'save',
      ];
    }
    if (standardGroupRound) {
      if (!statsEnabled) return ['standardGroupScores', 'save'];
      return [...sharedStatSteps, 'standardGroupScores', 'save'];
    }

    if (ironman || crossCardDualScore) {
      const result: StepKey[] = ['score'];
      if (scoreComplete(state.score)) result.push('opponentScore');
      if (scoreComplete(state.opponentScore)) result.push('save');
      return result;
    }

    if (!statsEnabled) return ['score', 'save'];

    const result: StepKey[] = [...sharedStatSteps];
    result.push('score');

    if (typeof state.totalPutts === 'number' && scoreComplete(state.score)) {
      result.push('save');
    }

    return result;
  }, [state, courseHole, bbbRound, skinsRound, standardGroupRound, ironman, crossCardDualScore, statsEnabled, groupParticipants, standardGroupHoleScores, sharedStatSteps]);
  const currentStep = steps[stepIndex];
  const currentStepIsSharedStat = typeof currentStep === 'string' && sharedStatSteps.includes(currentStep);

  const bbbStepConfig = useMemo(() => {
    if (!bbbRound || !currentStep) return null;

    if (currentStep === 'bbbBingo') {
      return {
        phase: 'winner' as const,
        title: 'Who got Bingo?',
        helper: 'Pick the player who earned the first BBB point on this hole.',
        category: 'bingoWinnerId' as BingoBangoBongoCategory,
        selectedParticipantId: state?.bingoWinnerId ?? null,
      };
    }

    if (currentStep === 'bbbBango') {
      return {
        phase: 'winner' as const,
        title: 'Who got Bango?',
        helper: 'Pick the player who earned the second BBB point on this hole.',
        category: 'bangoWinnerId' as BingoBangoBongoCategory,
        selectedParticipantId: state?.bangoWinnerId ?? null,
      };
    }

    if (currentStep === 'bbbBongo') {
      return {
        phase: 'winner' as const,
        title: 'Who got Bongo?',
        helper: 'Pick the player who earned the third BBB point on this hole.',
        category: 'bongoWinnerId' as BingoBangoBongoCategory,
        selectedParticipantId: state?.bongoWinnerId ?? null,
      };
    }

    if (currentStep === 'bbbScores') {
      return {
        phase: 'score' as const,
        title: 'Player scores',
        helper: `Enter each player's score for Hole ${holeNumber}.`,
      };
    }

    return null;
  }, [bbbRound, currentStep, state?.bingoWinnerId, state?.bangoWinnerId, state?.bongoWinnerId, groupParticipants, bbbHoleScores, holeNumber]);

  const skinsStepConfig = useMemo(() => {
    if (!skinsRound || currentStep !== 'skinsScores') return null;
    return {
      title: 'Player scores',
      helper: `Enter each player's gross score for Hole ${holeNumber}.`,
    };
  }, [skinsRound, currentStep, holeNumber]);

  const standardGroupStepConfig = useMemo(() => {
    if (!standardGroupRound || currentStep !== 'standardGroupScores') return null;
    return {
      title: 'Player scores',
      helper: `Enter each player's gross score for Hole ${holeNumber}.`,
    };
  }, [standardGroupRound, currentStep, holeNumber]);

  useEffect(() => {
    if (!__DEV__ || !DEBUG_BRANDING || !round) return;
    console.log('[branding] live round green icon rendered', {
      asset: 'coal-creek-logo-full.png',
      opacity: 1,
      screen: 'app/round/hole/[hole].tsx',
      holeNumber,
      gameMode: round.groupGameMode ?? round.roundMode ?? null,
    });
  }, [holeNumber, round, round?.groupGameMode, round?.roundMode]);

  const setBbbPlayerScore = async (participantId: string, score: number) => {
    if (!bbbRound) return;
    const nextScores = bbbHoleScores.map((entry) =>
      entry.participantId === participantId ? { ...entry, score } : entry,
    );
    await updateHole({ groupScores: nextScores });
  };

  const setSkinsPlayerScore = async (participantId: string, score: number) => {
    if (!skinsRound) return;
    const nextScores = skinsHoleScores.map((entry) =>
      entry.participantId === participantId ? { ...entry, score } : entry,
    );
    await updateHole({ groupScores: nextScores });
  };

  const setStandardGroupPlayerScore = async (participantId: string, score: number) => {
    if (!standardGroupRound) return;
    const nextScores = standardGroupHoleScores.map((entry) =>
      entry.participantId === participantId ? { ...entry, score } : entry,
    );
    const appUserParticipant = groupParticipants.find((participant) => participant.type === 'app_user') ?? groupParticipants[0];
    await updateHole({
      groupScores: nextScores,
      score: participantId === appUserParticipant?.id ? score : state?.score,
    });
  };

  const setSoloScore = async (score: number) => {
    await updateHole({ score });
  };

  const advanceFromScoreEntry = () => {
    if (currentStep === 'bbbScores') {
      const missingScore = bbbHoleScores.find((entry) => !scoreComplete(entry.score));
      if (missingScore) {
        const participant = groupParticipants.find((item) => item.id === missingScore.participantId);
        Alert.alert('Missing score', `Enter a score for ${participant?.displayName ?? 'every player'} before continuing.`);
        return;
      }
      setStepIndex((index) => index + 1);
      return;
    }

    if (currentStep === 'skinsScores') {
      const missingScore = skinsHoleScores.find((entry) => !scoreComplete(entry.score));
      if (missingScore) {
        const participant = groupParticipants.find((item) => item.id === missingScore.participantId);
        Alert.alert('Missing score', `Enter a score for ${participant?.displayName ?? 'every player'} before continuing.`);
        return;
      }
      setStepIndex((index) => index + 1);
      return;
    }

    if (currentStep === 'standardGroupScores') {
      const missingScore = standardGroupHoleScores.find((entry) => !scoreComplete(entry.score));
      if (missingScore) {
        const participant = groupParticipants.find((item) => item.id === missingScore.participantId);
        Alert.alert('Missing score', `Enter a score for ${participant?.displayName ?? 'every player'} before continuing.`);
        return;
      }
      setStepIndex((index) => index + 1);
      return;
    }

    if (currentStep === 'score') {
      if (!scoreComplete(state?.score)) {
        Alert.alert(
          'Missing score',
          ironman
            ? 'Enter your team score before continuing.'
            : scramble
              ? 'Enter your team score before continuing.'
              : crossCardDualScore
                ? 'Enter your score before continuing.'
                : 'Enter the hole score before continuing.',
        );
        return;
      }
      setStepIndex((index) => index + 1);
      return;
    }

    if (currentStep === 'opponentScore') {
      if (!scoreComplete(state?.opponentScore)) {
        Alert.alert(
          'Missing score',
          crossCardDualScore
            ? `Enter ${round?.tournamentCrossCardTargetName ?? 'your cross-card player'}'s score before continuing.`
            : 'Enter the opponent team score before continuing.',
        );
        return;
      }
      setStepIndex((index) => index + 1);
    }
  };

  const renderCompactScoreRows = (
    rows: Array<{
      id: string;
      name: string;
      meta?: string | null;
      score: number | null | undefined;
      onChange: (score: number) => void;
      active?: boolean;
    }>,
    actionTitle: string,
  ) => (
    <View style={styles.compactScoreSection}>
      {rows.map((row) => (
        <View key={row.id} style={[styles.compactScoreRow, row.active ? styles.compactScoreRowActive : null]}>
          <View style={styles.compactScoreIdentity}>
            <View style={styles.compactScoreAvatar}>
              <Text style={styles.compactScoreAvatarText}>{getParticipantInitials(row.name)}</Text>
            </View>
            <View style={styles.compactScoreNameWrap}>
              <Text style={styles.compactScoreName}>{row.name}</Text>
              {row.meta ? <Text style={styles.compactScoreMeta}>{row.meta}</Text> : null}
            </View>
          </View>

          <View style={styles.compactScoreStepper}>
            <Pressable onPress={() => row.onChange(bumpScore(row.score, -1))} style={({ pressed }) => [styles.scoreStepperButton, pressed ? styles.scoreStepperPressed : null]}>
              <Text style={styles.scoreStepperSymbol}>-</Text>
            </Pressable>
            <View style={styles.scoreStepperValueWrap}>
              <Text style={styles.scoreStepperValue}>{typeof row.score === 'number' ? row.score : '-'}</Text>
            </View>
            <Pressable onPress={() => row.onChange(bumpScore(row.score, 1))} style={({ pressed }) => [styles.scoreStepperButton, pressed ? styles.scoreStepperPressed : null]}>
              <Text style={styles.scoreStepperSymbol}>+</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <AppButton title={actionTitle} onPress={advanceFromScoreEntry} />
    </View>
  );

  const renderSharedStatsStep = () => {
    const isPar3 = courseHole?.par === 3;

    if (currentStep === 'driveSafe') {
      return (
        <>
          <Text style={styles.questionTitle}>Was drive safe?</Text>
          {isPar3 ? <Text style={styles.helperText}>On a par 3, a safe drive is treated as GIR automatically.</Text> : null}
          <View style={styles.answerRow}>
            <AppButton
              title="Yes"
              onPress={() =>
                answerAndAdvance(
                  isPar3
                    ? { driveSafe: true, drivePenalty: false, hitGreen: true, girMissPenalty: false, nearGreen: false }
                    : { driveSafe: true, drivePenalty: false },
                )
              }
              style={{ flex: 1 }}
            />
            <AppButton title="No" onPress={() => answerAndAdvance({ driveSafe: false, drivePenalty: null, hitGreen: null })} variant="secondary" style={{ flex: 1 }} />
          </View>
        </>
      );
    }

    if (currentStep === 'drivePenalty') {
      return (
        <>
          <Text style={styles.questionTitle}>If no, was there a penalty?</Text>
          <View style={styles.answerRow}>
            <AppButton title="Yes" onPress={() => answerAndAdvance({ drivePenalty: true })} style={{ flex: 1 }} />
            <AppButton title="No" onPress={() => answerAndAdvance({ drivePenalty: false })} variant="secondary" style={{ flex: 1 }} />
          </View>
        </>
      );
    }

    if (currentStep === 'hitGreen') {
      return (
        <>
          <Text style={styles.questionTitle}>Green in regulation?</Text>
          <View style={styles.answerRow}>
            <AppButton title="Yes" onPress={() => answerAndAdvance({ hitGreen: true, girMissPenalty: false, nearGreen: false })} style={{ flex: 1 }} />
            <AppButton title="No" onPress={() => answerAndAdvance({ hitGreen: false, girMissPenalty: null, nearGreen: null })} variant="secondary" style={{ flex: 1 }} />
          </View>
        </>
      );
    }

    if (currentStep === 'girMissPenalty') {
      return (
        <>
          <Text style={styles.questionTitle}>After the green miss, was there a penalty?</Text>
          <View style={styles.answerRow}>
            <AppButton title="Yes" onPress={() => answerAndAdvance({ girMissPenalty: true, nearGreen: false })} style={{ flex: 1 }} />
            <AppButton title="No" onPress={() => answerAndAdvance({ girMissPenalty: false, nearGreen: null })} variant="secondary" style={{ flex: 1 }} />
          </View>
        </>
      );
    }

    if (currentStep === 'nearGreen') {
      return (
        <>
          <Text style={styles.questionTitle}>Near green within 25 yards?</Text>
          <View style={styles.answerRow}>
            <AppButton title="Yes" onPress={() => answerAndAdvance({ nearGreen: true })} style={{ flex: 1 }} />
            <AppButton title="No" onPress={() => answerAndAdvance({ nearGreen: false })} variant="secondary" style={{ flex: 1 }} />
          </View>
        </>
      );
    }

    if (currentStep === 'putts') {
      return (
        <>
          <Text style={styles.questionTitle}>Putts</Text>
          <Text style={styles.helperText}>Choose the total putts for this hole.</Text>
          <View style={styles.answerRow}>
            <AppButton title="1" onPress={() => answerAndAdvance({ totalPutts: 1 })} compact style={styles.compactAnswerButton} />
            <AppButton title="2" onPress={() => answerAndAdvance({ totalPutts: 2 })} compact variant="secondary" style={styles.compactAnswerButton} />
            <AppButton title="3" onPress={() => answerAndAdvance({ totalPutts: 3 })} compact variant="secondary" style={styles.compactAnswerButton} />
          </View>
        </>
      );
    }

    return null;
  };

  const bbbWinnerSummaryCards = useMemo(() => ([
    { label: 'Bingo', value: bbbWinnerLabel(groupParticipants, state?.bingoWinnerId), tone: styles.bbbWinnerCardBingo },
    { label: 'Bango', value: bbbWinnerLabel(groupParticipants, state?.bangoWinnerId), tone: styles.bbbWinnerCardBango },
    { label: 'Bongo', value: bbbWinnerLabel(groupParticipants, state?.bongoWinnerId), tone: styles.bbbWinnerCardBongo },
  ]), [groupParticipants, state?.bangoWinnerId, state?.bingoWinnerId, state?.bongoWinnerId]);

  useEffect(() => {
    if (stepIndex > steps.length - 1) {
      setStepIndex(Math.max(steps.length - 1, 0));
    }
  }, [stepIndex, steps.length]);

  useEffect(() => {
    setHoleSaveStatus('idle');
  }, [holeNumber, round?.id]);

  useEffect(() => {
    if (!round || !user?.id || !getRegularRoundBackendGameType(round)) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      if (!shouldRetryRegularRoundSyncNow(round)) return;
      kickOffBackgroundRegularRoundSync(round, 'app_resume');
    });

    return () => subscription.remove();
  }, [round, user?.id]);

  useEffect(() => {
    if (!round || !user?.id || !getRegularRoundBackendGameType(round)) return;

    const syncState = round.regularRoundBackendSync;
    if (!syncState?.retryScheduledAt) return;

    const retryAt = new Date(syncState.retryScheduledAt).getTime();
    const delayMs = Math.max(retryAt - Date.now(), 0);
    const timer = setTimeout(async () => {
      kickOffBackgroundRegularRoundSync(round, 'retry_window_open');
    }, delayMs);

    return () => clearTimeout(timer);
  }, [round, user?.id]);

  useFocusEffect(React.useCallback(() => {
    if (!round || !user?.id || !getRegularRoundBackendGameType(round) || !shouldRetryRegularRoundSyncNow(round)) {
      return undefined;
    }

    kickOffBackgroundRegularRoundSync(round, 'hole_focus');
    return undefined;
  }, [round, user?.id]));

  useEffect(() => {
    if (!round || !state || !courseHole) return;

    const defaultScore = courseHole.par;
    const patch: Partial<HoleDraft> = {};

    if (!standardGroupRound) {
      if (!scoreComplete(state.score)) {
        patch.score = defaultScore;
      }
    }

    if (round.roundMode === 'casual_group' && groupParticipants.length > 0) {
      const nextGroupScores = buildDefaultGroupScores(state, groupParticipants, defaultScore);
      const currentGroupScores = ensureGroupScoresForHole(state, groupParticipants);
      const groupScoresChanged = nextGroupScores.some((entry, index) => (
        currentGroupScores[index]?.participantId !== entry.participantId
        || currentGroupScores[index]?.score !== entry.score
      ));

      if (groupScoresChanged) {
        patch.groupScores = nextGroupScores;
      }

      const appUserParticipant = groupParticipants.find((participant) => participant.type === 'app_user') ?? groupParticipants[0];
      const appUserScore = nextGroupScores.find((entry) => entry.participantId === appUserParticipant?.id)?.score;
      if (!scoreComplete(state.score) && typeof appUserScore === 'number') {
        patch.score = appUserScore;
      }
    }

    if (Object.keys(patch).length === 0) return;

    const nextRound: LocalRoundDraft = {
      ...round,
      holes: round.holes.map((hole) => (hole.hole === holeNumber ? { ...hole, ...patch } : hole)),
    };

    setRound(nextRound);
    void saveDraftRound(nextRound);
  }, [courseHole, groupParticipants, holeNumber, round, standardGroupRound, state]);

  if (checkingEntryAccess) {
    return <BrandWatermarkBackground screenName="HoleEditorScreen-loading"><View style={styles.loading}><Text style={styles.subtitle}>Checking group-round access...</Text></View></BrandWatermarkBackground>;
  }

  if (entryBlockedMessage) {
    return <BrandWatermarkBackground screenName="HoleEditorScreen-blocked"><View style={styles.loading}><Text style={styles.subtitle}>{entryBlockedMessage}</Text></View></BrandWatermarkBackground>;
  }

  if (!round || !courseHole || !state) {
    return <View style={styles.loading}><Text style={styles.subtitle}>Loading hole...</Text></View>;
  }

  const syncSummary = getPendingScoreSyncSummary(round);
  const previousHoleNumber = getPreviousHoleNumber(round, holeNumber);
  const nextHoleNumber = getNextHoleNumber(round, holeNumber);
  const isFirstSequenceHole = isFirstHoleInSequence(round, holeNumber);
  const isLastSequenceHole = isLastHoleInSequence(round, holeNumber);
  const tournamentContextLine = round.roundMode === 'tournament'
    ? (ironman || scramble
        ? [
            round.tournamentTeamName ? `Team ${round.tournamentTeamName}` : null,
            round.startingHole ? `Start Hole ${round.startingHole}` : null,
            ironman && round.tournamentOpponentTeamName ? `Opponent ${round.tournamentOpponentTeamName}` : null,
          ].filter(Boolean).join(' · ')
        : [
            round.tournamentPlayGroupName ? `Group ${round.tournamentPlayGroupName}` : null,
            round.tournamentTeeTime ? `Tee Time ${formatTeeTime(round.tournamentTeeTime)}` : null,
            round.tournamentCrossCardTargetName ? `Cross-Card ${round.tournamentCrossCardTargetName}` : null,
          ].filter(Boolean).join(' · '))
    : '';

  const updateHole = async (patch: Partial<HoleDraft>) => {
    setHoleSaveStatus('idle');
    const next: LocalRoundDraft = {
      ...round,
      currentHole: holeNumber,
      holes: round.holes.map((hole) => (hole.hole === holeNumber ? { ...hole, ...patch } : hole)),
    };
    setRound(next);
    await saveDraftRound(next);
  };

  const updateWolfDecision = async (decision: WolfHoleDecisionDraft) => {
    if (!wolfRound || !wolfCurrentParticipantId) return;

    const nextWolfHoleDecisions = {
      ...(round.wolfHoleDecisions ?? {}),
      [holeNumber]: {
        wolfParticipantId: wolfCurrentParticipantId,
        partnerParticipantId: decision.partnerParticipantId,
        isLoneWolf: decision.isLoneWolf,
        isBlindWolf: decision.isBlindWolf,
      },
    };

    const next: LocalRoundDraft = {
      ...round,
      currentHole: holeNumber,
      wolfHoleDecisions: nextWolfHoleDecisions,
      holes: round.holes.map((hole) => (
        hole.hole === holeNumber
          ? {
              ...hole,
              wolfPartnerParticipantId: decision.partnerParticipantId,
              wolfIsLoneWolf: decision.isLoneWolf,
              wolfIsBlindWolf: decision.isBlindWolf,
              wolfWinningSide: null,
            }
          : hole
      )),
    };

    setHoleSaveStatus('idle');
    setRound(next);
    await saveDraftRound(next);
  };

  const answerAndAdvance = async (patch: Partial<HoleDraft>) => {
    await updateHole(patch);
    setStepIndex((index) => index + 1);
  };

  const chooseWolfPartner = async (partnerParticipantId: string) => {
    if (!wolfCurrentParticipantId) return;
    await updateWolfDecision({
      wolfParticipantId: wolfCurrentParticipantId,
      partnerParticipantId,
      isLoneWolf: false,
      isBlindWolf: false,
    });
  };

  const chooseWolfSolo = async (isBlindWolf: boolean) => {
    if (!wolfCurrentParticipantId) return;
    await updateWolfDecision({
      wolfParticipantId: wolfCurrentParticipantId,
      partnerParticipantId: null,
      isLoneWolf: true,
      isBlindWolf,
    });
  };

  const updateBbbWinner = async (category: BingoBangoBongoCategory, participantId: string) => {
    if (!bbbRound) return;
    await answerAndAdvance({
      [category]: participantId,
    } as Partial<HoleDraft>);
  };

  const goBack = () => {
    setStepIndex((index) => Math.max(index - 1, 0));
  };

  const goToHole = async (targetHole: number) => {
    const nextRound = {
      ...round,
      currentHole: targetHole,
    };
    setRound(nextRound);
    await saveDraftRound(nextRound);
    router.replace(`/round/hole/${targetHole}`);
  };

  const goToPreviousHole = async () => {
    if (isFirstSequenceHole) return;
    await goToHole(previousHoleNumber);
  };

  const showSavedFeedback = async () => {
    setHoleSaveStatus('saved');
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  };

  const handleSaveHolePress = async () => {
    if (holeSaveStatus === 'saving' || holeSaveStatus === 'saved') return;
    setHoleSaveStatus('saving');
    try {
      const saveSucceeded = await confirmAndAdvance();
      if (!saveSucceeded) {
        setHoleSaveStatus('idle');
      }
    } catch (error) {
      setHoleSaveStatus('idle');
      throw error;
    }
  };

  const renderSaveHoleButton = (title: string) => (
    <Pressable
      onPress={() => {
        void handleSaveHolePress();
      }}
      disabled={holeSaveStatus !== 'idle'}
      style={({ pressed }) => [
        styles.saveHoleButton,
        holeSaveStatus !== 'idle' ? styles.saveHoleButtonSaved : null,
        holeSaveStatus !== 'idle' ? styles.saveHoleButtonDisabled : null,
        pressed ? styles.saveHoleButtonPressed : null,
      ]}
    >
      {holeSaveStatus !== 'idle' ? <MaterialIcons name="check-circle" size={18} color="#0f5f2c" /> : null}
      <Text style={[styles.saveHoleButtonText, holeSaveStatus !== 'idle' ? styles.saveHoleButtonTextSaved : null]}>
        {holeSaveStatus === 'saving' ? 'Saving...' : holeSaveStatus === 'saved' ? 'Hole Saved' : title}
      </Text>
    </Pressable>
  );

  const guardForcedHoleExit = (onAllowed: () => void) => {
    if (mustHoleOut && !scoreComplete(state.score)) {
      Alert.alert(
        'Hole-out required',
        `Hole ${holeNumber} must be holed out before leaving this screen. Record every stroke for this hole first.`,
      );
      return;
    }
    onAllowed();
  };

  const retryQueuedScores = async () => {
    if (!round.backendRoundId || !user?.id || syncSummary.pendingCount === 0) return;
    setRetryingSync(true);
    try {
      const retried = await retryPendingTournamentHoleSyncs({
        round,
        userId: user.id,
      });
      setRound(retried.round);
      await saveDraftRound(retried.round);
      if (retried.failedCount === 0) {
        setSyncMessage('All queued hole scores synced.');
      } else {
        setSyncMessage(`Synced ${retried.syncedCount}, still pending ${getPendingScoreSyncSummary(retried.round).pendingCount}.`);
      }
    } catch (error: any) {
      console.error(error?.message ?? 'Retry sync failed');
      setSyncMessage('Retry did not complete. Scores remain queued on this phone.');
    } finally {
      setRetryingSync(false);
    }
  };

  const saveBbbHoleAndAdvance = async () => {
    if (!(await requireOfficialGroupRoundAccess(round))) return false;

    const missingScore = bbbHoleScores.find((entry) => !scoreComplete(entry.score));
    if (missingScore) {
      const participant = groupParticipants.find((item) => item.id === missingScore.participantId);
      Alert.alert('Missing score', `Enter a score for ${participant?.displayName ?? 'every player'} before saving the hole.`);
      return false;
    }

    if (!state.bingoWinnerId || !state.bangoWinnerId || !state.bongoWinnerId) {
      Alert.alert('Missing BBB winner', 'Select Bingo, Bango, and Bongo winners before saving the hole.');
      return false;
    }

    const appUserParticipant = groupParticipants.find((participant) => participant.type === 'app_user') ?? groupParticipants[0];
    const appUserScore = bbbHoleScores.find((entry) => entry.participantId === appUserParticipant?.id)?.score ?? null;

    const finalizedHole: HoleDraft = {
      ...state,
      score: appUserScore,
      groupScores: bbbHoleScores,
    };

    let nextRound: LocalRoundDraft = queueRegularRoundHoleSync({
      ...round,
      currentHole: nextHoleNumber,
      holes: round.holes.map((hole) => (hole.hole === holeNumber ? finalizedHole : hole)),
    }, holeNumber);

    setRound(nextRound);
    await saveDraftRound(nextRound);
    await showSavedFeedback();
    if (__DEV__) {
      console.debug('[regular-round-sync] local_hole_save_success', {
        roundLocalId: nextRound.id,
        backendRoundId: nextRound.backendRoundId ?? null,
        gameType: 'bingo_bango_bongo',
        holeNumber,
      });
      console.debug('[regular-round-sync] hole_chunks_queued', {
        roundLocalId: nextRound.id,
        backendRoundId: nextRound.backendRoundId ?? null,
        gameType: 'bingo_bango_bongo',
        holeNumber,
        pendingCount: nextRound.regularRoundBackendSync?.chunks?.filter((chunk) => chunk.status !== 'synced' && chunk.status !== 'cancelled').length ?? 0,
      });
      console.debug('[regular-round-sync] advance_allowed_before_backend_sync', {
        roundLocalId: nextRound.id,
        holeNumber,
        nextHoleNumber,
        gameType: 'bingo_bango_bongo',
      });
    }
    applyRegularRoundSyncUiState(nextRound);
    kickOffBackgroundRegularRoundSync(nextRound, 'save_hole', holeNumber);

    if (isLastSequenceHole) {
      router.replace('/round/review');
    } else {
      router.replace(`/round/hole/${nextHoleNumber}`);
    }
    return true;
  };

  const saveSkinsHoleAndAdvance = async () => {
    if (!(await requireOfficialGroupRoundAccess(round))) return false;

    const missingScore = skinsHoleScores.find((entry) => !scoreComplete(entry.score));
    if (missingScore) {
      const participant = groupParticipants.find((item) => item.id === missingScore.participantId);
      Alert.alert('Missing score', `Enter a score for ${participant?.displayName ?? 'every player'} before saving the hole.`);
      return false;
    }

    const resolved = resolveSkinsHole(
      skinsHoleScores.map((entry) => ({ participantId: entry.participantId, score: entry.score ?? null })),
      skinsCarryoverCount,
    );

    if (!resolved) {
      Alert.alert('Skins result unavailable', 'Every player needs a gross score before Skins can be resolved.');
      return false;
    }

    const appUserParticipant = groupParticipants.find((participant) => participant.type === 'app_user') ?? groupParticipants[0];
    const appUserScore = skinsHoleScores.find((entry) => entry.participantId === appUserParticipant?.id)?.score ?? null;

    const finalizedHole: HoleDraft = {
      ...state,
      score: appUserScore,
      groupScores: skinsHoleScores,
      skinsWinnerId: resolved.winnerParticipantId,
      skinsWinningScore: resolved.winningScore,
      skinsIsPush: resolved.isPush,
      skinsCarryoverCount: resolved.carryoverSkinCount,
      skinsAwardedCount: resolved.awardedSkinCount,
    };

    let nextRound: LocalRoundDraft = queueRegularRoundHoleSync({
      ...round,
      currentHole: nextHoleNumber,
      holes: round.holes.map((hole) => (hole.hole === holeNumber ? finalizedHole : hole)),
    }, holeNumber);

    setRound(nextRound);
    await saveDraftRound(nextRound);
    await showSavedFeedback();
    if (__DEV__) {
      console.debug('[regular-round-sync] local_hole_save_success', {
        roundLocalId: nextRound.id,
        backendRoundId: nextRound.backendRoundId ?? null,
        gameType: 'skins',
        holeNumber,
      });
      console.debug('[regular-round-sync] hole_chunks_queued', {
        roundLocalId: nextRound.id,
        backendRoundId: nextRound.backendRoundId ?? null,
        gameType: 'skins',
        holeNumber,
        pendingCount: nextRound.regularRoundBackendSync?.chunks?.filter((chunk) => chunk.status !== 'synced' && chunk.status !== 'cancelled').length ?? 0,
      });
      console.debug('[regular-round-sync] advance_allowed_before_backend_sync', {
        roundLocalId: nextRound.id,
        holeNumber,
        nextHoleNumber,
        gameType: 'skins',
      });
    }
    applyRegularRoundSyncUiState(nextRound);
    kickOffBackgroundRegularRoundSync(nextRound, 'save_hole', holeNumber);

    if (isLastSequenceHole) {
      router.replace('/round/review');
    } else {
      router.replace(`/round/hole/${nextHoleNumber}`);
    }
    return true;
  };

  const confirmAndAdvance = async () => {
    if (!(await requireOfficialGroupRoundAccess(round))) return false;

    if (bbbRound) {
      return saveBbbHoleAndAdvance();
    }
    if (skinsRound) {
      return saveSkinsHoleAndAdvance();
    }

    let groupScoresForSave = standardGroupHoleScores;
    const appUserParticipant = groupParticipants.find((participant) => participant.type === 'app_user') ?? groupParticipants[0];
    const appUserGroupScore = groupScoresForSave.find((entry) => entry.participantId === appUserParticipant?.id)?.score ?? null;
    const scoreForSave = standardGroupRound ? appUserGroupScore : state.score;

    if (standardGroupRound) {
      const missingScore = groupScoresForSave.find((entry) => !scoreComplete(entry.score));
      if (missingScore) {
        const participant = groupParticipants.find((item) => item.id === missingScore.participantId);
        Alert.alert('Missing score', `Enter a score for ${participant?.displayName ?? 'every player'} before saving the hole.`);
        return false;
      }
    }

    if (wolfRound) {
      if (wolfParticipantIds.length !== 4 || wolfOrderParticipantIds.length !== 4 || !sameParticipantSet(wolfParticipantIds, wolfOrderParticipantIds)) {
        Alert.alert('Wolf order unavailable', 'This Wolf round needs four players and a complete Wolf order before saving holes.');
        return false;
      }
      if (!wolfCurrentParticipantId || !wolfCurrentDecision) {
        Alert.alert('Choose Wolf decision', 'Pick a partner, Lone Wolf, or Blind Wolf before saving this hole.');
        return false;
      }
      if (wolfCurrentDecision.wolfParticipantId !== wolfCurrentParticipantId) {
        Alert.alert('Wolf decision mismatch', 'Refresh this hole and choose the Wolf decision again.');
        return false;
      }
    }

    if (
      round.roundMode === 'tournament' &&
      (round.tournamentScoringMode === 'team' || round.tournamentScoringMode === 'team_vs_team') &&
      !round.tournamentTeamId
    ) {
      Alert.alert(
        'Team assignment needed',
        round.lastSyncError ?? 'This team round cannot save until your tournament team is loaded.',
      );
      return false;
    }

    if (!scoreComplete(scoreForSave)) {
      Alert.alert(
        'Missing score',
        ironman
          ? 'Enter your team score before saving.'
          : crossCardDualScore
            ? 'Enter your score before saving.'
            : 'Enter the hole score before saving.',
      );
      return false;
    }

    if ((ironman || crossCardDualScore) && !scoreComplete(state.opponentScore)) {
      Alert.alert(
        crossCardDualScore ? 'Missing cross-card score' : 'Missing opponent score',
        crossCardDualScore
          ? `Enter ${round.tournamentCrossCardTargetName ?? 'your cross-card player'}'s score before saving.`
          : 'Enter the opponent team score before saving.',
      );
      return false;
    }

    if (statsEnabled && typeof state.totalPutts !== 'number') {
      Alert.alert('Missing putts', 'Choose 1, 2, or 3 putts before saving.');
      return false;
    }

    const finalized = finalizeHoleStats(
      statsEnabled
        ? { ...state, score: scoreForSave, groupScores: standardGroupRound ? groupScoresForSave : state.groupScores }
        : { ...state, score: scoreForSave, groupScores: standardGroupRound ? groupScoresForSave : state.groupScores, totalPutts: undefined, onePutt: undefined, threePutt: undefined },
      courseHole.par,
    );
    const finalizedWithNassau =
      nassauRound && nassauHoleScores.length >= 2
        ? (() => {
            if (nassauHoleScores.some((entry) => !scoreComplete(entry.score))) {
              return {
                ...finalized,
                nassauWinnerId: null,
                nassauWinningScore: null,
                nassauIsHalved: null,
              };
            }

            const resolved = determineNassauHoleResult({
              participantScores: nassauHoleScores.map((entry) => ({
                participantId: entry.participantId,
                score: Number(entry.score),
              })),
            });

            return {
              ...finalized,
              nassauWinnerId: resolved?.winnerParticipantId ?? null,
              nassauWinningScore: resolved?.winningScore ?? null,
              nassauIsHalved: resolved?.isHalved ?? null,
            };
          })()
        : finalized;
    const finalizedWithStableford = stablefordRound ? applyStablefordToHole(round, finalizedWithNassau) : finalizedWithNassau;

    let nextRound: LocalRoundDraft = {
      ...round,
      currentHole: nextHoleNumber,
      holes: round.holes.map((hole) => (hole.hole === holeNumber ? finalizedWithStableford : hole)),
      backendSyncState: round.tournamentId ? 'score_only' : round.backendSyncState,
      tournamentStablefordHandicapStatus:
        stablefordRound
          ? (finalizedWithStableford.stablefordHandicapStatus ?? round.tournamentStablefordHandicapStatus)
          : round.tournamentStablefordHandicapStatus,
    };

    if (stablefordRound) {
      nextRound = {
        ...nextRound,
        tournamentStablefordTotal: getStablefordRoundTotal(nextRound),
      };
    }

    if (round.tournamentId && round.backendRoundId && user?.id) {
      nextRound = queueTournamentHoleScoreSync(
        nextRound,
        holeNumber,
        finalizedWithStableford.score ?? 0,
        (ironman || crossCardDualScore) ? (finalizedWithStableford.opponentScore ?? null) : null,
      );
    }

    if (!round.tournamentId && getRegularRoundBackendGameType(nextRound)) {
      nextRound = queueRegularRoundHoleSync(nextRound, holeNumber);
    }

    setRound(nextRound);
    await saveDraftRound(nextRound);
    await showSavedFeedback();
    if (!round.tournamentId && getRegularRoundBackendGameType(nextRound)) {
      if (__DEV__) {
        console.debug('[regular-round-sync] local_hole_save_success', {
          roundLocalId: nextRound.id,
          backendRoundId: nextRound.backendRoundId ?? null,
          gameType: getRegularRoundBackendGameType(nextRound),
          holeNumber,
        });
        console.debug('[regular-round-sync] hole_chunks_queued', {
          roundLocalId: nextRound.id,
          backendRoundId: nextRound.backendRoundId ?? null,
          gameType: getRegularRoundBackendGameType(nextRound),
          holeNumber,
          pendingCount: nextRound.regularRoundBackendSync?.chunks?.filter((chunk) => chunk.status !== 'synced' && chunk.status !== 'cancelled').length ?? 0,
        });
        console.debug('[regular-round-sync] advance_allowed_before_backend_sync', {
          roundLocalId: nextRound.id,
          holeNumber,
          nextHoleNumber,
          gameType: getRegularRoundBackendGameType(nextRound),
        });
      }
      applyRegularRoundSyncUiState(nextRound);
      kickOffBackgroundRegularRoundSync(nextRound, 'save_hole', holeNumber);
    }

    if (round.tournamentId && round.backendRoundId && user?.id) {
      try {
        await syncTournamentHoleScore({
          round: nextRound,
          userId: user.id,
          holeNumber,
          strokes: finalizedWithStableford.score ?? 0,
          opponentScore: (ironman || crossCardDualScore) ? (finalizedWithStableford.opponentScore ?? null) : null,
        });
        const syncedRound = markTournamentHoleScoreSynced(nextRound, holeNumber);
        setRound(syncedRound);
        await saveDraftRound(syncedRound);
        setSyncMessage(`Hole ${holeNumber} score synced to tournament leaderboard.`);
      } catch (error: any) {
        console.error(error?.message ?? 'Hole score sync failed');
        const failedRound = markTournamentHoleScoreSyncFailed(
          nextRound,
          holeNumber,
          finalizedWithStableford.score ?? 0,
          error?.message ?? 'Sync failed',
          (ironman || crossCardDualScore) ? (finalizedWithStableford.opponentScore ?? null) : null,
        );
        setRound(failedRound);
        await saveDraftRound(failedRound);
        setSyncMessage('Signal was weak. Score is safely queued on this phone and will retry automatically.');
      }
    }

    if (isLastSequenceHole) {
      router.replace('/round/review');
    } else {
      router.replace(`/round/hole/${nextHoleNumber}`);
    }
    return true;
  };

  const handleResetHole = () => {
    const hasSavedHole = bbbRound
      ? bbbHoleScores.some((entry) => scoreComplete(entry.score)) || !!state.bingoWinnerId || !!state.bangoWinnerId || !!state.bongoWinnerId
      : skinsRound
        ? skinsHoleScores.some((entry) => scoreComplete(entry.score)) || !!state.skinsWinnerId || state.skinsIsPush === true
      : !!state.score;

    if (!hasSavedHole) return;

    Alert.alert(
      round.roundMode === 'tournament' ? 'Delete this hole score?' : 'Reset this hole?',
      round.roundMode === 'tournament'
        ? 'This clears the current hole locally and removes the backend score for this hole in a tournament round.'
        : bbbRound
          ? 'This clears Bingo, Bango, Bongo, and every player score for the current BBB hole.'
          : skinsRound
            ? 'This clears every player score and the resolved Skins result for the current hole.'
          : 'This clears the current hole data for this regular round.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: round.roundMode === 'tournament' ? 'Delete' : 'Reset',
          style: 'destructive',
          onPress: async () => {
            setDeletingHole(true);
            try {
              const nextWolfHoleDecisions = { ...(round.wolfHoleDecisions ?? {}) };
              delete nextWolfHoleDecisions[holeNumber];
              let nextRound: LocalRoundDraft = {
                ...round,
                wolfHoleDecisions: Object.keys(nextWolfHoleDecisions).length > 0 ? nextWolfHoleDecisions : null,
                holes: round.holes.map((hole) => (hole.hole === holeNumber ? { hole: holeNumber } : hole)),
              };

              nextRound = removeTournamentHoleScoreSync(nextRound, holeNumber);

              if (bbbRound && round.backendRoundGameId) {
                await deleteBbbHoleSync({
                  round,
                  holeNumber,
                });
                nextRound = {
                  ...nextRound,
                  bbbSyncState: 'synced',
                  bbbLastSyncAt: new Date().toISOString(),
                  bbbLastSyncError: null,
                };
                setSyncMessage(`Hole ${holeNumber} was removed from the shared BBB board.`);
              } else if (skinsRound && round.backendRoundGameId) {
                await deleteSkinsHoleSync({
                  round,
                  holeNumber,
                });
                nextRound = {
                  ...nextRound,
                  skinsSyncState: 'synced',
                  skinsLastSyncAt: new Date().toISOString(),
                  skinsLastSyncError: null,
                };
                setSyncMessage(`Hole ${holeNumber} was removed from the shared Skins board.`);
              } else if (round.tournamentId && round.backendRoundId && user?.id) {
                await deleteTournamentHoleScore({
                  round,
                  userId: user.id,
                  holeNumber,
                });
                setSyncMessage(`Hole ${holeNumber} was removed from the tournament round.`);
              }

              setRound(nextRound);
              await saveDraftRound(nextRound);
              setStepIndex(0);
            } catch (error: any) {
              console.error(error?.message ?? 'Delete hole failed');
              Alert.alert('Delete failed', 'This hole could not be removed. Please try again.');
            } finally {
              setDeletingHole(false);
            }
          },
        },
      ],
    );
  };

  const isGroup = round.roundMode === 'casual_group';
  const hasSavedHole = bbbRound
    ? bbbHoleScores.some((entry) => scoreComplete(entry.score)) || !!state.bingoWinnerId || !!state.bangoWinnerId || !!state.bongoWinnerId
    : skinsRound
      ? skinsHoleScores.some((entry) => scoreComplete(entry.score)) || !!state.skinsWinnerId || state.skinsIsPush === true
    : !!state.score;

  return (
    <BrandWatermarkBackground style={styles.screen} screenName="HoleEditorScreen">
      <CoalCreekHeader />
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
        <RoundHeader
          title={`Hole ${holeNumber}`}
          subtitle={`Par ${courseHole.par} · HCP ${courseHole.hcp} · ${courseHole.yards[round.tee]} yards`}
          badge={round.tee}
        />

        {round.roundMode === 'tournament' ? (
          <SectionCard>
            <Text style={styles.groupHeading}>{round.tournamentName ?? 'Tournament Round'}</Text>
            <Text style={styles.groupMeta}>
              {ironman
                ? `Ironman round: save ${round.tournamentTeamName ?? 'our team'} for the live board and ${round.tournamentOpponentTeamName ?? 'the opponent'} for compare and verify.`
                : scramble
                  ? `Scramble round: one score per hole for ${round.tournamentTeamName ?? 'your team'}.`
                  : crossCardDualScore
                    ? `Cross-card round: save your score and ${round.tournamentCrossCardTargetName ?? 'your cross-card player'}'s score on every hole.`
                    : statsEnabled
                      ? 'During the round, only score syncs to the backend for the live board. Stats post at the end of the round.'
                      : 'No Stats is on for this round, so only score is being tracked.'}
            </Text>
            {tournamentContextLine ? <Text style={styles.contextMeta}>{tournamentContextLine}</Text> : null}
            <View style={styles.tournamentNavRow}>
              <AppButton
                title="Tournament View"
                onPress={() => guardForcedHoleExit(() => router.push(`/tournament/${round.tournamentId}/yardage`))}
                variant="secondary"
                style={{ flex: 1 }}
              />
              <AppButton
                title="Leaderboard"
                onPress={() => guardForcedHoleExit(() => router.push(`/tournament/${round.tournamentId}/live`))}
                variant="secondary"
                style={{ flex: 1 }}
              />
            </View>
            {hasSavedHole ? (
              <View style={styles.deleteRow}>
                  <AppButton
                  title={deletingHole ? 'Deleting...' : 'Delete Hole Score'}
                  onPress={handleResetHole}
                  variant="secondary"
                  disabled={deletingHole}
                  style={{ flex: 1 }}
                />
              </View>
            ) : null}
          </SectionCard>
        ) : null}

        {false && isGroup && round?.group && !bbbRound && !skinsRound ? (
          <SectionCard>
            <Text style={styles.groupHeading}>{round?.group?.groupName}</Text>
            <Text style={styles.groupMeta}>
              {round?.group?.participants?.map((participant) => participant.displayName).join(' · ')}
            </Text>
            <Text style={styles.groupMeta}>
              Scorekeeper: {round?.group?.participants?.find((participant) => participant.isScorekeeper)?.displayName ?? 'Not set'}
            </Text>
            <View style={styles.navRow}>
              <AppButton
                title="Open Live Board"
                onPress={() => router.push('/round/live' as any)}
                variant="secondary"
                style={{ flex: 1 }}
              />
            </View>
          </SectionCard>
        ) : null}

        {skinsRound ? (
          <>
            <SectionCard style={{ gap: 12 }}>
              <Text style={styles.syncTitle}>Skins In Play</Text>
              <Text style={styles.syncBody}>
                Hole {holeNumber} is worth {skinsCarryoverCount} skin{skinsCarryoverCount === 1 ? '' : 's'}.
              </Text>
              <Text style={styles.contextMeta}>
                {skinsPreview
                  ? skinsPreview.isPush
                    ? `Current preview: push at ${skinsPreview.winningScore}. Next hole would play for ${skinsCarryoverCount + 1}.`
                    : `${groupParticipants.find((participant) => participant.id === skinsPreview.winnerParticipantId)?.displayName ?? 'Winner'} would win ${skinsPreview.awardedSkinCount} skin${skinsPreview.awardedSkinCount === 1 ? '' : 's'} with ${skinsPreview.winningScore}.`
                  : 'Enter every player score to preview the Skins result before saving.'}
              </Text>
              <PlayerCardGrid>
                {Array.from({ length: 4 }, (_, index) => {
                  const participant = groupParticipants[index];
                  const totalsRow = participant
                    ? (skinsSummary?.totals ?? []).find((row) => row.participantId === participant.id) ?? null
                    : null;

                  if (!participant || !totalsRow) {
                    return (
                      <PlayerCard
                        key={`skins-total-open-${index + 1}`}
                        title={`Seat ${index + 1}`}
                        subtitle="Open seat"
                        meta="No player in this slot"
                        placeholder
                        disabled
                      />
                    );
                  }

                  return (
                    <PlayerCard
                      key={`skins-total-card-${participant.id}`}
                      title={totalsRow.displayName}
                      subtitle={`${totalsRow.totalSkinCountWon} skins`}
                      meta={`Holes won ${totalsRow.skinsWon} · Gross ${totalsRow.grossTotal}`}
                    />
                  );
                })}
              </PlayerCardGrid>
              {round.backendRoundId || hasSavedHole ? (
                <View style={styles.navRow}>
                  {round.backendRoundId ? (
                    <AppButton
                      title="Open Skins Live Board"
                      onPress={() => router.push('/round/skins-live' as any)}
                      variant="secondary"
                      style={{ flex: 1 }}
                    />
                  ) : null}
                  {hasSavedHole ? (
                    <AppButton
                      title={deletingHole ? 'Resetting...' : 'Reset This Hole'}
                      onPress={handleResetHole}
                      variant="secondary"
                      disabled={deletingHole}
                      style={{ flex: 1 }}
                    />
                  ) : null}
                </View>
              ) : null}
            </SectionCard>
          </>
        ) : null}

        {bbbRound ? (
          <>
            <SectionCard style={{ gap: 12 }}>
              <Text style={styles.syncTitle}>Running BBB Totals</Text>
              <Text style={styles.syncBody}>
                {bbbSummary?.completedHoleCount ?? 0} of {round.holes.length} holes have full Bingo Bango Bongo results.
              </Text>
              <PlayerCardGrid>
                {Array.from({ length: 4 }, (_, index) => {
                  const participant = groupParticipants[index];
                  const totalsRow = participant
                    ? (bbbSummary?.totals ?? []).find((row) => row.participantId === participant.id) ?? null
                    : null;

                  if (!participant || !totalsRow) {
                    return (
                      <PlayerCard
                        key={`bbb-total-open-${index + 1}`}
                        title={`Seat ${index + 1}`}
                        subtitle="Open seat"
                        meta="No player in this slot"
                        placeholder
                        disabled
                      />
                    );
                  }

                  return (
                    <PlayerCard
                      key={`bbb-total-card-${participant.id}`}
                      title={totalsRow.displayName}
                      subtitle={`${totalsRow.total} pts   ${formatRelativeToPar(bbbScoreRelativeByParticipant.get(participant.id) ?? 0)}`}
                      meta={`B ${totalsRow.bingo}   Ba ${totalsRow.bango}   Bo ${totalsRow.bongo}`}
                    />
                  );
                })}
              </PlayerCardGrid>
            </SectionCard>

            <View style={{ display: 'none' }}>
              <View style={styles.bbbWinnerSummaryRow}>
              {bbbWinnerSummaryCards.map((entry) => (
                <View key={entry.label} style={[styles.bbbWinnerSummaryCard, entry.tone]}>
                  <Text style={styles.bbbWinnerSummaryLabel}>{entry.label}</Text>
                  <Text style={styles.bbbWinnerSummaryValue}>{entry.value}</Text>
                </View>
              ))}
              </View>

              <View style={styles.bbbVerificationRow}>
              {Array.from({ length: 4 }, (_, index) => {
                const participant = groupParticipants[index];
                if (!participant) {
                  return (
                    <View key={`bbb-verify-open-${index + 1}`} style={[styles.bbbVerifyCard, styles.bbbVerifyPlaceholder]}>
                      <Text style={styles.bbbVerifyName}>Seat {index + 1}</Text>
                      <Text style={styles.bbbVerifyScore}>-</Text>
                    </View>
                  );
                }

                const scoreEntry = bbbHoleScores.find((entry) => entry.participantId === participant.id);
                return (
                  <View key={`bbb-verify-${participant.id}`} style={styles.bbbVerifyCard}>
                    <Text style={styles.bbbVerifyName}>{participant.displayName}</Text>
                    <Text style={styles.bbbVerifyScore}>{typeof scoreEntry?.score === 'number' ? scoreEntry.score : '-'}</Text>
                  </View>
                );
              })}
              </View>
            </View>

            {round.backendRoundId || hasSavedHole ? (
              <View style={styles.navRow}>
                {round.backendRoundId ? (
                  <AppButton
                    title="Open BBB Live Board"
                    onPress={() => router.push('/round/bbb-live' as any)}
                    variant="secondary"
                    style={{ flex: 1 }}
                  />
                ) : null}
                {hasSavedHole ? (
                  <AppButton
                    title={deletingHole ? 'Resetting...' : 'Reset This Hole'}
                    onPress={handleResetHole}
                    variant="secondary"
                    disabled={deletingHole}
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}

        <View style={styles.toolbar}>
          <AppButton title="Fairway" onPress={() => setImageMode('fairway')} variant={imageMode === 'fairway' ? 'primary' : 'secondary'} style={{ flex: 1 }} />
          <AppButton title="Green" onPress={() => setImageMode('green')} variant={imageMode === 'green' ? 'primary' : 'secondary'} style={{ flex: 1 }} />
        </View>

        <Image source={holeImages[holeNumber][imageMode]} resizeMode="cover" style={styles.mainImage} />

        {wolfRound ? (
          <SectionCard style={{ gap: 12 }}>
            <Text style={styles.syncTitle}>Wolf Decision</Text>
            <Text style={styles.syncBody}>
              Hole {holeNumber} Wolf: {wolfCurrentParticipant?.displayName ?? 'Waiting for Wolf order'}
            </Text>
            <Text style={styles.contextMeta}>
              {wolfCurrentParticipant
                ? `Order spot ${(wolfOrderParticipantIds.indexOf(wolfCurrentParticipant.id) + 1)} of ${wolfOrderParticipantIds.length || 4}`
                : 'Set the Wolf order on the group start screen.'}
            </Text>
            {wolfCurrentDecision ? (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryText}>
                  {wolfCurrentDecision.isBlindWolf
                    ? 'Current choice: Blind Wolf'
                    : wolfCurrentDecision.isLoneWolf
                      ? 'Current choice: Lone Wolf'
                      : `Current choice: Partner with ${groupParticipants.find((participant) => participant.id === wolfCurrentDecision.partnerParticipantId)?.displayName ?? 'partner'}`}
                </Text>
                {wolfHunters.length > 0 ? (
                  <Text style={styles.summaryText}>
                    Hunters: {wolfHunters.map((participant) => participant.displayName).join(', ')}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.helperText}>Choose the Wolf side before saving this hole.</Text>
            )}
            <PlayerCardGrid>
              {wolfPartnerOptions.map((participant) => (
                <PlayerCard
                  key={`wolf-partner-${participant.id}`}
                  title={participant.displayName}
                  subtitle="Partner"
                  meta="Wolf teams with this player"
                  selected={wolfCurrentDecision?.partnerParticipantId === participant.id && !wolfCurrentDecision.isLoneWolf}
                  onPress={() => {
                    void chooseWolfPartner(participant.id);
                  }}
                />
              ))}
            </PlayerCardGrid>
            <View style={styles.answerRow}>
              <AppButton
                title="Lone Wolf"
                onPress={() => {
                  void chooseWolfSolo(false);
                }}
                variant={wolfCurrentDecision?.isLoneWolf && !wolfCurrentDecision.isBlindWolf ? 'primary' : 'secondary'}
                style={{ flex: 1 }}
              />
              <AppButton
                title="Blind Wolf"
                onPress={() => {
                  void chooseWolfSolo(true);
                }}
                variant={wolfCurrentDecision?.isBlindWolf ? 'primary' : 'secondary'}
                style={{ flex: 1 }}
              />
            </View>
            <Text style={styles.helperText}>
              Lone Wolf is worth 3 points. Blind Wolf is worth 6 points and locks the Wolf in solo before partner selection.
            </Text>
          </SectionCard>
        ) : null}

        {!bbbRound && !skinsRound ? (
          <SectionCard>
            <View style={styles.progressRow}>
              <Text style={styles.progressText}>{`Step ${stepIndex + 1} of ${steps.length}`}</Text>
              <Text style={styles.progressText}>{currentStep === 'save' ? 'Ready to save' : 'Auto-advances after each answer'}</Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${((stepIndex + 1) / steps.length) * 100}%` }]} />
            </View>
            {round.roundMode !== 'tournament' && hasSavedHole ? (
              <View style={styles.deleteRow}>
                <AppButton
                  title={deletingHole ? 'Resetting...' : 'Reset This Hole'}
                  onPress={handleResetHole}
                  variant="secondary"
                  disabled={deletingHole}
                  style={{ flex: 1 }}
                />
              </View>
            ) : null}
            {round.roundMode === 'solo' ? (
              <View style={styles.deleteRow}>
                <AppButton
                  title="Open Live Board"
                  onPress={() => router.push('/round/live' as any)}
                  variant="secondary"
                  style={{ flex: 1 }}
                />
              </View>
            ) : null}
            {nassauRound && round.backendRoundId ? (
              <View style={styles.deleteRow}>
                <AppButton
                  title="Open Nassau Live Board"
                  onPress={() => router.push('/round/nassau-live' as any)}
                  variant="secondary"
                  style={{ flex: 1 }}
                />
              </View>
            ) : null}
          </SectionCard>
        ) : null}

        {round.roundMode === 'tournament' ? (
          <SectionCard>
            <Text style={styles.syncTitle}>Sync Status</Text>
            <Text style={styles.syncBody}>
              {syncSummary.pendingCount === 0
                ? 'All saved scores are synced.'
                : `${syncSummary.pendingCount} hole score${syncSummary.pendingCount === 1 ? '' : 's'} queued on this phone.`}
            </Text>
            {round.lastSyncError ? <Text style={styles.syncError}>Last error: {round.lastSyncError}</Text> : null}
            {syncSummary.pendingCount > 0 ? (
              <View style={styles.retryRow}>
                <AppButton
                  title={retryingSync ? 'Retrying...' : 'Retry Pending Sync'}
                  onPress={retryQueuedScores}
                  variant="secondary"
                  disabled={retryingSync}
                  style={{ flex: 1 }}
                />
              </View>
            ) : null}
          </SectionCard>
        ) : null}

        {stablefordRound ? (
          <SectionCard>
            <Text style={styles.syncTitle}>{stablefordModeLabel}</Text>
            <Text style={styles.syncBody}>
              Running total: {stablefordRunningTotal ?? 0} points through {stablefordScoredHoles} hole{stablefordScoredHoles === 1 ? '' : 's'}.
            </Text>
            {stablefordPreview ? (
              <Text style={styles.contextMeta}>
                Hole {holeNumber} preview: {stablefordPreview.points} points ({stablefordPreview.resultLabel}
                {stablefordPreview.basis === 'net'
                  ? `, net ${stablefordPreview.netStrokes}, handicap ${stablefordPreview.handicapStrokes >= 0 ? '+' : ''}${stablefordPreview.handicapStrokes}`
                  : ''})
              </Text>
            ) : null}
            {stablefordModifiedPresetSummary ? <Text style={styles.syncBody}>{stablefordModifiedPresetSummary}</Text> : null}
            {stablefordRule ? (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryText}>Hole {holeNumber} special rule</Text>
                {stablefordRule.must_hole_out ? <Text style={styles.summaryText}>Must hole out before leaving this hole.</Text> : null}
                {stablefordRule.track_stroke_tally ? <Text style={styles.summaryText}>Record actual strokes for this hole.</Text> : null}
              </View>
            ) : null}
            {round.tournamentStablefordMode === 'net' && round.tournamentStablefordHandicapStatus === 'ready' ? (
              <Text style={styles.syncBody}>
                Handicap scoring is on. Player handicap {formatHandicapNumber(round.tournamentPlayerHandicap) ?? '-'} maps to course handicap {formatHandicapNumber(round.tournamentCourseHandicap) ?? '-'} from the selected tee and rating. This hole receives {stablefordPreview?.handicapStrokes ?? 0} stroke{Math.abs(stablefordPreview?.handicapStrokes ?? 0) === 1 ? '' : 's'}.
              </Text>
            ) : null}
            {round.tournamentStablefordMode === 'net' && round.tournamentStablefordHandicapStatus === 'fallback_gross_pending_handicap' ? (
              <Text style={styles.syncError}>
                {round.tournamentStablefordHandicapSource === 'missing_profile'
                  ? 'Net Stableford needs your handicap on file. Gross hole results are being used until your player handicap is added to your profile.'
                  : round.tournamentStablefordHandicapSource === 'missing_rating'
                    ? 'Net Stableford needs a valid tee and rating pairing. Gross hole results are being used until course handicap can be calculated.'
                    : round.tournamentStablefordHandicapSource === 'disabled'
                      ? 'This event is marked as Net Stableford, but handicap scoring is not enabled in the tournament setup yet.'
                      : 'Net Stableford handicap data is incomplete, so gross hole results are being used for now.'}
              </Text>
            ) : null}
          </SectionCard>
        ) : null}

        {syncMessage && !bbbRound ? (
          <SectionCard>
            <Text style={styles.syncMessage}>{syncMessage}</Text>
            {skinsRound && round.skinsLastSyncError ? (
              <Text style={styles.syncError}>Skins sync error: {round.skinsLastSyncError}</Text>
            ) : null}
          </SectionCard>
        ) : null}

        {bbbRound ? (
          <>
            <SectionCard style={{ display: 'none' }}>
              <Text style={styles.syncTitle}>Running BBB Totals</Text>
              <Text style={styles.syncBody}>
                {bbbSummary?.completedHoleCount ?? 0} of {round.holes.length} holes have full Bingo Bango Bongo results.
              </Text>
              <PlayerCardGrid>
                {Array.from({ length: 4 }, (_, index) => {
                  const participant = groupParticipants[index];
                  const totalsRow = participant
                    ? (bbbSummary?.totals ?? []).find((row) => row.participantId === participant.id) ?? null
                    : null;

                  if (!participant || !totalsRow) {
                    return (
                      <PlayerCard
                        key={`bbb-total-open-${index + 1}`}
                        title={`Seat ${index + 1}`}
                        subtitle="Open seat"
                        meta="No player in this slot"
                        placeholder
                        disabled
                      />
                    );
                  }

                  return (
                    <PlayerCard
                      key={`bbb-total-card-${participant.id}`}
                      title={totalsRow.displayName}
                      subtitle={`${totalsRow.total} pts   ${formatRelativeToPar(bbbScoreRelativeByParticipant.get(participant.id) ?? 0)}`}
                      meta={`B ${totalsRow.bingo}   Ba ${totalsRow.bango}   Bo ${totalsRow.bongo}`}
                      selected={participant.id === state.bingoWinnerId || participant.id === state.bangoWinnerId || participant.id === state.bongoWinnerId}
                    />
                  );
                })}
              </PlayerCardGrid>
              {round.backendRoundId || hasSavedHole ? (
                <View style={styles.navRow}>
                  {round.backendRoundId ? (
                    <AppButton
                      title="Open BBB Live Board"
                      onPress={() => router.push('/round/bbb-live' as any)}
                      variant="secondary"
                      style={{ flex: 1 }}
                    />
                  ) : null}
                  {hasSavedHole ? (
                    <AppButton
                      title={deletingHole ? 'Resetting...' : 'Reset This Hole'}
                      onPress={handleResetHole}
                      variant="secondary"
                      disabled={deletingHole}
                      style={{ flex: 1 }}
                    />
                  ) : null}
                </View>
              ) : null}
              <View style={styles.bbbTotalsGrid}>
                {(bbbSummary?.totals ?? []).map((row) => (
                  <View key={row.participantId} style={styles.bbbTotalCard}>
                    <Text style={styles.bbbTotalName}>{row.displayName}</Text>
                    <Text style={styles.bbbTotalPoints}>
                      {row.total} pts   {formatRelativeToPar(bbbScoreRelativeByParticipant.get(row.participantId) ?? 0)}
                    </Text>
                    <Text style={styles.bbbTotalMeta}>B {row.bingo} · Ba {row.bango} · Bo {row.bongo}</Text>
                  </View>
                ))}
              </View>
            </SectionCard>

            <SectionCard style={{ gap: 16 }}>
              <View style={styles.bbbWinnerSummaryRow}>
                {bbbWinnerSummaryCards.map((entry) => (
                  <View key={`action-${entry.label}`} style={[styles.bbbWinnerSummaryCard, entry.tone]}>
                    <Text style={styles.bbbWinnerSummaryLabel}>{entry.label}</Text>
                    <Text style={styles.bbbWinnerSummaryValue}>{entry.value}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.bbbVerificationRow}>
                {Array.from({ length: 4 }, (_, index) => {
                  const participant = groupParticipants[index];
                  if (!participant) {
                    return (
                      <View key={`action-verify-open-${index + 1}`} style={[styles.bbbVerifyCard, styles.bbbVerifyPlaceholder]}>
                        <Text style={styles.bbbVerifyName}>Seat {index + 1}</Text>
                        <Text style={styles.bbbVerifyScore}>-</Text>
                      </View>
                    );
                  }

                  const scoreEntry = bbbHoleScores.find((entry) => entry.participantId === participant.id);
                  return (
                    <View key={`action-verify-${participant.id}`} style={styles.bbbVerifyCard}>
                      <Text style={styles.bbbVerifyName}>{participant.displayName}</Text>
                      <Text style={styles.bbbVerifyScore}>{typeof scoreEntry?.score === 'number' ? scoreEntry.score : '-'}</Text>
                    </View>
                  );
                })}
              </View>

              <View style={styles.progressRow}>
                <Text style={styles.progressText}>{`Step ${stepIndex + 1} of ${steps.length}`}</Text>
                <Text style={styles.progressText}>
                  {currentStep === 'save' ? 'Review and save' : currentStepIsSharedStat ? 'Personal stat entry' : 'Compact score entry'}
                </Text>
              </View>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${((stepIndex + 1) / steps.length) * 100}%` }]} />
              </View>
              {!currentStepIsSharedStat ? (
                <>
                  <Text style={styles.questionTitle}>{bbbStepConfig?.title ?? 'Save BBB Hole'}</Text>
                  <Text style={styles.helperText}>
                    {bbbStepConfig?.helper ?? 'Review the current BBB winners and player scores, then save this hole.'}
                  </Text>
                </>
              ) : null}

              {renderSharedStatsStep()}

              {bbbStepConfig?.phase === 'winner' ? (
                <PlayerCardGrid>
                  {Array.from({ length: 4 }, (_, index) => {
                    const participant = groupParticipants[index];
                    if (!participant) {
                      return (
                        <PlayerCard
                          key={`bbb-winner-open-${index + 1}`}
                          title={`Seat ${index + 1}`}
                          subtitle="Open seat"
                          meta="Not in this BBB round"
                          placeholder
                          disabled
                        />
                      );
                    }

                    return (
                      <PlayerCard
                        key={`${bbbStepConfig.category}-${participant.id}`}
                        title={participant.displayName}
                        subtitle={bbbStepConfig.selectedParticipantId === participant.id ? 'Selected' : `Seat ${index + 1}`}
                        meta="Tap to award this BBB point"
                        onPress={() => updateBbbWinner(bbbStepConfig.category, participant.id)}
                        selected={bbbStepConfig.selectedParticipantId === participant.id}
                      />
                    );
                  })}
                </PlayerCardGrid>
              ) : null}

              {bbbStepConfig?.phase === 'score' ? (
                renderCompactScoreRows(
                  groupParticipants.map((participant, index) => {
                    const scoreEntry = bbbHoleScores.find((entry) => entry.participantId === participant.id);
                    return {
                      id: `bbb-score-row-${participant.id}`,
                      name: participant.displayName,
                      meta: participant.isScorekeeper ? 'Scorekeeper' : `Seat ${index + 1} • BBB`,
                      score: scoreEntry?.score ?? null,
                      onChange: (score) => {
                        void setBbbPlayerScore(participant.id, score);
                      },
                    };
                  }),
                  'Review Hole',
                )
              ) : null}

              {currentStep === 'save' ? (
                renderSaveHoleButton(isLastSequenceHole ? 'Save Hole 18' : 'Save BBB Hole')
              ) : null}

              <View style={styles.navRow}>
                <AppButton
                  title="Back"
                  onPress={goBack}
                  variant="secondary"
                  disabled={stepIndex === 0}
                  style={{ flex: 1 }}
                />
                <AppButton
                  title="Previous Hole"
                  onPress={goToPreviousHole}
                  variant="secondary"
                  disabled={isFirstSequenceHole}
                  style={{ flex: 1 }}
                />
              </View>
            </SectionCard>

            {syncMessage ? (
              <SectionCard>
                <Text style={styles.syncMessage}>{syncMessage}</Text>
                {round.bbbLastSyncError ? (
                  <Text style={styles.syncError}>BBB sync error: {round.bbbLastSyncError}</Text>
                ) : null}
              </SectionCard>
            ) : null}
          </>
        ) : skinsRound ? (
          <SectionCard style={{ gap: 16 }}>
            <View style={styles.progressRow}>
              <Text style={styles.progressText}>{`Step ${stepIndex + 1} of ${steps.length}`}</Text>
              <Text style={styles.progressText}>
                {currentStep === 'save' ? 'Review and save' : currentStepIsSharedStat ? 'Personal stat entry' : 'Gross score entry'}
              </Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${((stepIndex + 1) / steps.length) * 100}%` }]} />
            </View>

            <View style={styles.bbbVerificationRow}>
              {Array.from({ length: 4 }, (_, index) => {
                const participant = groupParticipants[index];
                if (!participant) {
                  return (
                    <View key={`skins-verify-open-${index + 1}`} style={[styles.bbbVerifyCard, styles.bbbVerifyPlaceholder]}>
                      <Text style={styles.bbbVerifyName}>Seat {index + 1}</Text>
                      <Text style={styles.bbbVerifyScore}>-</Text>
                    </View>
                  );
                }

                const scoreEntry = skinsHoleScores.find((entry) => entry.participantId === participant.id);
                return (
                  <View key={`skins-verify-${participant.id}`} style={styles.bbbVerifyCard}>
                    <Text style={styles.bbbVerifyName}>{participant.displayName}</Text>
                    <Text style={styles.bbbVerifyScore}>{typeof scoreEntry?.score === 'number' ? scoreEntry.score : '-'}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.summaryCard}>
              <Text style={styles.summaryText}>Skins preview</Text>
              <Text style={styles.summaryText}>
                {skinsPreview
                  ? skinsPreview.isPush
                    ? `Push at ${skinsPreview.winningScore}. No skin awarded on this hole.`
                    : `${groupParticipants.find((participant) => participant.id === skinsPreview.winnerParticipantId)?.displayName ?? 'Winner'} would win ${skinsPreview.awardedSkinCount} skin${skinsPreview.awardedSkinCount === 1 ? '' : 's'} with ${skinsPreview.winningScore}.`
                  : 'Enter every player score to preview the hole result.'}
              </Text>
            </View>

            {renderSharedStatsStep()}

            {skinsStepConfig ? (
              <>
                <Text style={styles.questionTitle}>{skinsStepConfig.title}</Text>
                <Text style={styles.helperText}>{skinsStepConfig.helper}</Text>
                {renderCompactScoreRows(
                  groupParticipants.map((participant, index) => {
                    const scoreEntry = skinsHoleScores.find((entry) => entry.participantId === participant.id);
                    return {
                      id: `skins-score-row-${participant.id}`,
                      name: participant.displayName,
                      meta: participant.isScorekeeper ? 'Scorekeeper' : `Seat ${index + 1} • Skins`,
                      score: scoreEntry?.score ?? null,
                      onChange: (score) => {
                        void setSkinsPlayerScore(participant.id, score);
                      },
                    };
                  }),
                  'Review Hole',
                )}
              </>
            ) : null}

            {currentStep === 'save' ? (
              renderSaveHoleButton(isLastSequenceHole ? 'Save Hole 18' : 'Save Skins Hole')
            ) : null}

            <View style={styles.navRow}>
              <AppButton
                title="Back"
                onPress={goBack}
                variant="secondary"
                disabled={stepIndex === 0}
                style={{ flex: 1 }}
              />
              <AppButton
                title="Previous Hole"
                onPress={goToPreviousHole}
                variant="secondary"
                disabled={isFirstSequenceHole}
                style={{ flex: 1 }}
              />
            </View>
          </SectionCard>
        ) : (
          <SectionCard style={{ gap: 16 }}>
            {currentStep === 'driveSafe' ? (
              <>
                <Text style={styles.questionTitle}>Was drive safe?</Text>
                {courseHole.par === 3 ? <Text style={styles.helperText}>On a par 3, a safe drive is treated as GIR automatically.</Text> : null}
                <View style={styles.answerRow}>
                  <AppButton
                    title="Yes"
                    onPress={() =>
                      answerAndAdvance(
                        courseHole.par === 3
                          ? { driveSafe: true, drivePenalty: false, hitGreen: true, girMissPenalty: false, nearGreen: false }
                          : { driveSafe: true, drivePenalty: false },
                      )
                    }
                    style={{ flex: 1 }}
                  />
                  <AppButton title="No" onPress={() => answerAndAdvance({ driveSafe: false, drivePenalty: null, hitGreen: null })} variant="secondary" style={{ flex: 1 }} />
                </View>
              </>
            ) : null}

            {currentStep === 'drivePenalty' ? (
              <>
                <Text style={styles.questionTitle}>If no, was there a penalty?</Text>
                <View style={styles.answerRow}>
                  <AppButton title="Yes" onPress={() => answerAndAdvance({ drivePenalty: true })} style={{ flex: 1 }} />
                  <AppButton title="No" onPress={() => answerAndAdvance({ drivePenalty: false })} variant="secondary" style={{ flex: 1 }} />
                </View>
              </>
            ) : null}

            {currentStep === 'hitGreen' ? (
              <>
                <Text style={styles.questionTitle}>Green in regulation?</Text>
                <View style={styles.answerRow}>
                  <AppButton title="Yes" onPress={() => answerAndAdvance({ hitGreen: true, girMissPenalty: false, nearGreen: false })} style={{ flex: 1 }} />
                  <AppButton title="No" onPress={() => answerAndAdvance({ hitGreen: false, girMissPenalty: null, nearGreen: null })} variant="secondary" style={{ flex: 1 }} />
                </View>
              </>
            ) : null}

            {currentStep === 'girMissPenalty' ? (
              <>
                <Text style={styles.questionTitle}>After the green miss, was there a penalty?</Text>
                <View style={styles.answerRow}>
                  <AppButton title="Yes" onPress={() => answerAndAdvance({ girMissPenalty: true, nearGreen: false })} style={{ flex: 1 }} />
                  <AppButton title="No" onPress={() => answerAndAdvance({ girMissPenalty: false, nearGreen: null })} variant="secondary" style={{ flex: 1 }} />
                </View>
              </>
            ) : null}

            {currentStep === 'nearGreen' ? (
              <>
                <Text style={styles.questionTitle}>Near green within 25 yards?</Text>
                <View style={styles.answerRow}>
                  <AppButton title="Yes" onPress={() => answerAndAdvance({ nearGreen: true })} style={{ flex: 1 }} />
                  <AppButton title="No" onPress={() => answerAndAdvance({ nearGreen: false })} variant="secondary" style={{ flex: 1 }} />
                </View>
              </>
            ) : null}

            {standardGroupStepConfig ? (
              <>
                <Text style={styles.questionTitle}>{standardGroupStepConfig.title}</Text>
                <Text style={styles.helperText}>{standardGroupStepConfig.helper}</Text>
                {renderCompactScoreRows(
                  groupParticipants.map((participant, index) => {
                    const scoreEntry = standardGroupHoleScores.find((entry) => entry.participantId === participant.id);
                    return {
                      id: `standard-group-score-row-${participant.id}`,
                      name: participant.displayName,
                      meta: participant.isScorekeeper ? 'Scorekeeper' : `Seat ${index + 1} • Gross`,
                      score: scoreEntry?.score ?? null,
                      onChange: (score) => {
                        void setStandardGroupPlayerScore(participant.id, score);
                      },
                    };
                  }),
                  'Review Hole',
                )}
              </>
            ) : null}

            {currentStep === 'score' && !ironman && !scramble && !crossCardDualScore ? (
              <>
                <Text style={styles.questionTitle}>Enter Score</Text>
                {mustHoleOut ? <Text style={styles.helperText}>Hole {holeNumber} must be holed out. Record every stroke before you leave this hole.</Text> : null}
                {stablefordRound && stablefordRule?.track_stroke_tally ? <Text style={styles.helperText}>Actual stroke tally is required on this hole.</Text> : null}
                {renderCompactScoreRows(
                  [
                    {
                      id: 'solo-score-row',
                      name: round.group?.participants.find((participant) => participant.type === 'app_user')?.displayName ?? 'My Score',
                      meta: stablefordRound ? (stablefordModeLabel ?? 'Gross score') : 'Gross score',
                      score: state.score ?? null,
                      onChange: (score) => {
                        void setSoloScore(score);
                      },
                    },
                  ],
                  'Review Hole',
                )}
              </>
            ) : null}

            {currentStep === 'score' && (ironman || scramble || crossCardDualScore) ? (
              <>
                <Text style={styles.questionTitle}>
                  {ironman ? 'Our Team Score' : scramble ? 'Team Score' : crossCardDualScore ? 'My Score' : 'Enter Score'}
                </Text>
                {mustHoleOut ? <Text style={styles.helperText}>Hole {holeNumber} must be holed out. Record every stroke before you leave this hole.</Text> : null}
                {stablefordRound && stablefordRule?.track_stroke_tally ? <Text style={styles.helperText}>Actual stroke tally is required on this hole.</Text> : null}
                {renderCompactScoreRows(
                  [
                    {
                      id: 'tournament-score-row',
                      name: ironman
                        ? (round.tournamentTeamName ?? 'Our Team')
                        : scramble
                          ? (round.tournamentTeamName ?? 'Team')
                          : 'My Score',
                      meta: ironman
                        ? 'Team gross score'
                        : scramble
                          ? 'Team gross score'
                          : stablefordRound
                            ? (stablefordModeLabel ?? 'Gross score')
                            : 'Gross score',
                      score: state.score ?? null,
                      onChange: (score) => {
                        void setSoloScore(score);
                      },
                    },
                  ],
                  'Review Hole',
                )}
              </>
            ) : null}

            {currentStep === 'opponentScore' ? (
              <>
                <Text style={styles.questionTitle}>
                  {crossCardDualScore ? `${round.tournamentCrossCardTargetName ?? 'Cross-Card Player'} Score` : 'Opponent Team Score'}
                </Text>
                <Text style={styles.helperText}>
                  {crossCardDualScore
                    ? 'This is stored hole-by-hole for your assigned cross-card player.'
                    : 'This is stored hole-by-hole for compare and verify later.'}
                </Text>
                {renderCompactScoreRows(
                  [
                    {
                      id: 'tournament-opponent-score-row',
                      name: crossCardDualScore
                        ? (round.tournamentCrossCardTargetName ?? 'Cross-Card Player')
                        : (round.tournamentOpponentTeamName ?? 'Opponent Team'),
                      meta: crossCardDualScore ? 'Cross-card gross score' : 'Opponent team score',
                      score: state.opponentScore ?? null,
                      onChange: (score) => {
                        void updateHole({ opponentScore: score });
                      },
                    },
                  ],
                  'Review Hole',
                )}
              </>
            ) : null}

            {currentStep === 'putts' ? (
              <>
                <Text style={styles.questionTitle}>Putts</Text>
                <Text style={styles.helperText}>Choose the total putts for this hole.</Text>
                <View style={styles.answerRow}>
                  <AppButton title="1" onPress={() => answerAndAdvance({ totalPutts: 1 })} compact style={styles.compactAnswerButton} />
                  <AppButton title="2" onPress={() => answerAndAdvance({ totalPutts: 2 })} compact variant="secondary" style={styles.compactAnswerButton} />
                  <AppButton title="3" onPress={() => answerAndAdvance({ totalPutts: 3 })} compact variant="secondary" style={styles.compactAnswerButton} />
                </View>
              </>
            ) : null}

            {currentStep === 'save' ? (
              <>
                <Text style={styles.questionTitle}>Save hole</Text>
                <View style={styles.summaryCard}>
                  {standardGroupRound ? (
                    standardGroupHoleScores.map((entry) => {
                      const participant = groupParticipants.find((item) => item.id === entry.participantId);
                      return (
                        <Text key={`standard-group-save-${entry.participantId}`} style={styles.summaryText}>
                          {participant?.displayName ?? 'Player'}: {entry.score ?? '-'}
                        </Text>
                      );
                    })
                  ) : (
                    <Text style={styles.summaryText}>
                      {ironman ? 'Our Score' : scramble ? 'Team Score' : crossCardDualScore ? 'My Score' : 'Score'}: {state.score ?? '-'}
                    </Text>
                  )}
                  {ironman ? <Text style={styles.summaryText}>Opponent Score: {state.opponentScore ?? '-'}</Text> : null}
                  {crossCardDualScore ? <Text style={styles.summaryText}>{round.tournamentCrossCardTargetName ?? 'Cross-Card Player'} Score: {state.opponentScore ?? '-'}</Text> : null}
                  {stablefordPreview ? <Text style={styles.summaryText}>Stableford: {stablefordPreview.points} points ({stablefordPreview.resultLabel})</Text> : null}
                  {stablefordRound ? (
                    <Text style={styles.summaryText}>
                      Running Stableford Total: {(stablefordRunningTotal ?? 0) + Number(stablefordPreview?.points ?? 0) - Number(state.stablefordPoints ?? 0)}
                    </Text>
                  ) : null}
                  {wolfRound && wolfCurrentDecision ? (
                    <Text style={styles.summaryText}>
                      Wolf decision: {wolfCurrentDecision.isBlindWolf
                        ? 'Blind Wolf'
                        : wolfCurrentDecision.isLoneWolf
                          ? 'Lone Wolf'
                          : `Partner with ${groupParticipants.find((participant) => participant.id === wolfCurrentDecision.partnerParticipantId)?.displayName ?? 'partner'}`}
                    </Text>
                  ) : null}
                  {statsEnabled ? <Text style={styles.summaryText}>Putts: {state.totalPutts ?? '-'}</Text> : null}
                  {!statsEnabled && !ironman && !crossCardDualScore ? <Text style={styles.summaryText}>Score-only round</Text> : null}
                  {statsEnabled ? <Text style={styles.summaryText}>Drive safe: {binaryComplete(state.driveSafe) ? (state.driveSafe ? 'Yes' : 'No') : '-'}</Text> : null}
                  {statsEnabled ? <Text style={styles.summaryText}>GIR: {binaryComplete(state.hitGreen) ? (state.hitGreen ? 'Yes' : 'No') : '-'}</Text> : null}
                </View>
                {renderSaveHoleButton(holeNumber === 18 ? 'Save Hole 18' : 'Save Hole')}
              </>
            ) : null}

            <View style={styles.navRow}>
              <AppButton title="Back" onPress={goBack} variant="secondary" disabled={stepIndex === 0} style={{ flex: 1 }} />
              <AppButton
                title="Previous Hole"
                onPress={() => guardForcedHoleExit(goToPreviousHole)}
                variant="secondary"
                disabled={isFirstSequenceHole}
                style={{ flex: 1 }}
              />
            </View>
          </SectionCard>
        )}
        </View>
      </ScrollView>
      <PlayerBottomNav />
    </BrandWatermarkBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { flex: 1, backgroundColor: 'transparent' },
  scrollContent: { paddingBottom: 112 },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  subtitle: { color: '#5a6b61' },
  toolbar: { flexDirection: 'row', gap: 10 },
  mainImage: { width: '100%', height: 280, borderRadius: 18 },
  saveHoleButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#18341d',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  saveHoleButtonSaved: {
    backgroundColor: '#e7f4ea',
    borderWidth: 1,
    borderColor: '#8dc49a',
  },
  saveHoleButtonPressed: {
    opacity: 0.9,
  },
  saveHoleButtonDisabled: {
    opacity: 1,
  },
  saveHoleButtonText: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    includeFontPadding: false,
  },
  saveHoleButtonTextSaved: {
    color: '#0f5f2c',
  },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  progressText: { fontSize: 12, fontWeight: '800', color: '#5a6b61', textTransform: 'uppercase' },
  progressBarTrack: { height: 8, borderRadius: 999, backgroundColor: '#e5dfd1', marginTop: 12, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#18341d', borderRadius: 999 },
  questionTitle: { fontSize: 22, fontWeight: '800', color: '#132117' },
  helperText: { fontSize: 14, lineHeight: 20, color: '#5a6b61', marginTop: -4 },
  answerRow: { flexDirection: 'row', gap: 12 },
  compactAnswerButton: { flex: 1, minWidth: 0 },
  navRow: { marginTop: 6, flexDirection: 'row', gap: 12 },
  scoreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  scoreButton: { minWidth: '22%' },
  summaryCard: { borderRadius: 16, backgroundColor: '#f8f5ee', padding: 14, gap: 8 },
  summaryText: { fontSize: 15, color: '#132117' },
  groupHeading: { fontSize: 18, fontWeight: '800', color: '#132117' },
  groupMeta: { fontSize: 14, color: '#5a6b61', marginTop: 6 },
  contextMeta: { fontSize: 13, color: '#18341d', marginTop: 8, fontWeight: '700' },
  syncMessage: { fontSize: 14, lineHeight: 20, color: '#18341d' },
  tournamentNavRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  deleteRow: { marginTop: 12 },
  syncTitle: { fontSize: 18, fontWeight: '800', color: '#132117' },
  syncBody: { fontSize: 14, lineHeight: 20, color: '#425247', marginTop: 8 },
  syncError: { fontSize: 13, lineHeight: 18, color: '#7b3e33', marginTop: 8 },
  retryRow: { marginTop: 12 },
  bbbWinnerSummaryRow: { flexDirection: 'row', gap: 10 },
  bbbWinnerSummaryCard: { flex: 1, borderRadius: 16, padding: 12, minHeight: 86, justifyContent: 'space-between' },
  bbbWinnerCardBingo: { backgroundColor: '#b54136' },
  bbbWinnerCardBango: { backgroundColor: '#2f7d4a' },
  bbbWinnerCardBongo: { backgroundColor: '#2c5da8' },
  bbbWinnerSummaryLabel: { fontSize: 13, fontWeight: '800', color: '#fff', textTransform: 'uppercase' },
  bbbWinnerSummaryValue: { fontSize: 16, fontWeight: '800', color: '#fff' },
  bbbVerificationRow: { flexDirection: 'row', gap: 8 },
  bbbVerifyCard: { flex: 1, minHeight: 74, borderRadius: 14, backgroundColor: '#f8f5ee', padding: 10, justifyContent: 'space-between' },
  bbbVerifyPlaceholder: { opacity: 0.7 },
  bbbVerifyName: { fontSize: 12, fontWeight: '800', color: '#132117' },
  bbbVerifyScore: { fontSize: 24, fontWeight: '800', color: '#132117' },
  bbbTotalsGrid: { display: 'none' },
  bbbTotalCard: { width: '47%', backgroundColor: '#f8f5ee', borderRadius: 14, padding: 12, gap: 4 },
  bbbTotalName: { fontSize: 14, fontWeight: '800', color: '#132117' },
  bbbTotalPoints: { fontSize: 24, fontWeight: '800', color: '#132117' },
  bbbTotalMeta: { fontSize: 12, color: '#5a6b61' },
  bbbSection: { gap: 10 },
  bbbSectionTitle: { fontSize: 18, fontWeight: '800', color: '#132117' },
  bbbSelectionText: { fontSize: 14, color: '#5a6b61' },
  compactScoreSection: { gap: 12 },
  compactScoreRow: {
    minHeight: 78,
    borderRadius: 18,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#d9d1c3',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    shadowColor: '#102014',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  compactScoreRowActive: {
    borderColor: '#18341d',
    shadowOpacity: 0.1,
  },
  compactScoreIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  compactScoreAvatar: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: '#e9efe7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactScoreAvatarText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#18341d',
  },
  compactScoreNameWrap: {
    flex: 1,
    gap: 2,
  },
  compactScoreName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#132117',
  },
  compactScoreMeta: {
    fontSize: 12,
    color: '#6d786f',
  },
  compactScoreStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#f3eee4',
    borderWidth: 1,
    borderColor: '#ddd5c8',
    overflow: 'hidden',
  },
  scoreStepperButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#18341d',
  },
  scoreStepperPressed: {
    opacity: 0.88,
  },
  scoreStepperSymbol: {
    fontSize: 24,
    lineHeight: 24,
    fontWeight: '800',
    color: '#fffdf8',
    marginTop: -2,
  },
  scoreStepperValueWrap: {
    minWidth: 52,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  scoreStepperValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#132117',
  },
});
