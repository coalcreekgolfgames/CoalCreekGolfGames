import { supabase } from '@/lib/supabase'
import { DEFAULT_TEE_OPTION, holes, type RatingType, type TeeOption } from '@/constants/course'
import { finalizeHoleStats, summarizeRound } from '@/lib/roundStats'
import { getTournamentTeamContext } from '@/lib/tournaments'
import {
  applyStablefordToHole,
  getStablefordRoundTotal,
  isStablefordRound,
  resolveStablefordHandicap,
} from '@/lib/stableford'
import {
  isMatchPlayTournamentFormat,
  isTeamTournamentFormat,
  tournamentFormatNeedsPlayGroup,
} from '@/lib/tournamentFormats'
import type {
  LocalRoundDraft,
  PendingHoleScoreSync,
  TournamentFormatType,
  TournamentScoringMode,
  TournamentScoringFormat,
  TournamentSpecialHoleRule,
  TournamentStablefordMode,
  TournamentStablefordModifiedPreset,
} from '@/types/round'

type CanonicalYardageQuestionKey =
  | 'club_choice_correct'
  | 'fairway_hit'
  | 'green_in_regulation'
  | 'miss_left'
  | 'miss_right'
  | 'opponent_score'
  | 'penalty'
  | 'sand_save'
  | 'three_putt'
  | 'up_and_down'

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function nowIso() {
  return new Date().toISOString()
}

export function buildHoleSequence(startingHole?: number | null) {
  const start = Math.min(18, Math.max(1, Number(startingHole ?? 1)))
  return Array.from({ length: 18 }, (_, index) => ((start - 1 + index) % 18) + 1)
}

export function getNextHoleNumber(round: LocalRoundDraft, currentHole: number) {
  const sequence = round.holeSequence?.length === 18 ? round.holeSequence : buildHoleSequence(round.startingHole)
  const currentIndex = sequence.indexOf(currentHole)
  if (currentIndex === -1) return Math.min(currentHole + 1, 18)
  return sequence[Math.min(currentIndex + 1, sequence.length - 1)]
}

export function getPreviousHoleNumber(round: LocalRoundDraft, currentHole: number) {
  const sequence = round.holeSequence?.length === 18 ? round.holeSequence : buildHoleSequence(round.startingHole)
  const currentIndex = sequence.indexOf(currentHole)
  if (currentIndex === -1) return Math.max(currentHole - 1, 1)
  return sequence[Math.max(currentIndex - 1, 0)]
}

export function isFirstHoleInSequence(round: LocalRoundDraft, holeNumber: number) {
  const sequence = round.holeSequence?.length === 18 ? round.holeSequence : buildHoleSequence(round.startingHole)
  return sequence[0] === holeNumber
}

export function isLastHoleInSequence(round: LocalRoundDraft, holeNumber: number) {
  const sequence = round.holeSequence?.length === 18 ? round.holeSequence : buildHoleSequence(round.startingHole)
  return sequence[sequence.length - 1] === holeNumber
}

function scoringModeForFormat(formatType: TournamentFormatType | null | undefined): TournamentScoringMode {
  if (formatType === 'scramble') return 'team'
  if (formatType === 'ironman_team_scramble') return 'team_vs_team'
  return 'individual'
}

function isIronmanRound(round: LocalRoundDraft) {
  return round.tournamentFormat === 'ironman_team_scramble' || round.tournamentScoringMode === 'team_vs_team'
}

function isTeamRound(round: LocalRoundDraft) {
  return round.tournamentScoringMode === 'team' || round.tournamentScoringMode === 'team_vs_team'
}

function isCrossCardStrokePlayRound(round: LocalRoundDraft) {
  return (
    round.roundMode === 'tournament' &&
    round.tournamentFormat === 'individual_stroke_play' &&
    round.tournamentScoringFormat !== 'stableford' &&
    !!round.tournamentCrossCardTargetUserId
  )
}

function isTeamFormat(formatType: TournamentFormatType | null | undefined) {
  return isTeamTournamentFormat(formatType)
}

function assertTournamentFormatSupportedForMobileScoring(formatType: TournamentFormatType | null | undefined) {
  if (isMatchPlayTournamentFormat(formatType)) {
    throw new Error('Match Play tournament scoring is not available in the mobile scorer yet.')
  }
}

type TournamentRoundConfig = {
  scoringFormat?: TournamentScoringFormat | null
  stablefordMode?: TournamentStablefordMode | null
  stablefordModifiedPreset?: TournamentStablefordModifiedPreset | null
  handicapEnabled?: boolean | null
  playerHandicap?: number | null
  holeCount?: number | null
  unlimitedRoundsAllowed?: boolean | null
  bestRoundsCount?: number | null
  specialHoleRules?: TournamentSpecialHoleRule[] | null
}

