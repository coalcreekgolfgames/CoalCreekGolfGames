import AsyncStorage from '@react-native-async-storage/async-storage'
import type { GolfCanadaPostingPrep } from '@/lib/golfCanada'
import { supabase } from '@/lib/supabase'
import {
  buildDefaultMatchPlayHoleDefinitions,
  calculateMatchHoleResult,
  calculateStrokesReceivedForMatch,
  scoreMatchPlayCard,
} from '@/lib/tournaments/matchPlay'
import { isTeamTournamentFormat } from '@/lib/tournamentFormats'
import type {
  GolfCanadaPostingRecord,
  MatchPlayConcededBy,
  MatchPlayConcessionType,
  MatchPlayHandicapMode,
  MatchPlayScoringMode,
  MatchPlayTieHandling,
  TournamentFormatType,
} from '@/types/round'

const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4]
const FULL_COURSE_PAR = PARS.reduce((sum, value) => sum + value, 0)
const MATCH_PLAY_GOLF_CANADA_POSTINGS_KEY = 'coal_creek_match_play_golf_canada_postings_v1'
const DEFAULT_MATCH_PLAY_COURSE_NAME = 'Coal Creek Golf Resort'

export type TournamentLeaderboardRow = {
  tournament_id: string
  entity_type?: string | null
  entity_id?: string | null
  user_id?: string | null
  team_id?: string | null
  first_name?: string | null
  last_name?: string | null
  display_name?: string | null
  flight_name: string
  rounds_started?: number | null
  current_total_score: number | null
  last_hole_entered: number | null
  thru_label: string
  leaderboard_status: string
  overall_rank: number
  flight_rank: number
}

export type TournamentStablefordStandingsRow = {
  tournament_id: string
  user_id: string
  tournament_name?: string | null
  event_template?: string | null
  best_rounds_count?: number | null
  unlimited_rounds_allowed?: boolean | null
  first_name?: string | null
  last_name?: string | null
  display_name?: string | null
  submitted_rounds_count?: number | null
  counting_rounds_count?: number | null
  dropped_rounds_count?: number | null
  stableford_points_total?: number | null
  best_counting_round_total?: number | null
  overall_rank?: number | null
}

export type TournamentStablefordHoleTallyRow = {
  tournament_id: string
  user_id: string
  first_name?: string | null
  last_name?: string | null
  display_name?: string | null
  overall_rank?: number | null
  stableford_points_total?: number | null
  standing_counting_rounds_count?: number | null
  hole_number: number
  all_rounds_count?: number | null
  all_rounds_stroke_total?: number | null
  counting_rounds_count?: number | null
  counting_rounds_stroke_total?: number | null
}

export type TournamentStablefordHoleTalliesResult = {
  is_visible: boolean
  hidden_reason: string | null
  hole_number: number
  tallies: TournamentStablefordHoleTallyRow[]
}

export type TournamentForUser = {
  id: string
  name?: string | null
  description?: string | null
  start_date?: string | null
  end_date?: string | null
  status?: string | null
  invite_code?: string | null
  confirmation_rule?: string | null
  format_type?: string | null
  round_acceptance_rule?: string | null
  live_scoring_mode?: string | null
  leaderboard_visibility?: string | null
  birdie_pot_enabled?: boolean | null
  course_name?: string | null
  format_label?: string | null
  rules?: string | null
  check_in_info?: string | null
  prizing_notes?: string | null
  sponsor_notes?: string | null
  public_notes?: string | null
  event_template?: string | null
  scoring_format?: string | null
  stableford_mode?: string | null
  stableford_modified_preset?: string | null
  handicap_enabled?: boolean | null
  hole_count?: number | null
  unlimited_rounds_allowed?: boolean | null
  best_rounds_count?: number | null
  reveal_special_hole_tallies_after_event?: boolean | null
  special_hole_rules?: TournamentSpecialHoleRule[]
  event_add_ons?: TournamentEventAddOnForUser[]
  competitions?: TournamentCompetitionForUser[]
}

export type TournamentTodayItem = Pick<
  TournamentForUser,
  'id' | 'name' | 'start_date' | 'end_date' | 'status' | 'format_type' | 'scoring_format'
>

export type TournamentCompetitionForUser = {
  id: string
  tournament_id: string
  name: string
  description?: string | null
  competition_key: string
  scoring_format: string
  competition_scope: string
  competition_type?: string | null
  scope?: string | null
  handicap_mode: string
  handicap_allowance?: number | null
  holes_mode: string
  hole_start?: number | null
  hole_end?: number | null
  leaderboard_limit?: number | null
  sort_order: number
  is_active: boolean
}

const TOURNAMENT_COMPETITION_SELECT_COLUMNS =
  'id, tournament_id, name, description, competition_key, scoring_format, competition_scope, team_size, balls_to_count, holes_mode, hole_start, hole_end, handicap_mode, handicap_allowance, tiebreaker_mode, points_mode, purse_mode, leaderboard_limit, config_json, sort_order, is_active, created_at, updated_at'

function normalizeTournamentCompetitionForUser(row: any): TournamentCompetitionForUser {
  const scoringFormat = String(row?.scoring_format ?? row?.competition_type ?? '')
  const competitionScope = String(row?.competition_scope ?? row?.scope ?? '')

  return {
    id: String(row?.id ?? ''),
    tournament_id: String(row?.tournament_id ?? ''),
    name: String(row?.name ?? ''),
    description: typeof row?.description === 'string' ? row.description : null,
    competition_key: String(row?.competition_key ?? ''),
    scoring_format: scoringFormat,
    competition_scope: competitionScope,
    competition_type: scoringFormat || null,
    scope: competitionScope || null,
    handicap_mode: String(row?.handicap_mode ?? 'none'),
    handicap_allowance: typeof row?.handicap_allowance === 'number' ? row.handicap_allowance : null,
    holes_mode: String(row?.holes_mode ?? 'full_round'),
    hole_start: typeof row?.hole_start === 'number' ? row.hole_start : null,
    hole_end: typeof row?.hole_end === 'number' ? row.hole_end : null,
    leaderboard_limit: typeof row?.leaderboard_limit === 'number' ? row.leaderboard_limit : null,
    sort_order: typeof row?.sort_order === 'number' ? row.sort_order : 0,
    is_active: row?.is_active !== false,
  }
}

export type TournamentSpecialHoleRule = {
  hole_number: number
  must_hole_out?: boolean | null
  track_stroke_tally?: boolean | null
}

export type TournamentEventAddOnType =
  | 'birdie_pot'
  | 'closest_to_pin_prize'
  | 'closest_to_pin_pot'
  | 'longest_drive'
  | 'ball_in_sand'
  | 'ball_in_water'
  | 'hit_the_dozer'

export type TournamentEventAddOnResultMode =
  | 'score_detected'
  | 'manual_winner'
  | 'qualifier_draw'
  | 'qualifier_paid'

export type TournamentEventAddOnPerson = {
  id: string
  tournament_player_id?: string | null
  user_id: string
  first_name?: string | null
  last_name?: string | null
  display_name: string
  notes?: string | null
}

export type TournamentEventAddOnForUser = {
  id: string
  add_on_type: TournamentEventAddOnType
  name: string
  enabled: boolean
  result_mode: TournamentEventAddOnResultMode
  buy_in_amount?: number | null
  config_json?: Record<string, any> | null
  hole_numbers: number[]
  target_description?: string | null
  current_user_entered: boolean
  entered_player_count: number
  qualifiers: TournamentEventAddOnPerson[]
  winners: TournamentEventAddOnPerson[]
}

export type TournamentMatchPlayerOption = {
  participantId: string
  userId: string | null
  displayName: string
  firstName?: string | null
  lastName?: string | null
  handicap?: number | null
}

export type TournamentMatchSummary = {
  id: string
  tournamentId: string
  status: string
  matchType: string
  bracketRound?: number | null
  bracketPosition?: number | null
  scoringMode: MatchPlayScoringMode
  handicapMode: MatchPlayHandicapMode
  tieHandling: MatchPlayTieHandling
  playerA: TournamentMatchPlayerOption | null
  playerB: TournamentMatchPlayerOption | null
  playerAPlayingHandicap: number | null
  playerBPlayingHandicap: number | null
  currentLeaderParticipantId: string | null
  currentMargin: number | null
  holesRemaining: number | null
  finalResultLabel: string | null
  winnerParticipantId: string | null
  savedHoleCount?: number
  scorecardSavedHoleCount?: number
  decisiveHoleNumber?: number | null
  officialMatchComplete?: boolean
  scorecardComplete?: boolean
  finishedAt?: string | null
  updatedAt: string | null
  createdAt: string | null
  currentStatusLabel: string
}

export type CurrentUserMatchPlayNotification = {
  tournamentId: string
  tournamentName: string
  tournamentStatus: string | null
  matchId: string
  matchType: string
  playerAName: string
  playerBName: string
  currentStatusLabel: string
  officialMatchComplete: boolean
  scorecardComplete: boolean
  finishedAt: string | null
  resumeHole: number
  updatedAt: string | null
}

export type CurrentUserMatchPlayHomeState = {
  activeNotifications: CurrentUserMatchPlayNotification[]
  completedTournamentIds: string[]
}

export type TournamentMatchPlayHistoryItem = {
  key: string
  matchId: string
  tournamentId: string
  tournamentName: string
  opponentName: string
  resultLabel: string
  date: string
  grossTotal: number | null
  savedHoleCount: number
  currentUserSide: 'a' | 'b'
  finishedAt: string | null
  sortTimestamp: string
}

export type TournamentMatchHoleRecord = {
  id: string
  matchId: string
  holeNumber: number
  par: number | null
  strokeIndex: number | null
  playerAGross: number | null
  playerBGross: number | null
  playerAStrokesReceived: number | null
  playerBStrokesReceived: number | null
  playerANet: number | null
  playerBNet: number | null
  holeResult: 'a' | 'b' | 'halved' | null
  concessionType: MatchPlayConcessionType | null
  matchStatusAfterHole: string | null
  updatedAt: string | null
}

export type TournamentMatchResumeHoleState = {
  savedHoleNumbers: number[]
  resolvedResumeHole: number | null
  isMatchComplete: boolean
  source: string
}

type TournamentMatchRow = {
  id: string
  tournament_id: string
  bracket_round?: number | null
  bracket_position?: number | null
  match_type?: string | null
  status?: string | null
  player_a_participant_id?: string | null
  player_b_participant_id?: string | null
  player_a_playing_handicap?: number | null
  player_b_playing_handicap?: number | null
  scoring_mode?: MatchPlayScoringMode | null
  handicap_mode?: MatchPlayHandicapMode | null
  tie_handling?: MatchPlayTieHandling | null
  winner_participant_id?: string | null
  current_leader_participant_id?: string | null
  current_margin?: number | null
  holes_remaining?: number | null
  final_result_label?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type TournamentMatchHoleRow = {
  id: string
  match_id: string
  hole_number: number
  par?: number | null
  stroke_index?: number | null
  player_a_gross?: number | null
  player_b_gross?: number | null
  player_a_strokes_received?: number | null
  player_b_strokes_received?: number | null
  player_a_net?: number | null
  player_b_net?: number | null
  hole_result?: 'a' | 'b' | 'halved' | null
  concession_type?: MatchPlayConcessionType | null
  match_status_after_hole?: string | null
  updated_at?: string | null
}

function leaderboardEntityId(row: TournamentLeaderboardRow) {
  return row.entity_id ?? row.team_id ?? row.user_id ?? null
}

export function leaderboardRowIdentity(row: TournamentLeaderboardRow) {
  const entityType = row.entity_type ?? (row.team_id ? 'team' : row.user_id ? 'player' : 'entry')
  const entityId = leaderboardEntityId(row) ?? row.display_name ?? buildDisplayName(row.first_name, row.last_name)
  return `${entityType}:${entityId}`
}

function dedupeLeaderboardRows(rows: TournamentLeaderboardRow[]) {
  const deduped = new Map<string, TournamentLeaderboardRow>()

  for (const row of rows) {
    const identity = leaderboardRowIdentity(row)
    if (deduped.has(identity)) {
      deduped.delete(identity)
    }
    deduped.set(identity, row)
  }

  return Array.from(deduped.values())
}

type TeamMembershipRow = {
  id?: string
  user_id?: string | null
  team_id?: string | null
  member_order?: number | null
  is_active?: boolean | null
  tournament_teams?: TeamRow | TeamRow[] | null
}

type TeamRow = {
  id: string
  tournament_id?: string | null
  name?: string | null
  starting_hole?: number | null
}

type PlayGroupMemberRow = {
  id?: string
  user_id?: string | null
  group_id?: string | null
  seat_order?: number | null
  is_active?: boolean | null
  cross_card_target_user_id?: string | null
  play_groups?: PlayGroupRow | PlayGroupRow[] | null
}

type PlayGroupRow = {
  id: string
  tournament_id?: string | null
  name?: string | null
  tee_time?: string | null
  starting_hole?: number | null
}

type PlayerGroupLookupDebug = {
  userId: string
  tournamentId: string
  membershipConfirmed: boolean
  membershipRows: Array<{
    id?: string
    user_id?: string | null
    group_id?: string | null
    seat_order?: number | null
    is_active?: boolean | null
    cross_card_target_user_id?: string | null
  }>
  joinedGroupRows: Array<{
    id: string
    tournament_id?: string | null
    name?: string | null
    tee_time?: string | null
    starting_hole?: number | null
  }>
  selectedMembershipRow: {
    id?: string
    user_id?: string | null
    group_id?: string | null
    seat_order?: number | null
    is_active?: boolean | null
    cross_card_target_user_id?: string | null
  } | null
  selectedGroupRow: {
    id: string
    tournament_id?: string | null
    name?: string | null
    tee_time?: string | null
    starting_hole?: number | null
  } | null
  error?: string | null
  source:
    | 'play_group_members_direct_lookup'
    | 'membership_group_id_to_play_groups_id_match'
    | 'play_group_members_no_group_match'
    | 'play_group_members_no_membership_rows'
    | 'play_group_members_lookup_error'
    | 'not_tournament_member'
    | 'member_without_group_assignment'
    | 'round_fallback_lookup'
    | 'round_fallback_match'
    | 'round_fallback_not_found'
}

type TournamentPlayerMembershipRow = {
  id?: string | null
  tournament_id?: string | null
  user_id?: string | null
  display_name?: string | null
  guest_name?: string | null
  email?: string | null
  handicap?: number | null
  claimed_at?: string | null
  claimed_by_user_id?: string | null
  is_active?: boolean | null
}

type PlayerGroupLookupState =
  | 'resolved'
  | 'not_tournament_member'
  | 'member_without_group_assignment'

function isTeamFormat(formatType: TournamentFormatType | null | undefined) {
  return isTeamTournamentFormat(formatType)
}

function parThrough(lastHoleEntered: number | null | undefined) {
  const holeCount = Math.max(0, Math.min(Number(lastHoleEntered ?? 0), PARS.length))
  return PARS.slice(0, holeCount).reduce((sum, value) => sum + value, 0)
}

function teamScoreToPar(row: TournamentLeaderboardRow) {
  if (row.current_total_score == null) return Number.MAX_SAFE_INTEGER

  const isFinal =
    (row.last_hole_entered ?? 0) >= PARS.length
    || row.leaderboard_status?.toLowerCase().includes('final')
  const comparisonPar = isFinal ? FULL_COURSE_PAR : parThrough(row.last_hole_entered)

  return row.current_total_score - comparisonPar
}

function normalizeTeamName(team: TeamRow | null | undefined, fallback = 'Team') {
  return team?.name ?? fallback
}

function buildDisplayName(firstName?: string | null, lastName?: string | null) {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Player'
}

function looksLikeUuid(value: string | null | undefined) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim()),
  )
}

