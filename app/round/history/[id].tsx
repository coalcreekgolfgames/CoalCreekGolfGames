import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AppButton } from '@/components/ui/AppButton';
import { PlayerBottomNav } from '@/components/navigation/PlayerBottomNav';
import { GolfCanadaSection } from '@/components/round/GolfCanadaSection';
import { SectionCard } from '@/components/ui/SectionCard';
import { SettlementBreakdown } from '@/components/round/SettlementBreakdown';
import { DEFAULT_TEE_OPTION, resolveTeeOption } from '@/constants/course';
import { formatCurrencyFromCents } from '@/lib/currency';
import {
  buildGolfCanadaPostingPrepFromRoundGameSummary,
  buildGolfCanadaPostedRound,
  getGolfCanadaPostingPrep,
  getRoundGolfCanadaPostingState,
  markRoundGolfCanadaPosted,
  resolveGolfCanadaPostingState,
} from '@/lib/golfCanada';
import {
  getRegularRoundBackendStatusDetail,
  getRegularRoundBackendStatusLabel,
  prepareRegularRoundManualRetry,
  runRegularRoundFinalSyncLoop,
} from '@/lib/regularRoundBackendSync';
import {
  findHistoryBackendRowByRouteId,
  findLocalHistoryRoundByAnyId,
  getMyRoundHistory,
  historyDateFromBackendRow,
} from '@/lib/historyBackend';
import { getBbbHistorySummary, type BbbHistorySummary } from '@/lib/bbbBackend';
import { loadRoundHistory, updateSavedRound } from '@/lib/localRound';
import { summarizeRound } from '@/lib/roundStats';
import { getRegularRoundHistoryDetail, type RegularRoundHistoryDetail } from '@/lib/regularRoundHistory';
import { calculateGameSettlement } from '@/lib/settlements';
import {
  getGroupRoundCompanionMismatchReview,
  getGroupRoundCompanionScores,
  summarizeGroupRoundCompanionMismatchReview,
} from '@/lib/groupRoundCompanions';
import { useAuth } from '@/providers/AuthProvider';
import type { GolfCanadaPostingRecord, SavedRound } from '@/types/round';
import type { GroupRoundMismatchReviewSummary } from '@/lib/groupRoundCompanions';
import type { MyRoundHistoryRow } from '@/lib/historyBackend';

const DEBUG_GOLF_CANADA_BBB = false;

