import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BrandedScreen } from '@/components/BrandedScreen';
import { SectionCard } from '@/components/ui/SectionCard';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { useAuth } from '@/providers/AuthProvider';
import { buildStrokeCompetitionResults } from '@/lib/tournamentCompetitionResults';
import {
  formatTournamentFormatLabel,
  isBracketTournamentFormat,
  isMatchPlayTournamentFormat,
} from '@/lib/tournamentFormats';
import {
  createTournamentSinglesMatch,
  getTournamentMatchSavedHoleCount,
  getTournamentForUser,
  hasTournamentMatchStarted,
  isTournamentMatchScorecardComplete,
  listTournamentMatches,
  listTournamentPlayersForMatchPlay,
  type TournamentCompetitionForUser,
  type TournamentMatchPlayerOption,
  type TournamentMatchSummary,
  type TournamentEventAddOnForUser,
  type TournamentForUser,
} from '@/lib/tournaments';

const DEFAULT_TOURNAMENT_COURSE = 'Coal Creek Golf Resort';
const CLUB_DEFAULT_MODIFIED_PRESET =
  'Default preset: Albatross 4, Eagle 3, Birdie 2, Par 1, Bogey 0, More than bogey -1';

function isActiveMatchPlayCompetition(competition: TournamentCompetitionForUser) {
  if (!competition?.is_active) return false;
  return competition.scoring_format === 'match_play'
    || competition.competition_key === 'match_play'
    || competition.competition_key === 'singles_match_play'
    || competition.competition_key === 'match_play_bracket';
}

function isSinglesMatchPlayCompetition(competition: TournamentCompetitionForUser) {
  return isActiveMatchPlayCompetition(competition)
    && competition.competition_key !== 'match_play_bracket';
}

function isBracketMatchPlayCompetition(competition: TournamentCompetitionForUser) {
  return isActiveMatchPlayCompetition(competition)
    && competition.competition_key === 'match_play_bracket';
}

function matchRoundLabel(round: number | null | undefined, maxRound: number) {
  const numericRound = Number(round ?? 0);
  const remainingRounds = maxRound - numericRound + 1;
  if (remainingRounds === 1) return 'Final';
  if (remainingRounds === 2) return 'Semifinal';
  if (remainingRounds === 3) return 'Quarterfinal';
  if (remainingRounds === 4) return 'Round of 16';
  if (remainingRounds === 5) return 'Round of 32';
  return `Round ${numericRound || '-'}`;
}

function formatDateRange(startDate: string | null | undefined, endDate: string | null | undefined) {
  if (!startDate && !endDate) return 'Dates to be announced';
  if (startDate && endDate) return `${startDate} to ${endDate}`;
  return startDate ?? endDate ?? 'Dates to be announced';
}

function formatFormatLabel(item: TournamentForUser | null) {
  if (item?.format_label?.trim()) return item.format_label.trim();
  return formatTournamentFormatLabel(item?.format_type);
}

function renderDetailBlock(label: string, value: string | null | undefined) {
  if (!value?.trim()) return null;

  return (
    <View key={label} style={styles.detailBlock}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailText}>{value.trim()}</Text>
    </View>
  );
}

function formatStablefordMode(item: TournamentForUser | null) {
  if (item?.stableford_mode === 'net') return 'Net Stableford';
  if (item?.stableford_mode === 'modified') return 'Modified Stableford';
  return 'Standard Stableford';
}

function formatBooleanLabel(value: boolean | null | undefined, positive: string, negative: string) {
  return value ? positive : negative;
}

function formatBestRoundsLabel(value: number | null | undefined) {
  if (!value || value < 1) return 'All submitted rounds count';
  return `Best ${value} rounds count`;
}

function buildSpecialHoleRuleSummary(item: TournamentForUser | null) {
  const rules = item?.special_hole_rules ?? [];
  if (rules.length === 0) return [];

  return rules.map((rule) => {
    const parts: string[] = [];
    if (rule.must_hole_out) parts.push('must be holed out');
    if (rule.track_stroke_tally) parts.push('actual strokes recorded');

    return {
      key: `hole-${rule.hole_number}`,
      label: `Hole ${rule.hole_number}`,
      value: parts.length > 0 ? parts.join(', ') : 'special handling applies',
    };
  });
}

function isSevenDayStablefordProfile(item: TournamentForUser | null) {
  if (!item || item.scoring_format !== 'stableford') return false;
  if (item.event_template === 'stableford_7_day') return true;

  const holeSixRule = (item.special_hole_rules ?? []).find((rule) => rule.hole_number === 6);
  return (
    item.unlimited_rounds_allowed === true
    && item.best_rounds_count === 4
    && holeSixRule?.must_hole_out === true
    && holeSixRule?.track_stroke_tally === true
  );
}

