import type {
  RyderCupEvent,
  RyderCupLeaderboardSummary,
  RyderCupMatchFormat,
  RyderCupMatchPoints,
  RyderCupMatchSummaryInput,
  RyderCupSession,
  RyderCupSessionScoreSummary,
  RyderCupTeam,
  RyderCupTeamScoreSummary,
} from '@/types/ryderCup'

const RYDER_CUP_MATCH_FORMATS = ['singles', 'four_ball', 'foursomes', 'scramble'] as const

export function isRyderCupMatchFormat(value: unknown): value is RyderCupMatchFormat {
  return typeof value === 'string' && RYDER_CUP_MATCH_FORMATS.includes(value as RyderCupMatchFormat)
}

export function getRyderCupDisplayFormat(format: RyderCupMatchFormat): string {
  switch (format) {
    case 'singles':
      return 'Singles'
    case 'four_ball':
      return 'Four-Ball / Better Ball'
    case 'foursomes':
      return 'Foursomes / Alternate Shot'
    case 'scramble':
      return 'Scramble'
    default:
      return 'Unknown Format'
  }
}

function normalizeResultValue(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : ''
}

function includesParticipant(participantIds: string[] | null | undefined, participantId: string | null | undefined) {
  if (!participantId || !Array.isArray(participantIds)) return false
  return participantIds.includes(participantId)
}

function numericPoints(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

function pointsFromStoredMatch(input: RyderCupMatchSummaryInput): RyderCupMatchPoints | null {
  const status = normalizeResultValue(input.status)
  const teamAPoints = numericPoints(input.teamAPoints ?? input.team_a_points)
  const teamBPoints = numericPoints(input.teamBPoints ?? input.team_b_points)

  if (status !== 'completed' || teamAPoints == null || teamBPoints == null) return null

  if (teamAPoints === 1 && teamBPoints === 0) {
    return { teamAPoints, teamBPoints, result: 'team_a' }
  }
  if (teamAPoints === 0 && teamBPoints === 1) {
    return { teamAPoints, teamBPoints, result: 'team_b' }
  }
  if (teamAPoints === 0.5 && teamBPoints === 0.5) {
    return { teamAPoints, teamBPoints, result: 'halved' }
  }

  return null
}

export function getRyderCupMatchPoints(input: RyderCupMatchSummaryInput): RyderCupMatchPoints {
  const storedPoints = pointsFromStoredMatch(input)
  if (storedPoints) return storedPoints

  const status = normalizeResultValue(input.status)
  const result = normalizeResultValue(input.result ?? input.winner ?? input.winnerSide)
  const winnerParticipantId = input.winnerParticipantId ?? input.winner_participant_id ?? null
  const playerAParticipantId = input.playerAParticipantId ?? input.player_a_participant_id ?? null
  const playerBParticipantId = input.playerBParticipantId ?? input.player_b_participant_id ?? null

  if (['team_a', 'a', 'player_a', 'home'].includes(result)) {
    return { teamAPoints: 1, teamBPoints: 0, result: 'team_a' }
  }
  if (['team_b', 'b', 'player_b', 'away'].includes(result)) {
    return { teamAPoints: 0, teamBPoints: 1, result: 'team_b' }
  }
  if (['halve', 'halved', 'tie', 'tied', 'draw', 'all_square'].includes(result) || status === 'tied') {
    return { teamAPoints: 0.5, teamBPoints: 0.5, result: 'halved' }
  }

  if (winnerParticipantId) {
    if (includesParticipant(input.teamAParticipantIds, winnerParticipantId) || winnerParticipantId === playerAParticipantId) {
      return { teamAPoints: 1, teamBPoints: 0, result: 'team_a' }
    }
    if (includesParticipant(input.teamBParticipantIds, winnerParticipantId) || winnerParticipantId === playerBParticipantId) {
      return { teamAPoints: 0, teamBPoints: 1, result: 'team_b' }
    }
  }

  return { teamAPoints: 0, teamBPoints: 0, result: 'incomplete' }
}

export function summarizeRyderCupTeamPoints(matches: RyderCupMatchSummaryInput[]): RyderCupTeamScoreSummary {
  const summarizedMatches = matches.map((match) => ({
    id: match.id ?? null,
    ...getRyderCupMatchPoints(match),
  }))

  return {
    teamAPoints: summarizedMatches.reduce((sum, match) => sum + match.teamAPoints, 0),
    teamBPoints: summarizedMatches.reduce((sum, match) => sum + match.teamBPoints, 0),
    completedMatchCount: summarizedMatches.filter((match) => match.result !== 'incomplete').length,
    remainingMatchCount: summarizedMatches.filter((match) => match.result === 'incomplete').length,
    matches: summarizedMatches,
  }
}

export function summarizeRyderCupSessionPoints(
  matches: RyderCupMatchSummaryInput[],
  sessions: Array<Pick<RyderCupSession, 'id' | 'name' | 'display_order'>>,
): RyderCupSessionScoreSummary[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]))
  const sessionIds = new Set<string>(sessions.map((session) => session.id))

  for (const match of matches) {
    const sessionId = match.sessionId ?? match.session_id ?? null
    if (sessionId) sessionIds.add(sessionId)
  }

  return Array.from(sessionIds)
    .map((sessionId) => {
      const session = sessionsById.get(sessionId) ?? null
      const sessionMatches = matches.filter((match) => (match.sessionId ?? match.session_id ?? null) === sessionId)
      const summary = summarizeRyderCupTeamPoints(sessionMatches)

      return {
        sessionId,
        sessionName: session?.name ?? 'Session',
        teamAPoints: summary.teamAPoints,
        teamBPoints: summary.teamBPoints,
        completedMatchCount: summary.completedMatchCount,
        remainingMatchCount: summary.remainingMatchCount,
      }
    })
    .sort((a, b) => {
      const sessionA = sessionsById.get(a.sessionId)
      const sessionB = sessionsById.get(b.sessionId)
      const orderDiff = Number(sessionA?.display_order ?? 0) - Number(sessionB?.display_order ?? 0)
      if (orderDiff !== 0) return orderDiff
      return a.sessionName.localeCompare(b.sessionName)
    })
}

export function buildRyderCupLeaderboardSummary(
  event: Pick<RyderCupEvent, 'id' | 'name'>,
  teams: RyderCupTeam[],
  sessions: RyderCupSession[],
  matches: RyderCupMatchSummaryInput[],
): RyderCupLeaderboardSummary {
  const orderedTeams = [...teams].sort((a, b) => {
    const orderDiff = Number(a.display_order ?? 0) - Number(b.display_order ?? 0)
    if (orderDiff !== 0) return orderDiff
    return a.name.localeCompare(b.name)
  })
  const teamSummary = summarizeRyderCupTeamPoints(matches)

  return {
    eventId: event.id,
    eventName: event.name,
    teamA: orderedTeams[0] ?? null,
    teamB: orderedTeams[1] ?? null,
    teamAPoints: teamSummary.teamAPoints,
    teamBPoints: teamSummary.teamBPoints,
    completedMatchCount: teamSummary.completedMatchCount,
    remainingMatchCount: teamSummary.remainingMatchCount,
    sessions: summarizeRyderCupSessionPoints(matches, sessions),
  }
}