function cleanDisplayName(value: string | null | undefined) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null
  if (looksLikeUuid(trimmed)) return null
  if (trimmed.toLowerCase() === 'player') return null
  return trimmed
}

function buildProfileDisplayName(profile: any) {
  return (
    cleanDisplayName(`${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`) ??
    cleanDisplayName(profile?.display_name) ??
    cleanDisplayName(profile?.email) ??
    null
  )
}

function buildTournamentPlayerDisplayName(
  row?: TournamentPlayerMembershipRow | null,
  profile?: any,
  fallback = 'Guest Player',
) {
  return (
    cleanDisplayName(row?.display_name) ??
    cleanDisplayName(row?.guest_name) ??
    buildProfileDisplayName(profile) ??
    fallback
  )
}

function normalizeHoleNumbers(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 18)
    .sort((a, b) => a - b)
}

function normalizeTargetDescription(config: Record<string, any> | null | undefined) {
  return typeof config?.target_description === 'string' ? config.target_description : null
}

function normalizeEventAddOnName(type: TournamentEventAddOnType, name?: string | null) {
  if (name?.trim()) return name.trim()
  const labels: Record<TournamentEventAddOnType, string> = {
    birdie_pot: 'Birdie Pot',
    closest_to_pin_prize: 'Closest to the Pin Prize',
    closest_to_pin_pot: 'Closest to the Pin Pot',
    longest_drive: 'Longest Drive',
    ball_in_sand: 'Ball in the Sand',
    ball_in_water: 'Ball in the Water',
    hit_the_dozer: 'Hit the Dozer',
  }
  return labels[type]
}

