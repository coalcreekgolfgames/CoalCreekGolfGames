import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BrandedScreen } from '@/components/BrandedScreen';
import { AppButton } from '@/components/ui/AppButton';
import { TournamentQuickNav } from '@/components/navigation/TournamentQuickNav';
import { SectionCard } from '@/components/ui/SectionCard';
import { useAuth } from '@/providers/AuthProvider';
import {
  formatTournamentFormatLabel,
  isBracketTournamentFormat,
  isMatchPlayTournamentFormat,
  isTeamTournamentFormat,
  supportsTournamentStatsChoice,
} from '@/lib/tournamentFormats';
import {
  filterLeaderboardRowsForFormat,
  getTournamentForUser,
  getTournamentLiveLeaderboard,
  getTournamentPlayerGroupContext,
  leaderboardRowIdentity,
  type TournamentLeaderboardRow,
} from '@/lib/tournaments';
import { clearDraftRound, loadDraftRound, saveDraftRound } from '@/lib/localRound';
import {
  applyTournamentRoundConfig,
  createTournamentDraftRound,
  ensureTournamentDraftTeamContext,
  getPendingScoreSyncSummary,
  resetTournamentRound,
  retryPendingTournamentHoleSyncs,
} from '@/lib/tournamentRoundSync';
import { holes as courseHoles, teeOptions, type TeeOption } from '@/constants/course';

function parThroughHole(lastHoleEntered: number | null | undefined) {
  const thru = Number(lastHoleEntered ?? 0);
  if (!thru || thru < 1) return null;
  return courseHoles
    .filter((hole) => hole.hole <= thru)
    .reduce((sum, hole) => sum + Number(hole.par ?? 0), 0);
}

