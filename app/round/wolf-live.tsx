import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BrandWatermarkBackground } from '@/components/BrandWatermarkBackground';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { PlayerBottomNav } from '@/components/navigation/PlayerBottomNav';
import { WolfSettlementBreakdown } from '@/components/round/WolfSettlementBreakdown';
import { SectionCard } from '@/components/ui/SectionCard';
import { holes as courseHoles } from '@/constants/course';
import { formatCurrencyFromCents } from '@/lib/currency';
import { getWolfRoundGameIdForRound } from '@/lib/groupRoundCompanions';
import { loadDraftRound, saveDraftRound } from '@/lib/localRound';
import { drainActiveRegularRoundSync, queueRegularRoundHoleSync, shouldRetryRegularRoundSyncNow } from '@/lib/regularRoundBackendSync';
import { getWolfLiveSummary, type WolfGameSummary } from '@/lib/wolfBackend';
import { calculateWolfHoleResult, calculateWolfSettlement, formatWolfPoints, formatWolfSideLabel, getWolfForHole, type WolfHoleResult } from '@/lib/wolf';
import { useAuth } from '@/providers/AuthProvider';
import type { LocalRoundDraft, WolfScoringMode } from '@/types/round';

function scoreComplete(value: number | null | undefined) {
  return typeof value === 'number' && value > 0;
}

function getParForHole(holeNumber: number) {
  return courseHoles.find((hole) => hole.hole === holeNumber)?.par ?? null;
}

function parTotalForHoleNumbers(holeNumbers: number[]) {
  return holeNumbers.reduce((sum, holeNumber) => sum + (getParForHole(holeNumber) ?? 0), 0);
}

function formatRelativeToPar(grossTotal: number, completedHoleNumbers: number[]) {
  const relative = grossTotal - parTotalForHoleNumbers(completedHoleNumbers);
  if (relative === 0) return 'E';
  return relative > 0 ? `+${relative}` : `${relative}`;
}