export function applyTournamentRoundConfig(
  round: LocalRoundDraft,
  config: TournamentRoundConfig,
): LocalRoundDraft {
  const tournamentScoringFormat = config.scoringFormat ?? null
  const tournamentStablefordMode = config.stablefordMode ?? null
  const configuredRound: LocalRoundDraft = {
    ...round,
    tournamentScoringFormat,
    tournamentStablefordMode,
    tournamentStablefordModifiedPreset: config.stablefordModifiedPreset ?? null,
    tournamentHandicapEnabled: config.handicapEnabled ?? null,
    tournamentPlayerHandicap:
      typeof config.playerHandicap === 'number' && Number.isFinite(config.playerHandicap)
        ? config.playerHandicap
        : null,
    tournamentHoleCount: config.holeCount ?? null,
    tournamentUnlimitedRoundsAllowed: config.unlimitedRoundsAllowed ?? null,
    tournamentBestRoundsCount: config.bestRoundsCount ?? null,
    tournamentSpecialHoleRules: config.specialHoleRules ?? [],
  }

  const handicapResolution = resolveStablefordHandicap(configuredRound)
  const holesWithStableford =
    tournamentScoringFormat === 'stableford'
      ? configuredRound.holes.map((hole) => applyStablefordToHole(configuredRound, hole))
      : configuredRound.holes

  return {
    ...configuredRound,
    holes: holesWithStableford,
    tournamentStablefordHandicapStatus:
      tournamentScoringFormat === 'stableford'
        ? handicapResolution.status
        : null,
    tournamentStablefordHandicapSource:
      tournamentScoringFormat === 'stableford'
        ? handicapResolution.source
        : null,
    tournamentCourseHandicap:
      tournamentScoringFormat === 'stableford'
        ? handicapResolution.courseHandicap
        : null,
    tournamentStablefordTotal:
      tournamentScoringFormat === 'stableford'
        ? getStablefordRoundTotal({ ...configuredRound, holes: holesWithStableford })
        : null,
  }
}

function buildTeamRoundLinkPayload(params: {
  formatType: TournamentFormatType | null | undefined
  tournamentTeamId?: string | null
  tournamentPairingId?: string | null
  tournamentPlayGroupId?: string | null
}) {
  if (!isTeamFormat(params.formatType) || !params.tournamentTeamId) {
    if (tournamentFormatNeedsPlayGroup(params.formatType) && params.tournamentPlayGroupId) {
      return {
        group_id: params.tournamentPlayGroupId,
      }
    }
    return null
  }

  return {
    team_id: params.tournamentTeamId,
    pairing_id: params.formatType === 'ironman_team_scramble'
      ? (params.tournamentPairingId ?? null)
      : null,
    group_id: null,
  }
}

async function ensureRoundTeamLinkage(params: {
  roundId: string
  formatType: TournamentFormatType | null | undefined
  tournamentTeamId?: string | null
  tournamentPairingId?: string | null
  tournamentPlayGroupId?: string | null
  existingTeamId?: string | null
  existingPairingId?: string | null
  existingGroupId?: string | null
  reason: 'create' | 'reuse' | 'rehydrate'
}) {
  const payload = buildTeamRoundLinkPayload(params)
  if (!payload) return

  const needsUpdate =
    params.reason === 'create'
      ? true
      : (params.existingTeamId ?? null) !== payload.team_id
        || (params.existingPairingId ?? null) !== payload.pairing_id
        || (params.existingGroupId ?? null) !== payload.group_id

  if (!needsUpdate) return

  const updateRes = await supabase
    .from('rounds')
    .update({
      ...payload,
      updated_at: nowIso(),
    })
    .eq('id', params.roundId)

  if (updateRes.error) throw updateRes.error
}

function hasRequiredTeamContext(round: LocalRoundDraft) {
  if (!isTeamRound(round) && !isTeamFormat(round.tournamentFormat)) return true
  if (!round.tournamentTeamId) return false
  if (isIronmanRound(round) && !round.tournamentPairingId) return false
  return true
}

function normalizePostgrestError(error: any) {
  return error?.message ?? 'Sync failed'
}

function hasEnteredHoleScores(round: LocalRoundDraft) {
  return round.holes.some((hole) => typeof hole.score === 'number' && hole.score > 0)
}

function resolveSequenceCurrentHole(round: LocalRoundDraft, startingHole?: number | null) {
  const sequence = buildHoleSequence(startingHole)
  if (!hasEnteredHoleScores(round)) return sequence[0]
  if (sequence.includes(round.currentHole)) return round.currentHole
  return sequence[0]
}

