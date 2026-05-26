import type { TournamentFormatType } from '@/types/round'

export function formatTournamentFormatLabel(formatType: TournamentFormatType | null | undefined) {
  if (formatType === 'individual_stroke_play') return 'Stroke Play'
  if (formatType === 'scramble') return 'Scramble'
  if (formatType === 'ironman_team_scramble') return 'Ironman'
  if (formatType === 'singles_match_play') return 'Singles Match Play'
  if (formatType === 'match_play_bracket') return 'Match Play Bracket'
  return formatType ?? 'Tournament'
}

export function isTeamTournamentFormat(formatType: TournamentFormatType | null | undefined) {
  return formatType === 'scramble' || formatType === 'ironman_team_scramble'
}

export function isMatchPlayTournamentFormat(formatType: TournamentFormatType | null | undefined) {
  return formatType === 'singles_match_play' || formatType === 'match_play_bracket'
}

export function isBracketTournamentFormat(formatType: TournamentFormatType | null | undefined) {
  return formatType === 'match_play_bracket'
}

export function supportsTournamentStatsChoice(formatType: TournamentFormatType | null | undefined) {
  return formatType === 'individual_stroke_play'
}

export function tournamentFormatNeedsPlayGroup(formatType: TournamentFormatType | null | undefined) {
  return formatType === 'individual_stroke_play' || formatType === 'singles_match_play' || formatType === 'match_play_bracket'
}