export default function BbbHistoryDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [savedRound, setSavedRound] = useState<SavedRound | null>(null);
  const [historyMeta, setHistoryMeta] = useState<MyRoundHistoryRow | null>(null);
  const [summary, setSummary] = useState<BbbHistorySummary | null>(null);
  const [regularDetail, setRegularDetail] = useState<RegularRoundHistoryDetail | null>(null);
  const [companionScores, setCompanionScores] = useState<Awaited<ReturnType<typeof getGroupRoundCompanionScores>>>([]);
  const [postingState, setPostingState] = useState<GolfCanadaPostingRecord | null>(null);
  const [postingBusy, setPostingBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mismatchSummary, setMismatchSummary] = useState<GroupRoundMismatchReviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const cancelRetryRef = useRef(false);
  const backendStatusLabel = savedRound ? getRegularRoundBackendStatusLabel(savedRound) : null;

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const history = await loadRoundHistory();
        const backendHistoryRows = user?.id ? await getMyRoundHistory().catch(() => []) : [];
        const round = findLocalHistoryRoundByAnyId(history, params.id) ?? null;
        const backendHistoryMeta = findHistoryBackendRowByRouteId(backendHistoryRows, params.id)
          ?? backendHistoryRows.find((row) => row.round_game_id === params.id && row.game_type === 'bbb')
          ?? backendHistoryRows.find((row) => row.round_id === (round?.backendRoundId ?? params.id) && row.game_type === 'bbb')
          ?? null;
        if (!mounted) return;
        setSavedRound(round);
        setHistoryMeta(backendHistoryMeta);

        const resolvedRoundGameId = round?.backendRoundGameId ?? backendHistoryMeta?.round_game_id ?? null;
        const backendRoundId = round?.backendRoundId ?? backendHistoryMeta?.round_id ?? params.id;

        if (!backendRoundId) {
          setCompanionScores([]);
          setMismatchSummary(null);
          setLoading(false);
          return;
        }

        const [nextSummary, nextCompanionScores, mismatchRows] = await Promise.all([
          getBbbHistorySummary(backendRoundId),
          user?.id ? getGroupRoundCompanionScores(backendRoundId, user.id) : Promise.resolve([]),
          getGroupRoundCompanionMismatchReview(backendRoundId),
        ]);
        const nextRegularDetail = backendRoundId && user?.id
          ? await getRegularRoundHistoryDetail({
            roundId: backendRoundId,
            roundGameId: resolvedRoundGameId ?? nextSummary?.round_game_id ?? null,
            gameType: 'bbb',
            userId: user.id,
            source: 'detail_screen',
          }).catch(() => null)
          : null;
        const nextPostingState = backendRoundId && user?.id
          ? await getRoundGolfCanadaPostingState(backendRoundId, user.id, round).catch(() => null)
          : resolveGolfCanadaPostingState(round, null);
        if (!mounted) return;
        setSummary(nextSummary);
        setRegularDetail(nextRegularDetail);
        setCompanionScores(nextCompanionScores);
        setMismatchSummary(summarizeGroupRoundCompanionMismatchReview(mismatchRows));
        setPostingState(nextPostingState);
      } catch (nextError: any) {
        if (!mounted) return;
        setCompanionScores([]);
        setMismatchSummary(null);
        setRegularDetail(null);
        setPostingState(null);
        setError(nextError?.message ?? 'BBB history is unavailable.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [params.id, user?.id]);

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
      } else if (syncResult.round.backendRoundId) {
        const [nextSummary, nextCompanionScores, mismatchRows] = await Promise.all([
          getBbbHistorySummary(syncResult.round.backendRoundId),
          user?.id ? getGroupRoundCompanionScores(syncResult.round.backendRoundId, user.id) : Promise.resolve([]),
          getGroupRoundCompanionMismatchReview(syncResult.round.backendRoundId),
        ]);
        setSummary(nextSummary);
        setCompanionScores(nextCompanionScores);
        setMismatchSummary(summarizeGroupRoundCompanionMismatchReview(mismatchRows));
        if (user?.id) {
          const nextRegularDetail = await getRegularRoundHistoryDetail({
            roundId: syncResult.round.backendRoundId,
            gameType: 'bbb',
            userId: user.id,
            source: 'detail_screen',
          }).catch(() => null);
          setRegularDetail(nextRegularDetail);
          const nextPostingState = await getRoundGolfCanadaPostingState(syncResult.round.backendRoundId, user.id, syncResult.round as SavedRound).catch(() => null);
          setPostingState(nextPostingState);
        }
      }
    } catch (nextError: any) {
      Alert.alert('Backend sync failed', nextError?.message ?? 'This round was not saved to the backend yet.');
    } finally {
      setRetrying(false);
      cancelRetryRef.current = false;
    }
  };

  const backendBuyInCents = summary?.buy_in_cents ?? null;
  const settlement = summary?.standings.length
    ? calculateGameSettlement({
      buyInCents: backendBuyInCents ?? savedRound?.roundGameBuyInCents ?? 0,
      players: summary.standings.map((row) => ({
        id: row.participant_id,
        displayName: row.display_name,
        units: row.total_bbb_points,
      })),
    })
    : null;
  const personalSummary = savedRound?.statsEnabled !== false ? summarizeRound(savedRound?.holes ?? []) : null;
  const localGolfCanadaPrep = useMemo(() => (savedRound ? getGolfCanadaPostingPrep(savedRound, user?.id) : null), [savedRound, user?.id]);
  const backendGolfCanadaPrep = useMemo(() => regularDetail?.golfCanadaPostingPrep ?? null, [regularDetail]);
  const backendRoundId = savedRound?.backendRoundId ?? historyMeta?.round_id ?? regularDetail?.roundId ?? summary?.round_id ?? null;
  const roundGameId = savedRound?.backendRoundGameId ?? historyMeta?.round_game_id ?? regularDetail?.roundGameId ?? summary?.round_game_id ?? null;
  const summarySourceRound = useMemo(() => {
    if (savedRound || !backendRoundId) return null;
    return {
      id: backendRoundId,
      draftOwnerUserId: user?.id ?? null,
      date: historyMeta ? historyDateFromBackendRow(historyMeta) : (regularDetail?.roundDate ?? new Date().toISOString().slice(0, 10)),
      tee: resolveTeeOption(regularDetail?.backendDetail.teeName ?? DEFAULT_TEE_OPTION),
      ratingType: 'middle' as any,
      currentHole: 18,
      holes: [],
      roundMode: 'casual_group',
      group: null,
      groupGameMode: 'bingo_bango_bongo',
      backendRoundId,
      backendRoundGameId: roundGameId,
      statsEnabled: regularDetail?.personalStatsSummary != null,
      postingStates: null,
      savedAt: regularDetail?.roundDate ?? new Date().toISOString(),
      totalScore: regularDetail?.currentUserScore ?? 0,
      totalPutts: regularDetail?.personalStatsSummary?.totalPutts ?? 0,
      onePutts: 0,
      threePutts: 0,
      upAndDowns: regularDetail?.personalStatsSummary?.upAndDowns ?? 0,
      fairwaysHit: regularDetail?.personalStatsSummary?.fairwaysHit ?? 0,
      greensInRegulation: regularDetail?.personalStatsSummary?.greensInRegulation ?? 0,
      nearGreenCount: 0,
      penalties: regularDetail?.personalStatsSummary?.penalties ?? 0,
      doublesOrWorse: 0,
    } as SavedRound;
  }, [backendRoundId, historyMeta, regularDetail, roundGameId, savedRound, user?.id]);
  const summaryGolfCanadaPrep = useMemo(() => {
    if (!summary || !user?.id || !summarySourceRound) return null;
    return buildGolfCanadaPostingPrepFromRoundGameSummary(summarySourceRound, user.id, summary.holes, summary.standings);
  }, [summary, summarySourceRound, user?.id]);
  const golfCanadaPrep = useMemo(() => {
    if (localGolfCanadaPrep) return localGolfCanadaPrep;
    if (backendGolfCanadaPrep) return backendGolfCanadaPrep;
    return summaryGolfCanadaPrep;
  }, [backendGolfCanadaPrep, localGolfCanadaPrep, summaryGolfCanadaPrep]);
  const effectivePostingState = useMemo(
    () => resolveGolfCanadaPostingState(savedRound, postingState),
    [postingState, savedRound],
  );

  useEffect(() => {
    if (!__DEV__ || !DEBUG_GOLF_CANADA_BBB) return;
    console.debug('[golf-canada-bbb-debug]', {
      routeId: params.id,
      currentUserId: user?.id ?? null,
      backendRoundId,
      roundGameId,
      savedRoundId: savedRound?.id ?? null,
      savedRoundBackendRoundId: savedRound?.backendRoundId ?? null,
      hasRegularDetail: !!regularDetail,
      regularDetailRoundId: regularDetail?.roundId ?? null,
      hasRegularPostingPrep: !!backendGolfCanadaPrep,
      regularPostingHoleCount: backendGolfCanadaPrep?.scores.filter((entry) => typeof entry.score === 'number').length ?? 0,
      hasBbbSummary: !!summary,
      bbbSummaryRoundId: summary?.round_id ?? null,
      bbbSummaryRoundGameId: summary?.round_game_id ?? null,
      hasSummaryPostingPrep: !!summaryGolfCanadaPrep,
      summaryPostingHoleCount: summaryGolfCanadaPrep?.scores.filter((entry) => typeof entry.score === 'number').length ?? 0,
      finalHasPostingPrep: !!golfCanadaPrep,
      finalPostingPrepSource: localGolfCanadaPrep
        ? 'local_round'
        : backendGolfCanadaPrep
          ? 'regular_detail'
          : summaryGolfCanadaPrep
            ? 'bbb_summary'
            : 'none',
      postedStateLoaded: !!postingState,
    });
  }, [
    backendGolfCanadaPrep,
    backendRoundId,
    golfCanadaPrep,
    localGolfCanadaPrep,
    params.id,
    postingState,
    roundGameId,
    regularDetail,
    savedRound?.backendRoundId,
    savedRound?.id,
    summary,
    summaryGolfCanadaPrep,
    user?.id,
  ]);

  const handleMarkPosted = async () => {
    if (!user?.id || !backendRoundId) {
      if (!savedRound || !golfCanadaPrep) return;
      const updatedRound = await updateSavedRound(savedRound.id, (entry) =>
        buildGolfCanadaPostedRound(entry, {
          playedAlone: golfCanadaPrep.postingState.playedAlone === true,
          playedWithOthers: golfCanadaPrep.postingState.playedWithOthers === true,
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
      const nextPostingState = await markRoundGolfCanadaPosted({
        roundId: backendRoundId,
        userId: user.id,
        round: savedRound,
      });
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
        <Text style={styles.title}>BBB History</Text>
        <Text style={styles.subtitle}>{savedRound?.group?.groupName ?? 'Bingo Bango Bongo'} · {savedRound?.date ?? (historyMeta ? historyDateFromBackendRow(historyMeta) : 'Backend round')}</Text>

        {!savedRound && !summary && !loading ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Round not found</Text>
            <Text style={styles.body}>This round is not available in local history or backend history.</Text>
          </SectionCard>
        ) : loading ? (
          <SectionCard>
            <Text style={styles.body}>Loading BBB history...</Text>
          </SectionCard>
        ) : error ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>BBB history unavailable</Text>
            <Text style={styles.body}>{error}</Text>
          </SectionCard>
        ) : !summary ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>No backend BBB history found</Text>
            <Text style={styles.body}>This round was saved locally, but no synced BBB history was returned from the backend.</Text>
            {backendStatusLabel ? (
              <>
                <Text style={styles.body}>{savedRound ? getRegularRoundBackendStatusDetail(savedRound) : ''}</Text>
                <AppButton
                  title={retrying ? 'Cancel Sync' : 'Retry Backend Save'}
                  onPress={handleRetryBackendSave}
                  variant="secondary"
                />
              </>
            ) : null}
          </SectionCard>
        ) : (
          <>
            {backendStatusLabel ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>{backendStatusLabel}</Text>
                <Text style={styles.body}>{savedRound ? getRegularRoundBackendStatusDetail(savedRound) : ''}</Text>
                <AppButton
                  title={retrying ? 'Cancel Sync' : 'Retry Backend Save'}
                  onPress={handleRetryBackendSave}
                  variant="secondary"
                />
              </SectionCard>
            ) : null}
            {(savedRound?.backendRoundId ?? historyMeta?.round_id) ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Companion Review</Text>
                <Text style={styles.body}>Review participant cross-card scores against the official BBB score after completion.</Text>
                {mismatchSummary?.reviewComplete ? (
                  <>
                    <Text style={styles.body}>Mismatch review is complete for this round.</Text>
                    <AppButton
                      title="View Completed Review"
                      onPress={() => router.push(`/round/mismatch-review/${savedRound?.backendRoundId ?? historyMeta?.round_id}` as any)}
                      variant="secondary"
                    />
                  </>
                ) : mismatchSummary?.unresolved ? (
                  <AppButton
                    title="Open Mismatch Review"
                    onPress={() => router.push(`/round/mismatch-review/${savedRound?.backendRoundId ?? historyMeta?.round_id}` as any)}
                    variant="secondary"
                  />
                ) : mismatchSummary?.total ? (
                  <Text style={styles.body}>Cross-card review is available in read-only mode. No unresolved mismatches remain.</Text>
                ) : (
                  <Text style={styles.body}>No participant cross-card mismatches are available for review yet.</Text>
                )}
              </SectionCard>
            ) : null}
            {(savedRound || regularDetail || summary || backendRoundId) ? (
              <GolfCanadaSection
                postingState={effectivePostingState}
                prep={golfCanadaPrep}
                description="Post your own completed BBB round to Golf Canada using your official hole-by-hole score."
                onPost={() => router.push(
                  savedRound
                    ? (`/round/golf-canada-webview/${savedRound.id}?source=bbb` as any)
                    : (`/round/golf-canada-webview/${backendRoundId ?? params.id}?source=bbb` as any),
                )}
                onMarkPosted={handleMarkPosted}
                postingBusy={postingBusy}
              />
            ) : null}
            <SectionCard>
              <Text style={styles.sectionTitle}>Final Totals</Text>
              <SettlementBreakdown settlement={settlement} unitLabel="BBB point" />
              {personalSummary ? (
                <>
                  <Text style={styles.sectionTitle}>Personal Round Stats</Text>
                  <Text style={styles.body}>Putts {personalSummary.totalPutts} · Fairways {personalSummary.fairwaysHit} · GIR {personalSummary.greensInRegulation}</Text>
                  <Text style={styles.body}>One-putts {personalSummary.onePutts} · Three-putts {personalSummary.threePutts} · Up and downs {personalSummary.upAndDowns}</Text>
                </>
              ) : null}
              <View style={styles.cardList}>
                {summary.standings.map((row) => (
                  <View key={row.participant_id} style={styles.playerCard}>
                    <View style={styles.playerHeader}>
                      <Text style={styles.playerName}>{row.standing_rank}. {row.display_name}</Text>
                      <Text style={styles.playerPoints}>{row.total_bbb_points} pts</Text>
                    </View>
                    <Text style={styles.playerMeta}>Bingo {row.bingo_count} · Bango {row.bango_count} · Bongo {row.bongo_count}</Text>
                    <Text style={styles.playerMeta}>Strokes {row.stroke_total}</Text>
                    <Text style={styles.playerMeta}>{formatSettlementPlayer(settlement, row.participant_id)}</Text>
                  </View>
                ))}
              </View>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>My Cross-card History</Text>
              {companionScores.length === 0 ? (
                <Text style={styles.body}>No participant cross-cards are available for this round yet.</Text>
              ) : (
                <View style={styles.cardList}>
                  {companionScores.map((row) => (
                    <View key={`bbb-companion-history-${row.id}`} style={styles.holeCard}>
                      <View style={styles.playerHeader}>
                        <Text style={styles.holeTitle}>Hole {row.hole_number}</Text>
                        <Text style={styles.playerPoints}>{row.strokes}</Text>
                      </View>
                      <Text style={styles.playerMeta}>Official {typeof row.official_strokes === 'number' ? row.official_strokes : '-'}</Text>
                      <Text style={styles.playerMeta}>
                        {row.official_score_source === 'bingo_bango_bongo'
                          ? 'BBB official score'
                          : row.official_score_source === 'skins'
                            ? 'Skins official score'
                            : row.official_score_source === 'standard'
                              ? 'Group official score'
                              : 'Official score'}
                      </Text>
                      <Text style={styles.playerMeta}>
                        Delta {typeof row.score_delta === 'number' ? `${row.score_delta > 0 ? '+' : ''}${row.score_delta}` : '-'}
                      </Text>
                      {row.notes ? <Text style={styles.playerMeta}>{row.notes}</Text> : null}
                    </View>
                  ))}
                </View>
              )}
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Hole-by-hole</Text>
              <View style={styles.cardList}>
                {summary.holes.map((hole) => (
                  <View key={hole.round_game_bbb_hole_id} style={styles.holeCard}>
                    <Text style={styles.holeTitle}>Hole {hole.hole_number}</Text>
                    {hole.scores.map((score) => (
                      <Text key={`${hole.hole_number}-${score.participant_id}`} style={styles.playerMeta}>
                        {score.display_name}: {score.score ?? '-'}
                      </Text>
                    ))}
                    <Text style={styles.playerMeta}>Bingo: {hole.bingo_winner_display_name ?? 'Not set'}</Text>
                    <Text style={styles.playerMeta}>Bango: {hole.bango_winner_display_name ?? 'Not set'}</Text>
                    <Text style={styles.playerMeta}>Bongo: {hole.bongo_winner_display_name ?? 'Not set'}</Text>
                  </View>
                ))}
              </View>
            </SectionCard>
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
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#132117', marginBottom: 8 },
  body: { fontSize: 14, color: '#5a6b61', lineHeight: 21 },
  cardList: { gap: 10, marginTop: 6 },
  playerCard: { backgroundColor: '#eef3ec', borderRadius: 16, padding: 12, gap: 4 },
  holeCard: { backgroundColor: '#f8f5ee', borderRadius: 16, padding: 12, gap: 4 },
  holeTitle: { fontSize: 16, fontWeight: '800', color: '#132117', marginBottom: 2 },
  playerHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  playerName: { fontSize: 16, fontWeight: '800', color: '#132117', flex: 1 },
  playerPoints: { fontSize: 16, fontWeight: '800', color: '#132117' },
  playerMeta: { fontSize: 13, color: '#5a6b61' },
  statusPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  statusPillPending: { backgroundColor: '#efe7d5' },
  statusPillPosted: { backgroundColor: '#e7efe8' },
  statusPillText: { fontSize: 13, color: '#18341d', fontWeight: '800' },
});

function formatSettlementPlayer(
  settlement: ReturnType<typeof calculateGameSettlement> | null,
  participantId: string,
) {
  const player = settlement?.players.find((entry) => entry.id === participantId);
  if (!player) return 'Winnings $0.00';
  return `Winnings ${formatCurrencyFromCents(player.grossWinningsCents)} · net ${formatCurrencyFromCents(player.netCents)}`;
}