async function touchRound(roundId: string) {
  const updateRoundRes = await supabase
    .from('rounds')
    .update({
      score_entered_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq('id', roundId)

  if (updateRoundRes.error) throw updateRoundRes.error
}

async function refreshRoundPlayerTotal(roundId: string, userId: string, stablefordEnabled = false) {
  const scoresRes = await supabase
    .from('hole_scores')
    .select('strokes, stableford_points')
    .eq('round_id', roundId)
    .eq('user_id', userId)

  if (scoresRes.error) throw scoresRes.error

  const grossTotal = (scoresRes.data ?? []).reduce((sum: number, row: any) => sum + Number(row.strokes ?? 0), 0)
  const stablefordTotal = (scoresRes.data ?? []).reduce(
    (sum: number, row: any) => sum + Number(row.stableford_points ?? 0),
    0,
  )

  const updatePlayerRes = await supabase
    .from('round_players')
    .update(
      stablefordEnabled
        ? {
            gross_total: grossTotal,
            stableford_total: stablefordTotal,
          }
        : {
            gross_total: grossTotal,
          },
    )
    .eq('round_id', roundId)
    .eq('user_id', userId)

  if (updatePlayerRes.error) throw updatePlayerRes.error

  await touchRound(roundId)
}

async function ensureRoundPlayerRow(params: {
  roundId: string
  userId: string
  playerOrder?: number
  isScorer?: boolean
}) {
  const res = await supabase
    .from('round_players')
    .upsert(
      {
        round_id: params.roundId,
        user_id: params.userId,
        player_order: params.playerOrder ?? 1,
        gross_total: 0,
        is_scorer: params.isScorer ?? false,
      },
      {
        onConflict: 'round_id,user_id',
      },
    )

  if (res.error) throw res.error
}

async function listRoundTeamHoleScores(roundId: string) {
  const res = await supabase
    .from('round_team_hole_scores')
    .select('team_score, opponent_score')
    .eq('round_id', roundId)

  if (res.error) throw res.error
  return res.data ?? []
}

async function upsertRoundTeamHoleScore(params: {
  roundId: string
  holeNumber: number
  strokes: number
  opponentScore?: number | null
}) {
  const res = await supabase
    .from('round_team_hole_scores')
    .upsert({
      round_id: params.roundId,
      hole_number: params.holeNumber,
      team_score: params.strokes,
      opponent_score: params.opponentScore ?? null,
      updated_at: nowIso(),
    }, {
      onConflict: 'round_id,hole_number',
    })

  if (res.error) throw res.error
}

async function deleteRoundTeamHoleScore(roundId: string, holeNumber: number) {
  const res = await supabase
    .from('round_team_hole_scores')
    .delete()
    .eq('round_id', roundId)
    .eq('hole_number', holeNumber)

  if (res.error) throw res.error
}

async function resetRoundTeamHoleScores(roundId: string) {
  const res = await supabase
    .from('round_team_hole_scores')
    .delete()
    .eq('round_id', roundId)

  if (res.error) throw res.error
}

async function refreshRoundTeamTotal(roundId: string) {
  await listRoundTeamHoleScores(roundId)
  await touchRound(roundId)
}

export function getPendingScoreSyncSummary(round: LocalRoundDraft | null | undefined) {
  const items = round?.pendingScoreSyncs ?? []
  return {
    pendingCount: items.length,
    failedCount: items.filter((item) => item.status === 'failed').length,
    hasPending: items.length > 0,
  }
}

export function queueTournamentHoleScoreSync(
  round: LocalRoundDraft,
  holeNumber: number,
  strokes: number,
  opponentScore?: number | null,
): LocalRoundDraft {
  const existing = round.pendingScoreSyncs ?? []
  const nextItem: PendingHoleScoreSync = {
    holeNumber,
    strokes,
    opponentScore: opponentScore ?? null,
    status: 'pending',
    queuedAt: nowIso(),
    lastAttemptAt: null,
    lastError: null,
  }

  return {
    ...round,
    backendSyncState: 'score_only',
    pendingScoreSyncs: [...existing.filter((item) => item.holeNumber !== holeNumber), nextItem],
    lastSyncError: null,
  }
}

export function markTournamentHoleScoreSynced(
  round: LocalRoundDraft,
  holeNumber: number,
): LocalRoundDraft {
  const remaining = (round.pendingScoreSyncs ?? []).filter((item) => item.holeNumber !== holeNumber)

  return {
    ...round,
    pendingScoreSyncs: remaining,
    backendSyncState: remaining.length > 0 ? 'score_only' : 'idle',
    lastScoreSyncAt: nowIso(),
    lastSyncError: null,
  }
}

export function markTournamentHoleScoreSyncFailed(
  round: LocalRoundDraft,
  holeNumber: number,
  strokes: number,
  errorMessage: string,
  opponentScore?: number | null,
): LocalRoundDraft {
  const existing = round.pendingScoreSyncs ?? []
  const failedItem: PendingHoleScoreSync = {
    holeNumber,
    strokes,
    opponentScore: opponentScore ?? null,
    status: 'failed',
    queuedAt: existing.find((item) => item.holeNumber === holeNumber)?.queuedAt ?? nowIso(),
    lastAttemptAt: nowIso(),
    lastError: errorMessage,
  }

  return {
    ...round,
    backendSyncState: 'error',
    pendingScoreSyncs: [...existing.filter((item) => item.holeNumber !== holeNumber), failedItem],
    lastSyncError: errorMessage,
  }
}

export function removeTournamentHoleScoreSync(
  round: LocalRoundDraft,
  holeNumber: number,
): LocalRoundDraft {
  const remaining = (round.pendingScoreSyncs ?? []).filter((item) => item.holeNumber !== holeNumber)
  return {
    ...round,
    pendingScoreSyncs: remaining,
    backendSyncState: remaining.length > 0 ? round.backendSyncState : 'idle',
  }
}

export async function ensureTournamentRoundForUser(params: {
  userId: string
  tournamentId: string
  tournamentName?: string | null
  formatType?: TournamentFormatType | null
  tournamentTeamId?: string | null
  tournamentPairingId?: string | null
  tournamentPlayGroupId?: string | null
}) {
  const existingRes = await supabase
    .from('rounds')
    .select(`
      id,
      tournament_id,
      round_date,
      status,
      round_mode,
      created_by_user_id,
      scoring_user_id,
      team_id,
      pairing_id,
      group_id
    `)
    .eq('tournament_id', params.tournamentId)
    .eq('created_by_user_id', params.userId)
    .in('status', ['draft', 'pending_confirmation'])
    .order('round_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingRes.error) throw existingRes.error
  if (existingRes.data?.id) {
    await ensureRoundTeamLinkage({
      roundId: existingRes.data.id,
      formatType: params.formatType,
      tournamentTeamId: params.tournamentTeamId,
      tournamentPairingId: params.tournamentPairingId,
      tournamentPlayGroupId: params.tournamentPlayGroupId,
      existingTeamId: existingRes.data.team_id ?? null,
      existingPairingId: existingRes.data.pairing_id ?? null,
      existingGroupId: existingRes.data.group_id ?? null,
      reason: 'reuse',
    })

    return {
      roundId: existingRes.data.id,
      scoringUserId: existingRes.data.scoring_user_id ?? params.userId,
    }
  }

  const teamLinkPayload = buildTeamRoundLinkPayload({
    formatType: params.formatType,
    tournamentTeamId: params.tournamentTeamId,
    tournamentPairingId: params.tournamentPairingId,
    tournamentPlayGroupId: params.tournamentPlayGroupId,
  })

  const createRes = await supabase
    .from('rounds')
    .insert({
      tournament_id: params.tournamentId,
      course_name: 'Coal Creek',
      round_date: todayIsoDate(),
      created_by_user_id: params.userId,
      scoring_user_id: params.userId,
      status: 'draft',
      round_mode: 'tournament',
      has_score_data: true,
      has_yardage_data: false,
      score_entered_at: nowIso(),
      ...teamLinkPayload,
    })
    .select('id, scoring_user_id')
    .single()

  if (createRes.error) throw createRes.error

  const roundId = createRes.data.id

  const playerRes = await supabase
    .from('round_players')
    .insert({
      round_id: roundId,
      user_id: params.userId,
      player_order: 1,
      gross_total: 0,
      is_scorer: true,
    })

  if (playerRes.error) throw playerRes.error

  return {
    roundId,
    scoringUserId: createRes.data.scoring_user_id ?? params.userId,
  }
}

export async function createTournamentDraftRound(params: {
  userId: string
  tournamentId: string
  tournamentName?: string | null
  formatType?: TournamentFormatType | null
  statsEnabled: boolean
  scoringFormat?: TournamentScoringFormat | null
  stablefordMode?: TournamentStablefordMode | null
  stablefordModifiedPreset?: TournamentStablefordModifiedPreset | null
  handicapEnabled?: boolean | null
  playerHandicap?: number | null
  holeCount?: number | null
  unlimitedRoundsAllowed?: boolean | null
  bestRoundsCount?: number | null
  specialHoleRules?: TournamentSpecialHoleRule[] | null
  tee?: TeeOption | null
  ratingType?: RatingType | null
}): Promise<LocalRoundDraft> {
  const formatType = params.formatType ?? 'individual_stroke_play'
  assertTournamentFormatSupportedForMobileScoring(formatType)
  const baseDraft = applyTournamentRoundConfig({
    id: `${Date.now()}`,
    date: todayIsoDate(),
    tee: params.tee ?? DEFAULT_TEE_OPTION,
    ratingType: params.ratingType ?? 'men',
    currentHole: 1,
    holeSequence: buildHoleSequence(1),
    startingHole: 1,
    roundMode: 'tournament',
    tournamentId: params.tournamentId,
    tournamentName: params.tournamentName ?? null,
    tournamentFormat: formatType,
    tournamentScoringMode: scoringModeForFormat(formatType),
    tournamentTeamId: null,
    tournamentTeamName: null,
    tournamentPairingId: null,
    tournamentOpponentTeamId: null,
    tournamentOpponentTeamName: null,
    tournamentPlayGroupId: null,
    tournamentPlayGroupName: null,
    tournamentTeeTime: null,
    tournamentCrossCardTargetUserId: null,
    tournamentCrossCardTargetName: null,
    backendRoundId: null,
    scoringUserId: null,
    backendSyncState: 'idle',
    statsEnabled: params.statsEnabled,
    pendingScoreSyncs: [],
    lastScoreSyncAt: null,
    lastSyncError: null,
    holes: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1 })),
  }, {
    scoringFormat: params.scoringFormat ?? null,
    stablefordMode: params.stablefordMode ?? null,
    stablefordModifiedPreset: params.stablefordModifiedPreset ?? null,
    handicapEnabled: params.handicapEnabled ?? null,
    playerHandicap: params.playerHandicap ?? null,
    holeCount: params.holeCount ?? null,
    unlimitedRoundsAllowed: params.unlimitedRoundsAllowed ?? null,
    bestRoundsCount: params.bestRoundsCount ?? null,
    specialHoleRules: params.specialHoleRules ?? [],
  })

  const hydrated = await ensureTournamentDraftTeamContext({
    round: baseDraft,
    userId: params.userId,
  })

  const ensured = await ensureTournamentRoundForUser({
    userId: params.userId,
    tournamentId: params.tournamentId,
    tournamentName: params.tournamentName,
    formatType,
    tournamentTeamId: hydrated.round.tournamentTeamId ?? null,
    tournamentPairingId: hydrated.round.tournamentPairingId ?? null,
    tournamentPlayGroupId: hydrated.round.tournamentPlayGroupId ?? null,
  })

  return {
    ...hydrated.round,
    backendRoundId: ensured.roundId,
    scoringUserId: ensured.scoringUserId,
  }
}