function formatCurrency(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return '$0.00';
  return `$${numeric.toFixed(2)}`;
}

function formatHoleList(holeNumbers: number[] | null | undefined) {
  if (!holeNumbers || holeNumbers.length === 0) return 'Holes to be announced';
  if (holeNumbers.length === 1) return `Hole ${holeNumbers[0]}`;
  return `Holes ${holeNumbers.join(', ')}`;
}

function addOnWinnerLabel(addOn: TournamentEventAddOnForUser) {
  if (!addOn.winners.length) return 'Winner pending';
  if (addOn.winners.length === 1) return addOn.winners[0].display_name;
  return addOn.winners.map((winner) => winner.display_name).join(', ');
}

function renderEventAddOnCard(addOn: TournamentEventAddOnForUser) {
  const holeLabel = formatHoleList(addOn.hole_numbers);
  const winnerLabel = addOnWinnerLabel(addOn);
  const targetDescription = addOn.target_description?.trim() || null;

  if (addOn.add_on_type === 'birdie_pot') {
    return (
      <View key={addOn.id} style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Birdie Pot</Text>
        <Text style={styles.detailText}>Buy-in: {formatCurrency(addOn.buy_in_amount)}</Text>
        <Text style={styles.detailText}>Tracked holes: {holeLabel}</Text>
        <Text style={styles.detailText}>Your status: {addOn.current_user_entered ? 'Entered' : 'Not entered'}</Text>
        <Text style={styles.detailText}>Entered players: {addOn.entered_player_count}</Text>
      </View>
    );
  }

  if (addOn.add_on_type === 'closest_to_pin_prize' || addOn.add_on_type === 'closest_to_pin_pot') {
    return (
      <View key={addOn.id} style={styles.detailBlock}>
        <Text style={styles.detailLabel}>{addOn.name}</Text>
        <Text style={styles.detailText}>{holeLabel}</Text>
        <Text style={styles.detailText}>
          Format: {addOn.add_on_type === 'closest_to_pin_pot' ? `Pot (${formatCurrency(addOn.buy_in_amount)})` : 'Prize'}
        </Text>
        {addOn.add_on_type === 'closest_to_pin_pot' ? (
          <Text style={styles.detailText}>Your status: {addOn.current_user_entered ? 'Entered' : 'Not entered'}</Text>
        ) : null}
        <Text style={styles.detailText}>Current winner: {winnerLabel}</Text>
      </View>
    );
  }

  if (addOn.add_on_type === 'longest_drive') {
    return (
      <View key={addOn.id} style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Longest Drive</Text>
        <Text style={styles.detailText}>{holeLabel}</Text>
        <Text style={styles.detailText}>Current winner: {winnerLabel}</Text>
      </View>
    );
  }

  if (addOn.add_on_type === 'ball_in_sand' || addOn.add_on_type === 'ball_in_water') {
    return (
      <View key={addOn.id} style={styles.detailBlock}>
        <Text style={styles.detailLabel}>{addOn.name}</Text>
        <Text style={styles.detailText}>{holeLabel}</Text>
        {targetDescription ? <Text style={styles.detailText}>Target: {targetDescription}</Text> : null}
        <Text style={styles.detailText}>
          Qualifiers: {addOn.qualifiers.length > 0 ? addOn.qualifiers.map((qualifier) => qualifier.display_name).join(', ') : 'None posted yet'}
        </Text>
        <Text style={styles.detailText}>Current winner: {winnerLabel}</Text>
      </View>
    );
  }

  if (addOn.add_on_type === 'hit_the_dozer') {
    return (
      <View key={addOn.id} style={styles.detailBlock}>
        <Text style={styles.detailLabel}>Hit the Dozer</Text>
        <Text style={styles.detailText}>{holeLabel}</Text>
        {targetDescription ? <Text style={styles.detailText}>Target: {targetDescription}</Text> : null}
        <Text style={styles.detailText}>Buy-in: {formatCurrency(addOn.buy_in_amount)}</Text>
        <Text style={styles.detailText}>Your status: {addOn.current_user_entered ? 'Entered' : 'Not entered'}</Text>
        <Text style={styles.detailText}>
          Entries: {addOn.entered_player_count}
        </Text>
        <Text style={styles.detailText}>
          Posted qualifiers: {addOn.qualifiers.length > 0 ? addOn.qualifiers.map((qualifier) => qualifier.display_name).join(', ') : 'No qualifiers posted'}
        </Text>
        <Text style={styles.detailText}>Current winner: {winnerLabel}</Text>
      </View>
    );
  }

  return (
    <View key={addOn.id} style={styles.detailBlock}>
      <Text style={styles.detailLabel}>{addOn.name}</Text>
      <Text style={styles.detailText}>{holeLabel}</Text>
    </View>
  );
}

