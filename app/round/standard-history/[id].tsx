import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PlayerBottomNav } from '@/components/navigation/PlayerBottomNav';
import { AppButton } from '@/components/ui/AppButton';
import { GolfCanadaSection } from '@/components/round/GolfCanadaSection';
import { SectionCard } from '@/components/ui/SectionCard';
import { teeDisplayLabel } from '@/constants/course';
import { ensureGroupScoresForHole } from '@/lib/bingoBangoBongo';
import {
  buildGolfCanadaPostedRound,
  getRoundGolfCanadaPostingState,
  getGolfCanadaPostingPrep,
  markRoundGolfCanadaPosted,
  resolveGolfCanadaPostingState,
} from '@/lib/golfCanada';
import { loadRoundHistory, updateSavedRound } from '@/lib/localRound';
import {
  getRegularRoundBackendStatusDetail,
  getRegularRoundBackendStatusLabel,
  prepareRegularRoundManualRetry,
  runRegularRoundFinalSyncLoop,
} from '@/lib/regularRoundBackendSync';
import {
  getGroupRoundCompanionMismatchReview,
  getGroupRoundCompanionScores,
  summarizeGroupRoundCompanionMismatchReview,
} from '@/lib/groupRoundCompanions';
import {
  type StandardRoundBackendDetail,
} from '@/lib/standardRoundBackend';
import { getRegularRoundHistoryDetail, type RegularRoundHistoryDetail } from '@/lib/regularRoundHistory';
import {
  findHistoryBackendRowByRouteId,
  findLocalHistoryRoundByAnyId,
  formatRegularRoundStatus,
  getMyRoundHistory,
  historyDateFromBackendRow,
  historyTypeLabelFromBackendRow,
} from '@/lib/historyBackend';
import { useAuth } from '@/providers/AuthProvider';
import type { GolfCanadaPostingRecord, HoleDraft, SavedRound } from '@/types/round';
import type { GroupRoundMismatchReviewSummary } from '@/lib/groupRoundCompanions';
import type { MyRoundHistoryRow } from '@/lib/historyBackend';

const DEBUG_STANDARD_HISTORY = false;

function isStandardRound(round: SavedRound) {
  return round.roundMode === 'solo' || (round.roundMode === 'casual_group' && (!round.groupGameMode || round.groupGameMode === 'none'));
}

function getCurrentUserGroupParticipantId(round: SavedRound) {
  return round.group?.participants?.find((participant) => participant.type === 'app_user')?.id ?? null;
}

function getDisplayScore(round: SavedRound, hole: HoleDraft) {
  if (round.roundMode === 'solo') {
    return typeof hole.score === 'number' ? hole.score : null;
  }

  const appUserParticipantId = getCurrentUserGroupParticipantId(round);
  const currentUserScore = hole.groupScores?.find((entry) => entry.participantId === appUserParticipantId)?.score ?? null;
  return typeof currentUserScore === 'number' ? currentUserScore : typeof hole.score === 'number' ? hole.score : null;
}

function formatStat(value: number | null | undefined) {
  return typeof value === 'number' ? String(value) : '-';
}

type GroupScoreboardRow = {
  key: string;
  displayName: string;
  totalScore: number;
  holesComplete: number;
};