export async function ensureTournamentDraftTeamContext(params: {
  round: LocalRoundDraft
  userId: string
}) {
  const { round, userId } = params

  if (round.roundMode !== 'tournament' || !round.tournamentId) {
    return {
      round,
      missingTeamContext: false,
    }
  }

  if (round.tournamentFormat === 'individual_stroke_play') {
    const { getTournamentPlayerGroupContext } = await import('@/lib/tournaments')
    const groupContext = await getTournamentPlayerGroupContext(userId, round.tournamentId, round.tournamentFormat)

    if (!groupContext?.groupId) {
      const lookupState = groupContext?.lookupState
      const baseError =
        lookupState === 'not_tournament_member'
          ? 'Your account is not on the active tournament roster yet.'
          : lookupState === 'member_without_group_assignment'
            ? 'You are on the tournament roster, but no active tee-time group has been assigned yet.'
            : 'No active tee-time group was found for this tournament.'
      const lookupDebugText = groupContext?.lookupDebug
        ? ` Debug: ${JSON.stringify(groupContext.lookupDebug)}`
        : ''
      return {
        round: {
          ...round,
          lastSyncError: `${baseError}${lookupDebugText}`,
        },
        missingTeamContext: true,
      }
    }

    const hydratedRound = {
      ...round,
      currentHole: resolveSequenceCurrentHole(round, groupContext.startingHole ?? 1),
      startingHole: groupContext.startingHole ?? 1,
      holeSequence: buildHoleSequence(groupContext.startingHole ?? 1),
      tournamentPlayGroupId: groupContext.groupId ?? null,
      tournamentPlayGroupName: groupContext.groupName ?? null,
      tournamentTeeTime: groupContext.teeTime ?? null,
      tournamentCrossCardTargetUserId: groupContext.crossCardTargetUserId ?? null,
      tournamentCrossCardTargetName: groupContext.crossCardTargetName ?? null,
      lastSyncError: null,
    }

    if (hydratedRound.backendRoundId) {
      await ensureRoundTeamLinkage({
        roundId: hydratedRound.backendRoundId,
        formatType: hydratedRound.tournamentFormat,
        tournamentPlayGroupId: hydratedRound.tournamentPlayGroupId,
        existingGroupId: null,
        reason: 'rehydrate',
      })
    }

    return {
      round: hydratedRound,
      missingTeamContext: false,
    }
  }

  if (hasRequiredTeamContext(round)) {
    return {
      round,
      missingTeamContext: false,
    }
  }

  const teamContext = await getTournamentTeamContext(userId, round.tournamentId)
  if (!teamContext?.teamId) {
    return {
      round: {
        ...round,
        lastSyncError: 'No active team assignment was found for this tournament.',
      },
      missingTeamContext: true,
    }
  }

  if (isIronmanRound(round) && !teamContext.pairingId) {
    return {
      round: {
        ...round,
        tournamentTeamId: teamContext.teamId,
        tournamentTeamName: teamContext.teamName ?? null,
        tournamentPairingId: null,
        tournamentOpponentTeamId: teamContext.opponentTeamId ?? null,
        tournamentOpponentTeamName: teamContext.opponentTeamName ?? null,
        lastSyncError: 'No active Ironman pairing was found for this team.',
      },
      missingTeamContext: true,
    }
  }

  const hydratedRound = {
    ...round,
    currentHole: resolveSequenceCurrentHole(round, teamContext.startingHole ?? 1),
    tournamentTeamId: teamContext.teamId,
    tournamentTeamName: teamContext.teamName ?? null,
    tournamentPairingId: teamContext.pairingId ?? null,
    tournamentOpponentTeamId: teamContext.opponentTeamId ?? null,
    tournamentOpponentTeamName: teamContext.opponentTeamName ?? null,
    startingHole: teamContext.startingHole ?? 1,
    holeSequence: buildHoleSequence(teamContext.startingHole ?? 1),
    lastSyncError: null,
  }

  if (hydratedRound.backendRoundId) {
    await ensureRoundTeamLinkage({
      roundId: hydratedRound.backendRoundId,
      formatType: hydratedRound.tournamentFormat,
      tournamentTeamId: hydratedRound.tournamentTeamId,
      tournamentPairingId: hydratedRound.tournamentPairingId,
      existingGroupId: null,
      reason: 'rehydrate',
    })
  }

  return {
    round: hydratedRound,
    missingTeamContext: false,
  }
}

