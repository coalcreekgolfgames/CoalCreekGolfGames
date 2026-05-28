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
import { getSkinsHistorySummary, type SkinsHistorySummary } from '@/lib/skinsBackend';
import { loadRoundHistory, updateSavedRound } from '@/lib/localRound';
import { getRegularRoundHistoryDetail, type RegularRoundHistoryDetail } from '@/lib/regularRoundHistory';
import { summarizeRound } from '@/lib/roundStats';
import { calculateGameSettlementFromWinnings, type GameSettlement } from '@/lib/settlements';
import {
  getGroupRoundCompanionMismatchReview,
  summarizeGroupRoundCompanionMismatchReview,
} from '@/lib/groupRoundCompanions';
import { useAuth } from '@/providers/AuthProvider';
import type { GolfCanadaPostingRecord, SavedRound } from '@/types/round';
import type { GroupRoundMismatchReviewSummary } from '@/lib/groupRoundCompanions';
import type { MyRoundHistoryRow } from '@/lib/historyBackend';

export default function SkinsHistoryDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [savedRound, setSavedRound] = useState<SavedRound | null>(null);
  const [historyMeta, setHistoryMeta] = useState<MyRoundHistoryRow | null>(null);
  const [summary, setSummary] = useState<SkinsHistorySummary | null>(null);
  const [regularDetail, setRegularDetail] = useState<RegularRoundHistoryDetail | null>(null);
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
        const nextHistoryMeta = findHistoryBackendRowByRouteId(backendHistoryRows, params.id)
          ?? backendHistoryRows.find((row) => row.round_game_id === (round?.backendRoundGameId ?? params.id) && row.game_type === 'skins')
          ?? null;
        if (!mounted) return;
        setSavedRound(round);
        setHistoryMeta(nextHistoryMeta);

        const backendRoundGameId = round?.backendRoundGameId ?? params.id;

        if (!backendRoundGameId) {
          setLoading(false);
          return;
        }

        const [nextSummary, mismatchRows] = await Promise.all([
          getSkinsHistorySummary(backendRoundGameId),
          (round?.backendRoundId ?? nextHistoryMeta?.round_id) ? getGroupRoundCompanionMismatchReview(round?.backendRoundId ?? nextHistoryMeta!.round_id) : Promise.resolve([]),
        ]);
        const nextRegularDetail = (round?.backendRoundId ?? nextHistoryMeta?.round_id) && user?.id
          ? await getRegularRoundHistoryDetail({
            roundId: round?.backendRoundId ?? nextHistoryMeta!.round_id,
            roundGameId: backendRoundGameId,
            gameType: 'skins',
            userId: user.id,
            source: 'detail_screen',
          }).catch(() => null)
          : null;
        const nextPostingState = (round?.backendRoundId ?? nextHistoryMeta?.round_id) && user?.id
          ? await getRoundGolfCanadaPostingState(round?.backendRoundId ?? nextHistoryMeta!.round_id, user.id, round).catch(() => null)
          : resolveGolfCanadaPostingState(round, null);
        if (!mounted) return;
        setSummary(nextSummary);
        setRegularDetail(nextRegularDetail);
        setMismatchSummary(summarizeGroupRoundCompanionMismatchReview(mismatchRows));
        setPostingState(nextPostingState);
      } catch (nextError: any) {
        if (!mounted) return;
        setMismatchSummary(null);
        setRegularDetail(null);
        setPostingState(null);
        setError(nextError?.message ?? 'Skins history is unavailable.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
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
      } else if (syncResult.round.backendRoundGameId) {
        const [nextSummary, mismatchRows] = await Promise.all([
          getSkinsHistorySummary(syncResult.round.backendRoundGameId),
          syncResult.round.backendRoundId ? getGroupRoundCompanionMismatchReview(syncResult.round.backendRoundId) : Promise.resolve([]),
        ]);
        setSummary(nextSummary);
        setMismatchSummary(summarizeGroupRoundCompanionMismatchReview(mismatchRows));
        if (syncResult.round.backendRoundId && user?.id) {
          const nextRegularDetail = await getRegularRoundHistoryDetail({
            roundId: syncResult.round.backendRoundId,
            roundGameId: syncResult.round.backendRoundGameId,
            gameType: 'skins',
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
  const buyInCents = summary?.buy_in_cents ?? savedRound?.roundGameBuyInCents ?? 0;
  const settlement = summary?.standings.length && summary.unresolved_final_carryover_skin_count <= 0 && buyInCents > 0 && summary.total_awarded_skin_count > 0
    ? calculateGameSettlementFromWinnings({
      buyInCents,
      players: summary.standings.map((row) => ({
        id: row.participant_id,
        displayName: row.display_name,
        grossWinningsCents: row.player_winnings_cents ?? 0,
      })),
    })
    : null;
  const settlementPendingText = summary?.unresolved_final_carryover_skin_count && summary.unresolved_final_carryover_skin_count > 0
    ? 'Resolve the final putt-off before settlement can be calculated.'
    : null;
  const settlementEmptyText = !summary
    ? null
    : summary.unresolved_final_carryover_skin_count > 0
      ? null
      : buyInCents <= 0
        ? 'No buy-in was set for this game.'
        : summary.total_awarded_skin_count <= 0
          ? 'No settlement is needed.'
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
      groupGameMode: 'skins',
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

  const handleMarkPosted = async () => {
    if (!golfCanadaPrep) return;

    if (!user?.id || !backendRoundId) {
      if (!savedRound) return;
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
        <Text style={styles.title}>Skins History</Text>
        <Text style={styles.subtitle}>{savedRound?.group?.groupName ?? 'Skins'} · {savedRound?.date ?? (historyMeta ? historyDateFromBackendRow(historyMeta) : 'Backend round')}</Text>

        {!savedRound && !summary && !loading ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Round not found</Text>
            <Text style={styles.body}>This round is not available in local history or backend history.</Text>
          </SectionCard>
        ) : loading ? (
          <SectionCard>
            <Text style={styles.body}>Loading Skins history...</Text>
          </SectionCard>
        ) : error ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Skins history unavailable</Text>
            <Text style={styles.body}>{error}</Text>
          </SectionCard>
        ) : !summary ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>No backend Skins history found</Text>
            <Text style={styles.body}>This round was saved locally, but no synced Skins history was returned from the backend.</Text>
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
                <Text style={styles.body}>Review participant cross-card scores against the official Skins score after completion.</Text>
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
                description="Post your own completed Skins round to Golf Canada using your official hole-by-hole score."
                onPost={() => router.push(
                  savedRound
                    ? (`/round/golf-canada-webview/${savedRound.id}?source=skins` as any)
                    : (`/round/golf-canada-webview/${roundGameId ?? params.id}?source=skins` as any),
                )}
                onMarkPosted={handleMarkPosted}
                postingBusy={postingBusy}
              />
            ) : null}
            <SectionCard>
              <Text style={styles.sectionTitle}>Final Totals</Text>
              <Text style={styles.body}>Buy-in per player: {formatCurrencyFromCents(summary.buy_in_cents ?? savedRound?.roundGameBuyInCents ?? 0)}</Text>
              {personalSummary ? (
                <>
                  <Text style={styles.sectionTitle}>Personal Round Stats</Text>
                  <Text style={styles.body}>Putts {personalSummary.totalPutts} · Fairways {personalSummary.fairwaysHit} · GIR {personalSummary.greensInRegulation}</Text>
                  <Text style={styles.body}>One-putts {personalSummary.onePutts} · Three-putts {personalSummary.threePutts} · Up and downs {personalSummary.upAndDowns}</Text>
                </>
              ) : null}
              <Text style={styles.body}>Total pot: {formatCurrencyFromCents(summary.total_pot_cents ?? ((summary.buy_in_cents ?? savedRound?.roundGameBuyInCents ?? 0) * summary.standings.length))}</Text>
              <Text style={styles.body}>Total skins awarded: {summary.total_awarded_skin_count}</Text>
              <Text style={styles.body}>
                {summary.unresolved_final_carryover_skin_count > 0
                  ? `Winnings pending until the final putt-off awards ${summary.unresolved_final_carryover_skin_count} remaining skin${summary.unresolved_final_carryover_skin_count === 1 ? '' : 's'}.`
                  : `Skin value: ${formatCurrencyFromCents(summary.per_skin_value_cents ?? null)}`}
              </Text>
              <SettlementBreakdown
                settlement={settlement}
                unitLabel="Skin"
                pendingText={settlementPendingText}
                emptyText={settlementEmptyText}
                unitValueCents={summary.per_skin_value_cents ?? null}
              />
              {summary.skins_putt_off_winner_display_name && summary.skins_putt_off_awarded_skin_count ? (
                <Text style={styles.body}>
                  Final putt-off winner: {summary.skins_putt_off_winner_display_name} for {summary.skins_putt_off_awarded_skin_count} skin{summary.skins_putt_off_awarded_skin_count === 1 ? '' : 's'}.
                </Text>
              ) : null}
              <View style={styles.cardList}>
                {summary.standings.map((row) => (
                  <View key={row.participant_id} style={styles.playerCard}>
                    <View style={styles.playerHeader}>
                      <Text style={styles.playerName}>{row.standing_rank}. {row.display_name}</Text>
                      <Text style={styles.playerPoints}>{row.total_skin_count_won} skins</Text>
                    </View>
                    <Text style={styles.playerMeta}>Holes won {row.skins_won}</Text>
                    <Text style={styles.playerMeta}>Gross {row.gross_total}</Text>
                    <Text style={styles.playerMeta}>{formatSettlementPlayer(settlement, row.participant_id, row.player_winnings_cents ?? null)}</Text>
                  </View>
                ))}
              </View>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Hole-by-hole</Text>
              <View style={styles.cardList}>
                {summary.holes.map((hole) => (
                  <View key={hole.round_game_skins_hole_id} style={styles.holeCard}>
                    <Text style={styles.holeTitle}>Hole {hole.hole_number}</Text>
                    {hole.scores.map((score) => (
                      <Text key={`${hole.hole_number}-${score.participant_id}`} style={styles.playerMeta}>
                        {score.display_name}: {score.score ?? '-'}
                      </Text>
                    ))}
                    <Text style={styles.playerMeta}>Result: {hole.is_push ? 'Push' : hole.winner_display_name ?? 'No winner'}</Text>
                    <Text style={styles.playerMeta}>Winning score: {hole.winning_score ?? '-'}</Text>
                    <Text style={styles.playerMeta}>Carryover in play: {hole.carryover_skin_count}</Text>
                    <Text style={styles.playerMeta}>Skins awarded: {hole.awarded_skin_count}</Text>
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
  settlement: GameSettlement | null,
  participantId: string,
  fallbackWinningsCents: number | null,
) {
  const player = settlement?.players.find((entry) => entry.id === participantId);
  if (!player) return `Winnings ${formatCurrencyFromCents(fallbackWinningsCents)}`;
  return `Winnings ${formatCurrencyFromCents(player.grossWinningsCents)} Â· net ${formatCurrencyFromCents(player.netCents)}`;
}
