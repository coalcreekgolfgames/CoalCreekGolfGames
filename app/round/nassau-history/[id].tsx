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
  getRoundGolfCanadaPostingState,
  getGolfCanadaPostingPrep,
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
import { loadRoundHistory, updateSavedRound } from '@/lib/localRound';
import { formatNassauSegmentStatus } from '@/lib/nassau';
import { getNassauHistorySummary, type NassauGameSummary } from '@/lib/nassauBackend';
import { getRegularRoundHistoryDetail, type RegularRoundHistoryDetail } from '@/lib/regularRoundHistory';
import { calculateGameSettlementFromWinnings } from '@/lib/settlements';
import { useAuth } from '@/providers/AuthProvider';
import type { GolfCanadaPostingRecord, SavedRound } from '@/types/round';
import type { MyRoundHistoryRow } from '@/lib/historyBackend';

function segmentStatusText(summary: NassauGameSummary, key: 'front' | 'back' | 'overall') {
  const expectedHoles = key === 'overall' ? 18 : 9;
  const segment = summary.segments[key];
  const labels = Object.fromEntries(summary.standings.map((row) => [row.participant_id, row.display_name]));
  const base = formatNassauSegmentStatus({
    segment,
    participantLabelsById: labels,
  });

  if (segment.holesComplete === 0) return 'In progress';
  if (segment.holesComplete < expectedHoles) return `In progress · ${base}`;
  return base;
}

