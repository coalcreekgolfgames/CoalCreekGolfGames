export type RyderCupMatchFormat = 'singles' | 'four_ball' | 'foursomes' | 'scramble'
export type RyderCupEventStatus = 'draft' | 'active' | 'completed' | 'archived'
export type RyderCupSessionStatus = 'draft' | 'active' | 'completed' | 'archived'
export type RyderCupMatchStatus = 'scheduled' | 'active' | 'completed' | 'cancelled'
export type RyderCupHandicapMode = 'gross' | 'net'

export type RyderCupEvent = {
  id: string
  tournament_id: string
  competition_id?: string | null
  name: string
  scoring_mode: 'match_points'
  handicap_mode: RyderCupHandicapMode
  status: RyderCupEventStatus
  created_at?: string | null
  updated_at?: string | null
}

export type RyderCupTeam = {
  id: string
  ryder_cup_event_id: string
  name: string
  color?: string | null
  display_order: number
  captain_tournament_player_id?: string | null
  created_at?: string | null
}

export type RyderCupTeamMember = {
  id: string
  ryder_cup_team_id: string
  tournament_player_id: string
  created_at?: string | null
}

export type RyderCupSession = {
  id: string
  ryder_cup_event_id: string
  name: string
  session_date?: string | null
  display_order: number
  default_match_format: RyderCupMatchFormat
  status: RyderCupSessionStatus
  created_at?: string | null
}

export type RyderCupMatch = {
  id: string
  ryder_cup_event_id: string
  session_id: string
  tournament_match_id?: string | null
  match_format: RyderCupMatchFormat
  team_a_id: string
  team_b_id: string
  team_a_points: number
  team_b_points: number
  status: RyderCupMatchStatus
  display_order: number
  created_at?: string | null
}

export type RyderCupMatchPointResult = 'team_a' | 'team_b' | 'halved' | 'incomplete'

export type RyderCupMatchPoints = {
  teamAPoints: number
  teamBPoints: number
  result: RyderCupMatchPointResult
}

export type RyderCupMatchSummaryInput = {
  id?: string | null
  session_id?: string | null
  sessionId?: string | null
  status?: string | null
  team_a_points?: number | null
  team_b_points?: number | null
  teamAPoints?: number | null
  teamBPoints?: number | null
  winner?: string | null
  result?: string | null
  winnerSide?: string | null
  winnerParticipantId?: string | null
  winner_participant_id?: string | null
  playerAParticipantId?: string | null
  playerBParticipantId?: string | null
  player_a_participant_id?: string | null
  player_b_participant_id?: string | null
  teamAParticipantIds?: string[] | null
  teamBParticipantIds?: string[] | null
}

export type RyderCupTeamScoreSummary = {
  teamAPoints: number
  teamBPoints: number
  completedMatchCount: number
  remainingMatchCount: number
  matches: Array<RyderCupMatchPoints & { id: string | null }>
}

export type RyderCupSessionScoreSummary = {
  sessionId: string
  sessionName: string
  teamAPoints: number
  teamBPoints: number
  completedMatchCount: number
  remainingMatchCount: number
}

export type RyderCupLeaderboardSummary = {
  eventId: string
  eventName: string
  teamA: RyderCupTeam | null
  teamB: RyderCupTeam | null
  teamAPoints: number
  teamBPoints: number
  completedMatchCount: number
  remainingMatchCount: number
  sessions: RyderCupSessionScoreSummary[]
}
