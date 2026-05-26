import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BrandedScreen } from '@/components/BrandedScreen';
import { AppButton } from '@/components/ui/AppButton';
import { TournamentQuickNav } from '@/components/navigation/TournamentQuickNav';
import { SectionCard } from '@/components/ui/SectionCard';
import { useAuth } from '@/providers/AuthProvider';
import { buildStrokeCompetitionResults } from '@/lib/tournamentCompetitionResults';
import { formatTournamentFormatLabel, isMatchPlayTournamentFormat, isTeamTournamentFormat } from '@/lib/tournamentFormats';
import {
  currentUserCanScoreMatch,
  filterLeaderboardRowsForFormat,
  hasTournamentMatchStarted,
  getTournamentForUser,
  getTournamentLiveLeaderboard,
  isTournamentMatchScorecardComplete,
  listTournamentMatchHoles,
  listTournamentMatches,
  getTournamentPlayerHandicapMap,
  resolveTournamentMatchResumeHole,
  getTournamentStablefordHoleTallies,
  getTournamentStablefordStandings,
  leaderboardRowIdentity,
  type TournamentLeaderboardRow,
  type TournamentMatchResumeHoleState,
  type TournamentMatchSummary,
  type TournamentStablefordHoleTalliesResult,
  type TournamentStablefordHoleTallyRow,
  type TournamentStablefordStandingsRow,
} from '@/lib/tournaments';
import { holes as courseHoles } from '@/constants/course';

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

