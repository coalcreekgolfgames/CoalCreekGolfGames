import type {
  TournamentCompetitionForUser,
  TournamentLeaderboardRow,
} from '@/lib/tournaments'

export type StrokeCompetitionKey = 'stroke_gross' | 'stroke_net'

export type StrokeCompetitionResultRow = {
  rank: number
  name: string
  total: number
  grossTotal: number
  adjustedHandicap: number | null
  thruLabel: string
  leaderboardStatus: string
  lastHoleEntered: number | null
}

export type StrokeCompetitionResultSection = {
  competitionId: string
  competitionKey: StrokeCompetitionKey
  competitionName: string
  handicapMode: 'gross' | 'net'
  state: 'ready' | 'empty' | 'missing_handicaps'
  message: string | null
  rows: StrokeCompetitionResultRow[]
}

function normalizeCompetitionKey(value: string | null | undefined): StrokeCompetitionKey | null {
  if (value === 'stroke_gross' || value === 'main_low_gross') return 'stroke_gross'
  if (value === 'stroke_net' || value === 'main_low_net') return 'stroke_net'
  return null
}

function resolveRowName(row: TournamentLeaderboardRow) {
  if (row.display_name?.trim()) return row.display_name.trim()
  return `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Player'
}

function rankRows<T extends { total: number }>(rows: T[]) {
  let previousTotal: number | null = null
  let previousRank = 0
  return rows.map((row, index) => {
    const rank = previousTotal !== null && row.total === previousTotal ? previousRank : index + 1
    previousTotal = row.total
    previousRank = rank
    return { ...row, rank }
  })
}

export function buildStrokeCompetitionResults(params: {
  competitions: TournamentCompetitionForUser[]
  leaderboardRows: TournamentLeaderboardRow[]
  handicapByUserId: Record<string, number | null>
}) : StrokeCompetitionResultSection[] {
  const { competitions, leaderboardRows, handicapByUserId } = params
  const scoredRows = leaderboardRows.filter((row) => row.entity_type !== 'team' && typeof row.current_total_score === 'number')
  const sections: StrokeCompetitionResultSection[] = []

  for (const competition of competitions) {
    if (!competition.is_active) continue
    const normalizedKey = normalizeCompetitionKey(competition.competition_key)
    if (!normalizedKey) continue

    if (scoredRows.length === 0) {
      sections.push({
        competitionId: competition.id,
        competitionKey: normalizedKey,
        competitionName: competition.name,
        handicapMode: normalizedKey === 'stroke_net' ? 'net' : 'gross',
        state: 'empty',
        message: 'No scores have been entered yet.',
        rows: [],
      })
      continue
    }

    if (normalizedKey === 'stroke_net') {
      const allowance = Number.isFinite(Number(competition.handicap_allowance))
        ? Number(competition.handicap_allowance)
        : 100
      const missingHandicap = scoredRows.some((row) => typeof handicapByUserId[row.user_id ?? ''] !== 'number')

      if (missingHandicap) {
        sections.push({
          competitionId: competition.id,
          competitionKey: normalizedKey,
          competitionName: competition.name,
          handicapMode: 'net',
          state: 'missing_handicaps',
          message: 'Net results need player handicaps before they can be calculated.',
          rows: [],
        })
        continue
      }

      const rankedRows = rankRows(
        [...scoredRows]
          .map((row) => {
            const handicap = handicapByUserId[row.user_id ?? ''] ?? 0
            const adjustedHandicap = Math.round(handicap * (allowance / 100))
            return {
              name: resolveRowName(row),
              total: Number(row.current_total_score ?? 0) - adjustedHandicap,
              grossTotal: Number(row.current_total_score ?? 0),
              adjustedHandicap,
              thruLabel: row.thru_label ?? '-',
              leaderboardStatus: row.leaderboard_status ?? 'In Progress',
              lastHoleEntered: row.last_hole_entered ?? null,
            }
          })
          .sort((a, b) => a.total - b.total || a.grossTotal - b.grossTotal || a.name.localeCompare(b.name)),
      )

      sections.push({
        competitionId: competition.id,
        competitionKey: normalizedKey,
        competitionName: competition.name,
        handicapMode: 'net',
        state: 'ready',
        message: null,
        rows: competition.leaderboard_limit ? rankedRows.slice(0, competition.leaderboard_limit) : rankedRows,
      })
      continue
    }

    const rankedRows = rankRows(
      [...scoredRows]
        .map((row) => ({
          name: resolveRowName(row),
          total: Number(row.current_total_score ?? 0),
          grossTotal: Number(row.current_total_score ?? 0),
          adjustedHandicap: null,
          thruLabel: row.thru_label ?? '-',
          leaderboardStatus: row.leaderboard_status ?? 'In Progress',
          lastHoleEntered: row.last_hole_entered ?? null,
        }))
        .sort((a, b) => a.total - b.total || a.name.localeCompare(b.name)),
    )

    sections.push({
      competitionId: competition.id,
      competitionKey: normalizedKey,
      competitionName: competition.name,
      handicapMode: 'gross',
      state: 'ready',
      message: null,
      rows: competition.leaderboard_limit ? rankedRows.slice(0, competition.leaderboard_limit) : rankedRows,
    })
  }

  return sections.sort((a, b) => {
    const aCompetition = competitions.find((competition) => competition.id === a.competitionId)
    const bCompetition = competitions.find((competition) => competition.id === b.competitionId)
    return Number(aCompetition?.sort_order ?? 0) - Number(bCompetition?.sort_order ?? 0)
  })
}