async function getTournamentEventAddOnsForUser(
  userId: string,
  tournamentId: string,
): Promise<TournamentEventAddOnForUser[]> {
  const addOnsRes = await supabase
    .from('tournament_add_ons')
    .select('id, add_on_type, name, enabled, result_mode, buy_in_amount, config_json, display_order')
    .eq('tournament_id', tournamentId)
    .eq('enabled', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (addOnsRes.error) throw addOnsRes.error

  const addOns = (addOnsRes.data ?? []) as Array<{
    id: string
    add_on_type: TournamentEventAddOnType
    name?: string | null
    enabled: boolean
    result_mode: TournamentEventAddOnResultMode
    buy_in_amount?: number | null
    config_json?: Record<string, any> | null
  }>

  if (addOns.length === 0) return []

  const addOnIds = addOns.map((addOn) => addOn.id)

  const [entriesRes, qualifiersRes, winnersRes] = await Promise.all([
    supabase
      .from('tournament_add_on_entries')
      .select('id, tournament_add_on_id, tournament_player_id, user_id, is_active')
      .in('tournament_add_on_id', addOnIds)
      .eq('is_active', true),
    supabase
      .from('tournament_add_on_qualifiers')
      .select('id, tournament_add_on_id, tournament_player_id, user_id, notes')
      .in('tournament_add_on_id', addOnIds),
    supabase
      .from('tournament_add_on_winners')
      .select('id, tournament_add_on_id, tournament_player_id, user_id, notes')
      .in('tournament_add_on_id', addOnIds),
  ])

  if (entriesRes.error) throw entriesRes.error
  if (qualifiersRes.error) throw qualifiersRes.error
  if (winnersRes.error) throw winnersRes.error

  const entries = entriesRes.data ?? []
  const qualifiers = qualifiersRes.data ?? []
  const winners = winnersRes.data ?? []

  const personUserIds = Array.from(
    new Set(
      [...qualifiers, ...winners]
        .map((row: any) => row.user_id)
        .filter(Boolean),
    ),
  ) as string[]

  const profilesById = personUserIds.length > 0
    ? await lookupProfiles(personUserIds)
    : {}

  const qualifiersByAddOnId = new Map<string, TournamentEventAddOnPerson[]>()
  for (const qualifier of qualifiers as any[]) {
    const profile = profilesById[qualifier.user_id]
    const next = qualifiersByAddOnId.get(qualifier.tournament_add_on_id) ?? []
    next.push({
      id: qualifier.id,
      tournament_player_id: qualifier.tournament_player_id ?? null,
      user_id: qualifier.user_id,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      display_name: buildDisplayName(profile?.first_name, profile?.last_name),
      notes: qualifier.notes ?? null,
    })
    qualifiersByAddOnId.set(qualifier.tournament_add_on_id, next)
  }

  const winnersByAddOnId = new Map<string, TournamentEventAddOnPerson[]>()
  for (const winner of winners as any[]) {
    const profile = profilesById[winner.user_id]
    const next = winnersByAddOnId.get(winner.tournament_add_on_id) ?? []
    next.push({
      id: winner.id,
      tournament_player_id: winner.tournament_player_id ?? null,
      user_id: winner.user_id,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      display_name: buildDisplayName(profile?.first_name, profile?.last_name),
      notes: winner.notes ?? null,
    })
    winnersByAddOnId.set(winner.tournament_add_on_id, next)
  }

  return addOns.map((addOn) => {
    const addOnEntries = (entries as any[]).filter((entry) => entry.tournament_add_on_id === addOn.id)
    return {
      id: addOn.id,
      add_on_type: addOn.add_on_type,
      name: normalizeEventAddOnName(addOn.add_on_type, addOn.name),
      enabled: addOn.enabled,
      result_mode: addOn.result_mode,
      buy_in_amount: addOn.buy_in_amount ?? null,
      config_json: addOn.config_json ?? null,
      hole_numbers: normalizeHoleNumbers(addOn.config_json?.hole_numbers),
      target_description: normalizeTargetDescription(addOn.config_json),
      current_user_entered: addOnEntries.some((entry) => entry.user_id === userId),
      entered_player_count: addOnEntries.length,
      qualifiers: qualifiersByAddOnId.get(addOn.id) ?? [],
      winners: winnersByAddOnId.get(addOn.id) ?? [],
    }
  })
}

async function lookupTeamMembershipForUser(userId: string, tournamentId: string) {
  const rawRes = await supabase
    .from('tournament_team_members')
    .select(`
      id,
      user_id,
      team_id,
      member_order,
      is_active,
      tournament_teams!inner (
        id,
        tournament_id,
        name
      )
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('tournament_teams.tournament_id', tournamentId)
    .limit(1)
    .maybeSingle()

  if (rawRes.error) throw rawRes.error

  const row = rawRes.data as TeamMembershipRow | null
  const joinedTeam = Array.isArray(row?.tournament_teams)
    ? row?.tournament_teams?.[0] ?? null
    : row?.tournament_teams ?? null

  return {
    row,
    teamId: row?.team_id ?? joinedTeam?.id ?? null,
    team: joinedTeam,
  }
}

async function lookupTeam(teamId: string) {
  const { data, error } = await supabase
    .from('tournament_teams')
    .select('id, tournament_id, name, starting_hole')
    .eq('id', teamId)
    .maybeSingle()

  if (error) throw error
  return (data as TeamRow | null) ?? null
}

async function lookupTeamMembers(teamId: string) {
  const { data, error } = await supabase
    .from('tournament_team_members')
    .select('id, user_id, team_id, member_order, is_active')
    .eq('team_id', teamId)
    .eq('is_active', true)
    .order('member_order', { ascending: true })

  if (error) throw error
  return (data ?? []) as TeamMembershipRow[]
}

async function lookupProfiles(userIds: string[]) {
  if (userIds.length === 0) return {}
  const profileRes = await supabase
    .from('profiles')
    .select('id, first_name, last_name, handicap, email')
    .in('id', userIds)

  if (profileRes.error || !profileRes.data) return {}
  return Object.fromEntries(profileRes.data.map((profile: any) => [profile.id, profile]))
}

async function lookupPairing(teamId: string) {
  const { data, error } = await supabase
    .from('tournament_pairings')
    .select('id, tournament_id, team_a_id, team_b_id, starting_hole')
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    id: data.id,
    opponentTeamId: data.team_a_id === teamId ? data.team_b_id : data.team_a_id,
    startingHole: data.starting_hole ?? null,
  }
}

async function lookupPlayGroupMembershipForUser(userId: string, tournamentId: string) {
  const rawRes = await supabase
    .from('play_group_members')
    .select(`
      id,
      user_id,
      group_id,
      seat_order,
      is_active,
      cross_card_target_user_id
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('is_active', true)
    .order('seat_order', { ascending: true })
    .limit(20)

  if (rawRes.error) throw rawRes.error

  const rows = (rawRes.data ?? []) as PlayGroupMemberRow[]
  const firstRow = rows[0] ?? null
  return {
    rows,
    row: firstRow,
    groupId: firstRow?.group_id ?? null,
    group: null,
    joinedGroups: [],
  }
}

async function lookupPlayGroups(groupIds: string[]) {
  if (groupIds.length === 0) return []

  const { data, error } = await supabase
    .from('play_groups')
    .select('id, tournament_id, name, tee_time, starting_hole')
    .in('id', groupIds)

  if (error) throw error
  return (data ?? []) as PlayGroupRow[]
}

async function lookupPlayGroupMembers(groupId: string) {
  const { data, error } = await supabase
    .from('play_group_members')
    .select('id, user_id, group_id, seat_order, is_active, cross_card_target_user_id')
    .eq('group_id', groupId)
    .eq('is_active', true)
    .order('seat_order', { ascending: true })

  if (error) throw error
  return (data ?? []) as PlayGroupMemberRow[]
}

export async function getMyTournaments(userId: string) {
  const { data, error } = await supabase
    .from('tournament_players')
    .select(`
      tournament_id,
      is_active,
      tournaments (
        id,
        name,
        description,
        start_date,
        end_date,
        status,
        invite_code,
        confirmation_rule,
        format_type,
        round_acceptance_rule,
        live_scoring_mode,
        leaderboard_visibility,
        birdie_pot_enabled
      )
    `)
    .eq('user_id', userId)
    .eq('is_active', true)

  if (error) throw error
  return (data ?? []).map((row: any) => row.tournaments).filter(Boolean)
}

function normalizeDateOnly(value?: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 10)
}

function getLocalTodayKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function filterTournamentsForLocalDay(
  tournaments: TournamentTodayItem[],
  dayKey = getLocalTodayKey(),
) {
  return tournaments.filter((tournament) => {
    const start = normalizeDateOnly(tournament.start_date)
    if (!start) return false
    const end = normalizeDateOnly(tournament.end_date) ?? start
    return start <= dayKey && dayKey <= end
  })
}

export async function loadCurrentUserTournamentsToday(userId: string, dayKey = getLocalTodayKey()) {
  const tournaments = await getMyTournaments(userId)
  return filterTournamentsForLocalDay(tournaments, dayKey)
}

export async function getTournamentForUser(userId: string, tournamentId: string) {
  const { data, error } = await supabase
    .from('tournament_players')
    .select(`
      id,
      tournament_id,
      is_active,
      tournaments (
        id,
        name,
        description,
        start_date,
        end_date,
        status,
        invite_code,
        confirmation_rule,
        format_type,
        round_acceptance_rule,
        live_scoring_mode,
        leaderboard_visibility,
        birdie_pot_enabled,
        course_name,
        format_label,
        rules,
        check_in_info,
        prizing_notes,
        sponsor_notes,
        public_notes,
        event_template,
        scoring_format,
        stableford_mode,
        stableford_modified_preset,
        handicap_enabled,
        hole_count,
        unlimited_rounds_allowed,
        best_rounds_count,
        reveal_special_hole_tallies_after_event
      )
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('tournament_id', tournamentId)
    .maybeSingle()

  if (error) throw error
  const tournament = Array.isArray((data as any)?.tournaments)
    ? (data as any)?.tournaments?.[0] ?? null
    : (data as any)?.tournaments ?? null

  const normalizedTournament = (tournament as TournamentForUser | null) ?? null
  if (!normalizedTournament) return null

  const eventAddOns = await getTournamentEventAddOnsForUser(userId, normalizedTournament.id)
  const { data: competitionsData, error: competitionsError } = await supabase
    .from('tournament_competitions')
    .select(TOURNAMENT_COMPETITION_SELECT_COLUMNS)
    .eq('tournament_id', normalizedTournament.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (competitionsError) {
    console.warn('tournament competitions unavailable', competitionsError.message)
  }

  const rawCompetitions = (competitionsData ?? []) as any[]
  const competitions = rawCompetitions.map(normalizeTournamentCompetitionForUser)

  console.info('[competition-schema-fallback-debug]', {
    tournamentId: normalizedTournament.id,
    selectedColumns: TOURNAMENT_COMPETITION_SELECT_COLUMNS.split(',').map((part) => part.trim()),
    rawCompetitionCount: rawCompetitions.length,
    mappedCompetitionCount: competitions.length,
    usedScoringFormatAsCompetitionType: true,
    usedCompetitionScope: true,
    error: competitionsError?.message ?? null,
  })

  if (normalizedTournament.scoring_format !== 'stableford') {
    return {
      ...normalizedTournament,
      event_add_ons: eventAddOns,
      competitions,
    }
  }

  const specialRulesRes = await supabase
    .from('tournament_special_hole_rules')
    .select('hole_number, must_hole_out, track_stroke_tally')
    .eq('tournament_id', normalizedTournament.id)
    .order('hole_number', { ascending: true })

  if (specialRulesRes.error) throw specialRulesRes.error

  return {
    ...normalizedTournament,
    special_hole_rules: (specialRulesRes.data ?? []) as TournamentSpecialHoleRule[],
    event_add_ons: eventAddOns,
    competitions,
  }
}

export async function getTournamentPlayerHandicapMap(tournamentId: string) {
  const { data: playerRows, error: playersError } = await supabase
    .from('tournament_players')
    .select('user_id')
    .eq('tournament_id', tournamentId)
    .eq('is_active', true)

  if (playersError) {
    console.warn('tournament player handicap lookup unavailable', playersError.message)
    return {} as Record<string, number | null>
  }

  const userIds = Array.from(new Set((playerRows ?? []).map((row: any) => row.user_id).filter(Boolean)))
  if (userIds.length === 0) return {}

  const { data: profilesData, error: profilesError } = await supabase
    .from('profiles')
    .select('id, handicap')
    .in('id', userIds)

  if (profilesError) {
    console.warn('tournament player handicap profiles unavailable', profilesError.message)
    return {}
  }

  return Object.fromEntries(
    (profilesData ?? []).map((profile: any) => [
      String(profile.id),
      typeof profile.handicap === 'number' ? profile.handicap : null,
    ]),
  ) as Record<string, number | null>
}

async function lookupTournamentMembershipForUser(userId: string, tournamentId: string) {
  const { data, error } = await supabase
    .from('tournament_players')
    .select('id, tournament_id, user_id, is_active')
    .eq('user_id', userId)
    .eq('tournament_id', tournamentId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) throw error

  return (data as TournamentPlayerMembershipRow | null) ?? null
}

export async function getTournamentLiveLeaderboard(tournamentId: string) {
  const { data, error } = await supabase
    .from('v_tournament_live_leaderboard')
    .select(`
      tournament_id,
      entity_type,
      entity_id,
      user_id,
      team_id,
      first_name,
      last_name,
      display_name,
      flight_name,
      rounds_started,
      current_total_score,
      last_hole_entered,
      thru_label,
      leaderboard_status,
      overall_rank,
      flight_rank
    `)
    .eq('tournament_id', tournamentId)
    .order('flight_name', { ascending: true })
    .order('flight_rank', { ascending: true })

  if (error) {
    console.warn('live leaderboard unavailable', error.message)
    return []
  }

  return (data ?? []) as TournamentLeaderboardRow[]
}

export async function getTournamentStablefordStandings(tournamentId: string) {
  const { data, error } = await supabase
    .from('v_tournament_stableford_standings')
    .select(`
      tournament_id,
      user_id,
      tournament_name,
      event_template,
      best_rounds_count,
      unlimited_rounds_allowed,
      first_name,
      last_name,
      display_name,
      submitted_rounds_count,
      counting_rounds_count,
      dropped_rounds_count,
      stableford_points_total,
      best_counting_round_total,
      overall_rank
    `)
    .eq('tournament_id', tournamentId)
    .order('overall_rank', { ascending: true })

  if (error) {
    console.warn('stableford standings unavailable', error.message)
    return []
  }

  return (data ?? []) as TournamentStablefordStandingsRow[]
}

export async function getTournamentStablefordHoleTallies(
  tournament: TournamentForUser | null,
  holeNumber = 6,
): Promise<TournamentStablefordHoleTalliesResult> {
  if (!tournament?.id) {
    return {
      is_visible: false,
      hidden_reason: 'Tournament not available.',
      hole_number: holeNumber,
      tallies: [],
    }
  }

  const revealAfterEvent = tournament.reveal_special_hole_tallies_after_event === true
  const eventEndDate = tournament.end_date ? new Date(`${tournament.end_date}T23:59:59.999Z`) : null
  const eventComplete = eventEndDate ? Date.now() > eventEndDate.getTime() : false

  if (revealAfterEvent && !eventComplete) {
    return {
      is_visible: false,
      hidden_reason: 'Special-hole tallies are hidden until the event window has ended.',
      hole_number: holeNumber,
      tallies: [],
    }
  }

  const { data, error } = await supabase
    .from('v_tournament_stableford_hole_tallies')
    .select(`
      tournament_id,
      user_id,
      first_name,
      last_name,
      display_name,
      overall_rank,
      stableford_points_total,
      standing_counting_rounds_count,
      hole_number,
      all_rounds_count,
      all_rounds_stroke_total,
      counting_rounds_count,
      counting_rounds_stroke_total
    `)
    .eq('tournament_id', tournament.id)
    .eq('hole_number', holeNumber)
    .order('overall_rank', { ascending: true })

  if (error) {
    console.warn('stableford hole tallies unavailable', error.message)
    return {
      is_visible: false,
      hidden_reason: 'Stableford hole tallies are unavailable right now.',
      hole_number: holeNumber,
      tallies: [],
    }
  }

  return {
    is_visible: true,
    hidden_reason: null,
    hole_number: holeNumber,
    tallies: (data ?? []) as TournamentStablefordHoleTallyRow[],
  }
}

function normalizeMatchPlayer(
  profile: any,
  participantId: string,
  userId?: string | null,
  playerRow?: TournamentPlayerMembershipRow | null,
): TournamentMatchPlayerOption {
  const displayName = buildTournamentPlayerDisplayName(playerRow, profile)
  const firstName = cleanDisplayName(profile?.first_name) ?? null
  const lastName = cleanDisplayName(profile?.last_name) ?? null
  const handicap = typeof playerRow?.handicap === 'number'
    ? playerRow.handicap
    : typeof profile?.handicap === 'number'
      ? profile.handicap
      : null

  console.info('[guest-player-real-player-debug]', {
    tournamentPlayerId: participantId,
    userId: userId ?? null,
    displayName: playerRow?.display_name ?? null,
    guestName: playerRow?.guest_name ?? null,
    email: playerRow?.email ?? profile?.email ?? null,
    handicap,
    isGuest: !userId,
    isLinkedUser: !!userId,
    resolvedName: displayName,
  })

  if (!userId || cleanDisplayName(playerRow?.display_name) || cleanDisplayName(playerRow?.guest_name)) {
    console.info('[mobile-guest-player-name-debug]', {
      tournamentPlayerId: participantId,
      userId: userId ?? null,
      displayName: playerRow?.display_name ?? null,
      guestName: playerRow?.guest_name ?? null,
      profileName: buildProfileDisplayName(profile),
      resolvedName: displayName,
    })
  }

  return {
    participantId,
    userId: userId ?? null,
    firstName,
    lastName,
    displayName,
    handicap,
  }
}

async function listTournamentPlayerRows(tournamentId: string) {
  const extended = await supabase
    .from('tournament_players')
    .select('id, tournament_id, user_id, display_name, guest_name, email, handicap, claimed_at, claimed_by_user_id, is_active')
    .eq('tournament_id', tournamentId)
    .eq('is_active', true)

  if (!extended.error) return (extended.data ?? []) as TournamentPlayerMembershipRow[]

  const fallback = await supabase
    .from('tournament_players')
    .select('id, tournament_id, user_id, display_name, guest_name, is_active')
    .eq('tournament_id', tournamentId)
    .eq('is_active', true)

  if (fallback.error) throw fallback.error
  return ((fallback.data ?? []) as TournamentPlayerMembershipRow[]).map((row) => ({
    ...row,
    email: null,
    handicap: null,
    claimed_at: null,
    claimed_by_user_id: null,
  }))
}

function buildMatchStatusLabel(params: {
  playerAName: string
  playerBName: string
  leaderParticipantId?: string | null
  playerAParticipantId?: string | null
  playerBParticipantId?: string | null
  margin?: number | null
  holesRemaining?: number | null
  finalResultLabel?: string | null
  status?: string | null
  winnerParticipantId?: string | null
}) {
  if (params.finalResultLabel === 'Match Halved' || (params.status ?? '').toLowerCase() === 'tied') {
    return 'Match Halved'
  }

  if (params.finalResultLabel && params.winnerParticipantId) {
    const winnerName =
      params.winnerParticipantId === params.playerAParticipantId
        ? params.playerAName
        : params.winnerParticipantId === params.playerBParticipantId
          ? params.playerBName
          : 'Winner'
    return `${winnerName} wins ${params.finalResultLabel}`
  }

  const margin = Number(params.margin ?? 0)
  if (!margin) return 'All Square'

  const leaderName =
    params.leaderParticipantId === params.playerAParticipantId
      ? params.playerAName
      : params.leaderParticipantId === params.playerBParticipantId
        ? params.playerBName
        : margin > 0
          ? params.playerAName
          : params.playerBName

  const holesRemaining = Math.max(0, Number(params.holesRemaining ?? 0))
  if (holesRemaining > 0 && Math.abs(margin) === holesRemaining && (params.status ?? '').toLowerCase() === 'active') {
    return `${leaderName} ${Math.abs(margin)} Up (Dormie)`
  }

  return `${leaderName} ${Math.abs(margin)} Up`
}

function mapTournamentMatchSummary(
  row: TournamentMatchRow,
  playersById: Map<string, TournamentMatchPlayerOption>,
): TournamentMatchSummary {
  const playerA = row.player_a_participant_id ? playersById.get(row.player_a_participant_id) ?? null : null
  const playerB = row.player_b_participant_id ? playersById.get(row.player_b_participant_id) ?? null : null

  return {
    id: row.id,
    tournamentId: row.tournament_id,
    status: row.status ?? 'scheduled',
    matchType: row.match_type ?? 'singles',
    bracketRound: row.bracket_round ?? null,
    bracketPosition: row.bracket_position ?? null,
    scoringMode: (row.scoring_mode ?? 'net') as MatchPlayScoringMode,
    handicapMode: (row.handicap_mode ?? 'full_difference') as MatchPlayHandicapMode,
    tieHandling: (row.tie_handling ?? 'sudden_death_playoff') as MatchPlayTieHandling,
    playerA,
    playerB,
    playerAPlayingHandicap: row.player_a_playing_handicap ?? null,
    playerBPlayingHandicap: row.player_b_playing_handicap ?? null,
    currentLeaderParticipantId: row.current_leader_participant_id ?? null,
    currentMargin: row.current_margin ?? null,
    holesRemaining: row.holes_remaining ?? null,
    finalResultLabel: row.final_result_label ?? null,
    winnerParticipantId: row.winner_participant_id ?? null,
    updatedAt: row.updated_at ?? null,
    createdAt: row.created_at ?? null,
    currentStatusLabel: buildMatchStatusLabel({
      playerAName: playerA?.displayName ?? 'Player A',
      playerBName: playerB?.displayName ?? 'Player B',
      leaderParticipantId: row.current_leader_participant_id ?? null,
      playerAParticipantId: row.player_a_participant_id ?? null,
      playerBParticipantId: row.player_b_participant_id ?? null,
      margin: row.current_margin ?? null,
      holesRemaining: row.holes_remaining ?? null,
      finalResultLabel: row.final_result_label ?? null,
      status: row.status ?? null,
      winnerParticipantId: row.winner_participant_id ?? null,
    }),
  }
}

function mapTournamentMatchHole(row: TournamentMatchHoleRow): TournamentMatchHoleRecord {
  return {
    id: row.id,
    matchId: row.match_id,
    holeNumber: row.hole_number,
    par: row.par ?? null,
    strokeIndex: row.stroke_index ?? null,
    playerAGross: row.player_a_gross ?? null,
    playerBGross: row.player_b_gross ?? null,
    playerAStrokesReceived: row.player_a_strokes_received ?? null,
    playerBStrokesReceived: row.player_b_strokes_received ?? null,
    playerANet: row.player_a_net ?? null,
    playerBNet: row.player_b_net ?? null,
    holeResult: row.hole_result ?? null,
    concessionType: row.concession_type ?? null,
    matchStatusAfterHole: row.match_status_after_hole ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

function getRawTournamentErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object') {
    if ('message' in error && typeof (error as any).message === 'string' && (error as any).message.trim()) {
      return (error as any).message.trim()
    }
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') return serialized
    } catch {
      // ignore
    }
  }
  return fallback
}

function applySavedHoleStateToMatchSummary(
  match: TournamentMatchSummary,
  holes: TournamentMatchHoleRecord[],
): TournamentMatchSummary {
  const savedHoleCount = holes.filter((hole) => isCompletedSavedMatchHole(hole)).length
  const scorecardComplete = savedHoleCount >= 18
  const lastSavedHole = holes.length > 0 ? holes[holes.length - 1] : null
  const finishedAt = scorecardComplete ? (lastSavedHole?.updatedAt ?? match.updatedAt ?? null) : null
  const courseDefinitions = buildDefaultMatchPlayHoleDefinitions()
  const savedHoleByNumber = new Map(holes.map((hole) => [hole.holeNumber, hole]))
  const scorecard = scoreMatchPlayCard({
    scoringMode: match.scoringMode,
    handicapMode: match.handicapMode,
    tieHandling: match.tieHandling,
    playerAName: match.playerA?.displayName ?? 'Player A',
    playerBName: match.playerB?.displayName ?? 'Player B',
    playerAPlayingHandicap: match.playerAPlayingHandicap ?? null,
    playerBPlayingHandicap: match.playerBPlayingHandicap ?? null,
    holes: courseDefinitions.map((definition) => {
      const savedHole = savedHoleByNumber.get(definition.holeNumber)
      return {
        holeNumber: definition.holeNumber,
        par: savedHole?.par ?? definition.par ?? null,
        strokeIndex: savedHole?.strokeIndex ?? definition.strokeIndex ?? null,
        playerAGross: savedHole?.playerAGross ?? null,
        playerBGross: savedHole?.playerBGross ?? null,
        concessionType: savedHole?.concessionType ?? 'none',
        concededBy: null,
      }
    }),
    totalHoles: 18,
  })

  const computedCurrentStatusLabel =
    !scorecard.status.complete && scorecard.status.completedHoles > 0
      ? `${scorecard.status.statusLabel} thru ${scorecard.status.completedHoles}`
      : scorecard.status.statusLabel
  const decisiveHoleNumber = scorecard.status.complete
    ? Math.max(1, 18 - scorecard.status.holesRemaining)
    : null

  if (scorecard.status.complete) {
    const progressSuffix =
      savedHoleCount >= 18
        ? ' · Scorecard complete'
        : decisiveHoleNumber != null && savedHoleCount > decisiveHoleNumber
          ? ` · Scorecard thru ${savedHoleCount}/18`
          : ''

    return {
      ...match,
      status: scorecard.status.winner ? 'complete' : 'tied',
      currentLeaderParticipantId:
        scorecard.status.leader === 'a'
          ? match.playerA?.participantId ?? null
          : scorecard.status.leader === 'b'
            ? match.playerB?.participantId ?? null
            : null,
      currentMargin: Math.abs(scorecard.status.margin),
      holesRemaining: scorecard.status.holesRemaining,
      finalResultLabel: scorecard.status.finalResultLabel,
      winnerParticipantId:
        scorecard.status.winner === 'a'
          ? match.playerA?.participantId ?? null
          : scorecard.status.winner === 'b'
            ? match.playerB?.participantId ?? null
            : null,
      savedHoleCount,
      scorecardSavedHoleCount: savedHoleCount,
      decisiveHoleNumber,
      officialMatchComplete: true,
      scorecardComplete,
      finishedAt,
      currentStatusLabel: `${scorecard.status.statusLabel}${progressSuffix}`,
    }
  }

  return {
    ...match,
    status: scorecard.status.complete
      ? (scorecard.status.winner ? 'complete' : 'tied')
      : holes.length > 0
        ? 'active'
        : match.status === 'cancelled'
          ? 'cancelled'
          : 'scheduled',
    currentLeaderParticipantId:
      scorecard.status.leader === 'a'
        ? match.playerA?.participantId ?? null
        : scorecard.status.leader === 'b'
          ? match.playerB?.participantId ?? null
          : null,
    currentMargin: Math.abs(scorecard.status.margin),
    holesRemaining: scorecard.status.holesRemaining,
    finalResultLabel: scorecard.status.finalResultLabel,
    winnerParticipantId:
      scorecard.status.winner === 'a'
        ? match.playerA?.participantId ?? null
        : scorecard.status.winner === 'b'
          ? match.playerB?.participantId ?? null
          : null,
    savedHoleCount,
    scorecardSavedHoleCount: savedHoleCount,
    decisiveHoleNumber: scorecard.status.complete ? Math.max(1, 18 - scorecard.status.holesRemaining) : null,
    officialMatchComplete: scorecard.status.complete,
    scorecardComplete,
    finishedAt,
    currentStatusLabel: computedCurrentStatusLabel,
  }
}

function unorderedMatchPairKey(match: Pick<TournamentMatchSummary, 'playerA' | 'playerB' | 'matchType'>) {
  const a = match.playerA?.participantId ?? 'missing-a'
  const b = match.playerB?.participantId ?? 'missing-b'
  return `${match.matchType}:${[a, b].sort().join(':')}`
}

function isCompletedSavedMatchHole(hole: TournamentMatchHoleRecord | null | undefined) {
  return typeof hole?.playerAGross === 'number'
    && Number.isFinite(hole.playerAGross)
    && typeof hole?.playerBGross === 'number'
    && Number.isFinite(hole.playerBGross)
}

export function isTournamentMatchScorecardComplete(
  match: Pick<TournamentMatchSummary, 'scorecardComplete' | 'scorecardSavedHoleCount' | 'savedHoleCount'> | null | undefined,
) {
  if (!match) return false
  if (match.scorecardComplete === true) return true
  const savedHoleCount = Number(match.scorecardSavedHoleCount ?? match.savedHoleCount ?? 0)
  return savedHoleCount >= 18
}

export function getTournamentMatchSavedHoleCount(
  match: Pick<TournamentMatchSummary, 'scorecardSavedHoleCount' | 'savedHoleCount'> | null | undefined,
) {
  if (!match) return 0
  const savedHoleCount = Number(match.scorecardSavedHoleCount ?? match.savedHoleCount ?? 0)
  return Number.isFinite(savedHoleCount) && savedHoleCount > 0 ? savedHoleCount : 0
}

export function hasTournamentMatchStarted(
  match: Pick<TournamentMatchSummary, 'scorecardSavedHoleCount' | 'savedHoleCount'> | null | undefined,
) {
  return getTournamentMatchSavedHoleCount(match) > 0
}

export function currentUserCanScoreMatch(
  match: Pick<TournamentMatchSummary, 'playerA' | 'playerB'> | null | undefined,
  currentUserId: string | null | undefined,
) {
  if (!match || !currentUserId) return false
  return match.playerA?.userId === currentUserId || match.playerB?.userId === currentUserId
}

export function resolveTournamentMatchResumeHole(params: {
  preferredHole?: number | null
  holes: TournamentMatchHoleRecord[]
  isMatchComplete?: boolean | null
}): TournamentMatchResumeHoleState {
  const savedHoleNumbers = Array.from(
    new Set(
      params.holes
        .filter((hole) => isCompletedSavedMatchHole(hole))
        .map((hole) => hole.holeNumber)
        .filter((holeNumber) => Number.isInteger(holeNumber) && holeNumber >= 1 && holeNumber <= 18),
    ),
  ).sort((a, b) => a - b)

  const normalizedPreferredHole = Number.isInteger(params.preferredHole)
    && Number(params.preferredHole) >= 1
    && Number(params.preferredHole) <= 18
    ? Number(params.preferredHole)
    : null

  const isMatchComplete = Boolean(params.isMatchComplete)

  if (normalizedPreferredHole != null) {
    return {
      savedHoleNumbers,
      resolvedResumeHole: normalizedPreferredHole,
      isMatchComplete,
      source: 'route_hole',
    }
  }

  for (let holeNumber = 1; holeNumber <= 18; holeNumber += 1) {
    if (!savedHoleNumbers.includes(holeNumber)) {
      return {
        savedHoleNumbers,
        resolvedResumeHole: holeNumber,
        isMatchComplete,
        source: savedHoleNumbers.length > 0 ? 'first_unplayed_hole' : 'no_saved_holes',
      }
    }
  }

  return {
    savedHoleNumbers,
    resolvedResumeHole: 18,
    isMatchComplete,
    source: isMatchComplete ? 'all_saved_holes_complete' : 'all_saved_holes',
  }
}

function calculateDirectMatchPlayHole(params: {
  holeNumber: number
  par?: number | null
  strokeIndex?: number | null
  playerAGross: number
  playerBGross: number
  scoringMode: MatchPlayScoringMode
  handicapMode: MatchPlayHandicapMode
  concessionType?: MatchPlayConcessionType | null
  concededBy?: MatchPlayConcededBy | null
  playerAPlayingHandicap?: number | null
  playerBPlayingHandicap?: number | null
}) {
  const strokeAllocation = calculateStrokesReceivedForMatch({
    playerAPlayingHandicap: params.playerAPlayingHandicap ?? null,
    playerBPlayingHandicap: params.playerBPlayingHandicap ?? null,
    handicapMode: params.handicapMode,
    holes: [
      {
        holeNumber: params.holeNumber,
        par: params.par ?? null,
        strokeIndex: params.strokeIndex ?? null,
      },
      ...buildDefaultMatchPlayHoleDefinitions().filter((hole) => hole.holeNumber !== params.holeNumber),
    ],
  })
  const playerAStrokesReceived = strokeAllocation.playerAByHole[params.holeNumber] ?? 0
  const playerBStrokesReceived = strokeAllocation.playerBByHole[params.holeNumber] ?? 0
  const result =
    params.scoringMode === 'net' && strokeAllocation.handicapStatus !== 'ready'
      ? {
          playerANet: null,
          playerBNet: null,
          winner: null,
          resultLabel: strokeAllocation.handicapMessage,
        }
      : calculateMatchHoleResult({
          playerAGross: params.playerAGross,
          playerBGross: params.playerBGross,
          playerAStrokesReceived,
          playerBStrokesReceived,
          scoringMode: params.scoringMode,
          concededBy: params.concededBy ?? null,
          concessionType: params.concessionType ?? 'none',
        })

  return {
    playerAStrokesReceived,
    playerBStrokesReceived,
    playerANet: result.playerANet,
    playerBNet: result.playerBNet,
    winner: result.winner,
    resultLabel: result.resultLabel,
    handicapStatus: strokeAllocation.handicapStatus,
  }
}

function nextUnplayedScorecardHoleNumber(holes: TournamentMatchHoleRecord[]) {
  const state = resolveTournamentMatchResumeHole({
    holes,
    isMatchComplete: false,
  })
  return state.resolvedResumeHole ?? 18
}

function matchStatusPriority(status: string | null | undefined) {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
      return 5
    case 'complete':
    case 'conceded':
    case 'tied':
      return 4
    case 'scheduled':
      return 3
    case 'cancelled':
      return 1
    default:
      return 2
  }
}

function resolveDuplicateMatchGroups(matches: TournamentMatchSummary[], tournamentId: string) {
  const grouped = new Map<string, TournamentMatchSummary[]>()

  for (const match of matches) {
    const key = unorderedMatchPairKey(match)
    const next = grouped.get(key) ?? []
    next.push(match)
    grouped.set(key, next)
  }

  const deduped: TournamentMatchSummary[] = []

  for (const [pairKey, groupedMatches] of grouped.entries()) {
    const sorted = [...groupedMatches].sort((a, b) => {
      const savedHoleDiff = Number(b.savedHoleCount ?? 0) - Number(a.savedHoleCount ?? 0)
      if (savedHoleDiff !== 0) return savedHoleDiff

      const statusDiff = matchStatusPriority(b.status) - matchStatusPriority(a.status)
      if (statusDiff !== 0) return statusDiff

      const updatedDiff = String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? ''))
      if (updatedDiff !== 0) return updatedDiff

      return String(b.id).localeCompare(String(a.id))
    })

    const canonical = sorted[0]
    const duplicates = sorted.slice(1)

    console.info('[match-play-duplicate-resolution-debug]', {
      tournamentId,
      competitionId: null,
      pairKey,
      canonicalMatchId: canonical?.id ?? null,
      duplicateMatchIds: duplicates.map((match) => match.id),
      canonicalStatus: canonical?.status ?? null,
      duplicateStatuses: duplicates.map((match) => match.status ?? null),
      canonicalSavedHoleCount: canonical?.savedHoleCount ?? 0,
      duplicateSavedHoleCounts: duplicates.map((match) => match.savedHoleCount ?? 0),
    })

    if (canonical) deduped.push(canonical)
  }

  return deduped
}

function resolveCurrentUserMatchSide(match: TournamentMatchSummary, userId: string): 'a' | 'b' | null {
  if (match.playerA?.userId === userId) return 'a'
  if (match.playerB?.userId === userId) return 'b'
  return null
}

function buildCompletedMatchResultLabel(match: TournamentMatchSummary) {
  if (match.winnerParticipantId === match.playerA?.participantId && match.finalResultLabel) {
    return `${match.playerA.displayName} wins ${match.finalResultLabel}`
  }
  if (match.winnerParticipantId === match.playerB?.participantId && match.finalResultLabel) {
    return `${match.playerB.displayName} wins ${match.finalResultLabel}`
  }
  return match.currentStatusLabel
}

async function loadTournamentMatchGolfCanadaPostingCache() {
  try {
    const raw = await AsyncStorage.getItem(MATCH_PLAY_GOLF_CANADA_POSTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, GolfCanadaPostingRecord>
  } catch {
    return {}
  }
}

async function saveTournamentMatchGolfCanadaPostingCache(cache: Record<string, GolfCanadaPostingRecord>) {
  await AsyncStorage.setItem(MATCH_PLAY_GOLF_CANADA_POSTINGS_KEY, JSON.stringify(cache))
}

function buildDefaultTournamentMatchPostingState(postedAt?: string | null): GolfCanadaPostingRecord {
  return {
    provider: 'golf_canada',
    method: 'manual',
    status: postedAt ? 'posted_manually' : 'not_posted',
    postedAt: postedAt ?? null,
    playedAlone: false,
    playedWithOthers: true,
  }
}

export async function getTournamentMatchGolfCanadaPostingState(matchId: string) {
  const cache = await loadTournamentMatchGolfCanadaPostingCache()
  return cache[matchId] ?? buildDefaultTournamentMatchPostingState()
}

export async function markTournamentMatchGolfCanadaPosted(matchId: string) {
  const cache = await loadTournamentMatchGolfCanadaPostingCache()
  const nextRecord = buildDefaultTournamentMatchPostingState(new Date().toISOString())
  cache[matchId] = nextRecord
  await saveTournamentMatchGolfCanadaPostingCache(cache)
  return nextRecord
}

export async function listTournamentPlayersForMatchPlay(tournamentId: string) {
  const playerRows = await listTournamentPlayerRows(tournamentId)
  const profilesById = await lookupProfiles(playerRows.map((row) => row.user_id).filter(Boolean) as string[])
  return playerRows
    .map((row) =>
      normalizeMatchPlayer(
        row.user_id ? profilesById[row.user_id] : null,
        String(row.id ?? ''),
        row.user_id ?? null,
        row,
      ),
    )
    .filter((player) => !!player.participantId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export async function listTournamentMatches(tournamentId: string) {
  const [playerOptions, matchRes] = await Promise.all([
    listTournamentPlayersForMatchPlay(tournamentId),
    supabase
      .from('tournament_matches')
      .select(`
        id,
        tournament_id,
        bracket_round,
        bracket_position,
        match_type,
        status,
        player_a_participant_id,
        player_b_participant_id,
        player_a_playing_handicap,
        player_b_playing_handicap,
        scoring_mode,
        handicap_mode,
        tie_handling,
        winner_participant_id,
        current_leader_participant_id,
        current_margin,
        holes_remaining,
        final_result_label,
        created_at,
        updated_at
      `)
      .eq('tournament_id', tournamentId)
      .order('updated_at', { ascending: false }),
  ])

  if (matchRes.error) {
    console.info('[match-schema-fallback-debug]', {
      tournamentId,
      competitionIdColumnMissing: true,
      loadedByTournamentId: true,
      rawMatchCount: 0,
      renderedMatchCount: 0,
      error: matchRes.error.message,
    })
    throw matchRes.error
  }
  const playersById = new Map(playerOptions.map((player) => [player.participantId, player]))
  const rawRows = (matchRes.data ?? []) as TournamentMatchRow[]

  console.info('[match-schema-fallback-debug]', {
    tournamentId,
    competitionIdColumnMissing: true,
    loadedByTournamentId: true,
    rawMatchCount: rawRows.length,
    renderedMatchCount: rawRows.length,
    error: null,
  })

  const matchIds = rawRows.map((row) => row.id)
  const holeRowsByMatchId = new Map<string, TournamentMatchHoleRecord[]>()

  if (matchIds.length > 0) {
    const holeRes = await supabase
      .from('tournament_match_holes')
      .select(`
        id,
        match_id,
        hole_number,
        par,
        stroke_index,
        player_a_gross,
        player_b_gross,
        player_a_strokes_received,
        player_b_strokes_received,
        player_a_net,
        player_b_net,
        hole_result,
        concession_type,
        match_status_after_hole,
        updated_at
      `)
      .in('match_id', matchIds)
      .order('hole_number', { ascending: true })

    if (holeRes.error) throw holeRes.error
    for (const row of (holeRes.data ?? []) as TournamentMatchHoleRow[]) {
      const next = holeRowsByMatchId.get(row.match_id) ?? []
      next.push(mapTournamentMatchHole(row))
      holeRowsByMatchId.set(row.match_id, next)
    }
  }

  const normalizedMatches = rawRows.map((row) => {
    const savedHoles = holeRowsByMatchId.get(row.id) ?? []
    const summary = applySavedHoleStateToMatchSummary(
      mapTournamentMatchSummary(row, playersById),
      savedHoles,
    )
    console.info('[match-play-load-order-debug]', {
      matchId: summary.id,
      rawPlayerAId: row.player_a_participant_id ?? null,
      rawPlayerBId: row.player_b_participant_id ?? null,
      loadedPlayerAName: summary.playerA?.displayName ?? null,
      loadedPlayerBName: summary.playerB?.displayName ?? null,
      playerAHandicap: summary.playerAPlayingHandicap ?? null,
      playerBHandicap: summary.playerBPlayingHandicap ?? null,
    })
    console.info('[match-play-live-status-debug]', {
      matchId: summary.id,
      playerAName: summary.playerA?.displayName ?? 'Player A',
      playerBName: summary.playerB?.displayName ?? 'Player B',
      playerAHandicap: summary.playerAPlayingHandicap ?? null,
      playerBHandicap: summary.playerBPlayingHandicap ?? null,
      savedHoleCount: savedHoles.filter((hole) => typeof hole.playerAGross === 'number' && typeof hole.playerBGross === 'number').length,
      holes: scoreMatchPlayCard({
        scoringMode: summary.scoringMode,
        handicapMode: summary.handicapMode,
        tieHandling: summary.tieHandling,
        playerAName: summary.playerA?.displayName ?? 'Player A',
        playerBName: summary.playerB?.displayName ?? 'Player B',
        playerAPlayingHandicap: summary.playerAPlayingHandicap ?? null,
        playerBPlayingHandicap: summary.playerBPlayingHandicap ?? null,
        holes: buildDefaultMatchPlayHoleDefinitions().map((definition) => {
          const savedHole = savedHoles.find((hole) => hole.holeNumber === definition.holeNumber)
          return {
            holeNumber: definition.holeNumber,
            par: savedHole?.par ?? definition.par ?? null,
            strokeIndex: savedHole?.strokeIndex ?? definition.strokeIndex ?? null,
            playerAGross: savedHole?.playerAGross ?? null,
            playerBGross: savedHole?.playerBGross ?? null,
            concessionType: savedHole?.concessionType ?? 'none',
            concededBy: null,
          }
        }),
        totalHoles: 18,
      }).holes
        .filter((hole) => typeof hole.playerAGross === 'number' && typeof hole.playerBGross === 'number')
        .map((hole) => ({
          holeNumber: hole.holeNumber,
          strokeIndex: hole.strokeIndex ?? null,
          playerAGross: hole.playerAGross ?? null,
          playerBGross: hole.playerBGross ?? null,
          playerAStrokes: hole.playerAStrokesReceived ?? 0,
          playerBStrokes: hole.playerBStrokesReceived ?? 0,
          playerANet: hole.playerANet ?? null,
          playerBNet: hole.playerBNet ?? null,
          result: hole.winner ?? null,
        })),
      computedMargin: summary.currentMargin ?? 0,
      computedLeaderName:
        summary.currentLeaderParticipantId === summary.playerA?.participantId
          ? summary.playerA?.displayName ?? null
          : summary.currentLeaderParticipantId === summary.playerB?.participantId
            ? summary.playerB?.displayName ?? null
            : null,
      displayStatus: summary.currentStatusLabel,
    })
    return {
      ...summary,
      savedHoleCount: savedHoles.filter((hole) => typeof hole.playerAGross === 'number' && typeof hole.playerBGross === 'number').length,
    }
  })

  return resolveDuplicateMatchGroups(normalizedMatches, tournamentId)
}

export async function loadCurrentUserActiveMatchPlayNotifications(userId: string) {
  const state = await loadCurrentUserMatchPlayHomeState(userId)
  return state.activeNotifications
}

export async function loadCurrentUserMatchPlayHomeState(userId: string): Promise<CurrentUserMatchPlayHomeState> {
  const tournaments = await getMyTournaments(userId)
  const notifications: CurrentUserMatchPlayNotification[] = []
  const completedTournamentIds = new Set<string>()

  for (const tournament of tournaments) {
    if (!tournament?.id) continue

    const matches = await listTournamentMatches(tournament.id)
    const currentUserMatches = matches.filter((match) =>
      match.playerA?.userId === userId || match.playerB?.userId === userId,
    )

    for (const match of currentUserMatches) {
      const scorecardComplete = isTournamentMatchScorecardComplete(match)
      const savedHoleCount = getTournamentMatchSavedHoleCount(match)
      const hasStarted = savedHoleCount > 0
      const routeTarget = `/tournament/${tournament.id}/match/${match.id}`
      console.info('[match-play-home-notification-debug]', {
        tournamentId: tournament.id,
        matchId: match.id,
        status: match.status ?? null,
        officialMatchComplete: !!match.officialMatchComplete,
        scorecardComplete,
        savedHoleNumbers: [],
        finishedAt: match.finishedAt ?? null,
        shouldShowHomeCard: hasStarted && !scorecardComplete && String(match.status ?? '').toLowerCase() !== 'cancelled',
        routeTarget,
      })
      if (scorecardComplete || String(match.status ?? '').toLowerCase() === 'cancelled') {
        if (scorecardComplete) completedTournamentIds.add(tournament.id)
        continue
      }

      if (!hasStarted) continue

      const holes = await listTournamentMatchHoles(match.id)
      const resumeState = resolveTournamentMatchResumeHole({
        holes,
        isMatchComplete:
          match.status === 'complete'
          || match.status === 'tied'
          || !!match.finalResultLabel
          || !!match.winnerParticipantId,
      })

      notifications.push({
        tournamentId: tournament.id,
        tournamentName: tournament.name ?? 'Tournament',
        tournamentStatus: tournament.status ?? null,
        matchId: match.id,
        matchType: match.matchType,
        playerAName: match.playerA?.displayName ?? 'Player A',
        playerBName: match.playerB?.displayName ?? 'Player B',
        currentStatusLabel: match.currentStatusLabel,
        officialMatchComplete: !!match.officialMatchComplete,
        scorecardComplete,
        finishedAt: match.finishedAt ?? null,
        resumeHole: resumeState.resolvedResumeHole ?? 1,
        updatedAt: match.updatedAt ?? match.createdAt ?? null,
      })
    }
  }

  return {
    activeNotifications: notifications.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))),
    completedTournamentIds: Array.from(completedTournamentIds),
  }
}

export async function loadCurrentUserCompletedMatchPlayHistory(userId: string): Promise<TournamentMatchPlayHistoryItem[]> {
  const tournaments = await getMyTournaments(userId)
  const items: TournamentMatchPlayHistoryItem[] = []

  for (const tournament of tournaments) {
    if (!tournament?.id) continue

    const matches = await listTournamentMatches(tournament.id)
    const currentUserMatches = matches.filter((match) =>
      match.playerA?.userId === userId || match.playerB?.userId === userId,
    )

    for (const match of currentUserMatches) {
      const currentUserSide = resolveCurrentUserMatchSide(match, userId)
      if (!currentUserSide) {
        console.info('[match-play-history-debug]', {
          matchId: match.id,
          tournamentId: tournament.id,
          currentUserId: userId,
          currentUserSide: null,
          savedHoleCount: match.savedHoleCount ?? 0,
          grossTotal: null,
          includedInHistory: false,
          skipReason: 'current_user_not_in_match',
        })
        continue
      }

      const scorecardComplete = isTournamentMatchScorecardComplete(match)
      if (!scorecardComplete) {
        console.info('[match-play-history-debug]', {
          matchId: match.id,
          tournamentId: tournament.id,
          currentUserId: userId,
          currentUserSide,
          savedHoleCount: match.savedHoleCount ?? 0,
          grossTotal: null,
          includedInHistory: false,
          skipReason: 'scorecard_incomplete',
        })
        continue
      }

      const holes = await listTournamentMatchHoles(match.id)
      const scores = Array.from({ length: 18 }, (_, index) => {
        const hole = holes.find((entry) => entry.holeNumber === index + 1)
        const gross = currentUserSide === 'a' ? hole?.playerAGross : hole?.playerBGross
        return typeof gross === 'number' && Number.isFinite(gross) ? gross : null
      })
      const grossTotal = scores.every((score) => typeof score === 'number')
        ? scores.reduce((sum, score) => sum + Number(score ?? 0), 0)
        : null
      const opponentName = currentUserSide === 'a'
        ? (match.playerB?.displayName ?? 'Opponent')
        : (match.playerA?.displayName ?? 'Opponent')
      const resultLabel = buildCompletedMatchResultLabel(match)
      const date = tournament.end_date ?? tournament.start_date ?? match.finishedAt?.slice(0, 10) ?? ''
      const sortTimestamp = match.finishedAt ?? match.updatedAt ?? match.createdAt ?? date

      console.info('[match-play-history-debug]', {
        matchId: match.id,
        tournamentId: tournament.id,
        currentUserId: userId,
        currentUserSide,
        savedHoleCount: holes.filter((hole) => typeof hole.playerAGross === 'number' && typeof hole.playerBGross === 'number').length,
        grossTotal,
        includedInHistory: true,
        skipReason: null,
      })

      items.push({
        key: `match-play:${match.id}`,
        matchId: match.id,
        tournamentId: tournament.id,
        tournamentName: tournament.name ?? 'Tournament',
        opponentName,
        resultLabel,
        date,
        grossTotal,
        savedHoleCount: holes.filter((hole) => typeof hole.playerAGross === 'number' && typeof hole.playerBGross === 'number').length,
        currentUserSide,
        finishedAt: match.finishedAt ?? null,
        sortTimestamp,
      })
    }
  }

  return items.sort((a, b) => String(b.sortTimestamp ?? '').localeCompare(String(a.sortTimestamp ?? '')))
}

export async function getTournamentMatchGolfCanadaPrep(matchId: string, currentUserId: string): Promise<GolfCanadaPostingPrep | null> {
  const match = await getTournamentMatch(matchId)
  const currentUserSide = resolveCurrentUserMatchSide(match, currentUserId)

  if (!currentUserSide) {
    console.info('[match-play-golf-canada-debug]', {
      matchId,
      tournamentId: match.tournamentId,
      currentUserId,
      currentUserSide: null,
      savedHoleCount: match.savedHoleCount ?? 0,
      canPost: false,
      grossTotal: null,
      skipReason: 'current_user_not_in_match',
    })
    return null
  }

  const [holes, postingState, tournamentRes] = await Promise.all([
    listTournamentMatchHoles(matchId),
    getTournamentMatchGolfCanadaPostingState(matchId),
    supabase
      .from('tournaments')
      .select('name, start_date, course_name')
      .eq('id', match.tournamentId)
      .maybeSingle(),
  ])

  if (tournamentRes.error) throw tournamentRes.error

  const scores = Array.from({ length: 18 }, (_, index) => {
    const hole = holes.find((entry) => entry.holeNumber === index + 1)
    const gross = currentUserSide === 'a' ? hole?.playerAGross : hole?.playerBGross
    return {
      hole: index + 1,
      score: typeof gross === 'number' && Number.isFinite(gross) ? gross : null,
    }
  })
  const playedScores = scores.filter((entry) => typeof entry.score === 'number')
  const canPost = playedScores.length === 18
  const grossTotal = canPost
    ? playedScores.reduce((sum, entry) => sum + Number(entry.score ?? 0), 0)
    : null

  console.info('[match-play-golf-canada-debug]', {
    matchId,
    tournamentId: match.tournamentId,
    currentUserId,
    currentUserSide,
    savedHoleCount: playedScores.length,
    canPost,
    grossTotal,
    skipReason: canPost ? null : 'scorecard_not_18_holes',
  })

  if (!canPost) return null

  const tournamentMeta = tournamentRes.data as { name?: string | null; start_date?: string | null; course_name?: string | null } | null
  const resolvedGrossTotal = grossTotal ?? 0

  return {
    roundId: match.id,
    date: tournamentMeta?.start_date ?? match.finishedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    courseName: tournamentMeta?.course_name?.trim() || DEFAULT_MATCH_PLAY_COURSE_NAME,
    teeName: null,
    holeCount: 18,
    grossTotal: resolvedGrossTotal,
    frontTotal: scores.filter((entry) => entry.hole <= 9).reduce((sum, entry) => sum + Number(entry.score ?? 0), 0),
    backTotal: scores.filter((entry) => entry.hole >= 10).reduce((sum, entry) => sum + Number(entry.score ?? 0), 0),
    scores,
    postingState,
  }
}

export async function createTournamentSinglesMatch(params: {
  tournamentId: string
  playerAParticipantId: string
  playerBParticipantId: string
  playerAPlayingHandicap?: number | null
  playerBPlayingHandicap?: number | null
  scoringMode?: MatchPlayScoringMode | null
  handicapMode?: MatchPlayHandicapMode | null
  tieHandling?: MatchPlayTieHandling | null
}) {
  const existingMatchRes = await supabase
    .from('tournament_matches')
    .select('id')
    .eq('tournament_id', params.tournamentId)
    .eq('match_type', 'singles')
    .or(
      [
        `and(player_a_participant_id.eq.${params.playerAParticipantId},player_b_participant_id.eq.${params.playerBParticipantId})`,
        `and(player_a_participant_id.eq.${params.playerBParticipantId},player_b_participant_id.eq.${params.playerAParticipantId})`,
      ].join(','),
    )
    .limit(1)
    .maybeSingle()

  if (existingMatchRes.error) throw existingMatchRes.error
  if (existingMatchRes.data?.id) {
    throw new Error('This match already exists.')
  }

  const insertRes = await supabase
    .from('tournament_matches')
    .insert({
      tournament_id: params.tournamentId,
      match_type: 'singles',
      status: 'active',
      player_a_participant_id: params.playerAParticipantId,
      player_b_participant_id: params.playerBParticipantId,
      player_a_playing_handicap: params.playerAPlayingHandicap ?? null,
      player_b_playing_handicap: params.playerBPlayingHandicap ?? null,
      scoring_mode: params.scoringMode ?? 'net',
      handicap_mode: params.handicapMode ?? 'full_difference',
      tie_handling: params.tieHandling ?? 'sudden_death_playoff',
      current_margin: 0,
      holes_remaining: 18,
    })
    .select(`
      id,
      tournament_id,
      bracket_round,
      bracket_position,
      match_type,
      status,
      player_a_participant_id,
      player_b_participant_id,
      player_a_playing_handicap,
      player_b_playing_handicap,
      scoring_mode,
      handicap_mode,
      tie_handling,
      winner_participant_id,
      current_leader_participant_id,
      current_margin,
      holes_remaining,
      final_result_label,
      created_at,
      updated_at
    `)
    .single()

  if (insertRes.error) throw insertRes.error

  const playerOptions = await listTournamentPlayersForMatchPlay(params.tournamentId)
  const playersById = new Map(playerOptions.map((player) => [player.participantId, player]))
  return mapTournamentMatchSummary(insertRes.data as TournamentMatchRow, playersById)
}

export async function createTournamentBracketMatches(params: {
  tournamentId: string
  seededParticipantIds: string[]
  playingHandicapByParticipantId?: Record<string, number | null | undefined>
  scoringMode?: MatchPlayScoringMode | null
  handicapMode?: MatchPlayHandicapMode | null
  tieHandling?: MatchPlayTieHandling | null
}) {
  const seededIds = params.seededParticipantIds.filter(Boolean)
  const bracketSize = seededIds.length
  if (![2, 4, 8, 16, 32].includes(bracketSize)) {
    throw new Error('Bracket generation requires 2, 4, 8, 16, or 32 seeded players.')
  }

  const rounds = Math.log2(bracketSize)
  const rows: Array<Record<string, any>> = []

  for (let round = 1; round <= rounds; round += 1) {
    const matchCount = bracketSize / Math.pow(2, round)
    for (let position = 1; position <= matchCount; position += 1) {
      const isOpeningRound = round === 1
      const playerAId = isOpeningRound ? seededIds[(position - 1) * 2] ?? null : null
      const playerBId = isOpeningRound ? seededIds[(position - 1) * 2 + 1] ?? null : null
      rows.push({
        tournament_id: params.tournamentId,
        bracket_round: round,
        bracket_position: position,
        match_type: 'bracket',
        status: isOpeningRound && playerAId && playerBId ? 'scheduled' : 'scheduled',
        player_a_participant_id: playerAId,
        player_b_participant_id: playerBId,
        player_a_playing_handicap: playerAId ? params.playingHandicapByParticipantId?.[playerAId] ?? null : null,
        player_b_playing_handicap: playerBId ? params.playingHandicapByParticipantId?.[playerBId] ?? null : null,
        scoring_mode: params.scoringMode ?? 'net',
        handicap_mode: params.handicapMode ?? 'full_difference',
        tie_handling: params.tieHandling ?? 'sudden_death_playoff',
        current_margin: 0,
        holes_remaining: 18,
      })
    }
  }

  const insertRes = await supabase
    .from('tournament_matches')
    .insert(rows)

  if (insertRes.error) throw insertRes.error

  return listTournamentMatches(params.tournamentId)
}

export async function getTournamentMatch(matchId: string) {
  const matchRes = await supabase
    .from('tournament_matches')
    .select(`
      id,
      tournament_id,
      bracket_round,
      bracket_position,
      match_type,
      status,
      player_a_participant_id,
      player_b_participant_id,
      player_a_playing_handicap,
      player_b_playing_handicap,
      scoring_mode,
      handicap_mode,
      tie_handling,
      winner_participant_id,
      current_leader_participant_id,
      current_margin,
      holes_remaining,
      final_result_label,
      created_at,
      updated_at
    `)
    .eq('id', matchId)
    .single()

  if (matchRes.error) throw matchRes.error
  const matchRow = matchRes.data as TournamentMatchRow
  const [playerOptions, savedHoles] = await Promise.all([
    listTournamentPlayersForMatchPlay(matchRow.tournament_id),
    listTournamentMatchHoles(matchId),
  ])
  const playersById = new Map(playerOptions.map((player) => [player.participantId, player]))
  return applySavedHoleStateToMatchSummary(mapTournamentMatchSummary(matchRow, playersById), savedHoles)
}

export async function listTournamentMatchHoles(matchId: string) {
  const holeRes = await supabase
    .from('tournament_match_holes')
    .select(`
      id,
      match_id,
      hole_number,
      par,
      stroke_index,
      player_a_gross,
      player_b_gross,
      player_a_strokes_received,
      player_b_strokes_received,
      player_a_net,
      player_b_net,
      hole_result,
      concession_type,
      match_status_after_hole,
      updated_at
    `)
    .eq('match_id', matchId)
    .order('hole_number', { ascending: true })

  if (holeRes.error) throw holeRes.error
  return ((holeRes.data ?? []) as TournamentMatchHoleRow[]).map(mapTournamentMatchHole)
}

export async function updateTournamentMatchSettings(params: {
  matchId: string
  playerAPlayingHandicap?: number | null
  playerBPlayingHandicap?: number | null
  scoringMode?: MatchPlayScoringMode | null
  handicapMode?: MatchPlayHandicapMode | null
}) {
  const updateRes = await supabase
    .from('tournament_matches')
    .update({
      player_a_playing_handicap: params.playerAPlayingHandicap ?? null,
      player_b_playing_handicap: params.playerBPlayingHandicap ?? null,
      scoring_mode: params.scoringMode ?? 'net',
      handicap_mode: params.handicapMode ?? 'full_difference',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.matchId)

  if (updateRes.error) throw updateRes.error
}

export async function saveTournamentMatchHole(params: {
  matchId: string
  holeNumber: number
  playerAGross: number
  playerBGross: number
  concessionType?: MatchPlayConcessionType | null
  concededBy?: MatchPlayConcededBy | null
}) {
  let failedStep = 'load_match_start'

  try {
    console.info('[match-play-save-hole-step]', 'load_match_start')
    const match = await getTournamentMatch(params.matchId)
    failedStep = 'load_match_complete'
    console.info('[match-play-save-hole-step]', 'load_match_complete')

    if (!match.playerA?.participantId || !match.playerB?.participantId) {
      throw new Error('Match players are missing.')
    }
    if (!Number.isInteger(params.holeNumber) || params.holeNumber < 1 || params.holeNumber > 18) {
      throw new Error('Hole number is invalid.')
    }

    failedStep = 'validate_scores'
    console.info('[match-play-save-hole-step]', 'validate_scores')
    if (!Number.isFinite(params.playerAGross) || !Number.isFinite(params.playerBGross)) {
      throw new Error('Both gross scores are required.')
    }
    if (params.playerAGross <= 0 || params.playerBGross <= 0 || params.playerAGross > 20 || params.playerBGross > 20) {
      throw new Error('Gross scores must be between 1 and 20.')
    }

    const existingHoles = await listTournamentMatchHoles(params.matchId)
    const existingByHole = new Map(existingHoles.map((hole) => [hole.holeNumber, hole]))
    const preSaveMargin = Number(match.currentMargin ?? 0)
    const preSaveHolesRemaining = Number(match.holesRemaining ?? 18)
    const preSaveDormie = preSaveMargin > 0 && preSaveMargin === preSaveHolesRemaining
    const officialMatchCompleteBeforeSave = Boolean(
      match.finalResultLabel
      || match.winnerParticipantId
      || match.status === 'complete'
      || match.status === 'tied',
    )
    const decisiveHoleNumber = officialMatchCompleteBeforeSave
      ? Math.max(1, 18 - Math.max(0, Number(match.holesRemaining ?? 0)))
      : null
    existingByHole.set(params.holeNumber, {
      id: existingByHole.get(params.holeNumber)?.id ?? `hole-${params.holeNumber}`,
      matchId: params.matchId,
      holeNumber: params.holeNumber,
      par: existingByHole.get(params.holeNumber)?.par ?? null,
      strokeIndex: existingByHole.get(params.holeNumber)?.strokeIndex ?? null,
      playerAGross: params.playerAGross,
      playerBGross: params.playerBGross,
      playerAStrokesReceived: null,
      playerBStrokesReceived: null,
      playerANet: null,
      playerBNet: null,
      holeResult: null,
      concessionType: params.concessionType ?? 'none',
      matchStatusAfterHole: null,
      updatedAt: null,
    })

    const courseDefinitions = buildDefaultMatchPlayHoleDefinitions()
    const courseHole = courseDefinitions.find((entry) => entry.holeNumber === params.holeNumber)
    console.info('[match-play-save-hole-debug]', {
      matchId: params.matchId,
      tournamentId: match.tournamentId,
      holeNumber: params.holeNumber,
      playerAGross: params.playerAGross,
      playerBGross: params.playerBGross,
      scoringMode: match.scoringMode,
      handicapMode: match.handicapMode,
      playerAHandicap: match.playerAPlayingHandicap,
      playerBHandicap: match.playerBPlayingHandicap,
      par: courseHole?.par ?? null,
      strokeIndex: courseHole?.strokeIndex ?? null,
    })

    failedStep = 'calculate_result'
    console.info('[match-play-save-hole-step]', 'calculate_result')
    const scorecard = scoreMatchPlayCard({
      scoringMode: match.scoringMode,
      handicapMode: match.handicapMode,
      tieHandling: match.tieHandling,
      playerAName: match.playerA.displayName,
      playerBName: match.playerB.displayName,
      playerAPlayingHandicap: match.playerAPlayingHandicap ?? null,
      playerBPlayingHandicap: match.playerBPlayingHandicap ?? null,
      holes: Array.from(existingByHole.values())
        .map((hole) => {
          const definition = courseDefinitions.find((entry) => entry.holeNumber === hole.holeNumber)
          return {
            holeNumber: hole.holeNumber,
            par: definition?.par ?? hole.par ?? null,
            strokeIndex: definition?.strokeIndex ?? hole.strokeIndex ?? null,
            playerAGross: hole.playerAGross ?? null,
            playerBGross: hole.playerBGross ?? null,
            concessionType: hole.concessionType ?? 'none',
            concededBy:
              hole.concessionType && hole.concessionType !== 'none'
                ? ((hole.holeResult === 'a' ? 'b' : hole.holeResult === 'b' ? 'a' : null) as MatchPlayConcededBy | null)
                : null,
          }
        })
        .sort((a, b) => a.holeNumber - b.holeNumber),
      totalHoles: 18,
    })

    const calculatedHole = scorecard.holes.find((hole) => hole.holeNumber === params.holeNumber)
    const fallbackHole = calculateDirectMatchPlayHole({
      holeNumber: params.holeNumber,
      par: courseHole?.par ?? existingByHole.get(params.holeNumber)?.par ?? null,
      strokeIndex: courseHole?.strokeIndex ?? existingByHole.get(params.holeNumber)?.strokeIndex ?? null,
      playerAGross: params.playerAGross,
      playerBGross: params.playerBGross,
      scoringMode: match.scoringMode,
      handicapMode: match.handicapMode,
      concessionType: params.concessionType ?? 'none',
      concededBy: params.concededBy ?? null,
      playerAPlayingHandicap: match.playerAPlayingHandicap ?? null,
      playerBPlayingHandicap: match.playerBPlayingHandicap ?? null,
    })
    const resolvedCalculatedHole = calculatedHole ?? {
      holeNumber: params.holeNumber,
      par: courseHole?.par ?? existingByHole.get(params.holeNumber)?.par ?? null,
      strokeIndex: courseHole?.strokeIndex ?? existingByHole.get(params.holeNumber)?.strokeIndex ?? null,
      playerAGross: params.playerAGross,
      playerBGross: params.playerBGross,
      concessionType: params.concessionType ?? 'none',
      concededBy: params.concededBy ?? null,
      playerAStrokesReceived: fallbackHole.playerAStrokesReceived,
      playerBStrokesReceived: fallbackHole.playerBStrokesReceived,
      playerANet: fallbackHole.playerANet,
      playerBNet: fallbackHole.playerBNet,
      winner: fallbackHole.winner,
      resultLabel: fallbackHole.resultLabel,
      status: scorecard.status,
    }

    console.info('[match-play-dormie-save-debug]', {
      matchId: params.matchId,
      holeNumber: params.holeNumber,
      preSaveMargin,
      preSaveHolesRemaining,
      preSaveDormie,
      playerAGross: params.playerAGross,
      playerBGross: params.playerBGross,
      playerAStrokes: resolvedCalculatedHole.playerAStrokesReceived ?? fallbackHole.playerAStrokesReceived ?? 0,
      playerBStrokes: resolvedCalculatedHole.playerBStrokesReceived ?? fallbackHole.playerBStrokesReceived ?? 0,
      playerANet: resolvedCalculatedHole.playerANet ?? fallbackHole.playerANet ?? null,
      playerBNet: resolvedCalculatedHole.playerBNet ?? fallbackHole.playerBNet ?? null,
      currentHoleResult: resolvedCalculatedHole.winner ?? fallbackHole.winner ?? null,
      savedHoleResultFoundInCard: Boolean(calculatedHole),
      usedDirectFallback: !calculatedHole,
      postSaveMargin: Math.abs(scorecard.status.margin),
      postSaveHolesRemaining: scorecard.status.holesRemaining,
      postSaveComplete: scorecard.status.complete,
      finalStatusLabel: scorecard.status.statusLabel,
    })

    if (!resolvedCalculatedHole) {
      throw new Error('Could not calculate the saved hole result.')
    }

    failedStep = 'upsert_hole_start'
    console.info('[match-play-save-hole-step]', 'upsert_hole_start')
    const upsertRes = await supabase
      .from('tournament_match_holes')
      .upsert({
        match_id: params.matchId,
        hole_number: params.holeNumber,
        par: resolvedCalculatedHole.par ?? null,
        stroke_index: resolvedCalculatedHole.strokeIndex ?? null,
        player_a_gross: resolvedCalculatedHole.playerAGross ?? null,
        player_b_gross: resolvedCalculatedHole.playerBGross ?? null,
        player_a_strokes_received: resolvedCalculatedHole.playerAStrokesReceived,
        player_b_strokes_received: resolvedCalculatedHole.playerBStrokesReceived,
        player_a_net: resolvedCalculatedHole.playerANet,
        player_b_net: resolvedCalculatedHole.playerBNet,
        hole_result: resolvedCalculatedHole.winner,
        concession_type: resolvedCalculatedHole.concessionType ?? 'none',
        match_status_after_hole: resolvedCalculatedHole.status.statusLabel,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'match_id,hole_number',
      })

    if (upsertRes.error) throw upsertRes.error
    failedStep = 'upsert_hole_complete'
    console.info('[match-play-save-hole-step]', 'upsert_hole_complete')

    failedStep = 'update_match_start'
    console.info('[match-play-save-hole-step]', 'update_match_start')
    const matchUpdatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    if (!officialMatchCompleteBeforeSave) {
      matchUpdatePayload.status = scorecard.status.complete
        ? (scorecard.status.winner ? 'complete' : 'tied')
        : 'active'
      matchUpdatePayload.current_leader_participant_id =
        scorecard.status.leader === 'a'
          ? match.playerA.participantId
          : scorecard.status.leader === 'b'
            ? match.playerB.participantId
            : null
      matchUpdatePayload.current_margin = Math.abs(scorecard.status.margin)
      matchUpdatePayload.holes_remaining = scorecard.status.holesRemaining
      matchUpdatePayload.final_result_label = scorecard.status.finalResultLabel
      matchUpdatePayload.winner_participant_id =
        scorecard.status.winner === 'a'
          ? match.playerA.participantId
          : scorecard.status.winner === 'b'
            ? match.playerB.participantId
            : null
    }

    const updateRes = await supabase
      .from('tournament_matches')
      .update(matchUpdatePayload)
      .eq('id', params.matchId)

    if (updateRes.error) throw updateRes.error
    failedStep = 'update_match_complete'
    console.info('[match-play-save-hole-step]', 'update_match_complete')

    const updatedMatch = await getTournamentMatch(params.matchId)
    await maybeAdvanceBracketMatch(updatedMatch)

    console.info('[match-play-save-hole-result]', {
      success: true,
      failedStep,
      errorMessage: null,
      errorCode: null,
      errorDetails: null,
      errorHint: null,
      rawError: null,
    })

    console.info('[match-play-post-completion-scorecard-debug]', {
      matchId: params.matchId,
      holeNumber: params.holeNumber,
      officialMatchCompleteBeforeSave,
      decisiveHoleNumber,
      officialFinalStatus: match.currentStatusLabel,
      scorecardSavedHoleNumbers: Array.from(existingByHole.keys()).sort((a, b) => a - b),
      currentHoleSaved: true,
      countsForMatchResult: !officialMatchCompleteBeforeSave,
      nextResumeHole: nextUnplayedScorecardHoleNumber(await listTournamentMatchHoles(params.matchId)),
    })

    return {
      match: updatedMatch,
      holes: await listTournamentMatchHoles(params.matchId),
      calculatedHole: resolvedCalculatedHole,
    }
  } catch (error) {
    console.info('[match-play-save-hole-result]', {
      success: false,
      failedStep,
      errorMessage: getRawTournamentErrorMessage(error, 'Could not save hole.'),
      errorCode: error && typeof error === 'object' ? (error as any).code ?? null : null,
      errorDetails: error && typeof error === 'object' ? (error as any).details ?? null : null,
      errorHint: error && typeof error === 'object' ? (error as any).hint ?? null : null,
      rawError: error,
    })
    throw new Error(getRawTournamentErrorMessage(error, 'Could not save hole.'))
  }
}

async function maybeAdvanceBracketMatch(match: TournamentMatchSummary) {
  if (match.matchType !== 'bracket') return
  if (!match.winnerParticipantId) return
  if (!match.bracketRound || !match.bracketPosition) return

  const nextRound = match.bracketRound + 1
  const nextPosition = Math.ceil(match.bracketPosition / 2)
  const targetSlot = match.bracketPosition % 2 === 1 ? 'player_a' : 'player_b'
  const winnerHandicap =
    match.winnerParticipantId === match.playerA?.participantId
      ? match.playerAPlayingHandicap
      : match.winnerParticipantId === match.playerB?.participantId
        ? match.playerBPlayingHandicap
        : null

  const nextMatchRes = await supabase
    .from('tournament_matches')
    .select('id, player_a_participant_id, player_b_participant_id, player_a_playing_handicap, player_b_playing_handicap')
    .eq('tournament_id', match.tournamentId)
    .eq('match_type', 'bracket')
    .eq('bracket_round', nextRound)
    .eq('bracket_position', nextPosition)
    .maybeSingle()

  if (nextMatchRes.error) throw nextMatchRes.error
  if (!nextMatchRes.data?.id) return

  const nextMatch = nextMatchRes.data
  const payload: Record<string, any> = {
    updated_at: new Date().toISOString(),
  }

  if (targetSlot === 'player_a') {
    if (nextMatch.player_a_participant_id === match.winnerParticipantId) return
    payload.player_a_participant_id = match.winnerParticipantId
    payload.player_a_playing_handicap = winnerHandicap ?? null
  } else {
    if (nextMatch.player_b_participant_id === match.winnerParticipantId) return
    payload.player_b_participant_id = match.winnerParticipantId
    payload.player_b_playing_handicap = winnerHandicap ?? null
  }

  const updateNextRes = await supabase
    .from('tournament_matches')
    .update(payload)
    .eq('id', nextMatch.id)

  if (updateNextRes.error) throw updateNextRes.error
}

export function filterLeaderboardRowsForFormat(
  rows: TournamentLeaderboardRow[],
  formatType: TournamentFormatType | null | undefined,
) {
  const uniqueRows = dedupeLeaderboardRows(rows)

  if (isTeamFormat(formatType)) {
    const teamRows = uniqueRows
      .filter((row) => row.entity_type === 'team' || (!!row.team_id && row.entity_type !== 'player'))
      .sort((a, b) => {
        const scoreDiff = teamScoreToPar(a) - teamScoreToPar(b)
        if (scoreDiff !== 0) return scoreDiff

        const totalDiff = Number(a.current_total_score ?? Number.MAX_SAFE_INTEGER)
          - Number(b.current_total_score ?? Number.MAX_SAFE_INTEGER)
        if (totalDiff !== 0) return totalDiff

        return (a.display_name ?? a.team_id ?? a.entity_id ?? '').localeCompare(
          b.display_name ?? b.team_id ?? b.entity_id ?? '',
        )
      })

    const flightRankMap = new Map<string, number>()

    return teamRows.map((row, idx) => {
      const flightKey = row.flight_name || 'Overall'
      const nextFlightRank = (flightRankMap.get(flightKey) ?? 0) + 1
      flightRankMap.set(flightKey, nextFlightRank)

      return {
        ...row,
        overall_rank: idx + 1,
        flight_rank: nextFlightRank,
      }
    })
  }
  return uniqueRows.filter((row) => row.entity_type !== 'team')
}

export async function getTournamentTeamContext(userId: string, tournamentId: string) {
  try {
    const membership = await lookupTeamMembershipForUser(userId, tournamentId)
    if (!membership.teamId) return null

    const [team, members, pairing] = await Promise.all([
      membership.team ? Promise.resolve(membership.team) : lookupTeam(membership.teamId),
      lookupTeamMembers(membership.teamId),
      lookupPairing(membership.teamId),
    ])

    const profilesById = await lookupProfiles(
      members.map((member) => member.user_id).filter(Boolean) as string[],
    )

    const participants = members.map((member) => {
      const profile = member.user_id ? profilesById[member.user_id] : null
      const firstName = profile?.first_name ?? 'Team'
      const lastName = profile?.last_name ?? 'Member'
      return {
        displayName: buildDisplayName(firstName, lastName),
        isScorer: member.user_id === userId,
        type: 'app_user',
      }
    })

    const opponentTeam = pairing?.opponentTeamId ? await lookupTeam(pairing.opponentTeamId) : null

    return {
      teamId: membership.teamId,
      teamName: normalizeTeamName(team ?? null),
      startingHole: pairing?.startingHole ?? team?.starting_hole ?? null,
      participants,
      pairingId: pairing?.id ?? null,
      opponentTeamId: pairing?.opponentTeamId ?? null,
      opponentTeamName: normalizeTeamName(opponentTeam, 'Opponent Team'),
    }
  } catch (error: any) {
    console.warn('team context lookup failed', error?.message ?? error)
    return null
  }
}

export async function getTournamentPlayerGroupContext(
  userId: string,
  tournamentId: string,
  formatType?: TournamentFormatType | null,
) {
  const normalizedTournamentId = String(tournamentId ?? '').trim()
  const leaderboardRows = filterLeaderboardRowsForFormat(
    await getTournamentLiveLeaderboard(normalizedTournamentId),
    formatType,
  )

  if (isTeamFormat(formatType)) {
    const teamContext = await getTournamentTeamContext(userId, tournamentId)
    const myRow =
      leaderboardRows.find((row) => row.team_id === teamContext?.teamId || row.entity_id === teamContext?.teamId) ?? null

    return {
      roundId: null,
      roundDate: null,
      roundStatus: null,
      roundMode: 'tournament',
      submittedAt: null,
      groupName: teamContext?.teamName ?? 'Your team',
      participants: teamContext?.participants ?? [],
      scorekeeperName: teamContext?.participants.find((participant) => participant.isScorer)?.displayName ?? null,
      myScore: myRow?.current_total_score ?? null,
      lastHoleEntered: myRow?.last_hole_entered ?? null,
      thruLabel: myRow?.thru_label ?? 'No holes yet',
      myLeaderboardStatus: myRow?.leaderboard_status ?? 'Not Started',
      myOverallRank: myRow?.overall_rank ?? null,
      myFlightRank: myRow?.flight_rank ?? null,
      myFlightName: myRow?.flight_name ?? 'Overall',
      teamId: teamContext?.teamId ?? null,
      teamName: teamContext?.teamName ?? 'Your team',
      startingHole: teamContext?.startingHole ?? null,
      pairingId: teamContext?.pairingId ?? null,
      opponentTeamId: teamContext?.opponentTeamId ?? null,
      opponentTeamName: teamContext?.opponentTeamName ?? null,
    }
  }

  let lookupDebug: PlayerGroupLookupDebug = {
    userId,
    tournamentId: normalizedTournamentId,
    membershipConfirmed: false,
    membershipRows: [],
    joinedGroupRows: [],
    selectedMembershipRow: null,
    selectedGroupRow: null,
    error: null,
    source: 'play_group_members_direct_lookup',
  }

  try {
    const tournamentMembership = await lookupTournamentMembershipForUser(userId, normalizedTournamentId)
    if (!tournamentMembership) {
      lookupDebug = {
        ...lookupDebug,
        membershipConfirmed: false,
        source: 'not_tournament_member',
      }

      return {
        roundId: null,
        roundDate: null,
        roundStatus: null,
        roundMode: 'tournament',
        submittedAt: null,
        groupId: null,
        groupName: 'Tournament assignment needed',
        teeTime: null,
        startingHole: null,
        participants: [],
        scorekeeperName: null,
        myScore: null,
        lastHoleEntered: null,
        thruLabel: 'No holes yet',
        myLeaderboardStatus: 'Not Started',
        myOverallRank: null,
        myFlightRank: null,
        myFlightName: 'Overall',
        crossCardTargetUserId: null,
        crossCardTargetName: null,
        lookupState: 'not_tournament_member' as PlayerGroupLookupState,
        lookupDebug,
      }
    }

    const membership = await lookupPlayGroupMembershipForUser(userId, normalizedTournamentId)
    const membershipGroupIds = Array.from(
      new Set((membership.rows ?? []).map((row) => String(row.group_id ?? '').trim()).filter(Boolean)),
    )
    const candidateGroups = membershipGroupIds.length > 0
      ? await lookupPlayGroups(
          membershipGroupIds,
        )
      : []
    const selectedGroup = candidateGroups.find(
      (group) =>
        String(group.tournament_id ?? '').trim() === normalizedTournamentId
        && membershipGroupIds.includes(String(group.id).trim()),
    ) ?? null
    const selectedMembership =
      membership.rows.find((row) => String(row.group_id ?? '').trim() === String(selectedGroup?.id ?? '').trim())
      ?? null

    lookupDebug = {
      userId,
      tournamentId: normalizedTournamentId,
      membershipConfirmed: true,
      membershipRows: (membership.rows ?? []).map((row) => ({
        id: row.id,
        user_id: row.user_id ?? null,
        group_id: row.group_id ?? null,
        seat_order: row.seat_order ?? null,
        is_active: row.is_active ?? null,
        cross_card_target_user_id: row.cross_card_target_user_id ?? null,
      })),
      joinedGroupRows: candidateGroups
        .map((group) => ({
          id: group.id,
          tournament_id: group.tournament_id ?? null,
          name: group.name ?? null,
          tee_time: group.tee_time ?? null,
          starting_hole: group.starting_hole ?? null,
        })),
      selectedMembershipRow: selectedMembership
        ? {
            id: selectedMembership.id,
            user_id: selectedMembership.user_id ?? null,
            group_id: selectedMembership.group_id ?? null,
            seat_order: selectedMembership.seat_order ?? null,
            is_active: selectedMembership.is_active ?? null,
            cross_card_target_user_id: selectedMembership.cross_card_target_user_id ?? null,
          }
        : null,
      selectedGroupRow: selectedGroup
        ? {
            id: selectedGroup.id,
            tournament_id: selectedGroup.tournament_id ?? null,
            name: selectedGroup.name ?? null,
            tee_time: selectedGroup.tee_time ?? null,
          starting_hole: selectedGroup.starting_hole ?? null,
        }
        : null,
      error: null,
      source: selectedGroup
        ? 'membership_group_id_to_play_groups_id_match'
        : membershipGroupIds.length > 0
          ? 'play_group_members_no_group_match'
          : 'play_group_members_no_membership_rows',
    }

    if (selectedMembership?.group_id && selectedGroup) {
      const members = await lookupPlayGroupMembers(String(selectedMembership.group_id))
      const profilesById = await lookupProfiles(
        members.map((member) => member.user_id).filter(Boolean) as string[],
      )

      const currentMember = members.find((member) => member.user_id === userId) ?? selectedMembership
      const participants = members.map((member) => {
        const profile = member.user_id ? profilesById[member.user_id] : null
        const first = profile?.first_name ?? 'Player'
        const last = profile?.last_name ?? ''
        return {
          displayName: buildDisplayName(first, last),
          isScorer: member.user_id === userId,
          type: 'app_user',
        }
      })

      const leaderboardRows = filterLeaderboardRowsForFormat(
        await getTournamentLiveLeaderboard(normalizedTournamentId),
        formatType,
      )
      const myRow = leaderboardRows.find((row) => row.user_id === userId) ?? null
      const crossCardTargetProfile =
        currentMember?.cross_card_target_user_id
          ? profilesById[currentMember.cross_card_target_user_id]
          : null

      return {
        roundId: null,
        roundDate: null,
        roundStatus: null,
        roundMode: 'tournament',
        submittedAt: null,
        groupId: selectedGroup.id,
        groupName: selectedGroup.name ?? 'Your group',
        teeTime: selectedGroup.tee_time ?? null,
        startingHole: selectedGroup.starting_hole ?? null,
        participants,
        scorekeeperName: participants.find((participant) => participant.isScorer)?.displayName ?? null,
        myScore: myRow?.current_total_score ?? null,
        lastHoleEntered: myRow?.last_hole_entered ?? null,
        thruLabel: myRow?.thru_label ?? 'No holes yet',
        myLeaderboardStatus: myRow?.leaderboard_status ?? 'Not Started',
        myOverallRank: myRow?.overall_rank ?? null,
        myFlightRank: myRow?.flight_rank ?? null,
        myFlightName: myRow?.flight_name ?? 'Overall',
        crossCardTargetUserId: currentMember?.cross_card_target_user_id ?? null,
        crossCardTargetName: crossCardTargetProfile
          ? buildDisplayName(crossCardTargetProfile.first_name, crossCardTargetProfile.last_name)
          : null,
        lookupState: 'resolved' as PlayerGroupLookupState,
        lookupDebug,
      }
    }

    return {
      roundId: null,
      roundDate: null,
      roundStatus: null,
      roundMode: 'tournament',
      submittedAt: null,
      groupId: null,
      groupName: 'Group assignment needed',
      teeTime: null,
      startingHole: null,
      participants: [],
      scorekeeperName: null,
      myScore: null,
      lastHoleEntered: null,
      thruLabel: 'No holes yet',
      myLeaderboardStatus: 'Not Started',
      myOverallRank: null,
      myFlightRank: null,
      myFlightName: 'Overall',
      crossCardTargetUserId: null,
      crossCardTargetName: null,
      lookupState: 'member_without_group_assignment' as PlayerGroupLookupState,
      lookupDebug: {
        ...lookupDebug,
        source: 'member_without_group_assignment',
      },
    }
  } catch (error: any) {
    console.warn('play group context lookup failed', error?.message ?? error)
    lookupDebug = {
      ...lookupDebug,
      error: error?.message ?? String(error),
      source: 'play_group_members_lookup_error',
    }
  }

  lookupDebug = {
    ...lookupDebug,
    source: 'round_fallback_lookup',
  }

  const roundRes = await supabase
    .from('rounds')
    .select(`
      id,
      tournament_id,
      group_id,
      round_date,
      status,
      scoring_user_id,
      round_mode,
      submitted_at,
      play_groups (
        id,
        name
      ),
      round_players!inner (
        user_id
      )
    `)
    .eq('tournament_id', normalizedTournamentId)
    .eq('round_players.user_id', userId)
    .order('round_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (roundRes.error) {
    console.warn('group context round lookup failed', roundRes.error.message)
    return null
  }

  const round: any = roundRes.data
  if (!round) return null

  const myRow = leaderboardRows.find((row) => row.user_id === userId) ?? null

  let participants: any[] = []

  const participantRes = await supabase
    .from('round_participants')
    .select(`
      id,
      user_id,
      guest_profile_id,
      guest_first_name,
      guest_last_name,
      participant_order,
      is_scorer
    `)
    .eq('round_id', round.id)
    .order('participant_order', { ascending: true })

  if (!participantRes.error && participantRes.data) {
    const userIds = participantRes.data.map((row: any) => row.user_id).filter(Boolean)
    const profilesById = await lookupProfiles(userIds)

    participants = participantRes.data.map((row: any) => {
      const profile = row.user_id ? profilesById[row.user_id] : null
      const first = profile?.first_name ?? row.guest_first_name ?? ''
      const last = profile?.last_name ?? row.guest_last_name ?? ''
      return {
        displayName: buildDisplayName(first, last),
        isScorer: !!row.is_scorer,
        type: row.user_id ? 'app_user' : 'guest',
      }
    })
  } else {
    const fallbackRes = await supabase
      .from('round_players')
      .select(`
        user_id,
        player_order,
        is_scorer
      `)
      .eq('round_id', round.id)
      .order('player_order', { ascending: true })

    if (!fallbackRes.error && fallbackRes.data) {
      const userIds = fallbackRes.data.map((row: any) => row.user_id).filter(Boolean)
      const profilesById = await lookupProfiles(userIds)

      participants = fallbackRes.data.map((row: any) => {
        const profile = profilesById[row.user_id]
        const first = profile?.first_name ?? 'App'
        const last = profile?.last_name ?? 'User'
        return {
          displayName: buildDisplayName(first, last),
          isScorer: !!row.is_scorer,
          type: 'app_user',
        }
      })
    }
  }

  return {
    roundId: round.id,
    roundDate: round.round_date,
    roundStatus: round.status,
    roundMode: round.round_mode,
    submittedAt: round.submitted_at,
    groupName: round.play_groups?.name ?? 'Your group',
    groupId: round.group_id ?? null,
    teeTime: null,
    startingHole: null,
    participants,
    scorekeeperName: participants.find((participant) => participant.isScorer)?.displayName ?? null,
    myScore: myRow?.current_total_score ?? null,
    lastHoleEntered: myRow?.last_hole_entered ?? null,
    thruLabel: myRow?.thru_label ?? 'No holes yet',
    myLeaderboardStatus: myRow?.leaderboard_status ?? 'Not Started',
    myOverallRank: myRow?.overall_rank ?? null,
    myFlightRank: myRow?.flight_rank ?? null,
    myFlightName: myRow?.flight_name ?? 'Overall',
    lookupState: 'resolved' as PlayerGroupLookupState,
    lookupDebug: {
      ...lookupDebug,
      source: 'round_fallback_match',
    },
  }
}