function areObjectsEqual<T>(left: T, right: T) {
  if (left === right) return true;
  if (!left || !right) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

function getRoundHoleSequence(round: LocalRoundDraft | null) {
  const explicitSequence = (round?.holeSequence ?? []).filter((value): value is number => typeof value === 'number' && value > 0);
  if (explicitSequence.length > 0) return explicitSequence;

  return (round?.holes ?? [])
    .map((hole) => hole.hole)
    .filter((value): value is number => typeof value === 'number' && value > 0)
    .sort((a, b) => a - b);
}

function getWolfParticipantIds(round: LocalRoundDraft | null) {
  const configuredIds = Array.from(new Set((round?.wolfParticipantIds ?? []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
  if (configuredIds.length === 4) return configuredIds;
  return (round?.group?.participants ?? []).map((participant) => participant.id).slice(0, 4);
}

function getWolfOrderParticipantIds(round: LocalRoundDraft | null) {
  const participantIds = getWolfParticipantIds(round);
  const configuredOrder = Array.isArray(round?.wolfOrderParticipantIds)
    ? round!.wolfOrderParticipantIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const seen = new Set<string>();
  const nextOrder: string[] = [];

  configuredOrder.forEach((participantId) => {
    if (!participantIds.includes(participantId) || seen.has(participantId)) return;
    seen.add(participantId);
    nextOrder.push(participantId);
  });

  participantIds.forEach((participantId) => {
    if (seen.has(participantId)) return;
    seen.add(participantId);
    nextOrder.push(participantId);
  });

  return nextOrder;
}

function getWolfScoringMode(round: LocalRoundDraft | null): WolfScoringMode {
  return round?.wolfScoringMode ?? 'net';
}

function wolfScoringModeLabel(mode: WolfScoringMode) {
  return mode === 'winner_only' ? 'Winner-only' : 'Net points';
}

function getLocalCompletedWolfHoleNumbers(round: LocalRoundDraft | null) {
  if (!round || round.roundMode !== 'casual_group' || round.groupGameMode !== 'wolf') return [];
  const participantIds = getWolfParticipantIds(round);
  if (participantIds.length !== 4) return [];

  const holeSequence = getRoundHoleSequence(round);
  if (holeSequence.length === 0) return [];

  const currentHoleIndex = typeof round.currentHole === 'number' ? holeSequence.indexOf(round.currentHole) : -1;
  const completedHoleCountFromProgress = currentHoleIndex >= 0
    ? currentHoleIndex
    : Math.max(0, Math.min(Number(round.officialCompletedHole ?? 0), holeSequence.length));
  const candidateHoleNumbers = new Set(holeSequence.slice(0, completedHoleCountFromProgress));

  return round.holes
    .filter((hole) => {
      if (!candidateHoleNumbers.has(hole.hole)) return false;
      const decision = round.wolfHoleDecisions?.[hole.hole];
      if (!decision?.wolfParticipantId) return false;
      return participantIds.every((participantId) => {
        const score = hole.groupScores?.find((entry) => entry.participantId === participantId)?.score ?? null;
        return scoreComplete(score);
      });
    })
    .map((hole) => hole.hole)
    .sort((a, b) => a - b);
}

function buildRoundScoreboardRows(round: LocalRoundDraft, completedHoleNumbers: number[]) {
  const participants = round.group?.participants ?? [];
  const completedHoleSet = new Set(completedHoleNumbers);

  return participants
    .map((participant) => {
      let grossTotal = 0;
      let holesCompleted = 0;

      round.holes.forEach((hole) => {
        if (!completedHoleSet.has(hole.hole)) return;
        const score = hole.groupScores?.find((entry) => entry.participantId === participant.id)?.score
          ?? (participant.type === 'app_user' ? hole.score : null);
        if (!scoreComplete(score)) return;
        grossTotal += Number(score);
        holesCompleted += 1;
      });

      return {
        participantId: participant.id,
        displayName: participant.displayName,
        grossTotal,
        holesCompleted,
        completedHoleNumbers,
        standingRank: 0,
      };
    })
    .sort((a, b) => (
      a.grossTotal - b.grossTotal
      || b.holesCompleted - a.holesCompleted
      || a.displayName.localeCompare(b.displayName)
    ))
    .map((row, index) => ({ ...row, standingRank: index + 1 }));
}

type LocalWolfHoleSummary = {
  holeNumber: number;
  result: WolfHoleResult;
  wolfDisplayName: string;
  partnerDisplayName: string | null;
  huntersDisplayNames: string[];
  scores: Array<{
    participant_id: string;
    display_name: string;
    user_id: string | null;
    seat_order: number | null;
    score: number | null;
  }>;
};

function buildLocalWolfHoleSummaries(round: LocalRoundDraft, completedHoleNumbers: number[]) {
  const participantIds = getWolfParticipantIds(round);
  const participants = round.group?.participants ?? [];
  const scoringMode = getWolfScoringMode(round);
  if (participantIds.length !== 4 || participants.length === 0) return [];

  const summaries: LocalWolfHoleSummary[] = [];

  completedHoleNumbers.forEach((holeNumber) => {
    const hole = round.holes.find((entry) => entry.hole === holeNumber);
    const decision = round.wolfHoleDecisions?.[holeNumber];
    if (!hole || !decision?.wolfParticipantId) return;

    const scoresByParticipantId = Object.fromEntries(
      participantIds.map((participantId) => [
        participantId,
        hole.groupScores?.find((entry) => entry.participantId === participantId)?.score ?? null,
      ]),
    ) as Record<string, number | null | undefined>;

    const result = calculateWolfHoleResult({
      participantIds,
      decision: {
        holeNumber,
        wolfParticipantId: decision.wolfParticipantId,
        partnerParticipantId: decision.partnerParticipantId,
        isLoneWolf: decision.isLoneWolf,
        isBlindWolf: decision.isBlindWolf,
      },
      holeScores: {
        holeNumber,
        scoresByParticipantId,
      },
      scoringMode,
    });

    if (!result) return;

    summaries.push({
      holeNumber,
      result,
      wolfDisplayName: participants.find((participant) => participant.id === result.wolfParticipantId)?.displayName ?? 'Wolf',
      partnerDisplayName: result.partnerParticipantId
        ? (participants.find((participant) => participant.id === result.partnerParticipantId)?.displayName ?? 'Partner')
        : null,
      huntersDisplayNames: result.huntersParticipantIds.map((participantId) => participants.find((participant) => participant.id === participantId)?.displayName ?? 'Hunter'),
      scores: participantIds.map((participantId, index) => {
        const participant = participants.find((entry) => entry.id === participantId);
        return {
          participant_id: participantId,
          display_name: participant?.displayName ?? 'Player',
          user_id: participant?.type === 'app_user' ? participantId : null,
          seat_order: index + 1,
          score: typeof scoresByParticipantId[participantId] === 'number' ? Number(scoresByParticipantId[participantId]) : null,
        };
      }),
    });
  });

  return summaries;
}

function buildLocalWolfStandings(round: LocalRoundDraft, localHoleSummaries: LocalWolfHoleSummary[]) {
  const participantIds = getWolfParticipantIds(round);
  const participants = round.group?.participants ?? [];
  if (participantIds.length !== 4) return [];

  const standings = new Map(participantIds.map((participantId) => {
    const participant = participants.find((entry) => entry.id === participantId);
    return [participantId, {
      participantId,
      displayName: participant?.displayName ?? 'Player',
      userId: participant?.type === 'app_user' ? participantId : null,
      seatOrder: getWolfOrderParticipantIds(round).indexOf(participantId) + 1,
      totalPoints: 0,
      grossTotal: 0,
      holesComplete: 0,
      holesWon: 0,
      holesLost: 0,
      tiedHoles: 0,
      loneWolfWins: 0,
      loneWolfLosses: 0,
      blindWolfWins: 0,
      blindWolfLosses: 0,
      standingRank: 0,
    }];
  }));

  localHoleSummaries.forEach(({ result, scores }) => {
    scores.forEach((scoreRow) => {
      const standing = standings.get(scoreRow.participant_id);
      if (!standing || !scoreComplete(scoreRow.score)) return;
      standing.grossTotal += Number(scoreRow.score);
      standing.holesComplete += 1;
    });

    const winnerIds = result.winningSide === 'wolf_side'
      ? [result.wolfParticipantId, ...(result.isLoneWolf ? [] : (result.partnerParticipantId ? [result.partnerParticipantId] : []))]
      : result.winningSide === 'hunters'
        ? result.huntersParticipantIds
        : [];
    const loserIds = result.winningSide === 'tie'
      ? []
      : participantIds.filter((participantId) => !winnerIds.includes(participantId));

    participantIds.forEach((participantId) => {
      const standing = standings.get(participantId);
      if (!standing) return;
      standing.totalPoints += result.pointsByParticipantId[participantId] ?? 0;
      if (result.winningSide === 'tie') {
        standing.tiedHoles += 1;
      } else if (winnerIds.includes(participantId)) {
        standing.holesWon += 1;
      } else if (loserIds.includes(participantId)) {
        standing.holesLost += 1;
      }
    });

    const wolfStanding = standings.get(result.wolfParticipantId);
    if (wolfStanding && result.winningSide !== 'tie' && result.isLoneWolf) {
      if (result.isBlindWolf) {
        if (result.winningSide === 'wolf_side') wolfStanding.blindWolfWins += 1;
        if (result.winningSide === 'hunters') wolfStanding.blindWolfLosses += 1;
      } else {
        if (result.winningSide === 'wolf_side') wolfStanding.loneWolfWins += 1;
        if (result.winningSide === 'hunters') wolfStanding.loneWolfLosses += 1;
      }
    }
  });

  return Array.from(standings.values())
    .map((standing) => ({
      ...standing,
      grossTotal: standing.holesComplete > 0 ? standing.grossTotal : null,
    }))
    .sort((a, b) => (
      b.totalPoints - a.totalPoints
      || Number(a.grossTotal ?? Number.MAX_SAFE_INTEGER) - Number(b.grossTotal ?? Number.MAX_SAFE_INTEGER)
      || Number(a.seatOrder ?? 999) - Number(b.seatOrder ?? 999)
      || a.displayName.localeCompare(b.displayName)
    ))
    .map((standing, index) => ({ ...standing, standingRank: index + 1 }));
}

export default function WolfLiveScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ roundId?: string; roundGameId?: string }>();
  const backendRoundIdParam = typeof params.roundId === 'string' ? params.roundId : null;
  const backendRoundGameIdParam = typeof params.roundGameId === 'string' ? params.roundGameId : null;
  const [round, setRound] = useState<LocalRoundDraft | null>(null);
  const [summary, setSummary] = useState<WolfGameSummary | null>(null);
  const [resolvedRoundGameId, setResolvedRoundGameId] = useState<string | null>(backendRoundGameIdParam);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const roundRef = useRef<LocalRoundDraft | null>(null);
  const backfillInFlightRef = useRef(false);
  const attemptedBackfillKeyRef = useRef<string | null>(null);

  const localCompletedHoleNumbers = useMemo(() => getLocalCompletedWolfHoleNumbers(round), [round]);
  const backendWolfHoleNumbers = useMemo(
    () => (summary?.holes ?? []).map((hole) => hole.hole_number).sort((a, b) => a - b),
    [summary],
  );
  const missingHoleNumbers = useMemo(
    () => localCompletedHoleNumbers.filter((holeNumber) => !backendWolfHoleNumbers.includes(holeNumber)),
    [backendWolfHoleNumbers, localCompletedHoleNumbers],
  );
  const missingHoleKey = useMemo(() => missingHoleNumbers.join(','), [missingHoleNumbers]);
  const pendingBackfillHoleNumbers = useMemo(() => {
    const pendingChunks = round?.regularRoundBackendSync?.chunks ?? [];
    return Array.from(new Set(
      pendingChunks
        .filter((chunk) => (
          chunk.chunkType === 'hole_game'
          && typeof chunk.holeNumber === 'number'
          && chunk.status !== 'synced'
          && chunk.status !== 'cancelled'
        ))
        .map((chunk) => Number(chunk.holeNumber)),
    )).sort((a, b) => a - b);
  }, [round]);
  const pendingBackfillKey = useMemo(() => pendingBackfillHoleNumbers.join(','), [pendingBackfillHoleNumbers]);
  const localHoleSummaries = useMemo(() => (round ? buildLocalWolfHoleSummaries(round, localCompletedHoleNumbers) : []), [localCompletedHoleNumbers, round]);
  const localStandings = useMemo(() => (round ? buildLocalWolfStandings(round, localHoleSummaries) : []), [localHoleSummaries, round]);
  const roundScoreboardRows = useMemo(
    () => (round ? buildRoundScoreboardRows(round, localCompletedHoleNumbers) : []),
    [localCompletedHoleNumbers, round],
  );
  const effectiveStandings = localStandings.length > 0
    ? localStandings
    : (summary?.standings ?? []).map((row) => ({
      participantId: row.participant_id,
      displayName: row.display_name,
      userId: row.user_id,
      seatOrder: row.seat_order,
      totalPoints: row.total_points,
      grossTotal: row.gross_total,
      holesComplete: row.holes_complete,
      holesWon: row.holes_won,
      holesLost: row.holes_lost,
      tiedHoles: row.tied_holes,
      loneWolfWins: row.lone_wolf_wins,
      loneWolfLosses: row.lone_wolf_losses,
      blindWolfWins: row.blind_wolf_wins,
      blindWolfLosses: row.blind_wolf_losses,
      standingRank: row.standing_rank,
    }));
  const effectiveHoleResults = localHoleSummaries.length > 0
    ? localHoleSummaries.map((entry) => ({
      hole_number: entry.holeNumber,
      wolf_display_name: entry.wolfDisplayName,
      partner_display_name: entry.partnerDisplayName,
      hunters_display_names: entry.huntersDisplayNames,
      is_lone_wolf: entry.result.isLoneWolf,
      is_blind_wolf: entry.result.isBlindWolf,
      wolf_side_score: entry.result.wolfSideScore,
      hunters_side_score: entry.result.huntersSideScore,
      winning_side: entry.result.winningSide,
      points_by_participant_id: entry.result.pointsByParticipantId,
      scores: entry.scores,
    }))
    : (summary?.holes ?? []);
  const effectiveScoringMode: WolfScoringMode = round?.wolfScoringMode ?? summary?.scoring_mode ?? 'net';
  const wolfOrderParticipantIds = useMemo(() => {
    if (round) return getWolfOrderParticipantIds(round);
    return summary?.wolf_order_participant_ids ?? [];
  }, [round, summary?.wolf_order_participant_ids]);
  const buyInCents = round?.roundGameBuyInCents ?? summary?.buy_in_cents ?? 0;
  const wolfPlayerCount = round ? getWolfParticipantIds(round).length : (summary?.active_player_count ?? 0);
  const totalPotCents = summary?.total_pot_cents ?? (buyInCents * wolfPlayerCount);
  const roundComplete = (summary?.status === 'completed')
    || localCompletedHoleNumbers.length >= 18
    || (summary?.holes.length ?? 0) >= 18;
  const wolfSettlement = useMemo(() => (
    roundComplete && buyInCents > 0 && effectiveStandings.length === 4
      ? calculateWolfSettlement({
        buyInCents,
        players: effectiveStandings.map((row) => ({
          participantId: row.participantId,
          displayName: row.displayName,
          finalPoints: row.totalPoints,
        })),
      })
      : null
  ), [buyInCents, effectiveStandings, roundComplete]);
  const nextWolfHoleNumber = useMemo(() => {
    if (round?.currentHole) return round.currentHole;
    return Math.min((backendWolfHoleNumbers.at(-1) ?? 0) + 1, 18);
  }, [backendWolfHoleNumbers, round?.currentHole]);
  const upcomingWolfOrder = useMemo(() => {
    return Array.from({ length: 4 }, (_, index) => {
      const holeNumber = Math.min(nextWolfHoleNumber + index, 18);
      const participantId = getWolfForHole(wolfOrderParticipantIds, holeNumber);
      const displayName = round?.group?.participants?.find((participant) => participant.id === participantId)?.displayName
        ?? effectiveStandings.find((row) => row.participantId === participantId)?.displayName
        ?? 'Player';
      return {
        holeNumber,
        displayName,
      };
    }).filter((entry, index, list) => entry.holeNumber >= 1 && entry.holeNumber <= 18 && list.findIndex((candidate) => candidate.holeNumber === entry.holeNumber) === index);
  }, [effectiveStandings, nextWolfHoleNumber, round?.group?.participants, wolfOrderParticipantIds]);

  const updateRoundIfChanged = (nextRound: LocalRoundDraft | null) => {
    setRound((current) => {
      if (areObjectsEqual(current, nextRound)) return current;
      roundRef.current = nextRound;
      return nextRound;
    });
  };

  const updateSummaryIfChanged = (nextSummary: WolfGameSummary | null) => {
    setSummary((current) => {
      if (areObjectsEqual(current, nextSummary)) return current;
      return nextSummary;
    });
  };

  const kickOffActiveRoundDrain = (trigger: string, queuedHoleNumber?: number | null) => {
    if (!user?.id) return;
    void drainActiveRegularRoundSync({
      userId: user.id,
      trigger,
      queuedHoleNumber,
      onUpdate: (updatedRound) => {
        updateRoundIfChanged(updatedRound);
      },
    }).catch(() => {});
  };

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const draft = await loadDraftRound();
        if (!mounted) return;
        updateRoundIfChanged(draft);

        const roundGameId = backendRoundGameIdParam
          ?? draft?.backendRoundGameId
          ?? (backendRoundIdParam ? await getWolfRoundGameIdForRound(backendRoundIdParam) : null);

        if (!mounted) return;
        setResolvedRoundGameId(roundGameId);

        if (!roundGameId) {
          updateSummaryIfChanged(null);
          setLoading(false);
          return;
        }

        const nextSummary = await getWolfLiveSummary(roundGameId);
        if (!mounted) return;
        updateSummaryIfChanged(nextSummary);
      } catch (nextError: any) {
        if (!mounted) return;
        setError(nextError?.message ?? 'Wolf live board is unavailable.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [backendRoundGameIdParam, backendRoundIdParam]);

  useEffect(() => {
    backfillInFlightRef.current = false;
    attemptedBackfillKeyRef.current = null;
  }, [resolvedRoundGameId, round?.id]);

  useEffect(() => {
    if (!round || !user?.id || !shouldRetryRegularRoundSyncNow(round)) return;
    kickOffActiveRoundDrain('live_board_open');
  }, [round?.id, user?.id]);

  useEffect(() => {
    if (!round || !user?.id) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const activeRound = roundRef.current;
      if (!activeRound || !shouldRetryRegularRoundSyncNow(activeRound)) return;
      kickOffActiveRoundDrain('app_resume');
    });

    return () => subscription.remove();
  }, [user?.id, round?.id]);

  useEffect(() => {
    let active = true;

    const backfillMissingWolfSync = async () => {
      const currentRound = roundRef.current;
      if (!currentRound || !user?.id || currentRound.groupGameMode !== 'wolf' || !resolvedRoundGameId) return;
      if (!missingHoleKey) {
        attemptedBackfillKeyRef.current = null;
        return;
      }
      if (backfillInFlightRef.current) return;
      if (attemptedBackfillKeyRef.current === missingHoleKey) return;

      const queueableMissingHoleNumbers = missingHoleNumbers.filter((holeNumber) => !pendingBackfillHoleNumbers.includes(holeNumber));
      attemptedBackfillKeyRef.current = missingHoleKey;
      if (queueableMissingHoleNumbers.length === 0) return;

      backfillInFlightRef.current = true;

      try {
        let nextRound = currentRound;
        queueableMissingHoleNumbers.forEach((holeNumber) => {
          nextRound = queueRegularRoundHoleSync(nextRound, holeNumber);
        });

        if (areObjectsEqual(currentRound, nextRound)) return;

        if (!active) return;
        updateRoundIfChanged(nextRound);
        await saveDraftRound(nextRound);
        kickOffActiveRoundDrain('live_board_backfill');

        const refreshedSummary = await getWolfLiveSummary(resolvedRoundGameId);
        if (!active) return;
        updateSummaryIfChanged(refreshedSummary);
      } finally {
        backfillInFlightRef.current = false;
      }
    };

    void backfillMissingWolfSync();
    return () => {
      active = false;
    };
  }, [
    missingHoleKey,
    missingHoleNumbers,
    pendingBackfillHoleNumbers,
    pendingBackfillKey,
    resolvedRoundGameId,
    round?.groupGameMode,
    round?.id,
    user?.id,
  ]);

  return (
    <BrandWatermarkBackground style={styles.screen} screenName="WolfLiveScreen">
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <CoalCreekHeader />
        <Text style={styles.title}>Wolf Live Board</Text>
        <Text style={styles.subtitle}>
          {(round?.group?.groupName ?? 'Wolf')} | Rotating Wolf game with local live scoring first
        </Text>

        {!round?.backendRoundGameId && !backendRoundGameIdParam && !backendRoundIdParam ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Wolf Live Board is waiting for the round.</Text>
            <Text style={styles.body}>Start the Wolf round and save a hole to sync the live board.</Text>
          </SectionCard>
        ) : loading ? (
          <SectionCard>
            <Text style={styles.body}>Loading Wolf live board...</Text>
          </SectionCard>
        ) : error ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Wolf board unavailable</Text>
            <Text style={styles.body}>{error}</Text>
          </SectionCard>
        ) : (
          <>
            <SectionCard>
              <Text style={styles.sectionTitle}>Game Info</Text>
              <Text style={styles.body}>Buy-in per player: {formatCurrencyFromCents(buyInCents)}</Text>
              <Text style={styles.body}>Total pot: {formatCurrencyFromCents(totalPotCents)}</Text>
              <Text style={styles.body}>Wolf players: {wolfPlayerCount}</Text>
              <Text style={styles.body}>Scoring: {wolfScoringModeLabel(effectiveScoringMode)}</Text>
            </SectionCard>

            {roundScoreboardRows.length > 0 ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Round Scoreboard</Text>
                <Text style={styles.body}>Gross, Thru, and to-par use completed saved holes only. Future default scores are ignored.</Text>
                <View style={styles.cardList}>
                  {roundScoreboardRows.map((row) => (
                    <View key={row.participantId} style={styles.playerCard}>
                      <View style={styles.playerHeader}>
                        <Text style={styles.playerName}>{row.standingRank}. {row.displayName}</Text>
                        <Text style={styles.playerValue}>{row.holesCompleted > 0 ? row.grossTotal : '--'}</Text>
                      </View>
                      <Text style={styles.playerMeta}>
                        Thru {row.holesCompleted} | {row.holesCompleted > 0 ? formatRelativeToPar(row.grossTotal, row.completedHoleNumbers) : '--'}
                      </Text>
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}

            {effectiveStandings.length > 0 ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Wolf Standings</Text>
                <View style={styles.cardList}>
                  {effectiveStandings.map((row) => (
                    <View key={row.participantId} style={styles.playerCard}>
                      <View style={styles.playerHeader}>
                        <Text style={styles.playerName}>{row.standingRank}. {row.displayName}</Text>
                        <Text style={styles.playerValue}>{formatWolfPoints(row.totalPoints)}</Text>
                      </View>
                      <Text style={styles.playerMeta}>Gross {row.grossTotal ?? '--'} | Holes {row.holesComplete}</Text>
                      <Text style={styles.playerMeta}>Won {row.holesWon} | Lost {row.holesLost} | Tied {row.tiedHoles}</Text>
                      <Text style={styles.playerMeta}>Lone W {row.loneWolfWins} | Lone L {row.loneWolfLosses}</Text>
                      <Text style={styles.playerMeta}>Blind W {row.blindWolfWins} | Blind L {row.blindWolfLosses}</Text>
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}

            {effectiveHoleResults.length > 0 ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Hole by Hole</Text>
                <View style={styles.cardList}>
                  {effectiveHoleResults.map((hole) => (
                    <View key={`wolf-hole-${hole.hole_number}`} style={styles.holeCard}>
                      <Text style={styles.holeTitle}>Hole {hole.hole_number}</Text>
                      <Text style={styles.playerMeta}>
                        {formatWolfSideLabel({
                          wolfDisplayName: hole.wolf_display_name ?? 'Wolf',
                          partnerDisplayName: hole.partner_display_name ?? null,
                          isLoneWolf: hole.is_lone_wolf === true,
                          isBlindWolf: hole.is_blind_wolf === true,
                        })}
                      </Text>
                      <Text style={styles.playerMeta}>Hunters: {hole.hunters_display_names.join(', ')}</Text>
                      <Text style={styles.playerMeta}>Wolf side {hole.wolf_side_score ?? '-'} | Hunters {hole.hunters_side_score ?? '-'}</Text>
                      <Text style={styles.playerMeta}>
                        {hole.winning_side === 'wolf_side'
                          ? 'Result: Wolf side won'
                          : hole.winning_side === 'hunters'
                            ? 'Result: Hunters won'
                            : 'Result: Tied'}
                      </Text>
                      <View style={styles.scoreList}>
                        {hole.scores.map((score) => (
                          <View key={`${hole.hole_number}-${score.participant_id}`} style={styles.scoreRow}>
                            <Text style={styles.scoreName}>{score.display_name}</Text>
                            <Text style={styles.scoreValue}>{score.score ?? '-'}</Text>
                          </View>
                        ))}
                      </View>
                      <Text style={styles.playerMeta}>
                        Points: {hole.scores.map((score) => `${score.display_name} ${formatWolfPoints(hole.points_by_participant_id[score.participant_id] ?? 0)}`).join(', ')}
                      </Text>
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}

            {upcomingWolfOrder.length > 0 ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Upcoming Wolf Order</Text>
                <View style={styles.cardList}>
                  {upcomingWolfOrder.map((entry) => (
                    <Text key={`upcoming-wolf-${entry.holeNumber}`} style={styles.body}>
                      Hole {entry.holeNumber}: {entry.displayName}
                    </Text>
                  ))}
                </View>
              </SectionCard>
            ) : null}

            <SectionCard>
              <Text style={styles.sectionTitle}>{roundComplete ? 'Final Settlement' : 'Settlement'}</Text>
              <WolfSettlementBreakdown
                settlement={wolfSettlement}
                pendingText={roundComplete ? null : 'Settlement available after round is complete'}
                emptyText={buyInCents <= 0 ? 'No buy-in for this Wolf game' : null}
                unavailableText={roundComplete ? 'Final settlement is unavailable for this Wolf round.' : null}
              />
            </SectionCard>
          </>
        )}
      </ScrollView>
      <PlayerBottomNav />
    </BrandWatermarkBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, gap: 16, paddingBottom: 112 },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  subtitle: { fontSize: 15, color: '#5a6b61', lineHeight: 22 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  body: { fontSize: 14, color: '#5a6b61', lineHeight: 21 },
  cardList: { gap: 10, marginTop: 6 },
  playerCard: { backgroundColor: '#eef3ec', borderRadius: 16, padding: 12, gap: 4 },
  playerHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  playerName: { fontSize: 16, fontWeight: '800', color: '#132117', flex: 1 },
  playerValue: { fontSize: 16, fontWeight: '800', color: '#132117' },
  playerMeta: { fontSize: 13, color: '#5a6b61' },
  holeCard: { backgroundColor: '#f8f5ee', borderRadius: 16, padding: 12, gap: 6 },
  holeTitle: { fontSize: 16, fontWeight: '800', color: '#132117' },
  scoreList: { gap: 4 },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  scoreName: { fontSize: 14, color: '#132117', flex: 1 },
  scoreValue: { fontSize: 14, fontWeight: '700', color: '#132117' },
});
