import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BrandWatermarkBackground } from '@/components/BrandWatermarkBackground';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { AppButton } from '@/components/ui/AppButton';
import { SectionCard } from '@/components/ui/SectionCard';
import { TournamentQuickNav } from '@/components/navigation/TournamentQuickNav';
import { SettlementBreakdown } from '@/components/round/SettlementBreakdown';
import { holes as courseHoles } from '@/constants/course';
import { formatCurrencyFromCents } from '@/lib/currency';
import { loadDraftRound, saveDraftRound } from '@/lib/localRound';
import { formatNassauSegmentStatus } from '@/lib/nassau';
import { getNassauLiveSummary, type NassauGameSummary } from '@/lib/nassauBackend';
import { getNassauRoundGameIdForRound } from '@/lib/groupRoundCompanions';
import { drainActiveRegularRoundSync, queueRegularRoundHoleSync, shouldRetryRegularRoundSyncNow } from '@/lib/regularRoundBackendSync';
import { calculateGameSettlementFromWinnings } from '@/lib/settlements';
import { useAuth } from '@/providers/AuthProvider';
import type { LocalRoundDraft } from '@/types/round';

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

function getSelectedNassauParticipantIds(round: LocalRoundDraft | null) {
  const selectedIds = Array.from(new Set((round?.nassauParticipantIds ?? []).filter((value) => typeof value === 'string' && value.trim().length > 0)));
  if (selectedIds.length > 0) return selectedIds;
  return (round?.group?.participants ?? []).map((participant) => participant.id);
}

function getRoundHoleSequence(round: LocalRoundDraft | null) {
  const explicitSequence = (round?.holeSequence ?? []).filter((value): value is number => typeof value === 'number' && value > 0);
  if (explicitSequence.length > 0) return explicitSequence;

  return (round?.holes ?? [])
    .map((hole) => hole.hole)
    .filter((value): value is number => typeof value === 'number' && value > 0)
    .sort((a, b) => a - b);
}

function getLocalCompletedNassauHoleNumbers(round: LocalRoundDraft | null) {
  if (!round || round.roundMode !== 'casual_group') return [];
  const selectedIds = getSelectedNassauParticipantIds(round);
  if (selectedIds.length < 2) return [];

  const holeSequence = getRoundHoleSequence(round);
  if (holeSequence.length === 0) return [];

  const currentHoleIndex =
    typeof round.currentHole === 'number'
      ? holeSequence.indexOf(round.currentHole)
      : -1;
  const completedHoleCountFromProgress = currentHoleIndex >= 0
    ? currentHoleIndex
    : Math.max(0, Math.min(Number(round.officialCompletedHole ?? 0), holeSequence.length));
  const candidateHoleNumbers = new Set(holeSequence.slice(0, completedHoleCountFromProgress));

  return round.holes
    .filter((hole) => {
      if (!candidateHoleNumbers.has(hole.hole)) return false;
      const scoreById = new Map((hole.groupScores ?? []).map((entry) => [entry.participantId, entry.score]));
      return selectedIds.every((participantId) => scoreComplete(scoreById.get(participantId) ?? null));
    })
    .map((hole) => hole.hole)
    .sort((a, b) => a - b);
}

function segmentStatusText(
  summary: NassauGameSummary | null,
  key: 'front' | 'back' | 'overall',
) {
  if (!summary) return 'In progress';
  const expectedHoles = key === 'overall' ? 18 : 9;
  const segment = summary.segments[key];
  const labels = Object.fromEntries(summary.standings.map((row) => [row.participant_id, row.display_name]));
  const base = formatNassauSegmentStatus({
    segment,
    participantLabelsById: labels,
  });

  if (segment.holesComplete === 0) return 'In progress';
  if (segment.holesComplete < expectedHoles) return 'In progress';
  return base;
}

function segmentDisplayStatus(
  summary: NassauGameSummary | null,
  key: 'front' | 'back' | 'overall',
) {
  if (!summary) return 'In progress';
  const expectedHoles = key === 'overall' ? 18 : 9;
  const segment = summary.segments[key];
  if (segment.holesComplete < expectedHoles) return 'In progress';
  const labels = Object.fromEntries(summary.standings.map((row) => [row.participant_id, row.display_name]));
  return formatNassauSegmentStatus({
    segment,
    participantLabelsById: labels,
  });
}