export default function TournamentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [item, setItem] = useState<TournamentForUser | null>(null);
  const [matchPlayers, setMatchPlayers] = useState<TournamentMatchPlayerOption[]>([]);
  const [matches, setMatches] = useState<TournamentMatchSummary[]>([]);
  const [creatingMatch, setCreatingMatch] = useState(false);
  const [selectedPlayerAId, setSelectedPlayerAId] = useState<string | null>(null);
  const [selectedPlayerBId, setSelectedPlayerBId] = useState<string | null>(null);
  const [playerAHandicapInput, setPlayerAHandicapInput] = useState('');
  const [playerBHandicapInput, setPlayerBHandicapInput] = useState('');
  const [matchScoringMode, setMatchScoringMode] = useState<'net' | 'gross'>('net');
  const currentUserMatches = matches
    .filter((match) => match.playerA?.userId === user?.id || match.playerB?.userId === user?.id)
    .sort((a, b) => {
      const completionDiff = Number(isTournamentMatchScorecardComplete(a)) - Number(isTournamentMatchScorecardComplete(b));
      if (completionDiff !== 0) return completionDiff;
      const startedDiff = Number(hasTournamentMatchStarted(b)) - Number(hasTournamentMatchStarted(a));
      if (startedDiff !== 0) return startedDiff;
      return String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? ''));
    });
  const currentUserMatch = currentUserMatches[0] ?? null;
  const currentUserMatchScorecardComplete = isTournamentMatchScorecardComplete(currentUserMatch);
  const currentUserMatchSavedHoleCount = getTournamentMatchSavedHoleCount(currentUserMatch);
  const currentUserMatchStarted = hasTournamentMatchStarted(currentUserMatch);

  const syncHandicapInputs = useCallback((players: TournamentMatchPlayerOption[], playerAId: string | null, playerBId: string | null) => {
    const playerA = players.find((player) => player.participantId === playerAId) ?? null;
    const playerB = players.find((player) => player.participantId === playerBId) ?? null;
    setPlayerAHandicapInput(typeof playerA?.handicap === 'number' ? String(playerA.handicap) : '');
    setPlayerBHandicapInput(typeof playerB?.handicap === 'number' ? String(playerB.handicap) : '');
  }, []);

  const load = useCallback(async () => {
    if (!user?.id || !id) {
      setItem(null);
      setMatchPlayers([]);
      setMatches([]);
      setLoading(false);
      return;
    }

    try {
      const data = await getTournamentForUser(user.id, id);
      const hasMatchPlayCompetitions = (data?.competitions ?? []).some((competition) => isActiveMatchPlayCompetition(competition));
      const matchPlayFormat = isMatchPlayTournamentFormat(data?.format_type) || hasMatchPlayCompetitions;
      const [players, tournamentMatches] = matchPlayFormat
        ? await Promise.all([
            listTournamentPlayersForMatchPlay(id),
            listTournamentMatches(id),
          ])
        : [[], []];

      setItem(data);
      setMatchPlayers(players);
      setMatches(tournamentMatches);
      console.info('[mobile-tournament-setup-load-debug]', {
        tournamentId: id,
        tournamentLoaded: !!data?.id,
        competitionCount: (data?.competitions ?? []).length,
        playerCount: players.length,
        guestPlayerCount: players.filter((player) => !player.userId).length,
        registeredPlayerCount: players.filter((player) => !!player.userId).length,
        matchCount: tournamentMatches.length,
        error: null,
      });
      if (players.length >= 2) {
        const nextPlayerAId = selectedPlayerAId && players.some((player) => player.participantId === selectedPlayerAId)
          ? selectedPlayerAId
          : players[0]?.participantId ?? null;
        const nextPlayerBId = selectedPlayerBId && players.some((player) => player.participantId === selectedPlayerBId)
          ? selectedPlayerBId
          : players.find((player) => player.participantId !== nextPlayerAId)?.participantId ?? null;
        setSelectedPlayerAId(nextPlayerAId);
        setSelectedPlayerBId(nextPlayerBId);
        syncHandicapInputs(players, nextPlayerAId, nextPlayerBId);
      }
    } catch (error: any) {
      console.error(error?.message ?? 'Failed to load tournament');
      console.info('[mobile-tournament-setup-load-debug]', {
        tournamentId: id,
        tournamentLoaded: false,
        competitionCount: 0,
        playerCount: 0,
        guestPlayerCount: 0,
        registeredPlayerCount: 0,
        matchCount: 0,
        error: error?.message ?? 'Failed to load tournament',
      });
      setItem(null);
      setMatchPlayers([]);
      setMatches([]);
    }
  }, [user?.id, id]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      await load();
      setLoading(false);
    };
    run();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const shouldShowCreateMatch = !!item
      && (item.competitions ?? []).some((competition) => isSinglesMatchPlayCompetition(competition))
      && !currentUserMatch;
    const shouldShowStartMatch = !!currentUserMatch && !currentUserMatchStarted && !currentUserMatchScorecardComplete;
    const shouldShowResumeMatch = !!currentUserMatch && currentUserMatchStarted && !currentUserMatchScorecardComplete;
    const shouldShowViewFinalMatch = !!currentUserMatch && currentUserMatchScorecardComplete;
    console.info('[match-play-completion-ui-debug]', {
      tournamentId: id ?? null,
      matchId: currentUserMatch?.id ?? null,
      officialMatchComplete: currentUserMatch?.officialMatchComplete ?? null,
      scorecardComplete: currentUserMatchScorecardComplete,
      savedHoleNumbers: [],
      finishedAt: currentUserMatch?.finishedAt ?? null,
      shouldShowCreateMatch,
      shouldShowResumeMatch,
      shouldShowHomeNotification: shouldShowResumeMatch,
      bottomNavVisible: false,
    });
    console.info('[current-user-match-visibility-debug]', {
      tournamentId: id ?? null,
      currentUserId: user?.id ?? null,
      totalSinglesMatches: matches.filter((match) => match.matchType === 'singles').length,
      currentUserMatchId: currentUserMatch?.id ?? null,
      currentUserSavedHoleCount: currentUserMatchSavedHoleCount,
      currentUserScorecardComplete: currentUserMatchScorecardComplete,
      shouldShowStartMatch,
      shouldShowResumeMatch,
      shouldShowViewFinalMatch,
      shouldShowAllMatchesList: false,
    });
  }, [
    currentUserMatch?.finishedAt,
    currentUserMatch?.id,
    currentUserMatch?.officialMatchComplete,
    currentUserMatchSavedHoleCount,
    currentUserMatchStarted,
    currentUserMatchScorecardComplete,
    id,
    item,
    matches,
    user?.id,
  ]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <BrandedScreen screenName="TournamentDetailScreen-loading" scroll={false}>
        <View style={styles.loading}><ActivityIndicator size="large" color="#18341d" /></View>
      </BrandedScreen>
    );
  }

  if (!item) {
    return (
      <BrandedScreen screenName="TournamentDetailScreen-empty" scroll={false}>
        <View style={styles.loading}>
          <Text style={styles.emptyTitle}>Tournament not found</Text>
          <Text style={styles.subtitle}>You may no longer have access to this tournament.</Text>
        </View>
      </BrandedScreen>
    );
  }

  const courseName = item.course_name?.trim() || DEFAULT_TOURNAMENT_COURSE;
  const formatLabel = formatFormatLabel(item);
  const specialHoleRules = buildSpecialHoleRuleSummary(item);
  const isStableford = item.scoring_format === 'stableford';
  const showModifiedPreset =
    item.stableford_mode === 'modified' && item.stableford_modified_preset === 'club_default';
  const showSevenDayGuidance = isSevenDayStablefordProfile(item);
  const detailBlocks = [
    renderDetailBlock('Description', item.description),
    renderDetailBlock('Rules', item.rules),
    renderDetailBlock('Check-In', item.check_in_info),
    renderDetailBlock('Public Notes', item.public_notes),
  ].filter(Boolean);
  const eventAddOns = item.event_add_ons ?? [];
  const activeStrokeCompetitions = (item?.competitions ?? []).filter((competition) =>
    competition.competition_key === 'stroke_gross'
    || competition.competition_key === 'main_low_gross'
    || competition.competition_key === 'stroke_net'
    || competition.competition_key === 'main_low_net');
  const activeMatchPlayCompetitions = (item?.competitions ?? []).filter((competition) => isActiveMatchPlayCompetition(competition));
  const singlesMatchPlayCompetitions = activeMatchPlayCompetitions.filter((competition) => isSinglesMatchPlayCompetition(competition));
  const bracketMatchPlayCompetitions = activeMatchPlayCompetitions.filter((competition) => isBracketMatchPlayCompetition(competition));
  const matchPlayFormat = isMatchPlayTournamentFormat(item.format_type) || activeMatchPlayCompetitions.length > 0;
  const bracketMatchPlayFormat = isBracketTournamentFormat(item.format_type) || bracketMatchPlayCompetitions.length > 0;
  const singlesMatches = matches.filter((match) => match.matchType === 'singles');
  const bracketMatches = matches.filter((match) => match.matchType === 'bracket');
  const bracketMaxRound = bracketMatches.reduce((max, match) => Math.max(max, Number(match.bracketRound ?? 0)), 0);
  const selectedPlayerA = matchPlayers.find((player) => player.participantId === selectedPlayerAId) ?? null;
  const selectedPlayerB = matchPlayers.find((player) => player.participantId === selectedPlayerBId) ?? null;
  const availablePlayerAOptions = matchPlayers.filter((player) => player.participantId === selectedPlayerAId || player.participantId !== selectedPlayerBId);
  const availablePlayerBOptions = matchPlayers.filter((player) => player.participantId === selectedPlayerBId || player.participantId !== selectedPlayerAId);
  const shouldShowCreateMatch = singlesMatchPlayCompetitions.length > 0 && !currentUserMatch;
  const shouldShowStartMatch = !!currentUserMatch && !currentUserMatchStarted && !currentUserMatchScorecardComplete;
  const shouldShowResumeMatch = !!currentUserMatch && currentUserMatchStarted && !currentUserMatchScorecardComplete;
  const shouldShowViewFinalMatch = !!currentUserMatch && currentUserMatchScorecardComplete;
  const competitionPreview = buildStrokeCompetitionResults({
    competitions: item?.competitions ?? [],
    leaderboardRows: [],
    handicapByUserId: {},
  });

  const createMatch = async () => {
    if (!id) return;
    if (!selectedPlayerAId || !selectedPlayerBId || selectedPlayerAId === selectedPlayerBId) {
      Alert.alert('Choose two players', 'Select two different tournament players for the match.');
      return;
    }

    const playerAHandicap = playerAHandicapInput.trim() === '' ? null : Number(playerAHandicapInput);
    const playerBHandicap = playerBHandicapInput.trim() === '' ? null : Number(playerBHandicapInput);
    if (matchScoringMode === 'net') {
      if (!Number.isFinite(playerAHandicap) || !Number.isFinite(playerBHandicap)) {
        Alert.alert('Handicaps required', 'Net match play needs both playing handicaps before the match can be created.');
        return;
      }
    }

    setCreatingMatch(true);
    try {
      const created = await createTournamentSinglesMatch({
        tournamentId: id,
        playerAParticipantId: selectedPlayerAId,
        playerBParticipantId: selectedPlayerBId,
        playerAPlayingHandicap: Number.isFinite(playerAHandicap) ? Number(playerAHandicap) : null,
        playerBPlayingHandicap: Number.isFinite(playerBHandicap) ? Number(playerBHandicap) : null,
        scoringMode: matchScoringMode,
        handicapMode: matchScoringMode === 'net' ? 'full_difference' : 'none',
      });
      await load();
      router.push(`/tournament/${id}/match/${created.id}`);
    } catch (error: any) {
      console.error(error?.message ?? 'Failed to create match');
      Alert.alert('Match creation failed', error?.message ?? 'The match could not be created right now.');
    } finally {
      setCreatingMatch(false);
    }
  };

  return (
    <BrandedScreen screenName="TournamentDetailScreen" scroll={false} bodyStyle={styles.bodyWrap}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
      <SectionCard>
        <Text style={styles.eyebrow}>Tournament</Text>
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.subtitle}>{formatDateRange(item.start_date, item.end_date)}</Text>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Your tournament view</Text>
        {activeStrokeCompetitions.length > 0 ? (
          <View style={styles.detailsStack}>
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>Active competitions</Text>
              {competitionPreview.map((competition) => (
                <Text key={competition.competitionId} style={styles.detailText}>
                  {competition.competitionName} · {competition.handicapMode === 'net' ? 'Net' : 'Gross'} · Results show on the Live Board
                </Text>
              ))}
            </View>
          </View>
        ) : null}
        {matchPlayFormat ? (
          <>
            <Text style={styles.body}>
              Match Play competitions use the dedicated match scorer. Create singles matches here when needed, and open your current match or bracket match to score it hole by hole.
            </Text>

            {currentUserMatch ? (
              <View style={styles.detailBlock}>
                <Text style={styles.detailLabel}>Your Match</Text>
                <Text style={styles.detailText}>
                  {currentUserMatch.playerA?.displayName ?? 'Player A'} vs {currentUserMatch.playerB?.displayName ?? 'Player B'}
                </Text>
                <Text style={styles.detailText}>{currentUserMatch.currentStatusLabel}</Text>
                <View style={styles.buttonStack}>
                  <AppButton
                    title={
                      shouldShowViewFinalMatch
                        ? 'View Final Match'
                        : shouldShowStartMatch
                          ? 'Start Match'
                          : currentUserMatch.officialMatchComplete
                          ? 'Resume Scorecard'
                          : 'Resume Match'
                    }
                    onPress={() => router.push(`/tournament/${id}/match/${currentUserMatch.id}`)}
                  />
                </View>
              </View>
            ) : null}

            {shouldShowCreateMatch ? (
            <View style={styles.detailsStack}>
              <View style={styles.detailBlock}>
                <Text style={styles.detailLabel}>Create Singles Match</Text>
                <Text style={styles.detailText}>
                  Choose two tournament players. Net with Handicap Difference is the default scoring mode. Match creation, hole-by-hole scoring, save, and reload are wired here.
                </Text>

                <Text style={styles.pickerLabel}>Player A</Text>
                <View style={styles.selectedPlayerPreview}>
                  <Text style={styles.selectedPlayerPreviewName}>{selectedPlayerA?.displayName ?? 'Select Player A'}</Text>
                  <Text style={styles.selectedPlayerPreviewMeta}>
                    Handicap {typeof selectedPlayerA?.handicap === 'number' ? selectedPlayerA.handicap : '—'}
                  </Text>
                </View>
                <View style={styles.playerPickerGrid}>
                  {availablePlayerAOptions.map((player) => {
                    const selected = selectedPlayerAId === player.participantId;
                    return (
                      <Pressable
                        key={`a-${player.participantId}`}
                        onPress={() => {
                          setSelectedPlayerAId(player.participantId);
                          syncHandicapInputs(matchPlayers, player.participantId, selectedPlayerBId);
                        }}
                        style={[styles.playerPickCard, selected ? styles.playerPickCardSelected : null]}
                      >
                        <Text style={[styles.playerPickName, selected ? styles.playerPickNameSelected : null]}>{player.displayName}</Text>
                        <Text style={[styles.playerPickMeta, selected ? styles.playerPickMetaSelected : null]}>
                          Handicap {typeof player.handicap === 'number' ? player.handicap : '—'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.pickerLabel}>Player B</Text>
                <View style={styles.selectedPlayerPreview}>
                  <Text style={styles.selectedPlayerPreviewName}>{selectedPlayerB?.displayName ?? 'Select Player B'}</Text>
                  <Text style={styles.selectedPlayerPreviewMeta}>
                    Handicap {typeof selectedPlayerB?.handicap === 'number' ? selectedPlayerB.handicap : '—'}
                  </Text>
                </View>
                <View style={styles.playerPickerGrid}>
                  {availablePlayerBOptions.map((player) => {
                    const selected = selectedPlayerBId === player.participantId;
                    return (
                      <Pressable
                        key={`b-${player.participantId}`}
                        onPress={() => {
                          setSelectedPlayerBId(player.participantId);
                          syncHandicapInputs(matchPlayers, selectedPlayerAId, player.participantId);
                        }}
                        style={[styles.playerPickCard, selected ? styles.playerPickCardSelected : null]}
                      >
                        <Text style={[styles.playerPickName, selected ? styles.playerPickNameSelected : null]}>{player.displayName}</Text>
                        <Text style={[styles.playerPickMeta, selected ? styles.playerPickMetaSelected : null]}>
                          Handicap {typeof player.handicap === 'number' ? player.handicap : '—'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.modeRow}>
                  <AppButton
                    title="Net Match"
                    onPress={() => setMatchScoringMode('net')}
                    variant={matchScoringMode === 'net' ? 'primary' : 'secondary'}
                    compact
                    style={{ flex: 1 }}
                  />
                  <AppButton
                    title="Gross Match"
                    onPress={() => setMatchScoringMode('gross')}
                    variant={matchScoringMode === 'gross' ? 'primary' : 'secondary'}
                    compact
                    style={{ flex: 1 }}
                  />
                </View>

                <View style={styles.inputRow}>
                  <View style={{ flex: 1 }}>
                    <AppInput
                      label="Player A Handicap"
                      value={playerAHandicapInput}
                      onChangeText={setPlayerAHandicapInput}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppInput
                      label="Player B Handicap"
                      value={playerBHandicapInput}
                      onChangeText={setPlayerBHandicapInput}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>

                <View style={styles.buttonStack}>
                  <AppButton
                    title={creatingMatch ? 'Creating Match…' : 'Create Match'}
                    onPress={createMatch}
                    disabled={creatingMatch || matchPlayers.length < 2}
                  />
                </View>
              </View>
            </View>
            ) : null}

            {bracketMatchPlayFormat ? (
              <View style={styles.detailsStack}>
                <View style={styles.detailBlock}>
                  <Text style={styles.detailLabel}>Bracket Matches</Text>
                  <Text style={styles.detailText}>
                    {bracketMatches.length > 0
                      ? `${bracketMatches.length} bracket match${bracketMatches.length === 1 ? '' : 'es'} created`
                      : 'No bracket has been generated yet.'}
                  </Text>
                </View>
                {Array.from({ length: bracketMaxRound }, (_, index) => index + 1).map((round) => {
                  const roundMatches = bracketMatches.filter((match) => Number(match.bracketRound ?? 0) === round);
                  if (roundMatches.length === 0) return null;
                  return (
                    <View key={`round-${round}`} style={styles.detailBlock}>
                      <Text style={styles.detailLabel}>{matchRoundLabel(round, bracketMaxRound)}</Text>
                      {roundMatches.map((match) => {
                        const isUsersMatch = match.playerA?.userId === user?.id || match.playerB?.userId === user?.id;
                        return (
                          <View key={match.id} style={styles.matchCard}>
                            <Text style={styles.matchTitle}>
                              {match.playerA?.displayName ?? 'Awaiting opponent'} vs {match.playerB?.displayName ?? 'Awaiting opponent'}
                            </Text>
                            <Text style={styles.matchMeta}>
                              {match.playerA && match.playerB ? match.currentStatusLabel : 'Awaiting opponent'}
                            </Text>
                            <Text style={styles.matchMeta}>{match.status ?? 'scheduled'}</Text>
                            {isUsersMatch ? (
                              <AppButton
                                title={
                                  isTournamentMatchScorecardComplete(match)
                                    ? 'View Final Match'
                                    : match.officialMatchComplete
                                      ? 'Resume Scorecard'
                                      : 'Score Match'
                                }
                                onPress={() => router.push(`/tournament/${id}/match/${match.id}`)}
                                compact
                              />
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.buttonStack}>
              <AppButton title="Open Match Play Live Board" onPress={() => router.push(`/tournament/${id}/live`)} variant="secondary" />
              <AppButton title="Back to Tournaments" variant="secondary" onPress={() => router.back()} />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.body}>
              Open the group-first Yardage Book tournament view to see your group at the top and the leaderboard underneath.
            </Text>

            <View style={styles.buttonStack}>
              <AppButton title="Open Tournament Round" onPress={() => router.push(`/tournament/${id}/yardage`)} />
              <AppButton title="Open Live Board" onPress={() => router.push(`/tournament/${id}/live`)} variant="secondary" />
              <AppButton title="Back to Tournaments" variant="secondary" onPress={() => router.back()} />
            </View>
          </>
        )}
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Tournament Details</Text>
        <View style={styles.metaGrid}>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Course</Text>
            <Text style={styles.metaValue}>{courseName}</Text>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Format</Text>
            <Text style={styles.metaValue}>{formatLabel}</Text>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={styles.metaValue}>{item.status || '-'}</Text>
          </View>
        </View>

        {detailBlocks.length > 0 ? (
          <View style={styles.detailsStack}>
            {detailBlocks}
          </View>
        ) : (
          <Text style={styles.body}>
            More tournament details will appear here as the event setup is published.
          </Text>
        )}
      </SectionCard>

      {eventAddOns.length > 0 ? (
        <SectionCard>
          <Text style={styles.sectionTitle}>Event Add-ons</Text>
          <Text style={styles.body}>
            Active event side-games and prize contests for this tournament. This view is read-only in v1.
          </Text>
          <View style={styles.detailsStack}>
            {eventAddOns.map((addOn) => renderEventAddOnCard(addOn))}
          </View>
        </SectionCard>
      ) : null}

      {isStableford ? (
        <SectionCard>
          <Text style={styles.sectionTitle}>Stableford Event</Text>
          <View style={styles.metaGrid}>
            <View style={styles.metaBox}>
              <Text style={styles.metaLabel}>Mode</Text>
              <Text style={styles.metaValue}>{formatStablefordMode(item)}</Text>
            </View>
            <View style={styles.metaBox}>
              <Text style={styles.metaLabel}>Handicap</Text>
              <Text style={styles.metaValue}>
                {formatBooleanLabel(item.handicap_enabled, 'Enabled', 'Disabled')}
              </Text>
            </View>
            <View style={styles.metaBox}>
              <Text style={styles.metaLabel}>Hole Count</Text>
              <Text style={styles.metaValue}>{item.hole_count ?? 18}</Text>
            </View>
            <View style={styles.metaBox}>
              <Text style={styles.metaLabel}>Round Entry</Text>
              <Text style={styles.metaValue}>
                {formatBooleanLabel(item.unlimited_rounds_allowed, 'Unlimited during event window', 'Standard round limit')}
              </Text>
            </View>
            <View style={styles.metaBox}>
              <Text style={styles.metaLabel}>Standings Rule</Text>
              <Text style={styles.metaValue}>{formatBestRoundsLabel(item.best_rounds_count)}</Text>
            </View>
          </View>

          {showSevenDayGuidance ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>What Counts</Text>
              <Text style={styles.detailText}>
                You can post unlimited rounds during the event window, but only your best 4 rounds count toward the standings.
              </Text>
              <Text style={styles.detailText}>
                Any extra rounds beyond your best 4 are treated as dropped rounds and do not add points to your event total.
              </Text>
            </View>
          ) : null}

          {showModifiedPreset ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailLabel}>Modified Stableford</Text>
              <Text style={styles.detailText}>{CLUB_DEFAULT_MODIFIED_PRESET}</Text>
            </View>
          ) : null}

          {specialHoleRules.length > 0 ? (
            <View style={styles.detailsStack}>
              {specialHoleRules.map((rule) => (
                <View key={rule.key} style={styles.detailBlock}>
                  <Text style={styles.detailLabel}>{rule.label}</Text>
                  <Text style={styles.detailText}>{rule.value}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {showSevenDayGuidance ? (
            <View style={styles.detailsStack}>
              <View style={styles.detailBlock}>
                <Text style={styles.detailLabel}>7-Day Rules</Text>
                <Text style={styles.detailText}>
                  Unlimited rounds are allowed during the event window.
                </Text>
                <Text style={styles.detailText}>
                  Only your best 4 rounds count toward the standings.
                </Text>
                <Text style={styles.detailText}>
                  Dropped rounds stay in your history but do not count toward your event total.
                </Text>
                <Text style={styles.detailText}>
                  Hole 6 must always be holed out and actual strokes recorded.
                </Text>
                <Text style={styles.detailText}>
                  Hole 6 tally results stay hidden until the event window ends.
                </Text>
              </View>
            </View>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard>
        <Text style={styles.sectionTitle}>Tournament info</Text>
        <View style={styles.metaGrid}>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Invite Code</Text>
            <Text style={styles.metaValue}>{item.invite_code || '-'}</Text>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Scoring</Text>
            <Text style={styles.metaValue}>{item.live_scoring_mode || '-'}</Text>
          </View>
        </View>
      </SectionCard>
    </ScrollView>
    </BrandedScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  bodyWrap: { flex: 1, padding: 16 },
  content: { gap: 16, paddingBottom: 24 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', color: '#8b7447' },
  title: { fontSize: 28, fontWeight: '800', color: '#132117', marginTop: 8 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: '#132117' },
  subtitle: { fontSize: 15, color: '#5a6b61', marginTop: 8 },
  body: { fontSize: 15, color: '#425247', lineHeight: 22, marginTop: 12 },
  emptyTitle: { fontSize: 22, fontWeight: '800', color: '#132117' },
  buttonStack: { gap: 12, marginTop: 16 },
  metaGrid: { gap: 12, marginTop: 14 },
  metaBox: { backgroundColor: '#f7f3ea', borderRadius: 14, padding: 14 },
  metaLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase', color: '#8b8a84' },
  metaValue: { fontSize: 17, fontWeight: '800', color: '#132117', marginTop: 6 },
  detailsStack: { gap: 12, marginTop: 16 },
  detailBlock: { backgroundColor: '#f7f3ea', borderRadius: 14, padding: 14 },
  detailLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase', color: '#8b8a84' },
  detailText: { fontSize: 15, color: '#425247', lineHeight: 22, marginTop: 8 },
  matchCard: { backgroundColor: '#f7f3ea', borderRadius: 14, padding: 14, gap: 8 },
  matchTitle: { fontSize: 18, fontWeight: '800', color: '#132117' },
  matchMeta: { fontSize: 14, color: '#425247' },
  pickerLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1.0, textTransform: 'uppercase', color: '#8b8a84', marginTop: 14, marginBottom: 8 },
  selectedPlayerPreview: {
    backgroundColor: '#f7f3ea',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e1d9ca',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  selectedPlayerPreviewName: { fontSize: 15, fontWeight: '800', color: '#132117' },
  selectedPlayerPreviewMeta: { fontSize: 13, color: '#5a6b61', marginTop: 2 },
  playerPickerGrid: { gap: 10 },
  playerPickCard: { backgroundColor: '#fffdf8', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#d8d1c4' },
  playerPickCardSelected: { backgroundColor: '#18341d', borderColor: '#18341d' },
  playerPickCardDisabled: { opacity: 0.45 },
  playerPickName: { fontSize: 16, fontWeight: '700', color: '#132117' },
  playerPickNameSelected: { color: '#fff' },
  playerPickMeta: { fontSize: 13, color: '#5a6b61', marginTop: 4 },
  playerPickMetaSelected: { color: '#dfe9de' },
  modeRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  inputRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
});