export default function NassauHistoryDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [savedRound, setSavedRound] = useState<SavedRound | null>(null);
  const [historyMeta, setHistoryMeta] = useState<MyRoundHistoryRow | null>(null);
  const [summary, setSummary] = useState<NassauGameSummary | null>(null);
  const [regularDetail, setRegularDetail] = useState<RegularRoundHistoryDetail | null>(null);
  const [postingState, setPostingState] = useState<GolfCanadaPostingRecord | null>(null);
  const [postingBusy, setPostingBusy] = useState(false);
  const [loading, setLoading] = useState(true);
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
          ?? backendHistoryRows.find((row) => row.round_game_id === (round?.backendRoundGameId ?? params.id) && row.game_type === 'nassau')
          ?? null;
        const backendRoundId = round?.backendRoundId ?? nextHistoryMeta?.round_id ?? null;
        if (!mounted) return;
        setSavedRound(round);
        setHistoryMeta(nextHistoryMeta);

        const backendRoundGameId = round?.backendRoundGameId ?? params.id;

        if (!backendRoundGameId) {
          setLoading(false);
          return;
        }

        const [nextSummary, nextRegularDetail] = await Promise.all([
          getNassauHistorySummary(backendRoundGameId),
          backendRoundId && user?.id
            ? getRegularRoundHistoryDetail({ roundId: backendRoundId, roundGameId: backendRoundGameId, gameType: 'nassau', userId: user.id, source: 'detail_screen' }).catch(() => null)
            : Promise.resolve(null),
        ]);
        const nextPostingState = backendRoundId && user?.id
          ? await getRoundGolfCanadaPostingState(backendRoundId, user.id, round).catch(() => null)
          : resolveGolfCanadaPostingState(round, null);
        if (!mounted) return;
        setSummary(nextSummary);
        setRegularDetail(nextRegularDetail);
        setPostingState(nextPostingState);
      } catch (nextError: any) {
        if (!mounted) return;
        setPostingState(null);
        setError(nextError?.message ?? 'Nassau history is unavailable.');
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
    if (!savedRound || !user?.id) {
      Alert.alert('Sign in required', 'Sign in before retrying backend save for this round.');
      return;
    }

    if (retrying) {
      cancelRetryRef.current = true;
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
        const nextSummary = await getNassauHistorySummary(syncResult.round.backendRoundGameId);
        setSummary(nextSummary);
        if (syncResult.round.backendRoundId && user?.id) {
          const nextRegularDetail = await getRegularRoundHistoryDetail({
            roundId: syncResult.round.backendRoundId,
            roundGameId: syncResult.round.backendRoundGameId,
            gameType: 'nassau',
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

  const settlement = useMemo(() => (
    summary && summary.buy_in_cents > 0 && summary.standings.length > 0
      ? calculateGameSettlementFromWinnings({
        buyInCents: summary.buy_in_cents,
        players: summary.standings.map((row) => ({
          id: row.participant_id,
          displayName: row.display_name,
          grossWinningsCents: row.winnings_cents,
        })),
      })
      : null
  ), [summary]);
  const localGolfCanadaPrep = useMemo(() => (savedRound ? getGolfCanadaPostingPrep(savedRound, user?.id) : null), [savedRound, user?.id]);
  const backendGolfCanadaPrep = useMemo(() => regularDetail?.golfCanadaPostingPrep ?? null, [regularDetail]);
  const backendRoundId = savedRound?.backendRoundId ?? regularDetail?.roundId ?? historyMeta?.round_id ?? summary?.round_id ?? null;
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
      groupGameMode: 'nassau',
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
        <Text style={styles.title}>Nassau History</Text>
        <Text style={styles.subtitle}>
          {savedRound?.group?.groupName ?? 'Nassau'} · {savedRound?.date ?? (historyMeta ? historyDateFromBackendRow(historyMeta) : 'Backend round')}
        </Text>

        {!savedRound && !summary && !loading ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Round not found</Text>
            <Text style={styles.body}>This round is not available in local history or backend history.</Text>
          </SectionCard>
        ) : loading ? (
          <SectionCard>
            <Text style={styles.body}>Loading Nassau history...</Text>
          </SectionCard>
        ) : error ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Nassau history unavailable</Text>
            <Text style={styles.body}>{error}</Text>
          </SectionCard>
        ) : !summary ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>No backend Nassau history found</Text>
            <Text style={styles.body}>This round was saved locally, but no synced Nassau history was returned from the backend.</Text>
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

            {(savedRound || regularDetail || summary || backendRoundId) ? (
              <GolfCanadaSection
                postingState={effectivePostingState}
                prep={golfCanadaPrep}
                description="Post your own completed Nassau round to Golf Canada using your official hole-by-hole score."
                onPost={() => router.push(
                  savedRound
                    ? (`/round/golf-canada-webview/${savedRound.id}?source=nassau` as any)
                    : (`/round/golf-canada-webview/${roundGameId ?? params.id}?source=nassau` as any),
                )}
                onMarkPosted={handleMarkPosted}
                postingBusy={postingBusy}
              />
            ) : null}

            <SectionCard>
              <Text style={styles.sectionTitle}>Segments</Text>
              <Text style={styles.body}>Front 9: {segmentStatusText(summary, 'front')}</Text>
              <Text style={styles.body}>Back 9: {segmentStatusText(summary, 'back')}</Text>
              <Text style={styles.body}>Overall 18: {segmentStatusText(summary, 'overall')}</Text>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Settlement</Text>
              <Text style={styles.body}>Buy-in per player: {formatCurrencyFromCents(summary.buy_in_cents)}</Text>
              <Text style={styles.body}>Total pot: {formatCurrencyFromCents(summary.total_pot_cents)}</Text>
              <Text style={styles.body}>Each segment share: {formatCurrencyFromCents(summary.segment_value_cents)}</Text>
              <SettlementBreakdown
                settlement={settlement}
                unitLabel="Segment share"
                emptyText={summary.buy_in_cents <= 0 ? 'No buy-in was set for this game.' : null}
                unitValueCents={summary.segment_value_cents}
              />
              <View style={styles.cardList}>
                {summary.standings.map((row) => (
                  <View key={row.participant_id} style={styles.playerCard}>
                    <View style={styles.playerHeader}>
                      <Text style={styles.playerName}>{row.display_name}</Text>
                      <Text style={styles.playerValue}>{formatCurrencyFromCents(row.winnings_cents)}</Text>
                    </View>
                    <Text style={styles.playerMeta}>Front {row.front_total ?? '-'} · share {row.front_share}</Text>
                    <Text style={styles.playerMeta}>Back {row.back_total ?? '-'} · share {row.back_share}</Text>
                    <Text style={styles.playerMeta}>Overall {row.overall_total ?? '-'} · share {row.overall_share}</Text>
                  </View>
                ))}
              </View>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Hole by Hole</Text>
              <View style={styles.cardList}>
                {summary.holes.map((hole) => (
                  <View key={`nassau-hole-${hole.hole_number}`} style={styles.holeCard}>
                    <Text style={styles.holeTitle}>Hole {hole.hole_number}</Text>
                    <Text style={styles.holeMeta}>
                      {hole.is_halved
                        ? `Tied low at ${hole.winning_score ?? '-'}`
                        : hole.winner_display_name
                          ? `${hole.winner_display_name} low with ${hole.winning_score ?? '-'}`
                          : 'No Nassau result recorded'}
                    </Text>
                    <View style={styles.scoreList}>
                      {hole.scores.map((scoreRow) => (
                        <View key={`${hole.hole_number}-${scoreRow.participant_id}`} style={styles.scoreRow}>
                          <Text style={styles.scoreName}>{scoreRow.display_name}</Text>
                          <Text style={styles.scoreValue}>{scoreRow.score ?? '-'}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            </SectionCard>
          </>
        )}

        <AppButton title="Back to History" onPress={() => router.back()} variant="secondary" />
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
  statusPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  statusPillPending: { backgroundColor: '#efe7d5' },
  statusPillPosted: { backgroundColor: '#e7efe8' },
  statusPillText: { fontSize: 13, color: '#18341d', fontWeight: '800' },
  cardList: { gap: 10, marginTop: 6 },
  playerCard: { backgroundColor: '#eef3ec', borderRadius: 16, padding: 12, gap: 4 },
  playerHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  playerName: { fontSize: 16, fontWeight: '800', color: '#132117', flex: 1 },
  playerValue: { fontSize: 15, fontWeight: '800', color: '#132117' },
  playerMeta: { fontSize: 13, color: '#5a6b61' },
  holeCard: { backgroundColor: '#eef3ec', borderRadius: 16, padding: 12, gap: 6 },
  holeTitle: { fontSize: 16, fontWeight: '800', color: '#132117' },
  holeMeta: { fontSize: 13, color: '#5a6b61' },
  scoreList: { gap: 4 },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  scoreName: { fontSize: 14, color: '#132117', flex: 1 },
  scoreValue: { fontSize: 14, fontWeight: '700', color: '#132117' },
});