export async function syncTournamentHoleScore(params: {
  round: LocalRoundDraft
  userId: string
  holeNumber: number
  strokes: number
  opponentScore?: number | null
}) {
  assertTournamentFormatSupportedForMobileScoring(params.round.tournamentFormat)

  if (!params.round.backendRoundId) {
    throw new Error('Missing backend round id for score sync.')
  }

  if (isTeamRound(params.round)) {
    if (!params.round.tournamentTeamId) {
      throw new Error('Missing tournament team id for team score sync.')
    }

    await upsertRoundTeamHoleScore({
      roundId: params.round.backendRoundId,
      holeNumber: params.holeNumber,
      strokes: params.strokes,
      opponentScore: isIronmanRound(params.round) ? (params.opponentScore ?? null) : null,
    })

    await refreshRoundTeamTotal(params.round.backendRoundId)
    return
  }

  const stablefordEnabled = isStablefordRound(params.round)
  const stablefordHole =
    stablefordEnabled
      ? params.round.holes.find((hole) => hole.hole === params.holeNumber) ?? null
      : null
  const basePayload = {
    round_id: params.round.backendRoundId,
    user_id: params.userId,
    hole_number: params.holeNumber,
    strokes: params.strokes,
    updated_at: nowIso(),
  }

  const upsertRes = await supabase
    .from('hole_scores')
    .upsert(stablefordEnabled
      ? {
          ...basePayload,
          stableford_points: stablefordHole?.stablefordPoints ?? null,
          stableford_basis: stablefordHole?.stablefordBasis ?? null,
          stableford_result_label: stablefordHole?.stablefordResultLabel ?? null,
          stableford_net_strokes: stablefordHole?.stablefordNetStrokes ?? null,
          stableford_handicap_strokes: stablefordHole?.stablefordHandicapStrokes ?? null,
          stableford_handicap_status: stablefordHole?.stablefordHandicapStatus ?? null,
        }
      : basePayload, {
      onConflict: 'round_id,user_id,hole_number',
    })

  if (upsertRes.error) throw upsertRes.error

  await refreshRoundPlayerTotal(params.round.backendRoundId, params.userId, stablefordEnabled)

  if (
    isCrossCardStrokePlayRound(params.round) &&
    params.round.tournamentCrossCardTargetUserId &&
    typeof params.opponentScore === 'number' &&
    params.opponentScore > 0
  ) {
    await ensureRoundPlayerRow({
      roundId: params.round.backendRoundId,
      userId: params.round.tournamentCrossCardTargetUserId,
      playerOrder: 2,
      isScorer: false,
    })

    const crossCardRes = await supabase
      .from('hole_scores')
      .upsert(
        {
          round_id: params.round.backendRoundId,
          user_id: params.round.tournamentCrossCardTargetUserId,
          hole_number: params.holeNumber,
          strokes: params.opponentScore,
          updated_at: nowIso(),
        },
        {
          onConflict: 'round_id,user_id,hole_number',
        },
      )

    if (crossCardRes.error) throw crossCardRes.error

    await refreshRoundPlayerTotal(
      params.round.backendRoundId,
      params.round.tournamentCrossCardTargetUserId,
      false,
    )
  }
}