function stablefordPlayerName(row: TournamentStablefordStandingsRow | TournamentStablefordHoleTallyRow) {
  if (row.display_name?.trim()) return row.display_name.trim();
  return `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Unnamed entry';
}

function isSevenDayStablefordProfile(tournament: any | null) {
  return tournament?.scoring_format === 'stableford'
    && (
      tournament?.event_template === 'stableford_7_day'
      || (
        tournament?.unlimited_rounds_allowed === true
        && tournament?.best_rounds_count === 4
      )
    );
}

function standingsHelpText(tournament: any | null) {
  const bestRoundsCount = Number(tournament?.best_rounds_count ?? 0);
  if (isSevenDayStablefordProfile(tournament)) {
    return 'Unlimited rounds are allowed during the event window. Only your best 4 rounds count toward the standings, and any extra rounds are shown as dropped rounds.';
  }
  if (bestRoundsCount > 0) {
    return `Only your best ${bestRoundsCount} rounds count toward the standings. Lower rounds are shown as dropped rounds.`;
  }
  return 'Standings are based on the Stableford points from every submitted counting round.';
}

function holeTallyHelpText(tournament: any | null) {
  if (isSevenDayStablefordProfile(tournament)) {
    return 'Hole 6 uses actual strokes, not Stableford points. All-round totals include every submitted round, while counting-round totals include only the rounds currently counting toward your best 4.';
  }
  return 'Special-hole totals use actual strokes from submitted rounds. Counting-round totals include only the rounds currently used in the standings.';
}

function LeaderRow({ row, useFlightRank }: { row: TournamentLeaderboardRow; useFlightRank: boolean }) {
  const toPar = formatToPar(row.current_total_score, row.last_hole_entered);

  return (
    <View style={styles.rowCard}>
      <View style={styles.rowLeft}>
        <View style={styles.rankBubble}>
          <Text style={styles.rankText}>{useFlightRank ? row.flight_rank : row.overall_rank}</Text>
        </View>
        <View style={{ flex: 1 }}>
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

function StablefordLeaderRow({ row }: { row: TournamentStablefordStandingsRow }) {
  return (
    <View style={styles.rowCard}>
      <View style={styles.rowLeft}>
        <View style={styles.rankBubble}>
          <Text style={styles.rankText}>{row.overall_rank ?? '-'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.playerName}>{stablefordPlayerName(row)}</Text>
          <Text style={styles.rowMeta}>
            Counting rounds used: {row.counting_rounds_count ?? 0}
            {typeof row.dropped_rounds_count === 'number' && row.dropped_rounds_count > 0
              ? ` · Dropped rounds not counting: ${row.dropped_rounds_count}`
              : ''}
          </Text>
        </View>
      </View>

      <View style={styles.rowRight}>
        <Text style={styles.scoreText}>{row.stableford_points_total ?? 0}</Text>
        <Text style={styles.rowMeta}>Stableford points total</Text>
        <Text style={styles.lastHole}>Best single counting round: {row.best_counting_round_total ?? '-'}</Text>
      </View>
    </View>
  );
}

function StablefordHoleTallyRowCard({ row }: { row: TournamentStablefordHoleTallyRow }) {
  return (
    <View style={styles.rowCard}>
      <View style={styles.rowLeft}>
        <View style={styles.rankBubble}>
          <Text style={styles.rankText}>{row.overall_rank ?? '-'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.playerName}>{stablefordPlayerName(row)}</Text>
          <Text style={styles.rowMeta}>{row.stableford_points_total ?? 0} Stableford points</Text>
        </View>
      </View>

      <View style={styles.rowRight}>
        <Text style={styles.scoreText}>{row.all_rounds_stroke_total ?? 0}</Text>
        <Text style={styles.rowMeta}>All rounds strokes</Text>
        <Text style={styles.lastHole}>Counting rounds: {row.counting_rounds_stroke_total ?? 0}</Text>
      </View>
    </View>
  );
}

function isActiveMatchPlayCompetition(competition: any) {
  if (!competition?.is_active) return false;
  return competition.scoring_format === 'match_play'
    || competition.competition_key === 'match_play'
    || competition.competition_key === 'singles_match_play'
    || competition.competition_key === 'match_play_bracket';
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

export default function TournamentLiveBoardScreen() {
  const { id, matchId: routeMatchId, hole: routeHole } = useLocalSearchParams<{ id: string; matchId?: string; hole?: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tournament, setTournament] = useState<any | null>(null);
  const [rows, setRows] = useState<TournamentLeaderboardRow[]>([]);
  const [matches, setMatches] = useState<TournamentMatchSummary[]>([]);
  const [playerHandicapMap, setPlayerHandicapMap] = useState<Record<string, number | null>>({});
  const [stablefordStandings, setStablefordStandings] = useState<TournamentStablefordStandingsRow[]>([]);
  const [stablefordHoleTallies, setStablefordHoleTallies] = useState<TournamentStablefordHoleTalliesResult>({
    is_visible: false,
    hidden_reason: null,
    hole_number: 6,
    tallies: [],
  });
  const [resumeHoleState, setResumeHoleState] = useState<TournamentMatchResumeHoleState | null>(null);

  const load = useCallback(async () => {
    if (!user?.id || !id) {
      setTournament(null);
      setRows([]);
      setMatches([]);
      setLoading(false);
      return;
    }

    try {
      const [tournamentData, leaderboard, handicapMap] = await Promise.all([
        getTournamentForUser(user.id, id),
        getTournamentLiveLeaderboard(id),
        getTournamentPlayerHandicapMap(id),
      ]);

      const hasMatchPlayCompetitions = (tournamentData?.competitions ?? []).some((competition: any) => isActiveMatchPlayCompetition(competition));
      const tournamentMatches = hasMatchPlayCompetitions || isMatchPlayTournamentFormat(tournamentData?.format_type)
        ? await listTournamentMatches(id)
        : [];

      const stablefordData =
        tournamentData?.scoring_format === 'stableford'
          ? await Promise.all([
              getTournamentStablefordStandings(id),
              getTournamentStablefordHoleTallies(tournamentData, 6),
            ])
          : null;

      setTournament(tournamentData);
      setRows(filterLeaderboardRowsForFormat(leaderboard, tournamentData?.format_type));
      setMatches(tournamentMatches);
      setPlayerHandicapMap(handicapMap);
      setStablefordStandings(stablefordData?.[0] ?? []);
      setStablefordHoleTallies(stablefordData?.[1] ?? {
        is_visible: false,
        hidden_reason: null,
        hole_number: 6,
        tallies: [],
      });
    } catch (error: any) {
      console.error(error?.message ?? 'Failed to load live board');
      setTournament(null);
      setRows([]);
      setMatches([]);
      setPlayerHandicapMap({});
      setStablefordStandings([]);
      setStablefordHoleTallies({
        is_visible: false,
        hidden_reason: null,
        hole_number: 6,
        tallies: [],
      });
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

  const hasFlights = grouped.length > 1 || (grouped.length === 1 && grouped[0][0] !== 'Overall');
  const teamFormat = isTeamTournamentFormat(tournament?.format_type);
  const hasMatchPlayCompetitions = (tournament?.competitions ?? []).some((competition: any) => isActiveMatchPlayCompetition(competition));
  const matchPlayFormat = isMatchPlayTournamentFormat(tournament?.format_type) || hasMatchPlayCompetitions;
  const stablefordFormat = tournament?.scoring_format === 'stableford';
  const singlesMatches = matches.filter((match) => match.matchType === 'singles');
  const bracketMatches = matches.filter((match) => match.matchType === 'bracket');
  const bracketMaxRound = bracketMatches.reduce((max, match) => Math.max(max, Number(match.bracketRound ?? 0)), 0);
  const strokeCompetitionResults = buildStrokeCompetitionResults({
    competitions: tournament?.competitions ?? [],
    leaderboardRows: rows,
    handicapByUserId: playerHandicapMap,
  });
  const resumeMatch = useMemo(() => {
    const normalizedRouteMatchId = typeof routeMatchId === 'string' && routeMatchId.trim() ? routeMatchId.trim() : null;
    const byId = new Map(matches.map((match) => [match.id, match]));
    if (normalizedRouteMatchId && byId.has(normalizedRouteMatchId)) {
      return byId.get(normalizedRouteMatchId) ?? null;
    }

    const currentUserId = user?.id ?? null;
    if (!currentUserId) return null;

    const candidateMatches = matches
      .filter((match) => match.playerA?.userId === currentUserId || match.playerB?.userId === currentUserId)
      .sort((a, b) => {
        const completionDiff = Number(isTournamentMatchScorecardComplete(a)) - Number(isTournamentMatchScorecardComplete(b));
        if (completionDiff !== 0) return completionDiff;
        const startedDiff = Number(hasTournamentMatchStarted(b)) - Number(hasTournamentMatchStarted(a));
        if (startedDiff !== 0) return startedDiff;
        const priority = (status: string | null | undefined) => {
          switch ((status ?? '').toLowerCase()) {
            case 'active':
              return 0;
            case 'scheduled':
              return 1;
            case 'complete':
            case 'conceded':
            case 'tied':
              return 2;
            default:
              return 3;
          }
        };
        const priorityDiff = priority(a.status) - priority(b.status);
        if (priorityDiff !== 0) return priorityDiff;
        return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));
      });

    return candidateMatches[0] ?? null;
  }, [matches, routeMatchId, user?.id]);
  const resumeMatchStarted = hasTournamentMatchStarted(resumeMatch);

  const parsedRouteHole = useMemo(() => {
    const numeric = Number(routeHole);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= 18 ? numeric : null;
  }, [routeHole]);

  useEffect(() => {
    let cancelled = false;

    const resolveResumeHole = async () => {
      if (!resumeMatch?.id) {
        if (!cancelled) setResumeHoleState(null);
        return;
      }

      try {
        const savedHoles = await listTournamentMatchHoles(resumeMatch.id);
        const nextState = resolveTournamentMatchResumeHole({
          preferredHole: parsedRouteHole,
          holes: savedHoles,
          isMatchComplete:
            resumeMatch.status === 'complete'
            || resumeMatch.status === 'tied'
            || !!resumeMatch.finalResultLabel
            || !!resumeMatch.winnerParticipantId,
        });

        console.info('[match-play-resume-hole-debug]', {
          matchId: resumeMatch.id,
          routeHole: parsedRouteHole,
          savedHoleNumbers: nextState.savedHoleNumbers,
          resolvedResumeHole: nextState.resolvedResumeHole,
          isMatchComplete: nextState.isMatchComplete,
          source: nextState.source,
        });

        if (!cancelled) setResumeHoleState(nextState);
      } catch (error: any) {
        console.warn(error?.message ?? 'Failed to resolve match resume hole');
        if (!cancelled) {
          const fallbackState = resolveTournamentMatchResumeHole({
            preferredHole: parsedRouteHole,
            holes: [],
            isMatchComplete:
              resumeMatch.status === 'complete'
              || resumeMatch.status === 'tied'
              || !!resumeMatch.finalResultLabel
              || !!resumeMatch.winnerParticipantId,
          });
          console.info('[match-play-resume-hole-debug]', {
            matchId: resumeMatch.id,
            routeHole: parsedRouteHole,
            savedHoleNumbers: fallbackState.savedHoleNumbers,
            resolvedResumeHole: fallbackState.resolvedResumeHole,
            isMatchComplete: fallbackState.isMatchComplete,
            source: `${fallbackState.source}_fallback`,
          });
          setResumeHoleState(fallbackState);
        }
      }
    };

    void resolveResumeHole();

    return () => {
      cancelled = true;
    };
  }, [parsedRouteHole, resumeMatch]);

  useEffect(() => {
    console.info('[match-play-live-resume-debug]', {
      tournamentId: id ?? null,
      routeMatchId: typeof routeMatchId === 'string' ? routeMatchId : null,
      resolvedMatchId: resumeMatch?.id ?? null,
      currentUserId: user?.id ?? null,
      matchStatus: resumeMatch?.status ?? null,
      resumeHref: resumeMatch
        ? `/tournament/${id}/match/${resumeMatch.id}${resumeHoleState?.resolvedResumeHole ? `?hole=${resumeHoleState.resolvedResumeHole}` : ''}`
        : null,
    });
  }, [id, resumeHoleState?.resolvedResumeHole, resumeMatch, routeMatchId, user?.id]);

  if (loading) {
    return (
      <BrandedScreen screenName="TournamentLiveBoardScreen-loading" scroll={false}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#18341d" />
        </View>
      </BrandedScreen>
    );
  }

  return (
    <BrandedScreen screenName="TournamentLiveBoardScreen" scroll={false} bodyStyle={styles.bodyWrap}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
      <SectionCard>
        <Text style={styles.eyebrow}>Live Board</Text>
        <Text style={styles.title}>{tournament?.name ?? 'Tournament'}</Text>
        <Text style={styles.subtitle}>
          {stablefordFormat
            ? 'Stableford events show event standings based on backend counting-round results.'
            : 'Scores are shown relative to par, like -2, E, or +4.'}
        </Text>

        <View style={styles.headerBadgeRow}>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{formatTournamentFormatLabel(tournament?.format_type)}</Text>
          </View>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{tournament?.status ?? 'Active'}</Text>
          </View>
        </View>

        <View style={styles.buttonRow}>
          <AppButton
            title="Back to Tournament"
            onPress={() => router.push(`/tournament/${id}/yardage`)}
            variant="secondary"
            style={{ flex: 1 }}
          />
          {resumeMatch ? (
            <AppButton
              title={
                isTournamentMatchScorecardComplete(resumeMatch)
                  ? 'View Final Match'
                  : !currentUserCanScoreMatch(resumeMatch, user?.id)
                    ? 'View Match'
                    : !resumeMatchStarted
                      ? 'Start Match'
                  : routeMatchId
                    ? 'Back to Match Scoring'
                    : 'Resume Match'
              }
              onPress={() => router.push(`/tournament/${id}/match/${resumeMatch.id}${resumeHoleState?.resolvedResumeHole ? `?hole=${resumeHoleState.resolvedResumeHole}` : ''}`)}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
      </SectionCard>

      {matchPlayFormat ? (
        <>
          {singlesMatches.length > 0 ? (
            <SectionCard>
              <Text style={styles.sectionLabel}>Singles Match Play</Text>
              <Text style={styles.sectionTitle}>Current matches</Text>
              <View style={styles.stack}>
                {singlesMatches.map((match) => (
                  <View key={match.id} style={styles.rowCard}>
                    <View style={styles.rowLeft}>
                      <View style={styles.rankBubble}>
                        <Text style={styles.rankText}>M</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.playerName}>
                          {match.playerA?.displayName ?? 'Player A'} vs {match.playerB?.displayName ?? 'Player B'}
                        </Text>
                        <Text style={styles.rowMeta}>{match.currentStatusLabel}</Text>
                      </View>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={styles.scoreText}>{match.finalResultLabel ?? 'Live'}</Text>
                      <Text style={styles.rowMeta}>{match.status ?? 'scheduled'}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </SectionCard>
          ) : null}

          {bracketMatches.length > 0 ? (
            <SectionCard>
              <Text style={styles.sectionLabel}>Match Play Bracket</Text>
              <Text style={styles.sectionTitle}>Bracket progress</Text>
              <View style={styles.stack}>
                {Array.from({ length: bracketMaxRound }, (_, index) => index + 1).map((round) => {
                  const roundMatches = bracketMatches.filter((match) => Number(match.bracketRound ?? 0) === round);
                  if (roundMatches.length === 0) return null;
                  return (
                    <View key={`round-${round}`} style={styles.detailBlock}>
                      <Text style={styles.detailLabel}>{matchRoundLabel(round, bracketMaxRound)}</Text>
                      {roundMatches.map((match) => (
                        <View key={match.id} style={styles.matchCard}>
                          <Text style={styles.matchTitle}>
                            {match.playerA?.displayName ?? 'Awaiting opponent'} vs {match.playerB?.displayName ?? 'Awaiting opponent'}
                          </Text>
                          <Text style={styles.matchMeta}>
                            {match.playerA && match.playerB ? match.currentStatusLabel : 'Awaiting opponent'}
                          </Text>
                          <Text style={styles.matchMeta}>{match.status ?? 'scheduled'}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })}
              </View>
            </SectionCard>
          ) : null}

          {singlesMatches.length === 0 && bracketMatches.length === 0 ? (
            <SectionCard>
              <Text style={styles.sectionLabel}>Match Play</Text>
              <Text style={styles.sectionTitle}>No matches have been created yet.</Text>
              <Text style={styles.body}>
                Create matches or generate a bracket from tournament Competitions to begin posting results here.
              </Text>
            </SectionCard>
          ) : null}
        </>
      ) : stablefordFormat ? (
        <>
          <SectionCard>
            <Text style={styles.sectionLabel}>Stableford Standings</Text>
            <Text style={styles.sectionTitle}>Tournament Points Board</Text>
            <Text style={styles.subtitle}>
              {standingsHelpText(tournament)}
            </Text>
            <View style={styles.stack}>
              {stablefordStandings.length > 0 ? (
                stablefordStandings.map((row) => (
                  <StablefordLeaderRow key={`stableford-${row.user_id}`} row={row} />
                ))
              ) : (
                <Text style={styles.subtitle}>
                  No Stableford standings are available yet. Submit your first round to start building your event total.
                </Text>
              )}
            </View>
            {stablefordFormat && typeof tournament?.best_rounds_count === 'number' && tournament.best_rounds_count > 1 ? (
              <Text style={styles.helperNote}>
                If you have fewer than {tournament.best_rounds_count} completed rounds, your standings total is based only on the counting rounds you have submitted so far.
              </Text>
            ) : null}
          </SectionCard>

          <SectionCard>
            <Text style={styles.sectionLabel}>Hole 6 Tally</Text>
            <Text style={styles.sectionTitle}>Special Hole Stroke Totals</Text>
            {stablefordHoleTallies.is_visible ? (
              <>
                <Text style={styles.subtitle}>
                  {holeTallyHelpText(tournament)}
                </Text>
                <View style={styles.stack}>
                  {stablefordHoleTallies.tallies.length > 0 ? (
                    stablefordHoleTallies.tallies.map((row) => (
                      <StablefordHoleTallyRowCard key={`hole6-${row.user_id}`} row={row} />
                    ))
                  ) : (
                    <Text style={styles.subtitle}>
                      No Hole 6 tally data is available yet. Hole 6 totals will appear after submitted rounds include a completed Hole 6 score.
                    </Text>
                  )}
                </View>
              </>
            ) : (
              <Text style={styles.subtitle}>
                {stablefordHoleTallies.hidden_reason ?? 'Hole 6 tallies are hidden right now.'}
              </Text>
            )}
          </SectionCard>
        </>
      ) : strokeCompetitionResults.length > 0 ? (
        <>
          {strokeCompetitionResults.map((competition) => (
            <SectionCard key={competition.competitionId}>
              <Text style={styles.sectionLabel}>Competition</Text>
              <Text style={styles.sectionTitle}>{competition.competitionName}</Text>
              <Text style={styles.subtitle}>
                Stroke Play · {competition.handicapMode === 'net' ? 'Net' : 'Gross'} · All 18 Holes
              </Text>
              {competition.state === 'ready' ? (
                <View style={styles.stack}>
                  {competition.rows.map((row) => (
                    <View key={`${competition.competitionId}-${row.rank}-${row.name}`} style={styles.rowCard}>
                      <View style={styles.rowLeft}>
                        <View style={styles.rankBubble}>
                          <Text style={styles.rankText}>{row.rank}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.playerName}>{row.name}</Text>
                          <Text style={styles.rowMeta}>
                            {row.leaderboardStatus}
                            {competition.handicapMode === 'net' ? ` · Gross ${row.grossTotal} · Handicap ${row.adjustedHandicap ?? 0}` : ''}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.rowRight}>
                        <Text style={styles.scoreText}>{row.total}</Text>
                        <Text style={styles.rowMeta}>{row.thruLabel}</Text>
                        <Text style={styles.lastHole}>Last hole entered: {row.lastHoleEntered ?? '-'}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.subtitle}>{competition.message}</Text>
              )}
            </SectionCard>
          ))}

          {rows.length === 0 ? (
            <SectionCard>
              <Text style={styles.sectionLabel}>Leaderboard</Text>
              <Text style={styles.sectionTitle}>No live rows yet</Text>
              <Text style={styles.subtitle}>
                Once scores sync, {teamFormat ? 'teams' : 'players'} will appear here with to-par scoring.
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
        </>
      ) : rows.length === 0 ? (
        <SectionCard>
          <Text style={styles.sectionLabel}>Leaderboard</Text>
          <Text style={styles.sectionTitle}>No live rows yet</Text>
          <Text style={styles.subtitle}>
            Once scores sync, {teamFormat ? 'teams' : 'players'} will appear here with to-par scoring.
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
  headerBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  headerBadge: { backgroundColor: '#eef3ec', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  headerBadgeText: { fontSize: 12, fontWeight: '800', color: '#18341d', textTransform: 'uppercase', letterSpacing: 0.8 },
  buttonRow: { marginTop: 16, flexDirection: 'row', gap: 12 },
  stack: { gap: 12, marginTop: 14 },
  helperNote: { fontSize: 13, color: '#5a6b61', lineHeight: 19, marginTop: 12 },
  detailBlock: {
    marginTop: 6,
    backgroundColor: '#f7f3ea',
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#8b7447',
  },
  matchCard: {
    backgroundColor: '#fffdf8',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e1d9ca',
    padding: 12,
    gap: 4,
  },
  matchTitle: { fontSize: 15, fontWeight: '800', color: '#132117' },
  matchMeta: { fontSize: 13, color: '#5a6b61' },
  rowCard: {
    backgroundColor: '#f7f3ea',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  rowRight: { alignItems: 'flex-end' },
  rankBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fffdf8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { fontSize: 14, fontWeight: '800', color: '#132117' },
  playerName: { fontSize: 16, fontWeight: '800', color: '#132117' },
  scoreText: { fontSize: 22, fontWeight: '800', color: '#132117' },
  rowMeta: { fontSize: 13, color: '#5a6b61', marginTop: 2 },
  lastHole: { fontSize: 11, fontWeight: '700', color: '#8b8a84', marginTop: 4, textTransform: 'uppercase' },
});