function isSegmentComplete(summary: NassauGameSummary | null, key: 'front' | 'back' | 'overall') {
  if (!summary) return false;
  return summary.segments[key].holesComplete >= (key === 'overall' ? 18 : 9);
}

function buildNassauRoundScoreboardRows(round: LocalRoundDraft, completedHoleNumbers: number[]) {
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
    .sort((a, b) =>
      a.grossTotal - b.grossTotal
      || b.holesCompleted - a.holesCompleted
      || a.displayName.localeCompare(b.displayName),
    )
    .map((row, index) => ({ ...row, standingRank: index + 1 }));
}

export default function NassauLiveScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ roundId?: string; roundGameId?: string }>();
  const backendRoundIdParam = typeof params.roundId === 'string' ? params.roundId : null;
  const backendRoundGameIdParam = typeof params.roundGameId === 'string' ? params.roundGameId : null;
  const [round, setRound] = useState<LocalRoundDraft | null>(null);
  const [summary, setSummary] = useState<NassauGameSummary | null>(null);
  const [resolvedRoundGameId, setResolvedRoundGameId] = useState<string | null>(backendRoundGameIdParam);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const roundRef = useRef<LocalRoundDraft | null>(null);
  const backfillInFlightRef = useRef(false);
  const attemptedBackfillKeyRef = useRef<string | null>(null);

  const localCompletedHoleNumbers = useMemo(() => getLocalCompletedNassauHoleNumbers(round), [round]);
  const localCompletedHoles = localCompletedHoleNumbers.length;
  const backendNassauHoleNumbers = useMemo(
    () => (summary?.holes ?? []).map((hole) => hole.hole_number).sort((a, b) => a - b),
    [summary],
  );
  const missingHoleNumbers = useMemo(
    () => localCompletedHoleNumbers.filter((holeNumber) => !backendNassauHoleNumbers.includes(holeNumber)),
    [backendNassauHoleNumbers, localCompletedHoleNumbers],
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
  const backendCompletedHoles = summary?.segments.overall.holesComplete ?? 0;
  const displayedCompletedHoles = Math.max(localCompletedHoles, backendCompletedHoles);
  const selectedNassauParticipantIds = useMemo(() => getSelectedNassauParticipantIds(round), [round]);
  const selectedNassauParticipantIdSet = useMemo(
    () => new Set(selectedNassauParticipantIds),
    [selectedNassauParticipantIds],
  );
  const mainScoreboardRows = useMemo(
    () => (round ? buildNassauRoundScoreboardRows(round, localCompletedHoleNumbers) : []),
    [localCompletedHoleNumbers, round],
  );
  const frontComplete = useMemo(() => isSegmentComplete(summary, 'front'), [summary]);
  const backComplete = useMemo(() => isSegmentComplete(summary, 'back'), [summary]);
  const overallComplete = useMemo(() => isSegmentComplete(summary, 'overall'), [summary]);

  const updateRoundIfChanged = (nextRound: LocalRoundDraft | null) => {
    setRound((current) => {
      if (areObjectsEqual(current, nextRound)) return current;
      roundRef.current = nextRound;
      return nextRound;
    });
  };

  const updateSummaryIfChanged = (nextSummary: NassauGameSummary | null) => {
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
          ?? (backendRoundIdParam ? await getNassauRoundGameIdForRound(backendRoundIdParam) : null);

        if (!mounted) return;
        setResolvedRoundGameId(roundGameId);

        if (!roundGameId) {
          updateSummaryIfChanged(null);
          setLoading(false);
          return;
        }

        const nextSummary = await getNassauLiveSummary(roundGameId);
        if (!mounted) return;
        updateSummaryIfChanged(nextSummary);
      } catch (nextError: any) {
        if (!mounted) return;
        setError(nextError?.message ?? 'Nassau live board is unavailable.');
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

    const backfillMissingNassauSync = async () => {
      const currentRound = roundRef.current;
      if (!currentRound || !user?.id || currentRound.groupGameMode !== 'nassau' || !resolvedRoundGameId) return;
      if (!missingHoleKey) {
        attemptedBackfillKeyRef.current = null;
        return;
      }
      if (backfillInFlightRef.current) return;
      if (attemptedBackfillKeyRef.current === missingHoleKey) return;

      const queueableMissingHoleNumbers = missingHoleNumbers.filter(
        (holeNumber) => !pendingBackfillHoleNumbers.includes(holeNumber),
      );

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

        const refreshedSummary = await getNassauLiveSummary(resolvedRoundGameId);
        if (!active) return;
        updateSummaryIfChanged(refreshedSummary);
      } finally {
        backfillInFlightRef.current = false;
      }
    };

    void backfillMissingNassauSync();
    return () => {
      active = false;
    };
  }, [
    missingHoleKey,
    pendingBackfillKey,
    resolvedRoundGameId,
    round?.groupGameMode,
    round?.id,
    user?.id,
  ]);

  const settlement = useMemo(() => (
    summary && overallComplete && summary.buy_in_cents > 0 && summary.standings.length > 0
      ? calculateGameSettlementFromWinnings({
        buyInCents: summary.buy_in_cents,
        players: summary.standings.map((row) => ({
          id: row.participant_id,
          displayName: row.display_name,
          grossWinningsCents: row.winnings_cents,
        })),
      })
      : null
  ), [overallComplete, summary]);

  return (
    <BrandWatermarkBackground style={styles.screen} screenName="NassauLiveScreen">
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <CoalCreekHeader />
        <Text style={styles.title}>Nassau Live Board</Text>
        <Text style={styles.subtitle}>
          {(round?.group?.groupName ?? 'Nassau')} | Full round scoreboard with Nassau details for buy-in players
        </Text>

        {!round?.backendRoundGameId && !backendRoundGameIdParam && !backendRoundIdParam ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Nassau Live Board coming next. Scores are being saved.</Text>
            <Text style={styles.body}>Start the Nassau round and save a hole to sync the live board.</Text>
          </SectionCard>
        ) : loading ? (
          <SectionCard>
            <Text style={styles.body}>Loading Nassau live standings...</Text>
          </SectionCard>
        ) : error ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Nassau board unavailable</Text>
            <Text style={styles.body}>{error}</Text>
          </SectionCard>
        ) : (
          <>
            {mainScoreboardRows.length > 0 ? (
              <SectionCard>
                <Text style={styles.sectionTitle}>Round Scoreboard</Text>
                <Text style={styles.body}>
                  All group participants appear here. Nassau buy-in selection only affects the Nassau sections below.
                </Text>
                <View style={styles.cardList}>
                  {mainScoreboardRows.map((row) => {
                    const inNassau = selectedNassauParticipantIdSet.has(row.participantId);
                    return (
                      <View key={row.participantId} style={styles.playerCard}>
                        <View style={styles.playerHeader}>
                          <View style={styles.playerTitleWrap}>
                            <Text style={styles.playerName}>{row.standingRank}. {row.displayName}</Text>
                            <View style={inNassau ? styles.nassauBadge : styles.nonNassauBadge}>
                              <Text style={inNassau ? styles.nassauBadgeText : styles.nonNassauBadgeText}>
                                {inNassau ? 'Nassau' : 'Round only'}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.playerMetaStrong}>{row.holesCompleted > 0 ? row.grossTotal : '--'}</Text>
                        </View>
                        <Text style={styles.playerMeta}>
                          Thru {row.holesCompleted} | {row.holesCompleted > 0 ? formatRelativeToPar(row.grossTotal, row.completedHoleNumbers) : '--'}
                        </Text>
                        <Text style={styles.playerMeta}>
                          {inNassau ? 'Included in Nassau game and pot.' : 'Shown on the round scoreboard only. Not in Nassau pot.'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </SectionCard>
            ) : null}

            {!summary ? (
              <SectionCard>
                <Text style={styles.emptyTitle}>Nassau details coming next</Text>
                <Text style={styles.body}>The main round scoreboard is available. Nassau game details will appear after Nassau hole rows sync.</Text>
              </SectionCard>
            ) : (
              <>
                <SectionCard>
                  <Text style={styles.sectionTitle}>Segments</Text>
                  <Text style={styles.body}>These Nassau results only use the selected buy-in players.</Text>
                  <View style={styles.segmentGrid}>
                    <View style={styles.segmentCard}>
                      <Text style={styles.segmentTitle}>Front 9</Text>
                      <Text style={styles.segmentStatus}>{segmentDisplayStatus(summary, 'front')}</Text>
                      <Text style={styles.segmentMeta}>{Math.min(displayedCompletedHoles, 9)} of 9 holes complete</Text>
                    </View>
                    <View style={styles.segmentCard}>
                      <Text style={styles.segmentTitle}>Back 9</Text>
                      <Text style={styles.segmentStatus}>{segmentDisplayStatus(summary, 'back')}</Text>
                      <Text style={styles.segmentMeta}>{displayedCompletedHoles > 9 ? Math.min(displayedCompletedHoles - 9, 9) : 0} of 9 holes complete</Text>
                    </View>
                    <View style={styles.segmentCard}>
                      <Text style={styles.segmentTitle}>Overall 18</Text>
                      <Text style={styles.segmentStatus}>{segmentDisplayStatus(summary, 'overall')}</Text>
                      <Text style={styles.segmentMeta}>{displayedCompletedHoles} of 18 holes complete</Text>
                    </View>
                  </View>
                </SectionCard>

                <SectionCard>
                  <Text style={styles.sectionTitle}>Nassau Details</Text>
                  <Text style={styles.body}>Buy-in per player: {formatCurrencyFromCents(summary.buy_in_cents)}</Text>
                  <Text style={styles.body}>Total pot: {formatCurrencyFromCents(summary.total_pot_cents)}</Text>
                  <Text style={styles.body}>Each segment share: {formatCurrencyFromCents(summary.segment_value_cents)}</Text>
                  <Text style={styles.body}>Holes complete: {displayedCompletedHoles}</Text>
                  <Text style={styles.body}>Only selected Nassau players appear in the segment standings and settlement preview.</Text>
                  <SettlementBreakdown
                    settlement={settlement}
                    unitLabel="Segment share"
                    pendingText={overallComplete ? null : 'Settlement appears after all 18 Nassau holes are complete.'}
                    emptyText={summary.buy_in_cents <= 0 ? 'No buy-in was set for this game.' : null}
                    unitValueCents={summary.segment_value_cents}
                  />
                  <View style={styles.cardList}>
                    {summary.standings.map((row) => (
                      <View key={row.participant_id} style={styles.playerCard}>
                        <View style={styles.playerHeader}>
                          <View style={styles.playerTitleWrap}>
                            <Text style={styles.playerName}>{row.display_name}</Text>
                            <View style={styles.nassauBadge}>
                              <Text style={styles.nassauBadgeText}>Nassau</Text>
                            </View>
                          </View>
                          <Text style={styles.playerMetaStrong}>{overallComplete ? formatCurrencyFromCents(row.winnings_cents) : '--'}</Text>
                        </View>
                        <Text style={styles.playerMeta}>Gross {row.gross_total ?? '-'}</Text>
                        <Text style={styles.playerMeta}>Front {frontComplete ? (row.front_total ?? '-') : 'In progress'} | share {frontComplete ? row.front_share : '-'}</Text>
                        <Text style={styles.playerMeta}>Back {backComplete ? (row.back_total ?? '-') : 'In progress'} | share {backComplete ? row.back_share : '-'}</Text>
                        <Text style={styles.playerMeta}>Overall {overallComplete ? (row.overall_total ?? '-') : 'In progress'} | share {overallComplete ? row.overall_share : '-'}</Text>
                      </View>
                    ))}
                  </View>
                </SectionCard>
              </>
            )}
          </>
        )}

        <AppButton title="Back to round" onPress={() => router.back()} variant="secondary" />
      </ScrollView>
      <TournamentQuickNav />
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
  segmentGrid: { gap: 10 },
  segmentCard: { backgroundColor: '#eef3ec', borderRadius: 16, padding: 12, gap: 4 },
  segmentTitle: { fontSize: 16, fontWeight: '800', color: '#132117' },
  segmentStatus: { fontSize: 14, color: '#18341d', lineHeight: 20 },
  segmentMeta: { fontSize: 13, color: '#5a6b61' },
  cardList: { gap: 10, marginTop: 6 },
  playerCard: { backgroundColor: '#eef3ec', borderRadius: 16, padding: 12, gap: 4 },
  playerHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  playerTitleWrap: { flex: 1, gap: 6 },
  playerName: { fontSize: 16, fontWeight: '800', color: '#132117', flex: 1 },
  playerMetaStrong: { fontSize: 15, fontWeight: '800', color: '#132117' },
  playerMeta: { fontSize: 13, color: '#5a6b61' },
  nassauBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#18341d',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  nassauBadgeText: { fontSize: 11, fontWeight: '800', color: '#f4f7f1' },
  nonNassauBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#d7ddd2',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  nonNassauBadgeText: { fontSize: 11, fontWeight: '700', color: '#516055' },
});