export async function retryPendingTournamentHoleSyncs(params: {
  round: LocalRoundDraft
  userId: string
}) {
  let nextRound = { ...params.round }
  let syncedCount = 0
  let failedCount = 0

  if (!nextRound.backendRoundId) {
    return { round: nextRound, syncedCount, failedCount }
  }

  const queue = [...(nextRound.pendingScoreSyncs ?? [])].sort((a, b) => a.holeNumber - b.holeNumber)

  for (const item of queue) {
    try {
      await syncTournamentHoleScore({
        round: nextRound,
        userId: params.userId,
        holeNumber: item.holeNumber,
        strokes: item.strokes,
        opponentScore: item.opponentScore ?? null,
      })
      nextRound = markTournamentHoleScoreSynced(nextRound, item.holeNumber)
      syncedCount += 1
    } catch (error: any) {
      nextRound = markTournamentHoleScoreSyncFailed(
        nextRound,
        item.holeNumber,
        item.strokes,
        normalizePostgrestError(error),
        item.opponentScore ?? null,
      )
      failedCount += 1
    }
  }

  return {
    round: nextRound,
    syncedCount,
    failedCount,
  }
}

export async function deleteTournamentHoleScore(params: {
  round: LocalRoundDraft
  userId: string
  holeNumber: number
}) {
  if (!params.round.backendRoundId) throw new Error('Missing round id for hole delete.')

  if (isTeamRound(params.round)) {
    if (!params.round.tournamentTeamId) throw new Error('Missing team id for team hole delete.')
    await deleteRoundTeamHoleScore(params.round.backendRoundId, params.holeNumber)
    await refreshRoundTeamTotal(params.round.backendRoundId)
    return
  }

  const deleteScoreRes = await supabase
    .from('hole_scores')
    .delete()
    .eq('round_id', params.round.backendRoundId)
    .eq('user_id', params.userId)
    .eq('hole_number', params.holeNumber)

  if (deleteScoreRes.error) throw deleteScoreRes.error

  if (isCrossCardStrokePlayRound(params.round) && params.round.tournamentCrossCardTargetUserId) {
    const deleteCrossCardRes = await supabase
      .from('hole_scores')
      .delete()
      .eq('round_id', params.round.backendRoundId)
      .eq('user_id', params.round.tournamentCrossCardTargetUserId)
      .eq('hole_number', params.holeNumber)

    if (deleteCrossCardRes.error) throw deleteCrossCardRes.error
  }

  const deleteAnswersRes = await supabase
    .from('round_yardage_answers')
    .delete()
    .eq('round_id', params.round.backendRoundId)
    .eq('user_id', params.userId)
    .eq('hole_number', params.holeNumber)

  if (deleteAnswersRes.error) {
    console.warn('round_yardage_answers delete failed', deleteAnswersRes.error.message)
  }

  await refreshRoundPlayerTotal(
    params.round.backendRoundId,
    params.userId,
    isStablefordRound(params.round),
  )

  if (isCrossCardStrokePlayRound(params.round) && params.round.tournamentCrossCardTargetUserId) {
    await refreshRoundPlayerTotal(
      params.round.backendRoundId,
      params.round.tournamentCrossCardTargetUserId,
      false,
    )
  }
}

