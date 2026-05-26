import React, { useEffect, useMemo, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import { BrandWatermarkBackground } from '@/components/BrandWatermarkBackground';
import { CoalCreekHeader } from '@/components/CoalCreekHeader';
import { TournamentQuickNav } from '@/components/navigation/TournamentQuickNav';
import { AppButton } from '@/components/ui/AppButton';
import { holes as courseHoles } from '@/constants/course';
import { SectionCard } from '@/components/ui/SectionCard';
import { getGroupRoundLiveProgress, type GroupRoundLiveProgress } from '@/lib/groupRoundCompanions';
import { getGroupRoundPrimaryEntryDecision } from '@/lib/groupRoundEntry';
import { getCompletedHoleCount, getSavedHoleNumbers, loadLiveRoundVisibilityState } from '@/lib/localRound';
import { drainActiveRegularRoundSync, shouldRetryRegularRoundSyncNow } from '@/lib/regularRoundBackendSync';
import {
  getStandardRoundLiveBoardData,
  resolveStandardRoundLiveBoardBackendRoundId,
  type ResolvedStandardRoundLiveBoardId,
  type StandardRoundLiveBoardData,
  type StandardRoundLiveBoardViewRow,
} from '@/lib/standardRoundBackend';
import {
  buildStandardRoundLiveBoardRows,
  isStandardLiveBoardRound,
  type StandardRoundLiveBoardRow,
} from '@/lib/standardRoundLiveBoard';
import { useAuth } from '@/providers/AuthProvider';
import type { LocalRoundDraft } from '@/types/round';

function getCurrentUserDisplayName(profile: any, user: any) {
  const firstName = String(profile?.first_name ?? user?.user_metadata?.first_name ?? '').trim();
  const lastName = String(profile?.last_name ?? user?.user_metadata?.last_name ?? '').trim();
  return `${firstName} ${lastName}`.trim() || 'You';
}

function parThroughHoleCount(holeCount: number) {
  return courseHoles.slice(0, Math.max(0, holeCount)).reduce((sum, hole) => sum + hole.par, 0);
}

function formatRelativeToPar(grossTotal: number, holesCompleted: number) {
  const relative = grossTotal - parThroughHoleCount(holesCompleted);
  if (relative === 0) return 'E';
  return relative > 0 ? `+${relative}` : `${relative}`;
}

function canUseLocalStandardLiveBoardFallback(round: LocalRoundDraft | null, userId?: string | null) {
  if (!round || !isStandardLiveBoardRound(round)) return false;
  if (!round.backendRoundId) return true;
  if (!userId) return false;
  if (round.draftOwnerUserId === userId || round.scoringUserId === userId) return true;

  const localParticipant = round.group?.participants?.find(
    (participant) => participant.type === 'app_user' && participant.id === userId,
  );
  return localParticipant?.isScorekeeper === true;
}

function logStandardLiveBoardDebug(event: string, payload: Record<string, unknown>) {
  if (!__DEV__) return;
  console.log(`[standard-live-board] ${event}`, payload);
}

export default function StandardRoundLiveBoardScreen() {
  const params = useLocalSearchParams<{ roundId?: string }>();
  const backendRoundIdParam = typeof params.roundId === 'string' ? params.roundId : null;
  const { profile, user, loading: authLoading, authRefreshKey } = useAuth();
  const [round, setRound] = useState<LocalRoundDraft | null>(null);
  const [backendBoardData, setBackendBoardData] = useState<StandardRoundLiveBoardData | null>(null);
  const [backendRows, setBackendRows] = useState<StandardRoundLiveBoardViewRow[]>([]);
  const [resolvedLiveBoardId, setResolvedLiveBoardId] = useState<ResolvedStandardRoundLiveBoardId>({
    originalRouteId: null,
    backendRoundId: null,
    source: 'unresolved',
  });
  const [participantCount, setParticipantCount] = useState(0);
  const [holeScoreCount, setHoleScoreCount] = useState(0);
  const [liveProgress, setLiveProgress] = useState<GroupRoundLiveProgress | null>(null);
  const [backendReadFailed, setBackendReadFailed] = useState(false);
  const [backendErrorMessage, setBackendErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [entryTitle, setEntryTitle] = useState('Continue Hole');
  const [entryLoading, setEntryLoading] = useState(false);
  const roundRef = React.useRef<LocalRoundDraft | null>(null);

  const kickOffActiveRoundDrain = React.useCallback((trigger: string) => {
    if (!user?.id) return;
    void drainActiveRegularRoundSync({
      userId: user.id,
      trigger,
      onUpdate: (updatedRound) => {
        setRound(updatedRound);
      },
    }).catch(() => {});
  }, [user?.id]);

  useFocusEffect(React.useCallback(() => {
    let mounted = true;

    const load = async () => {
      const visibilityState = await loadLiveRoundVisibilityState();
      if (!mounted) return;
      const draft = visibilityState.activeRound;
      setRound(draft);
      setBackendBoardData(null);
      setBackendRows([]);
      setResolvedLiveBoardId({
        originalRouteId: backendRoundIdParam,
        backendRoundId: null,
        source: 'unresolved',
      });
      setParticipantCount(0);
      setHoleScoreCount(0);
      setLiveProgress(null);
      setBackendReadFailed(false);
      setBackendErrorMessage(null);

      const resolution = await resolveStandardRoundLiveBoardBackendRoundId({
        routeId: backendRoundIdParam,
        draft,
        userId: user?.id,
      });
      if (!mounted) return;
      setResolvedLiveBoardId(resolution);
      const backendRoundId = resolution.backendRoundId;
      const detectedRoundMode = draft?.roundMode ?? null;
      const detectedGroupGameMode = draft?.groupGameMode ?? null;

      logStandardLiveBoardDebug('load_start', {
        routeRoundId: backendRoundIdParam,
        draftId: draft?.id ?? null,
        draftBackendRoundId: draft?.backendRoundId ?? null,
        detectedIdSource: resolution.source,
        resolvedBackendRoundId: backendRoundId,
        detectedRoundMode,
        detectedGroupGameMode,
      });

      if (backendRoundId) {
        try {
          const [liveBoardData, liveProgressRow] = await Promise.all([
            getStandardRoundLiveBoardData(backendRoundId),
            getGroupRoundLiveProgress(backendRoundId),
          ]);
          if (!mounted) return;
          setBackendBoardData(liveBoardData);
          setBackendRows(liveBoardData.rows);
          setParticipantCount(liveBoardData.participantCount);
          setHoleScoreCount(liveBoardData.holeScoreRowCount ?? liveBoardData.holeScoreCount ?? 0);
          setLiveProgress(liveProgressRow);
          setBackendReadFailed(false);
          logStandardLiveBoardDebug('backend_load_success', {
            routeRoundId: backendRoundIdParam,
            detectedIdSource: resolution.source,
            resolvedBackendRoundId: backendRoundId,
            detectedRoundMode,
            detectedGroupGameMode,
            liveBoardDataKeys: Object.keys(liveBoardData ?? {}),
            playersLength: liveBoardData.players?.length ?? 0,
            participantCount: liveBoardData.participantCount,
            holeScoreCount: liveBoardData.holeScoreRowCount ?? liveBoardData.holeScoreCount ?? 0,
            liveProgress: liveProgressRow,
          });
          if (
            (liveBoardData.holeScoreRowCount ?? liveBoardData.holeScoreCount ?? 0) === 0
            && ((liveProgressRow?.current_official_hole ?? 1) > 1 || (liveProgressRow?.completed_official_hole ?? 0) > 0)
          ) {
            console.warn('[standard-live-board] backend_progress_without_scores', {
              resolvedBackendRoundId: backendRoundId,
              holeScoreCount: liveBoardData.holeScoreRowCount ?? liveBoardData.holeScoreCount ?? 0,
              liveProgress: liveProgressRow,
            });
          }
        } catch (error: any) {
          console.warn('standard round live board backend read failed', error?.message ?? error);
          if (!mounted) return;
          setBackendBoardData(null);
          setBackendRows([]);
          setParticipantCount(0);
          setHoleScoreCount(0);
          setLiveProgress(null);
          setBackendReadFailed(true);
          setBackendErrorMessage(error?.message ?? 'The backend live board could not be loaded right now.');
          logStandardLiveBoardDebug('backend_load_error', {
            routeRoundId: backendRoundIdParam,
            detectedIdSource: resolution.source,
            resolvedBackendRoundId: backendRoundId,
            detectedRoundMode,
            detectedGroupGameMode,
            message: error?.message ?? String(error),
          });
        }
      }
      setLoading(false);
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [authRefreshKey, backendRoundIdParam, user?.id]));

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    let active = true;

    const syncEntryDecision = async () => {
      setEntryLoading(round?.roundMode === 'casual_group' && !!round?.backendRoundId);
      const decision = await getGroupRoundPrimaryEntryDecision({
        round,
        userId: user?.id,
        authLoading,
      });

      if (!active) return;
      setEntryTitle(decision.label);
      setEntryLoading(decision.status === 'loading');
    };

    void syncEntryDecision();
    return () => {
      active = false;
    };
  }, [authLoading, authRefreshKey, round, user?.id]);

  useEffect(() => {
    if (!round || !user?.id || !shouldRetryRegularRoundSyncNow(round)) return;
    kickOffActiveRoundDrain('live_board_open');
  }, [kickOffActiveRoundDrain, round, user?.id]);

  useEffect(() => {
    if (!round || !user?.id) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const activeRound = roundRef.current;
      if (!activeRound || !shouldRetryRegularRoundSyncNow(activeRound)) return;
      kickOffActiveRoundDrain('app_resume');
    });

    return () => subscription.remove();
  }, [kickOffActiveRoundDrain, round, user?.id]);

  const currentUserDisplayName = getCurrentUserDisplayName(profile, user);
  const backendRoundId = resolvedLiveBoardId.backendRoundId;
  const allowLocalFallback = canUseLocalStandardLiveBoardFallback(round, user?.id);
  const openRoundEntry = async () => {
    if (!round?.currentHole) return;

    const decision = await getGroupRoundPrimaryEntryDecision({
      round,
      userId: user?.id,
      authLoading,
    });

    if (decision.status === 'companion' && decision.route) {
      router.push(decision.route as any);
      return;
    }

    if (decision.status !== 'official') {
      Alert.alert('Round unavailable', decision.message ?? 'This shared group round is not available for official scoring.');
      return;
    }

    router.push(`/round/hole/${round.currentHole}` as any);
  };

  const rows = useMemo<StandardRoundLiveBoardRow[]>(() => {
    const backendPlayers = backendBoardData?.players ?? [];
    if (backendPlayers.length > 0) {
      return backendPlayers.map((player) => ({
        participantId: player.participantId,
        displayName: player.displayName,
        grossTotal: Number(player.totalScore ?? 0),
        holesCompleted: Number(player.thru ?? 0),
        standingRank: Number(player.standingRank ?? 0),
      }));
    }
    if (!round && backendRows.length === 0 && participantCount === 0) return [];
    if (backendRoundId && !allowLocalFallback) return [];
    if (!round || !isStandardLiveBoardRound(round)) return [];
    return buildStandardRoundLiveBoardRows(round, currentUserDisplayName);
  },
    [allowLocalFallback, backendBoardData, backendRoundId, backendRows.length, currentUserDisplayName, participantCount, round],
  );

  useEffect(() => {
    if (!round) return;
    console.info('[solo-live-round-filter-debug]', {
      roundId: round.id,
      status: 'active',
      completedHoleCount: getCompletedHoleCount(round),
      savedHoleNumbers: getSavedHoleNumbers(round),
      grossFromSavedHoles: rows[0]?.grossTotal ?? 0,
      projectedParScoreWasUsed: false,
      hiddenReason: null,
      shownOnLiveRound: true,
      shownOnLiveBoard: true,
    });
  }, [round, rows]);

  const isGroup = round?.roundMode === 'casual_group' || participantCount > 0 || backendRows.length > 0;
  const showBackendWaitingState = !backendReadFailed
    && !!backendRoundId
    && !allowLocalFallback
    && participantCount > 0
    && holeScoreCount === 0;
  const showBackendResolveFailureState = !loading
    && !backendReadFailed
    && !allowLocalFallback
    && !!backendRoundIdParam
    && !backendRoundId;
  const showBackendNoPlayersState = !loading
    && !backendReadFailed
    && !!backendRoundId
    && !allowLocalFallback
    && participantCount === 0;
  const showBackendDebugEmptyState = !loading
    && !backendReadFailed
    && !!backendRoundId
    && !allowLocalFallback
    && participantCount > 0
    && rows.length === 0;

  if (__DEV__ && showBackendDebugEmptyState) {
    console.warn('[standard-live-board] data_loaded_but_no_player_rows', {
      routeRoundId: backendRoundIdParam,
      detectedIdSource: resolvedLiveBoardId.source,
      resolvedBackendRoundId: backendRoundId,
      participantCount,
      holeScoreCount,
      liveProgress,
      backendBoardDataKeys: backendBoardData ? Object.keys(backendBoardData) : [],
    });
  }

  return (
    <BrandWatermarkBackground style={styles.screen} screenName="StandardRoundLiveBoardScreen">
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <CoalCreekHeader />
        <Text style={styles.title}>{isGroup ? 'Group Live Board' : 'Round Live Board'}</Text>
        <Text style={styles.subtitle}>
          {round ? `${round.date} / ${round.tee} / ${round.ratingType}` : 'Backend group round'}
        </Text>

        {loading ? (
          <SectionCard>
            <Text style={styles.body}>Loading live board...</Text>
          </SectionCard>
        ) : backendReadFailed ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Live Board unavailable</Text>
            <Text style={styles.body}>{backendErrorMessage ?? 'The backend live board could not be loaded right now. Please try again.'}</Text>
          </SectionCard>
        ) : showBackendResolveFailureState ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Live Board unavailable</Text>
            <Text style={styles.body}>Could not resolve this Live Board to a backend group round.</Text>
          </SectionCard>
        ) : showBackendNoPlayersState ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>No players found</Text>
            <Text style={styles.body}>No players were found for this group round.</Text>
          </SectionCard>
        ) : !backendRoundId && !round && backendRows.length === 0 ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>No live round</Text>
            <Text style={styles.body}>Start a solo or standard group round to see the live board.</Text>
          </SectionCard>
        ) : round && !isStandardLiveBoardRound(round) ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>Use the game live board</Text>
            <Text style={styles.body}>BBB and Skins rounds keep their specialized live boards.</Text>
          </SectionCard>
        ) : (
          <>
            <SectionCard>
              <Text style={styles.sectionTitle}>{isGroup ? round?.group?.groupName ?? 'Group round' : currentUserDisplayName}</Text>
              <Text style={styles.body}>
                {((isGroup && backendRows.length > 0)
                  || (backendBoardData?.players?.length ?? 0) > 0)
                  ? 'Scores are loaded from the backend live board. Backend sync status is tracked separately.'
                  : allowLocalFallback
                    ? 'Scores update from saved hole data on this device. Backend sync status is tracked separately.'
                    : 'Scores are limited to backend-synced official saves for this shared round.'}
              </Text>
              {showBackendWaitingState ? (
                <Text style={styles.body}>Waiting for the scorekeeper to save the first hole.</Text>
              ) : null}
              {showBackendDebugEmptyState ? (
                <Text style={styles.body}>Live Board data loaded, but no player rows were created.</Text>
              ) : null}
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Standings</Text>
              {showBackendWaitingState ? (
                <Text style={styles.body}>The player list is ready. Official scores will appear here as soon as the scorekeeper saves the first hole.</Text>
              ) : null}
              {showBackendDebugEmptyState ? (
                <Text style={styles.body}>Live Board data loaded, but no player rows were created.</Text>
              ) : null}
              <View style={styles.cardList}>
                {rows.map((row) => (
                  <View key={row.participantId} style={styles.playerCard}>
                    <View style={styles.playerHeader}>
                      <Text style={styles.playerName}>{isGroup ? `${row.standingRank}. ${row.displayName}` : row.displayName}</Text>
                      <Text style={styles.playerPoints}>{row.holesCompleted > 0 ? row.grossTotal : '--'}</Text>
                    </View>
                    <Text style={styles.playerMeta}>
                      {isGroup ? `Thru ${row.holesCompleted} | ${row.holesCompleted > 0 ? formatRelativeToPar(row.grossTotal, row.holesCompleted) : '--'}` : `Thru ${row.holesCompleted}`}
                    </Text>
                  </View>
                ))}
              </View>
            </SectionCard>
          </>
        )}

        <View style={styles.row}>
          {round?.currentHole ? (
            !entryLoading ? (
              <AppButton title={entryTitle === 'Join Round' ? 'Join Round' : `Continue Hole ${round.currentHole}`} onPress={() => void openRoundEntry()} style={{ flex: 1 }} />
            ) : (
              <View style={[styles.loadingButton, { flex: 1 }]}>
                <Text style={styles.loadingButtonText}>Checking round access...</Text>
              </View>
            )
          ) : null}
          <AppButton title="Back to round" onPress={() => router.back()} variant="secondary" style={{ flex: 1 }} />
        </View>
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
  cardList: { gap: 10, marginTop: 6 },
  playerCard: { backgroundColor: '#eef3ec', borderRadius: 16, padding: 12, gap: 4 },
  playerHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  playerName: { fontSize: 16, fontWeight: '800', color: '#132117', flex: 1 },
  playerPoints: { fontSize: 16, fontWeight: '800', color: '#132117' },
  playerMeta: { fontSize: 13, color: '#5a6b61' },
  row: { flexDirection: 'row', gap: 12 },
  loadingButton: { minHeight: 48, borderRadius: 14, backgroundColor: '#d9dfd6', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  loadingButtonText: { fontSize: 14, fontWeight: '700', color: '#5a6b61' },
});