export default function StandardHistoryDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [savedRound, setSavedRound] = useState<SavedRound | null>(null);
  const [historyMeta, setHistoryMeta] = useState<MyRoundHistoryRow | null>(null);
  const [backendDetail, setBackendDetail] = useState<StandardRoundBackendDetail | null>(null);
  const [regularDetail, setRegularDetail] = useState<RegularRoundHistoryDetail | null>(null);
  const [postingState, setPostingState] = useState<GolfCanadaPostingRecord | null>(null);
  const [companionScores, setCompanionScores] = useState<Awaited<ReturnType<typeof getGroupRoundCompanionScores>>>([]);
  const [backendReadFailed, setBackendReadFailed] = useState(false);
  const [backendErrorMessage, setBackendErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mismatchSummary, setMismatchSummary] = useState<GroupRoundMismatchReviewSummary | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [postingBusy, setPostingBusy] = useState(false);
  const [holeByHoleExpanded, setHoleByHoleExpanded] = useState(false);
  const cancelRetryRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const history = await loadRoundHistory();
      const backendHistoryRows = user?.id ? await getMyRoundHistory().catch(() => []) : [];
      let round = findLocalHistoryRoundByAnyId(history, params.id) ?? null;
      const nextHistoryMeta = findHistoryBackendRowByRouteId(backendHistoryRows, params.id)
        ?? backendHistoryRows.find((row) => row.roundId === params.id || row.round_id === params.id)
        ?? null;
      const backendRoundId = round?.backendRoundId ?? nextHistoryMeta?.roundId ?? nextHistoryMeta?.round_id ?? params.id;

      if (__DEV__ && DEBUG_STANDARD_HISTORY) {
        console.log('[standard-history] loader_source', {
          routeId: params.id,
          localHistoryFound: !!round,
          backendHistoryMetaFound: !!nextHistoryMeta,
          backendRoundId,
          loader: backendRoundId ? 'backend_rpc_loader' : 'local_history_fallback',
        });
      }

      if (mounted) {
        setHistoryMeta(nextHistoryMeta
          ?? (backendRoundId ? backendHistoryRows.find((row) => row.round_id === backendRoundId && ((row.gameType ?? row.game_type) === 'standard' || (row.gameType ?? row.game_type) === null)) ?? null : null));
      }

      if (backendRoundId) {
        try {
          const [detail, nextCompanionScores, mismatchRows] = await Promise.all([
            user?.id ? getRegularRoundHistoryDetail({ roundId: backendRoundId, userId: user.id, source: 'detail_screen' }) : Promise.resolve(null),
            user?.id ? getGroupRoundCompanionScores(backendRoundId, user.id) : Promise.resolve([]),
            getGroupRoundCompanionMismatchReview(backendRoundId),
          ]);

          if (__DEV__ && DEBUG_STANDARD_HISTORY && detail) {
            console.log('[standard-history] backend_load_success', {
              id: backendRoundId,
              holeCount: detail.holesComplete,
              totalScore: detail.currentUserScore,
              status: detail.status,
            });
          }

          if (mounted) {
            const nextPostingState = backendRoundId && user?.id
              ? await getRoundGolfCanadaPostingState(backendRoundId, user.id, round).catch(() => null)
              : resolveGolfCanadaPostingState(round, null);
            setRegularDetail(detail);
            setBackendDetail(detail?.backendDetail ?? null);
            setPostingState(nextPostingState);
            setCompanionScores(nextCompanionScores);
            setMismatchSummary(summarizeGroupRoundCompanionMismatchReview(mismatchRows));
            setBackendReadFailed(false);
            setBackendErrorMessage(null);
            if (__DEV__ && DEBUG_STANDARD_HISTORY) {
              const participantHoleScoreCellCount = (detail?.participants ?? []).reduce((sum, participant) => sum + participant.holeScores.length, 0);
              console.log('[standard-history] participant_scores_loaded', {
                roundId: backendRoundId,
                participantCount: detail?.participants.length ?? 0,
                scoreRowCount: participantHoleScoreCellCount,
              });
            }
          }
        } catch (error: any) {
          console.warn('standard round history backend read failed', error?.message ?? error);
          if (__DEV__) {
            console.log('[standard-history] backend_load_error', {
              id: backendRoundId,
              code: error?.code ?? null,
              message: error?.message ?? String(error),
              details: error?.details ?? null,
            });
          }
          if (mounted) {
            setRegularDetail(null);
            setBackendDetail(null);
            setPostingState(null);
            setCompanionScores([]);
            setMismatchSummary(null);
            setBackendReadFailed(true);
            setBackendErrorMessage(error?.message ?? 'The backend standard round history RPC failed to load.');
          }
        }
      } else if (mounted) {
        setRegularDetail(null);
        setBackendDetail(null);
        setPostingState(resolveGolfCanadaPostingState(round, null));
        setCompanionScores([]);
        setMismatchSummary(null);
      }
      if (!mounted) return;
      setSavedRound(round);
      setLoading(false);
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [params.id, user?.id]);

  const backendSyncLabel = savedRound ? getRegularRoundBackendStatusLabel(savedRound) : null;
  const golfCanadaPrep = useMemo(() => (savedRound ? getGolfCanadaPostingPrep(savedRound, user?.id) : null), [savedRound, user?.id]);
  const backendGolfCanadaPrep = useMemo(() => regularDetail?.golfCanadaPostingPrep ?? null, [regularDetail]);
  const effectiveGolfCanadaPrep = golfCanadaPrep ?? backendGolfCanadaPrep;
  const effectivePostingState = useMemo(
    () => resolveGolfCanadaPostingState(savedRound, postingState),
    [postingState, savedRound],
  );
  const title = savedRound?.roundMode === 'casual_group'
    ? 'Group Round History'
    : historyMeta && historyTypeLabelFromBackendRow(historyMeta) === 'Group'
      ? 'Group Round History'
      : 'Solo Round History';
  const backendRoundDate = historyMeta ? historyDateFromBackendRow(historyMeta) : 'Backend round';
  const backendRoundId = savedRound?.backendRoundId ?? backendDetail?.roundId ?? historyMeta?.roundId ?? historyMeta?.round_id ?? params.id;
  const friendlyRegularRoundStatus = formatRegularRoundStatus(backendDetail?.status ?? historyMeta?.status ?? null);
  const backendGroupScoreboard = useMemo<GroupScoreboardRow[]>(() => {
    return (regularDetail?.participants ?? []).map((participant) => ({
      key: participant.participantId,
      displayName: participant.name,
      totalScore: Number(participant.totalScore ?? 0),
      holesComplete: Number(participant.holesComplete ?? 0),
    })).sort((a, b) => a.totalScore - b.totalScore || a.displayName.localeCompare(b.displayName));
  }, [regularDetail]);
  const localGroupScoreboard = useMemo<GroupScoreboardRow[]>(() => {
    if (!savedRound?.group?.participants?.length) return [];
    return savedRound.group.participants.map((participant) => {
      const totalScore = savedRound.holes.reduce((sum, hole) => {
        const score = ensureGroupScoresForHole(hole, savedRound.group!.participants).find((entry) => entry.participantId === participant.id)?.score;
        return sum + (typeof score === 'number' ? score : 0);
      }, 0);
      const holesComplete = savedRound.holes.filter((hole) => {
        const score = ensureGroupScoresForHole(hole, savedRound.group!.participants).find((entry) => entry.participantId === participant.id)?.score;
        return typeof score === 'number' && score > 0;
      }).length;
      return {
        key: participant.id,
        displayName: participant.displayName,
        totalScore,
        holesComplete,
      };
    }).sort((a, b) => a.totalScore - b.totalScore || a.displayName.localeCompare(b.displayName));
  }, [savedRound]);
  const effectiveGroupScoreboard = localGroupScoreboard.length > 0 ? localGroupScoreboard : backendGroupScoreboard;
  const holeByHolePlayerCount = savedRound?.roundMode === 'casual_group'
    ? (savedRound.group?.participants?.length ?? 0)
    : (savedRound ? 1 : Math.max(regularDetail?.participants.length ?? 0, 1));
  const holeByHoleHoleCount = savedRound?.holes.length ?? Math.max(
    regularDetail?.currentUserHoleScores.length ?? 0,
    ...((regularDetail?.participants ?? []).map((participant) => participant.holeScores.length)),
    0,
  );
  const holeByHoleScoreCellCount = savedRound
    ? savedRound.holes.reduce((sum, hole) => {
      if (savedRound.roundMode === 'casual_group' && savedRound.group?.participants?.length) {
        return sum + ensureGroupScoresForHole(hole, savedRound.group.participants).length;
      }
      return sum + 1;
    }, 0)
    : (regularDetail?.participants ?? []).reduce((sum, participant) => sum + participant.holeScores.length, 0);
  const hasBackendDetail = !!backendDetail;
  const backendHoleCount = backendDetail?.holeCount ?? 0;
  const hasParticipantScores = effectiveGroupScoreboard.length > 1;
  const participantCount = effectiveGroupScoreboard.length;
  const backendLoading = loading;
  const backendErrorCode = backendReadFailed ? (backendErrorMessage ?? 'backend_error') : null;
  const willShowNotFound = !savedRound && !hasBackendDetail && !backendLoading && !backendReadFailed && !regularDetail;
  const renderSource = loading
    ? 'backend_loading'
    : backendReadFailed && !savedRound
      ? 'backend_error'
      : savedRound
        ? 'local_saved_round'
        : hasBackendDetail
          ? 'backend_detail'
          : 'not_found';

  if (__DEV__ && DEBUG_STANDARD_HISTORY) {
    console.log('[standard-history] render_state', {
      routeId: params.id,
      localHistoryFound: !!savedRound,
      backendHistoryMetaFound: !!historyMeta,
      hasBackendDetail,
      backendHoleCount,
      hasParticipantScores,
      participantCount,
      backendLoading,
      backendErrorCode,
      willShowNotFound,
      renderSource,
    });
  }

  useEffect(() => {
    if (!__DEV__ || !DEBUG_STANDARD_HISTORY) return;
    console.log('[standard-history] hole_by_hole_data', {
      routeId: params.id,
      playerCount: holeByHolePlayerCount,
      holeCount: holeByHoleHoleCount,
      scoreCellCount: holeByHoleScoreCellCount,
      sourceUsed: savedRound ? 'local_saved_round' : 'regular_detail',
    });
  }, [holeByHoleHoleCount, holeByHolePlayerCount, holeByHoleScoreCellCount, params.id, savedRound]);

  const toggleHoleByHole = () => {
    setHoleByHoleExpanded((current) => {
      const nextExpanded = !current;
      if (__DEV__ && DEBUG_STANDARD_HISTORY) {
        console.log('[standard-history] hole_by_hole_toggle', {
          routeId: params.id,
          expanded: nextExpanded,
        });
      }
      return nextExpanded;
    });
  };

  const handleRetryBackendSave = async () => {
    if (!savedRound) return;

    if (retrying) {
      cancelRetryRef.current = true;
      return;
    }

    if (!user?.id) {
      Alert.alert('Sign in required', 'Sign in before retrying backend save for this round.');
      return;
    }

    setRetrying(true);
    cancelRetryRef.current = false;

    try {
      const retryableRound = prepareRegularRoundManualRetry(savedRound);
      setSavedRound(retryableRound);
      await updateSavedRound(savedRound.id, () => retryableRound as SavedRound);

      const syncResult = await runRegularRoundFinalSyncLoop({
        round: retryableRound,
        userId: user.id,
        persist: async (nextRound) => {
          const updated = await updateSavedRound(savedRound.id, () => nextRound as SavedRound);
          if (updated) setSavedRound(updated);
        },
        onUpdate: (nextRound) => {
          setSavedRound(nextRound as SavedRound);
        },
        shouldCancel: () => cancelRetryRef.current,
      });

      if (syncResult.cancelled) {
        Alert.alert('Backend sync cancelled', 'This round remains saved locally. Retry it again later.');
      }
    } catch (nextError: any) {
      Alert.alert('Backend sync failed', nextError?.message ?? 'This round was not saved to the backend yet.');
    } finally {
      setRetrying(false);
      cancelRetryRef.current = false;
    }
  };

  const handleMarkPosted = async () => {
    if (!effectiveGolfCanadaPrep) return;

    if (!user?.id || !backendRoundId) {
      if (!savedRound) return;
      const updatedRound = await updateSavedRound(savedRound.id, (entry) =>
        buildGolfCanadaPostedRound(entry, {
          playedAlone: effectiveGolfCanadaPrep.postingState.playedAlone === true,
          playedWithOthers: effectiveGolfCanadaPrep.postingState.playedWithOthers === true,
        }),
      );
      if (updatedRound) {
        setSavedRound(updatedRound);
        setPostingState(resolveGolfCanadaPostingState(updatedRound, null));
      }
      return;
    }

    try {
      setPostingBusy(true);
      const nextPostingState = await markRoundGolfCanadaPosted({ roundId: backendRoundId, userId: user.id, round: savedRound });
      setPostingState(nextPostingState);
      if (savedRound) {
        const updatedRound = await updateSavedRound(savedRound.id, (entry) =>
          buildGolfCanadaPostedRound(entry, {
            playedAlone: nextPostingState.playedAlone === true,
            playedWithOthers: nextPostingState.playedWithOthers === true,
            postedAt: nextPostingState.postedAt ?? null,
          }),
        );
        if (updatedRound) setSavedRound(updatedRound);
      }
    } catch (nextError: any) {
      Alert.alert('Golf Canada status unavailable', nextError?.message ?? 'Could not mark this round as posted.');
    } finally {
      setPostingBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{savedRound?.date ?? backendRoundDate}</Text>

        {loading ? (
          <SectionCard>
            <Text style={styles.body}>Loading round history...</Text>
          </SectionCard>
        ) : !savedRound && backendReadFailed ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Backend history unavailable</Text>
            <Text style={styles.body}>{backendErrorMessage ?? 'The backend standard round history RPC failed to load for this round.'}</Text>
          </SectionCard>
        ) : willShowNotFound ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Round not found</Text>
            <Text style={styles.body}>This round is not available in local history or backend history.</Text>
          </SectionCard>
        ) : savedRound && !isStandardRound(savedRound) ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Use the game history view</Text>
            <Text style={styles.body}>This saved round has its own game-specific history view.</Text>
          </SectionCard>
        ) : (
          <>
            {backendSyncLabel ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>{backendSyncLabel}</Text>
                <Text style={styles.body}>{savedRound ? getRegularRoundBackendStatusDetail(savedRound) : ''}</Text>
                <AppButton
                  title={retrying ? 'Cancel Sync' : 'Retry Backend Save'}
                  onPress={handleRetryBackendSave}
                  variant="secondary"
                />
              </SectionCard>
            ) : null}

            {(savedRound || backendDetail) ? (
              <GolfCanadaSection
                postingState={effectivePostingState}
                prep={effectiveGolfCanadaPrep}
                description="Golf Canada posting is manual and separate from backend save status."
                onPost={() => router.push(
                  savedRound
                    ? (`/round/golf-canada-webview/${savedRound.id}` as any)
                    : (`/round/golf-canada-webview/${backendRoundId}?source=standard-backend` as any),
                )}
                onMarkPosted={handleMarkPosted}
                postingBusy={postingBusy}
              />
            ) : null}

            {((savedRound?.roundMode === 'casual_group' && savedRound.backendRoundId) || (backendDetail?.roundMode === 'casual_group' && backendRoundId)) ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Companion Review</Text>
                <Text style={styles.body}>Review participant cross-card scores against the official group-round score after completion.</Text>
                {mismatchSummary?.reviewComplete ? (
                  <>
                    <Text style={styles.body}>Mismatch review is complete for this round.</Text>
                    <AppButton
                      title="View Completed Review"
                      onPress={() => router.push(`/round/mismatch-review/${backendRoundId}` as any)}
                      variant="secondary"
                    />
                  </>
                ) : mismatchSummary?.unresolved ? (
                  <AppButton
                    title="Open Mismatch Review"
                    onPress={() => router.push(`/round/mismatch-review/${backendRoundId}` as any)}
                    variant="secondary"
                  />
                ) : mismatchSummary?.total ? (
                  <Text style={styles.body}>Cross-card review is available in read-only mode. No unresolved mismatches remain.</Text>
                ) : (
                  <Text style={styles.body}>No participant cross-card mismatches are available for review yet.</Text>
                )}
              </SectionCard>
            ) : null}

            {savedRound ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Round Summary</Text>
                <Text style={styles.body}>{teeDisplayLabel(savedRound.tee)}</Text>
                <View style={styles.statGrid}>
                  <View style={styles.statCard}>
                    <Text style={styles.statValue}>{formatStat(savedRound.totalScore)}</Text>
                    <Text style={styles.statLabel}>Total</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statValue}>{formatStat(savedRound.totalPutts)}</Text>
                    <Text style={styles.statLabel}>Putts</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statValue}>{formatStat(savedRound.fairwaysHit)}</Text>
                    <Text style={styles.statLabel}>Fairways</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statValue}>{formatStat(savedRound.greensInRegulation)}</Text>
                    <Text style={styles.statLabel}>GIR</Text>
                  </View>
                </View>
                <Text style={styles.body}>
                  One-putts {savedRound.onePutts} / Three-putts {savedRound.threePutts} / Up and downs {savedRound.upAndDowns}
                </Text>
              </SectionCard>
            ) : backendDetail || historyMeta ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Round Summary</Text>
                <Text style={styles.body}>Course {backendDetail?.courseName ?? historyMeta?.course_name ?? 'Unknown'}</Text>
                <Text style={styles.body}>Date {backendDetail?.roundDate ?? historyMeta?.round_date ?? backendRoundDate}</Text>
                <Text style={styles.body}>Type {backendDetail?.roundMode === 'casual_group' ? 'Group' : 'Standard'}</Text>
                {backendDetail?.teeName ? <Text style={styles.body}>{backendDetail.teeName} tee</Text> : null}
                <View style={styles.statGrid}>
                  <View style={styles.statCard}>
                    <Text style={styles.statValue}>{formatStat(backendDetail?.currentUserScore ?? historyMeta?.current_user_score)}</Text>
                    <Text style={styles.statLabel}>Total</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statValue}>{formatStat(backendDetail?.holeCount ?? historyMeta?.holes_complete ?? null)}</Text>
                    <Text style={styles.statLabel}>Holes</Text>
                  </View>
                  {backendDetail?.statsSummary ? (
                    <>
                      <View style={styles.statCard}>
                        <Text style={styles.statValue}>{formatStat(backendDetail.statsSummary.totalPutts)}</Text>
                        <Text style={styles.statLabel}>Putts</Text>
                      </View>
                      <View style={styles.statCard}>
                        <Text style={styles.statValue}>{formatStat(backendDetail.statsSummary.greensInRegulation)}</Text>
                        <Text style={styles.statLabel}>GIR</Text>
                      </View>
                    </>
                  ) : null}
                </View>
                {friendlyRegularRoundStatus ? (
                  <Text style={styles.body}>{friendlyRegularRoundStatus}</Text>
                ) : null}
                {backendDetail?.statsSummary ? (
                  <Text style={styles.body}>
                    Fairways {formatStat(backendDetail.statsSummary.fairwaysHit)} / Putts {formatStat(backendDetail.statsSummary.totalPutts)} / Up and downs {formatStat(backendDetail.statsSummary.upAndDowns)}
                  </Text>
                ) : null}
              </SectionCard>
            ) : null}

            {savedRound?.roundMode === 'casual_group' && savedRound.group?.participants?.length ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>{savedRound.group.groupName}</Text>
                <View style={styles.cardList}>
                  {savedRound.group.participants.map((participant) => (
                    <Text key={participant.id} style={styles.body}>
                      {participant.displayName}{participant.type === 'app_user' ? ' (you)' : ''}
                    </Text>
                  ))}
                </View>
              </SectionCard>
            ) : null}

            {effectiveGroupScoreboard.length > 1 ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Group Scores</Text>
                <View style={styles.cardList}>
                  {effectiveGroupScoreboard.map((participant) => (
                    <View key={participant.key} style={styles.holeCard}>
                      <View style={styles.holeHeader}>
                        <Text style={styles.holeTitle}>{participant.displayName}</Text>
                        <Text style={styles.holeScore}>{formatStat(participant.totalScore)}</Text>
                      </View>
                      <Text style={styles.playerMeta}>Thru {participant.holesComplete}</Text>
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}

            <SectionCard>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Hole by Hole</Text>
                <AppButton
                  title={holeByHoleExpanded ? 'Hide Hole by Hole' : 'Hole by Hole'}
                  onPress={toggleHoleByHole}
                  variant="secondary"
                  style={styles.inlineAction}
                />
              </View>
              <Text style={styles.body}>
                {holeByHoleExpanded
                  ? 'Per-hole scores are expanded below.'
                  : 'Show full per-hole scores only when you need them.'}
              </Text>
              {holeByHoleExpanded ? (
                savedRound ? (
                  <View style={styles.cardList}>
                    {savedRound.holes.map((hole) => (
                      <View key={`standard-history-hole-${hole.hole}`} style={styles.holeCard}>
                        <View style={styles.holeHeader}>
                          <Text style={styles.holeTitle}>Hole {hole.hole}</Text>
                          <Text style={styles.holeScore}>{formatStat(getDisplayScore(savedRound, hole))}</Text>
                        </View>
                        {savedRound.roundMode === 'casual_group' && savedRound.group?.participants?.length ? (
                          ensureGroupScoresForHole(hole, savedRound.group.participants).map((entry) => {
                            const participant = savedRound.group?.participants.find((item) => item.id === entry.participantId);
                            return (
                              <Text key={`standard-history-score-${hole.hole}-${entry.participantId}`} style={styles.playerMeta}>
                                {participant?.displayName ?? 'Player'}: {formatStat(entry.score)}
                              </Text>
                            );
                          })
                        ) : null}
                        <Text style={styles.playerMeta}>Putts {formatStat(hole.totalPutts)}</Text>
                        <Text style={styles.playerMeta}>Fairway {hole.driveSafe ? 'Hit' : hole.drivePenalty ? 'Miss / penalty' : '-'}</Text>
                        <Text style={styles.playerMeta}>Green {hole.hitGreen ? 'Hit' : hole.girMissPenalty ? 'Miss / penalty' : '-'}</Text>
                        {hole.note ? <Text style={styles.playerMeta}>{hole.note}</Text> : null}
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.cardList}>
                    {Array.from({ length: holeByHoleHoleCount }, (_, index) => index + 1).map((holeNumber) => {
                      const playerRows = (regularDetail?.participants ?? []).map((participant) => ({
                        participantId: participant.participantId,
                        isCurrentUser: participant.userId === user?.id,
                        displayName: participant.name,
                        strokes: participant.holeScores.find((entry) => entry.holeNumber === holeNumber)?.strokes ?? null,
                      }));
                      const headlineScore = playerRows.find((row) => row.isCurrentUser && row.strokes != null)?.strokes
                        ?? playerRows.find((row) => row.strokes != null)?.strokes
                        ?? null;
                      const currentUserHole = regularDetail?.personalStatsByHole?.find((entry) => entry.holeNumber === holeNumber) ?? null;
                      return (
                        <View key={`standard-history-backend-hole-${holeNumber}`} style={styles.holeCard}>
                          <View style={styles.holeHeader}>
                            <Text style={styles.holeTitle}>Hole {holeNumber}</Text>
                            <Text style={styles.holeScore}>{formatStat(headlineScore)}</Text>
                          </View>
                          {playerRows.map((row) => (
                            <Text key={`standard-history-backend-score-${holeNumber}-${row.participantId}`} style={styles.playerMeta}>
                              {row.displayName}: {formatStat(row.strokes)}
                            </Text>
                          ))}
                          {currentUserHole?.totalPutts != null ? (
                            <Text style={styles.playerMeta}>Putts {formatStat(currentUserHole.totalPutts ?? null)}</Text>
                          ) : null}
                          {currentUserHole?.fairwayHit != null ? (
                            <Text style={styles.playerMeta}>Fairway {currentUserHole.fairwayHit ? 'Hit' : 'Miss'}</Text>
                          ) : null}
                          {currentUserHole?.hitGreen != null ? (
                            <Text style={styles.playerMeta}>Green {currentUserHole.hitGreen ? 'Hit' : 'Miss'}</Text>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                )
              ) : null}
            </SectionCard>

            {savedRound?.roundMode === 'casual_group' && companionScores.length > 0 ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>My Cross-card History</Text>
                <Text style={styles.body}>These are the participant-entered companion scores saved under your account.</Text>
                <View style={styles.cardList}>
                  {companionScores.map((row) => (
                    <View key={`companion-history-${row.id}`} style={styles.holeCard}>
                      <View style={styles.holeHeader}>
                        <Text style={styles.holeTitle}>Hole {row.hole_number}</Text>
                        <Text style={styles.holeScore}>{formatStat(row.strokes)}</Text>
                      </View>
                      <Text style={styles.playerMeta}>
                        Official {formatStat(row.official_strokes)}
                        {typeof row.score_delta === 'number'
                          ? ` / Delta ${row.score_delta > 0 ? '+' : ''}${row.score_delta}`
                          : ''}
                      </Text>
                      {row.notes ? <Text style={styles.playerMeta}>{row.notes}</Text> : null}
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}
          </>
        )}

        <AppButton title="Back to history" onPress={() => router.back()} variant="secondary" />
      </ScrollView>
      <PlayerBottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f0e7' },
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, gap: 16, paddingBottom: 112 },
  title: { fontSize: 28, fontWeight: '800', color: '#132117' },
  subtitle: { fontSize: 15, color: '#5a6b61', lineHeight: 22 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  inlineAction: { minWidth: 156 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  body: { fontSize: 14, color: '#5a6b61', lineHeight: 21 },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginBottom: 10,
  },
  statusPillPending: { backgroundColor: '#efe7d5' },
  statusPillPosted: { backgroundColor: '#e7efe8' },
  statusPillText: { fontSize: 13, color: '#18341d', fontWeight: '800' },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginVertical: 12,
  },
  statCard: {
    width: '47%',
    backgroundColor: '#eef3ec',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
  },
  statValue: { fontSize: 24, fontWeight: '800', color: '#132117' },
  statLabel: { fontSize: 12, fontWeight: '800', color: '#5a6b61', textTransform: 'uppercase' },
  cardList: { gap: 10, marginTop: 6 },
  holeCard: { backgroundColor: '#f8f5ee', borderRadius: 16, padding: 12, gap: 4 },
  holeHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  holeTitle: { fontSize: 16, fontWeight: '800', color: '#132117', marginBottom: 2 },
  holeScore: { fontSize: 18, fontWeight: '800', color: '#132117' },
  playerMeta: { fontSize: 13, color: '#5a6b61' },
});