export async function resetTournamentRound(params: {
  round: LocalRoundDraft
  userId: string
}) {
  if (!params.round.backendRoundId) throw new Error('Missing round id for round reset.')

  if (isTeamRound(params.round) && params.round.tournamentTeamId) {
    await resetRoundTeamHoleScores(params.round.backendRoundId)

    const roundRes = await supabase
      .from('rounds')
      .update({
        status: 'draft',
        has_yardage_data: false,
        score_entered_at: null,
        yardage_entered_at: null,
        submitted_at: null,
        confirmed_at: null,
        updated_at: nowIso(),
      })
      .eq('id', params.round.backendRoundId)

    if (roundRes.error) throw roundRes.error
    return
  }

  const deleteScoresRes = await supabase
    .from('hole_scores')
    .delete()
    .eq('round_id', params.round.backendRoundId)
    .eq('user_id', params.userId)

  if (deleteScoresRes.error) throw deleteScoresRes.error

  if (isCrossCardStrokePlayRound(params.round) && params.round.tournamentCrossCardTargetUserId) {
    const deleteCrossCardScoresRes = await supabase
      .from('hole_scores')
      .delete()
      .eq('round_id', params.round.backendRoundId)
      .eq('user_id', params.round.tournamentCrossCardTargetUserId)

    if (deleteCrossCardScoresRes.error) throw deleteCrossCardScoresRes.error
  }

  const deleteAnswersRes = await supabase
    .from('round_yardage_answers')
    .delete()
    .eq('round_id', params.round.backendRoundId)
    .eq('user_id', params.userId)

  if (deleteAnswersRes.error) {
    console.warn('round_yardage_answers reset failed', deleteAnswersRes.error.message)
  }

  const deleteStatsRes = await supabase
    .from('round_yardage_stats')
    .delete()
    .eq('round_id', params.round.backendRoundId)
    .eq('user_id', params.userId)

  if (deleteStatsRes.error) {
    console.warn('round_yardage_stats reset failed', deleteStatsRes.error.message)
  }

  const playerRes = await supabase
    .from('round_players')
    .update(
      isStablefordRound(params.round)
        ? {
            gross_total: 0,
            stableford_total: 0,
          }
        : {
            gross_total: 0,
          },
    )
    .eq('round_id', params.round.backendRoundId)
    .eq('user_id', params.userId)

  if (playerRes.error) throw playerRes.error

  if (isCrossCardStrokePlayRound(params.round) && params.round.tournamentCrossCardTargetUserId) {
    const crossCardPlayerRes = await supabase
      .from('round_players')
      .update({
        gross_total: 0,
      })
      .eq('round_id', params.round.backendRoundId)
      .eq('user_id', params.round.tournamentCrossCardTargetUserId)

    if (crossCardPlayerRes.error) throw crossCardPlayerRes.error
  }

  const roundRes = await supabase
    .from('rounds')
    .update({
      status: 'draft',
      has_yardage_data: false,
      score_entered_at: null,
      yardage_entered_at: null,
      submitted_at: null,
      confirmed_at: null,
      updated_at: nowIso(),
    })
    .eq('id', params.round.backendRoundId)

  if (roundRes.error) throw roundRes.error
}

async function upsertYardageStat(roundId: string, userId: string, payload: any) {
  const res = await supabase
    .from('round_yardage_stats')
    .upsert({
      round_id: roundId,
      user_id: userId,
      ...payload,
      updated_at: nowIso(),
    }, {
      onConflict: 'round_id,user_id',
    })

  if (res.error) throw res.error
}