function formatToPar(currentTotalScore: number | null | undefined, lastHoleEntered: number | null | undefined) {
  if (currentTotalScore == null) return '-';
  const parSoFar = parThroughHole(lastHoleEntered);
  if (parSoFar == null) return '-';
  const diff = Number(currentTotalScore) - parSoFar;
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

function leaderboardName(row: TournamentLeaderboardRow) {
  if (row.display_name?.trim()) return row.display_name.trim();
  return `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Unnamed entry';
}

function leaderboardKey(row: TournamentLeaderboardRow) {
  return leaderboardRowIdentity(row);
}

function formatTeeTime(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`1970-01-01T${value}`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getIndividualAssignmentTitle(source: string | null | undefined) {
  if (source === 'not_tournament_member') return 'Tournament roster needed';
  if (source === 'member_without_group_assignment') return 'Tee group assignment needed';
  return 'Individual group lookup';
}

function getIndividualAssignmentMessage(source: string | null | undefined) {
  if (source === 'not_tournament_member') {
    return 'Your account is not on the active tournament roster yet. Ask an admin to confirm your tournament player entry is active.';
  }
  if (source === 'member_without_group_assignment') {
    return 'You are on the tournament roster, but no active tee-time group is assigned yet. Ask an admin to place you into a play group for this tournament.';
  }
  return 'Your tournament group will appear here once the player-to-group assignment is available.';
}

function LeaderRow({ row, useFlightRank }: { row: TournamentLeaderboardRow; useFlightRank: boolean }) {
  const toPar = formatToPar(row.current_total_score, row.last_hole_entered);
  return (
    <View style={styles.rowCard}>
      <View style={styles.rowLeft}>
        <View style={styles.rankBubble}>
          <Text style={styles.rankText}>{useFlightRank ? row.flight_rank : row.overall_rank}</Text>
        </View>
        <View>
          <Text style={styles.playerName}>{leaderboardName(row)}</Text>
          <Text style={styles.rowMeta}>{row.leaderboard_status}</Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.scoreText}>{toPar}</Text>
        <Text style={styles.rowMeta}>{row.thru_label}</Text>
        <Text style={styles.lastHole}>Last hole entered: {row.last_hole_entered ?? '-'}</Text>
      </View>
    </View>
  );
}

export default function TournamentYardageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [item, setItem] = useState<any | null>(null);
  const [rows, setRows] = useState<TournamentLeaderboardRow[]>([]);
  const [groupContext, setGroupContext] = useState<any | null>(null);
  const [currentDraft, setCurrentDraft] = useState<any | null>(null);
  const [startingRound, setStartingRound] = useState(false);
  const [resettingRound, setResettingRound] = useState(false);
  const [retryingSync, setRetryingSync] = useState(false);
  const [statsEnabledChoice, setStatsEnabledChoice] = useState(true);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [selectedTee, setSelectedTee] = useState<TeeOption | null>(null);

  const load = useCallback(async () => {
    if (!user?.id || !id) {
      setItem(null);
      setRows([]);
      setGroupContext(null);
      setCurrentDraft(null);
      setLoading(false);
      return;
    }

    try {
      const [tournament, rawLeaderboard, draft] = await Promise.all([
        getTournamentForUser(user.id, id),
        getTournamentLiveLeaderboard(id),
        loadDraftRound(),
      ]);

      const formatType = tournament?.format_type ?? 'individual_stroke_play';
      const [group, leaderboard] = await Promise.all([
        getTournamentPlayerGroupContext(user.id, id, formatType),
        Promise.resolve(filterLeaderboardRowsForFormat(rawLeaderboard, formatType)),
      ]);

      let nextDraft = draft;

      if (
        draft &&
        draft.roundMode === 'tournament' &&
        draft.tournamentId === id
      ) {
        nextDraft = applyTournamentRoundConfig(draft, {
          scoringFormat: tournament?.scoring_format ?? null,
          stablefordMode: tournament?.stableford_mode ?? null,
          stablefordModifiedPreset: tournament?.stableford_modified_preset ?? null,
          handicapEnabled: tournament?.handicap_enabled ?? null,
          playerHandicap: profile?.handicap ?? null,
          holeCount: tournament?.hole_count ?? null,
          unlimitedRoundsAllowed: tournament?.unlimited_rounds_allowed ?? null,
          bestRoundsCount: tournament?.best_rounds_count ?? null,
          specialHoleRules: tournament?.special_hole_rules ?? [],
        });

        const hydrated = await ensureTournamentDraftTeamContext({
          round: nextDraft,
          userId: user.id,
        });
        nextDraft = hydrated.round;
        await saveDraftRound(nextDraft);
      }

      if (
        nextDraft &&
        nextDraft.roundMode === 'tournament' &&
        nextDraft.tournamentId === id &&
        nextDraft.backendRoundId &&
        (nextDraft.pendingScoreSyncs?.length ?? 0) > 0
      ) {
        const retried = await retryPendingTournamentHoleSyncs({
          round: nextDraft,
          userId: user.id,
        });
        nextDraft = retried.round;
        await saveDraftRound(nextDraft);

        if (retried.syncedCount > 0 && retried.failedCount === 0) {
          setSyncMessage(`Synced ${retried.syncedCount} queued hole score${retried.syncedCount === 1 ? '' : 's'}.`);
        } else if (retried.syncedCount > 0 || retried.failedCount > 0) {
          setSyncMessage(`Synced ${retried.syncedCount}, still pending ${getPendingScoreSyncSummary(nextDraft).pendingCount}.`);
        }
      }

      setItem(tournament);
      setRows(leaderboard);
      setGroupContext(group);
      setCurrentDraft(nextDraft);
      setStatsEnabledChoice(nextDraft?.statsEnabled ?? true);
    } catch (error: any) {
      console.error(error?.message ?? 'Failed to load tournament yardage view');
      setItem(null);
      setRows([]);
      setGroupContext(null);
      setCurrentDraft(null);
    }
  }, [user?.id, profile?.handicap, id]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      await load();
      setLoading(false);
    };
    run();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, TournamentLeaderboardRow[]>();
    rows.forEach((row) => {
      const key = row.flight_name || 'Overall';
      const existing = map.get(key) ?? [];
      existing.push(row);
      map.set(key, existing);
    });
    return Array.from(map.entries());
  }, [rows]);

  const openOrCreateRound = async () => {
    if (!user?.id || !id || !item) return;
    setStartingRound(true);
    try {
      if (
        currentDraft &&
        currentDraft.roundMode === 'tournament' &&
        currentDraft.tournamentId === id &&
        currentDraft.backendRoundId
      ) {
        const hydrated = await ensureTournamentDraftTeamContext({
          round: currentDraft,
          userId: user.id,
        });
        if (hydrated.round !== currentDraft) {
          setCurrentDraft(hydrated.round);
          await saveDraftRound(hydrated.round);
        }
        if (hydrated.missingTeamContext) {
          Alert.alert(
            'Tournament assignment needed',
            hydrated.round.lastSyncError ?? 'Your team assignment is not available yet. Please refresh and try again.',
          );
          return;
        }
        router.push(`/round/hole/${hydrated.round.currentHole || hydrated.round.startingHole || 1}`);
        return;
      }

      const formatType = item?.format_type ?? 'individual_stroke_play';
      const statsEnabled = supportsTournamentStatsChoice(formatType) ? statsEnabledChoice : false;
      if (!selectedTee) {
        Alert.alert('Choose a tee', 'Select the tee set you are playing before starting the tournament round.');
        return;
      }

      const draft = await createTournamentDraftRound({
        userId: user.id,
        tournamentId: id,
        tournamentName: item.name,
        formatType,
        statsEnabled,
        scoringFormat: item.scoring_format ?? null,
        stablefordMode: item.stableford_mode ?? null,
        stablefordModifiedPreset: item.stableford_modified_preset ?? null,
        handicapEnabled: item.handicap_enabled ?? null,
        playerHandicap: profile?.handicap ?? null,
        holeCount: item.hole_count ?? null,
        unlimitedRoundsAllowed: item.unlimited_rounds_allowed ?? null,
        bestRoundsCount: item.best_rounds_count ?? null,
        specialHoleRules: item.special_hole_rules ?? [],
        tee: selectedTee,
        ratingType: 'men',
      });

      if (isTeamTournamentFormat(formatType) && !draft.tournamentTeamId) {
        Alert.alert(
          'Team assignment needed',
          draft.lastSyncError ?? 'No active team was found for your account in this tournament yet.',
        );
        return;
      }

      if (formatType === 'individual_stroke_play' && !draft.tournamentPlayGroupId) {
        Alert.alert(
          'Group assignment needed',
          draft.lastSyncError ?? 'No active tee-time group was found for your account in this tournament yet.',
        );
        return;
      }

      await saveDraftRound(draft);
      setCurrentDraft(draft);
      router.push(`/round/hole/${draft.currentHole || draft.startingHole || 1}`);
    } catch (error: any) {
      console.error(error?.message ?? 'Failed to open tournament round');
      Alert.alert(
        'Tournament round unavailable',
        error?.message ?? 'This tournament round could not be opened on this phone yet.',
      );
    } finally {
      setStartingRound(false);
    }
  };

  const retryQueuedScores = async () => {
    if (!currentDraft?.backendRoundId || !user?.id) return;
    setRetryingSync(true);
    try {
      const retried = await retryPendingTournamentHoleSyncs({
        round: currentDraft,
        userId: user.id,
      });
      setCurrentDraft(retried.round);
      await saveDraftRound(retried.round);
      await load();
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

  const handleReset = () => {
    if (!user?.id || !currentDraft) return;

    Alert.alert(
      'Reset tournament round?',
      'This will delete your saved hole scores and stat payload for this tournament round and clear the local round on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setResettingRound(true);
            try {
              await resetTournamentRound({
                round: currentDraft,
                userId: user.id,
              });

              await clearDraftRound();
              setCurrentDraft(null);
              await load();
              Alert.alert('Round reset', 'Your tournament round test data was cleared.');
            } catch (error: any) {
              console.error(error?.message ?? 'Failed to reset round');
              Alert.alert('Reset failed', 'The round could not be reset. Please try again.');
            } finally {
              setResettingRound(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <BrandedScreen screenName="TournamentYardageScreen-loading" scroll={false}>
        <View style={styles.loading}><ActivityIndicator size="large" color="#18341d" /></View>
      </BrandedScreen>
    );
  }

  const formatType = item?.format_type ?? 'individual_stroke_play';
  const teamFormat = isTeamTournamentFormat(formatType);
  const matchPlayFormat = isMatchPlayTournamentFormat(formatType);
  const hasFlights = grouped.length > 1 || (grouped.length === 1 && grouped[0][0] !== 'Overall');
  const hasTournamentDraft =
    !!currentDraft &&
    currentDraft.roundMode === 'tournament' &&
    currentDraft.tournamentId === id &&
    !!currentDraft.backendRoundId;

  const showStatsChoice = supportsTournamentStatsChoice(formatType);
  const myToPar = formatToPar(groupContext?.myScore, groupContext?.lastHoleEntered);
  const syncSummary = getPendingScoreSyncSummary(currentDraft);
  const individualLookupDebug =
    formatType === 'individual_stroke_play'
      ? groupContext?.lookupDebug ?? {
          userId: user?.id ?? null,
          tournamentId: id ?? null,
          membershipConfirmed: false,
          membershipRows: [],
          joinedGroupRows: [],
          selectedMembershipRow: null,
          selectedGroupRow: null,
          error: currentDraft?.lastSyncError ?? null,
          source: 'yardage_no_group_context',
        }
      : null;
  const individualAssignmentTitle = !teamFormat ? getIndividualAssignmentTitle(individualLookupDebug?.source) : null;
  const individualAssignmentMessage = !teamFormat ? getIndividualAssignmentMessage(individualLookupDebug?.source) : null;
  const contextLine = teamFormat
    ? [
        groupContext?.startingHole ? `Start Hole ${groupContext.startingHole}` : null,
        groupContext?.opponentTeamName ? `Opponent ${groupContext.opponentTeamName}` : null,
      ].filter(Boolean).join(' • ')
    : [
        groupContext?.teeTime ? `Tee Time ${formatTeeTime(groupContext.teeTime)}` : null,
        groupContext?.groupName ? `Group ${groupContext.groupName}` : null,
        groupContext?.crossCardTargetName ? `Cross-Card ${groupContext.crossCardTargetName}` : null,
      ].filter(Boolean).join(' • ');

  return (
    <BrandedScreen screenName="TournamentYardageScreen" scroll={false} bodyStyle={styles.bodyWrap}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
      <SectionCard>
        <Text style={styles.eyebrow}>Tournament Round</Text>
        <Text style={styles.title}>{item?.name ?? 'Tournament'}</Text>
        <Text style={styles.subtitle}>
          Shared tournament shell with a group-first Yardage Book layout.
        </Text>

        <View style={styles.headerBadgeRow}>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{formatTournamentFormatLabel(formatType)}</Text>
          </View>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{item?.status ?? 'Active'}</Text>
          </View>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{groupContext?.myLeaderboardStatus ?? 'Not Started'}</Text>
          </View>
        </View>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionLabel}>{teamFormat ? 'Your Team' : 'Your Group'}</Text>
        <Text style={styles.sectionTitle}>{groupContext?.teamName ?? groupContext?.groupName ?? (teamFormat ? 'Your tournament team' : 'Your tournament group')}</Text>
        <Text style={styles.body}>
          {groupContext?.participants?.length
            ? groupContext.participants.map((participant: any) => participant.displayName).join(' • ')
            : teamFormat
              ? 'No assigned team was found yet. This card will populate when your tournament team membership is available.'
              : individualAssignmentMessage ?? 'No assigned group found yet. This top card will populate once your tournament round and group pairing are created.'}
        </Text>
        {contextLine ? <Text style={styles.contextText}>{contextLine}</Text> : null}
        {teamFormat && groupContext?.opponentTeamName ? (
          <Text style={styles.body}>Opponent: {groupContext.opponentTeamName}</Text>
        ) : null}
        {!teamFormat && individualLookupDebug ? (
          <View style={styles.debugCard}>
            <Text style={styles.debugLabel}>{individualAssignmentTitle}</Text>
            <Text style={styles.debugState}>Decision state: {String(individualLookupDebug.source ?? '-')}</Text>
            <Text style={styles.debugText}>{individualAssignmentMessage}</Text>
            <Text style={styles.debugText}>Route tournament id: {String(id ?? '-')}</Text>
            <Text style={styles.debugText}>Lookup tournament id: {String(individualLookupDebug.tournamentId ?? '-')}</Text>
            <Text style={styles.debugText}>User: {String(individualLookupDebug.userId ?? '-')}</Text>
            <Text style={styles.debugText}>Tournament membership confirmed: {individualLookupDebug.membershipConfirmed ? 'yes' : 'no'}</Text>
            <Text style={styles.debugText}>Matched membership group_id: {String(individualLookupDebug.selectedMembershipRow?.group_id ?? '-')}</Text>
            <Text style={styles.debugText}>Matched play_groups.id: {String(individualLookupDebug.selectedGroupRow?.id ?? '-')}</Text>
            <Text style={styles.debugText}>Matched play_groups.tournament_id: {String(individualLookupDebug.selectedGroupRow?.tournament_id ?? '-')}</Text>
            <Text style={styles.debugText}>Decision path: {String(individualLookupDebug.source ?? '-')}</Text>
            <Text style={styles.debugText}>Membership rows: {JSON.stringify(individualLookupDebug.membershipRows ?? [])}</Text>
            <Text style={styles.debugText}>Candidate play_groups rows: {JSON.stringify(individualLookupDebug.joinedGroupRows ?? [])}</Text>
            {individualLookupDebug.error ? (
              <Text style={styles.debugError}>Lookup error: {String(individualLookupDebug.error)}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.topCards}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>{teamFormat ? 'Team To Par' : 'My To Par'}</Text>
            <Text style={styles.metricValue}>{myToPar}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Last Hole Entered</Text>
            <Text style={styles.metricValue}>{groupContext?.lastHoleEntered ?? '-'}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Group Status</Text>
            <Text style={styles.metricValueSmall}>{groupContext?.myLeaderboardStatus ?? 'Not Started'}</Text>
          </View>
        </View>

        {showStatsChoice ? (
          <View style={styles.statsChoiceCard}>
            <Text style={styles.metricLabel}>Stats</Text>
            <Text style={styles.statsChoiceText}>Single-player stroke play can track stats. They are on by default each time you open the tournament.</Text>
            <View style={styles.statsChoiceRow}>
              <AppButton
                title="Stats On"
                onPress={() => setStatsEnabledChoice(true)}
                variant={statsEnabledChoice ? 'primary' : 'secondary'}
                style={{ flex: 1 }}
              />
              <AppButton
                title="No Stats"
                onPress={() => setStatsEnabledChoice(false)}
                variant={!statsEnabledChoice ? 'primary' : 'secondary'}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : (
          <View style={styles.statsChoiceCard}>
            <Text style={styles.metricLabel}>Stats</Text>
            <Text style={styles.statsChoiceText}>
              {matchPlayFormat
                ? 'Match play uses head-to-head hole results instead of the stroke-play stat set. Handicap-aware match scoring is configured separately from this screen.'
                : formatType === 'scramble'
                ? 'Scramble rounds are score-only. One team score is entered each hole.'
                : 'Ironman rounds are score-only. Our team score and the opponent team score are both entered each hole.'}
            </Text>
          </View>
        )}

        {matchPlayFormat ? (
          <View style={styles.matchPlayNoticeCard}>
            <Text style={styles.metricLabel}>Match Play</Text>
            <Text style={styles.matchPlayTitle}>
              {isBracketTournamentFormat(formatType) ? 'Coming soon' : 'Use the match screen'}
            </Text>
            <Text style={styles.statsChoiceText}>
              {isBracketTournamentFormat(formatType)
                ? 'Match Play Bracket is not ready for mobile scoring yet. Bracket setup, advancement, and results are not wired in this screen.'
                : 'Singles Match Play is scored from the tournament match screen, not from the stroke-play round starter. This screen stays blocked so match results are not saved with the wrong rules.'}
            </Text>
            {!isBracketTournamentFormat(formatType) ? <Text style={styles.matchPlayMeta}>Default scoring mode: Net with Handicap Difference</Text> : null}
          </View>
        ) : null}

        {!hasTournamentDraft && !matchPlayFormat ? (
          <View style={styles.statsChoiceCard}>
            <Text style={styles.metricLabel}>Tee</Text>
            <Text style={styles.statsChoiceText}>Choose the tee you are playing for this tournament round.</Text>
            <View style={styles.teeChoiceRow}>
              {teeOptions.map((option) => (
                <AppButton
                  key={option}
                  title={option}
                  onPress={() => setSelectedTee(option)}
                  variant={selectedTee === option ? 'primary' : 'secondary'}
                  compact
                  style={styles.teeChoiceButton}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.syncCard}>
          <Text style={styles.metricLabel}>Sync Status</Text>
          <Text style={styles.statsChoiceText}>
            {syncSummary.pendingCount === 0
              ? 'All saved hole scores are synced.'
              : `${syncSummary.pendingCount} hole score${syncSummary.pendingCount === 1 ? '' : 's'} are queued on this phone.`}
          </Text>
          {currentDraft?.lastSyncError ? <Text style={styles.syncError}>Last error: {currentDraft.lastSyncError}</Text> : null}
          {syncSummary.pendingCount > 0 ? (
            <View style={styles.statsChoiceRow}>
              <AppButton
                title={retryingSync ? 'Retrying…' : 'Retry Pending Sync'}
                onPress={retryQueuedScores}
                variant="secondary"
                disabled={retryingSync}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}
        </View>

        {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}

        <View style={styles.buttonStack}>
          <AppButton
            title={matchPlayFormat ? (isBracketTournamentFormat(formatType) ? 'Match Play Bracket Coming Soon' : 'Open Match Screen') : startingRound ? 'Opening…' : (hasTournamentDraft ? 'Resume Tournament Round' : 'Start Tournament Round')}
            onPress={openOrCreateRound}
            disabled={startingRound || resettingRound || matchPlayFormat || (!hasTournamentDraft && !selectedTee)}
          />
          <AppButton
            title={resettingRound ? 'Resetting…' : 'Reset Tournament Round'}
            onPress={handleReset}
            variant="secondary"
            disabled={resettingRound || startingRound || !hasTournamentDraft || matchPlayFormat}
          />
          <AppButton title="Open Live Board Only" onPress={() => router.push(`/tournament/${id}/live`)} variant="secondary" />
        </View>
      </SectionCard>

      {rows.length === 0 ? (
        <SectionCard>
          <Text style={styles.sectionLabel}>Leaderboard</Text>
          <Text style={styles.sectionTitle}>No live rows yet</Text>
          <Text style={styles.body}>
            Once scores start saving, the leaderboard underneath your {teamFormat ? 'team' : 'group'} card will populate here.
          </Text>
        </SectionCard>
      ) : hasFlights ? (
        grouped.map(([flight, items]) => (
          <SectionCard key={flight}>
            <Text style={styles.sectionLabel}>Flight Leaderboard</Text>
            <Text style={styles.sectionTitle}>{flight}</Text>
            <View style={styles.stack}>
              {items.map((row) => (
                <LeaderRow key={`${flight}-${leaderboardKey(row)}`} row={row} useFlightRank />
              ))}
            </View>
          </SectionCard>
        ))
      ) : (
        <SectionCard>
          <Text style={styles.sectionLabel}>Leaderboard</Text>
          <Text style={styles.sectionTitle}>Tournament Leaderboard</Text>
          <View style={styles.stack}>
            {rows.map((row) => (
              <LeaderRow key={leaderboardKey(row)} row={row} useFlightRank={false} />
            ))}
          </View>
        </SectionCard>
      )}
      </ScrollView>
      <TournamentQuickNav />
    </BrandedScreen>
  );
}

const styles = StyleSheet.create({
  bodyWrap: { flex: 1 },
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, gap: 16, paddingBottom: 112 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', color: '#8b7447' },
  title: { fontSize: 28, fontWeight: '800', color: '#132117', marginTop: 8 },
  subtitle: { fontSize: 15, color: '#5a6b61', marginTop: 8, lineHeight: 21 },
  sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: '#8b7447' },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: '#132117', marginTop: 4 },
  body: { fontSize: 15, color: '#425247', lineHeight: 22, marginTop: 10 },
  contextText: { fontSize: 13, color: '#18341d', fontWeight: '700', marginTop: 10 },
  debugCard: { backgroundColor: '#f7f3ea', borderRadius: 14, padding: 12, marginTop: 12, gap: 6 },
  debugLabel: { fontSize: 11, fontWeight: '800', color: '#8b8a84', textTransform: 'uppercase', letterSpacing: 1.0 },
  debugState: { fontSize: 12, lineHeight: 17, color: '#18341d', fontWeight: '700' },
  debugText: { fontSize: 12, lineHeight: 17, color: '#425247' },
  debugError: { fontSize: 12, lineHeight: 17, color: '#7b3e33', fontWeight: '700' },
  headerBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  headerBadge: { backgroundColor: '#eef3ec', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  headerBadgeText: { fontSize: 12, fontWeight: '800', color: '#18341d', textTransform: 'uppercase', letterSpacing: 0.8 },
  topCards: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  metricCard: { flex: 1, minWidth: 100, backgroundColor: '#f7f3ea', borderRadius: 14, padding: 12 },
  metricLabel: { fontSize: 11, fontWeight: '800', color: '#8b8a84', textTransform: 'uppercase', letterSpacing: 1.0 },
  metricValue: { fontSize: 28, fontWeight: '800', color: '#132117', marginTop: 8 },
  metricValueSmall: { fontSize: 15, fontWeight: '700', color: '#132117', marginTop: 8, lineHeight: 20 },
  statsChoiceCard: { backgroundColor: '#f7f3ea', borderRadius: 14, padding: 12, marginTop: 14, gap: 10 },
  syncCard: { backgroundColor: '#f7f3ea', borderRadius: 14, padding: 12, marginTop: 14, gap: 10 },
  matchPlayNoticeCard: { backgroundColor: '#eef3ec', borderRadius: 14, padding: 12, marginTop: 14, gap: 10, borderWidth: 1, borderColor: '#d5dfd5' },
  matchPlayTitle: { fontSize: 16, fontWeight: '800', color: '#132117' },
  matchPlayMeta: { fontSize: 13, color: '#18341d', fontWeight: '700' },
  statsChoiceText: { fontSize: 14, color: '#425247', lineHeight: 20 },
  statsChoiceRow: { flexDirection: 'row', gap: 10 },
  teeChoiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  teeChoiceButton: { minWidth: 96 },
  syncError: { fontSize: 13, lineHeight: 18, color: '#7b3e33' },
  syncMessage: { fontSize: 13, lineHeight: 18, color: '#18341d', marginTop: 10 },
  buttonStack: { gap: 12, marginTop: 16 },
  stack: { gap: 12, marginTop: 14 },
  rowCard: { backgroundColor: '#f7f3ea', borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  rowRight: { alignItems: 'flex-end' },
  rankBubble: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fffdf8', alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 14, fontWeight: '800', color: '#132117' },
  playerName: { fontSize: 16, fontWeight: '800', color: '#132117' },
  scoreText: { fontSize: 22, fontWeight: '800', color: '#132117' },
  rowMeta: { fontSize: 13, color: '#5a6b61', marginTop: 2 },
  lastHole: { fontSize: 11, fontWeight: '700', color: '#8b8a84', marginTop: 4, textTransform: 'uppercase' },
});