async function upsertYardageAnswer(row: {
  round_id: string
  user_id: string
  hole_number: number
  question_key: CanonicalYardageQuestionKey
  answer_boolean?: boolean | null
  answer_text?: string | null
  answer_number?: number | null
}) {
  const res = await supabase
    .from('round_yardage_answers')
    .upsert({
      ...row,
      updated_at: nowIso(),
    }, {
      onConflict: 'round_id,user_id,hole_number,question_key',
    })

  if (res.error) throw res.error
}

export async function finalizeTournamentRoundSync(params: {
  round: LocalRoundDraft
  userId: string
}) {
  const { round, userId } = params
  if (!round.backendRoundId) throw new Error('Missing backend round id for tournament round.')
  if (!round.tournamentId) throw new Error('Missing tournament id for tournament round.')

  const finalizedHoles = round.holes.map((hole) => {
    const courseHole = holes.find((item) => item.hole === hole.hole)
    const finalizedHole = courseHole ? finalizeHoleStats(hole, courseHole.par) : hole
    return applyStablefordToHole(round, finalizedHole)
  })
  const finalizedRound = {
    ...round,
    holes: finalizedHoles,
    tournamentStablefordTotal: isStablefordRound(round) ? getStablefordRoundTotal({ ...round, holes: finalizedHoles }) : null,
  }

  for (const hole of finalizedHoles) {
    if (typeof hole.score === 'number' && hole.score > 0) {
      await syncTournamentHoleScore({
        round: finalizedRound,
        userId,
        holeNumber: hole.hole,
        strokes: hole.score,
        opponentScore: hole.opponentScore ?? null,
      })
    }
  }

  if (isTeamRound(round)) {
    const submitRes = await supabase.rpc('submit_round', {
      p_round_id: round.backendRoundId,
      p_submitted_by: userId,
    })

    if (submitRes.error) {
      console.warn('submit_round failed', submitRes.error.message)
    }

    return {
      finalizedHoles,
      summary: summarizeRound(finalizedHoles),
    }
  }

  if (!round.statsEnabled) {
    const submitRes = await supabase.rpc('submit_round', {
      p_round_id: round.backendRoundId,
      p_submitted_by: userId,
    })

    if (submitRes.error) {
      console.warn('submit_round failed', submitRes.error.message)
    }

    return {
      finalizedHoles,
      summary: summarizeRound(finalizedHoles),
    }
  }

  const summary = summarizeRound(finalizedHoles)

  await upsertYardageStat(round.backendRoundId, userId, {
    fairways_hit: summary.fairwaysHit,
    greens_in_regulation: summary.greensInRegulation,
    putts: summary.totalPutts,
    penalty_strokes: summary.penalties,
    scrambling_successes: summary.upAndDowns,
    sand_saves: 0,
  })

  for (const hole of finalizedHoles) {
    const isPar3 = holes.find((item) => item.hole === hole.hole)?.par === 3
    const fairwayHit = isPar3 ? null : (hole.driveSafe ?? null)
    const penalty = hole.drivePenalty === true || hole.girMissPenalty === true

    if (fairwayHit !== null) {
      await upsertYardageAnswer({
        round_id: round.backendRoundId,
        user_id: userId,
        hole_number: hole.hole,
        question_key: 'fairway_hit',
        answer_boolean: fairwayHit,
      })
    }

    if (typeof hole.hitGreen === 'boolean') {
      await upsertYardageAnswer({
        round_id: round.backendRoundId,
        user_id: userId,
        hole_number: hole.hole,
        question_key: 'green_in_regulation',
        answer_boolean: hole.hitGreen,
      })
    }

    if (typeof hole.upAndDownMade === 'boolean') {
      await upsertYardageAnswer({
        round_id: round.backendRoundId,
        user_id: userId,
        hole_number: hole.hole,
        question_key: 'up_and_down',
        answer_boolean: hole.upAndDownMade,
      })
    }

    await upsertYardageAnswer({
      round_id: round.backendRoundId,
      user_id: userId,
      hole_number: hole.hole,
      question_key: 'penalty',
      answer_boolean: penalty,
    })

    if (typeof hole.totalPutts === 'number') {
      await upsertYardageAnswer({
        round_id: round.backendRoundId,
        user_id: userId,
        hole_number: hole.hole,
        question_key: 'three_putt',
        answer_boolean: hole.threePutt ?? hole.totalPutts >= 3,
      })
    }
  }

  const markRoundRes = await supabase
    .from('rounds')
    .update({
      has_yardage_data: true,
      yardage_entered_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq('id', round.backendRoundId)

  if (markRoundRes.error) throw markRoundRes.error

  const submitRes = await supabase.rpc('submit_round', {
    p_round_id: round.backendRoundId,
    p_submitted_by: userId,
  })

  if (submitRes.error) {
    console.warn('submit_round failed', submitRes.error.message)
  }

  return {
    finalizedHoles,
    summary,
  }
}
