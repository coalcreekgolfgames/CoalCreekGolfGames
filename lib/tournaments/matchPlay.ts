import { holes as courseHoles } from '@/constants/course'
import type {
  MatchPlayConcededBy,
  MatchPlayConcessionType,
  MatchPlayHandicapMode,
  MatchPlayHoleWinner,
  MatchPlayScoringMode,
  MatchPlayTieHandling,
} from '@/types/round'

export type MatchPlayHoleDefinition = {
  holeNumber: number
  par?: number | null
  strokeIndex?: number | null
}

export type MatchPlayHoleInput = MatchPlayHoleDefinition & {
  playerAGross?: number | null
  playerBGross?: number | null
  concededBy?: MatchPlayConcededBy | null
  concessionType?: MatchPlayConcessionType | null
}

export type MatchPlayScorecardInput = {
  scoringMode?: MatchPlayScoringMode | null
  handicapMode?: MatchPlayHandicapMode | null
  tieHandling?: MatchPlayTieHandling | null
  playerAName?: string | null
  playerBName?: string | null
  playerAPlayingHandicap?: number | null
  playerBPlayingHandicap?: number | null
  holes?: MatchPlayHoleInput[] | null
  totalHoles?: number | null
}

export type MatchPlayStrokeAllocation = {
  playerAPlayingHandicap: number
  playerBPlayingHandicap: number
  difference: number
  lowerHandicapPlayer: 'a' | 'b' | null
  handicapStatus: 'ready' | 'missing_handicap' | 'missing_stroke_index' | 'gross_only'
  handicapMessage: string | null
  playerAByHole: Record<number, number>
  playerBByHole: Record<number, number>
}

export type MatchPlayStatusSummary = {
  completedHoles: number
  playerAHolesWon: number
  playerBHolesWon: number
  leader: 'a' | 'b' | null
  currentLeaderParticipant: 'a' | 'b' | null
  margin: number
  holesRemaining: number
  dormie: boolean
  complete: boolean
  winner: 'a' | 'b' | null
  finalResultLabel: string | null
  statusLabel: string
}

export type MatchPlayCalculatedHole = MatchPlayHoleInput & {
  playerAStrokesReceived: number
  playerBStrokesReceived: number
  playerANet: number | null
  playerBNet: number | null
  winner: MatchPlayHoleWinner | null
  resultLabel: string | null
  status: MatchPlayStatusSummary
}

export type MatchPlayScorecardResult = {
  strokes: MatchPlayStrokeAllocation
  holes: MatchPlayCalculatedHole[]
  status: MatchPlayStatusSummary
}

export type MatchPlayPostingPreview = {
  supported: boolean
  requiresManualPosting: boolean
  message: string
  playedHoleCount: number
  unplayedHoleNumbers: number[]
  grossScoresByHole: Array<{
    holeNumber: number
    playerAGross: number | null
    playerBGross: number | null
  }>
}

const DEFAULT_TOTAL_HOLES = 18

function playerLabel(side: 'a' | 'b', names?: { playerAName?: string | null; playerBName?: string | null }) {
  if (side === 'a') return names?.playerAName?.trim() || 'Player A'
  return names?.playerBName?.trim() || 'Player B'
}

function normalizeHandicap(value: number | null | undefined) {
  if (value == null) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(0, Math.round(numeric))
}

function normalizedTotalHoles(holes: MatchPlayHoleInput[], totalHoles?: number | null) {
  const explicit = Number(totalHoles ?? 0)
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1, Math.round(explicit))
  }
  const maxHole = holes.reduce((max, hole) => Math.max(max, Number(hole.holeNumber ?? 0)), 0)
  return Math.max(DEFAULT_TOTAL_HOLES, maxHole || 0)
}

function buildHoleRanking(holes: MatchPlayHoleDefinition[]) {
  return [...holes]
    .filter((hole) => Number.isFinite(Number(hole.strokeIndex ?? NaN)) && Number(hole.strokeIndex) > 0)
    .sort((a, b) => {
      const strokeDiff = Number(a.strokeIndex ?? 0) - Number(b.strokeIndex ?? 0)
      if (strokeDiff !== 0) return strokeDiff
      return a.holeNumber - b.holeNumber
    })
}

function assignStrokesByHole(holeRanking: MatchPlayHoleDefinition[], strokesToAllocate: number) {
  const allocations: Record<number, number> = {}
  if (strokesToAllocate <= 0 || holeRanking.length === 0) return allocations

  for (let index = 0; index < strokesToAllocate; index += 1) {
    const hole = holeRanking[index % holeRanking.length]
    allocations[hole.holeNumber] = (allocations[hole.holeNumber] ?? 0) + 1
  }

  return allocations
}

export function buildDefaultMatchPlayHoleDefinitions(totalHoles = DEFAULT_TOTAL_HOLES): MatchPlayHoleDefinition[] {
  return courseHoles.slice(0, totalHoles).map((hole) => ({
    holeNumber: hole.hole,
    par: hole.par,
    strokeIndex: hole.hcp,
  }))
}

export function calculateStrokesReceivedForMatch(params: {
  playerAPlayingHandicap?: number | null
  playerBPlayingHandicap?: number | null
  handicapMode?: MatchPlayHandicapMode | null
  holes?: MatchPlayHoleDefinition[] | null
}): MatchPlayStrokeAllocation {
  const handicapMode = params.handicapMode ?? 'full_difference'
  const playerAHandicap = normalizeHandicap(params.playerAPlayingHandicap)
  const playerBHandicap = normalizeHandicap(params.playerBPlayingHandicap)
  const playerAPlayingHandicap = playerAHandicap ?? 0
  const playerBPlayingHandicap = playerBHandicap ?? 0
  const difference = Math.abs(playerAPlayingHandicap - playerBPlayingHandicap)
  const lowerHandicapPlayer =
    playerAPlayingHandicap === playerBPlayingHandicap
      ? null
      : playerAPlayingHandicap < playerBPlayingHandicap
        ? 'a'
        : 'b'
  const holeDefinitions = params.holes?.length ? params.holes : buildDefaultMatchPlayHoleDefinitions()
  const holeRanking = buildHoleRanking(holeDefinitions)

  if (handicapMode !== 'full_difference') {
    return {
      playerAPlayingHandicap,
      playerBPlayingHandicap,
      difference: 0,
      lowerHandicapPlayer,
      handicapStatus: 'gross_only',
      handicapMessage: null,
      playerAByHole: {},
      playerBByHole: {},
    }
  }

  if (playerAHandicap == null || playerBHandicap == null) {
    return {
      playerAPlayingHandicap,
      playerBPlayingHandicap,
      difference,
      lowerHandicapPlayer,
      handicapStatus: 'missing_handicap',
      handicapMessage: 'Playing handicaps are required for net match play.',
      playerAByHole: {},
      playerBByHole: {},
    }
  }

  if (difference === 0 || lowerHandicapPlayer == null) {
    return {
      playerAPlayingHandicap,
      playerBPlayingHandicap,
      difference,
      lowerHandicapPlayer,
      handicapStatus: 'ready',
      handicapMessage: null,
      playerAByHole: {},
      playerBByHole: {},
    }
  }

  if (holeRanking.length === 0) {
    return {
      playerAPlayingHandicap,
      playerBPlayingHandicap,
      difference,
      lowerHandicapPlayer,
      handicapStatus: 'missing_stroke_index',
      handicapMessage: 'Stroke index data is required for net match play.',
      playerAByHole: {},
      playerBByHole: {},
    }
  }

  const receivingPlayer = lowerHandicapPlayer === 'a' ? 'b' : 'a'
  const allocations = assignStrokesByHole(holeRanking, difference)

  return {
    playerAPlayingHandicap,
    playerBPlayingHandicap,
    difference,
    lowerHandicapPlayer,
    handicapStatus: 'ready',
    handicapMessage: null,
    playerAByHole: receivingPlayer === 'a' ? allocations : {},
    playerBByHole: receivingPlayer === 'b' ? allocations : {},
  }
}

export function calculateMatchHoleResult(params: {
  playerAGross?: number | null
  playerBGross?: number | null
  playerAStrokesReceived?: number | null
  playerBStrokesReceived?: number | null
  scoringMode?: MatchPlayScoringMode | null
  concededBy?: MatchPlayConcededBy | null
  concessionType?: MatchPlayConcessionType | null
}) {
  const concessionType = params.concessionType ?? 'none'
  const concededBy = params.concededBy ?? null
  const scoringMode = params.scoringMode ?? 'net'
  const playerAGross = typeof params.playerAGross === 'number' ? params.playerAGross : null
  const playerBGross = typeof params.playerBGross === 'number' ? params.playerBGross : null
  const playerAStrokesReceived = Math.max(0, Number(params.playerAStrokesReceived ?? 0) || 0)
  const playerBStrokesReceived = Math.max(0, Number(params.playerBStrokesReceived ?? 0) || 0)
  const playerANet = playerAGross == null ? null : playerAGross - (scoringMode === 'net' ? playerAStrokesReceived : 0)
  const playerBNet = playerBGross == null ? null : playerBGross - (scoringMode === 'net' ? playerBStrokesReceived : 0)

  if ((concessionType === 'hole' || concessionType === 'match') && concededBy) {
    const winner: MatchPlayHoleWinner = concededBy === 'a' ? 'b' : 'a'
    return {
      playerANet,
      playerBNet,
      winner,
      resultLabel: winner === 'a' ? 'Player A wins hole' : 'Player B wins hole',
    }
  }

  if (playerANet == null || playerBNet == null) {
    return {
      playerANet,
      playerBNet,
      winner: null,
      resultLabel: null,
    }
  }

  if (playerANet === playerBNet) {
    return {
      playerANet,
      playerBNet,
      winner: 'halved' as MatchPlayHoleWinner,
      resultLabel: 'Hole halved',
    }
  }

  const winner: MatchPlayHoleWinner = playerANet < playerBNet ? 'a' : 'b'
  return {
    playerANet,
    playerBNet,
    winner,
    resultLabel: winner === 'a' ? 'Player A wins hole' : 'Player B wins hole',
  }
}

export function calculateFinalResultLabel(params: {
  margin: number
  holesRemaining: number
  winner: 'a' | 'b' | null
  tie?: boolean | null
  conceded?: boolean | null
}) {
  if (params.tie) return 'Tied'
  if (!params.winner) return null
  if (params.conceded) return 'Conceded'
  if (params.holesRemaining > 0) return `${Math.abs(params.margin)} and ${params.holesRemaining}`
  return `${Math.abs(params.margin)} Up`
}

function statusLabelForState(params: {
  leader: 'a' | 'b' | null
  margin: number
  dormie: boolean
  complete: boolean
  winner: 'a' | 'b' | null
  holesRemaining: number
  tieHandling: MatchPlayTieHandling
  playerAName?: string | null
  playerBName?: string | null
  finalResultLabel: string | null
}) {
  if (params.complete && params.winner) {
    return `${playerLabel(params.winner, params)} wins ${params.finalResultLabel ?? ''}`.trim()
  }

  if (params.complete && !params.winner) {
    return 'Match Halved'
  }

  if (!params.leader || params.margin === 0) return 'All Square'
  if (params.dormie) return `${playerLabel(params.leader, params)} ${Math.abs(params.margin)} Up (Dormie)`
  return `${playerLabel(params.leader, params)} ${Math.abs(params.margin)} Up`
}

export function calculateMatchStatus(params: {
  holes: Array<{
    holeNumber: number
    winner: MatchPlayHoleWinner | null
    concessionType?: MatchPlayConcessionType | null
    concededBy?: MatchPlayConcededBy | null
  }>
  playerAName?: string | null
  playerBName?: string | null
  tieHandling?: MatchPlayTieHandling | null
  totalHoles?: number | null
}) {
  const tieHandling = params.tieHandling ?? 'sudden_death_playoff'
  const scoredHoles = [...params.holes]
    .filter((hole) => hole.winner != null)
    .sort((a, b) => a.holeNumber - b.holeNumber)
  const totalHoles = normalizedTotalHoles(
    scoredHoles.map((hole) => ({ holeNumber: hole.holeNumber })),
    params.totalHoles,
  )

  let playerAHolesWon = 0
  let playerBHolesWon = 0
  let complete = false
  let winner: 'a' | 'b' | null = null
  let finalResultLabel: string | null = null
  let completedHoles = 0
  let holesRemaining = totalHoles

  for (const hole of scoredHoles) {
    completedHoles += 1

    if (hole.winner === 'a') playerAHolesWon += 1
    if (hole.winner === 'b') playerBHolesWon += 1

    holesRemaining = Math.max(0, totalHoles - completedHoles)
    const margin = playerAHolesWon - playerBHolesWon
    const conceded = hole.concessionType === 'match' && !!hole.concededBy

    if (conceded) {
      winner = hole.concededBy === 'a' ? 'b' : 'a'
      complete = true
      finalResultLabel = calculateFinalResultLabel({
        margin: winner === 'a' ? Math.max(1, margin) : Math.min(-1, margin),
        holesRemaining,
        winner,
        conceded: true,
      })
      break
    }

    if (Math.abs(margin) > holesRemaining) {
      winner = margin > 0 ? 'a' : 'b'
      complete = true
      finalResultLabel = calculateFinalResultLabel({
        margin,
        holesRemaining,
        winner,
      })
      break
    }
  }

  const margin = playerAHolesWon - playerBHolesWon
  const leader = margin === 0 ? null : margin > 0 ? 'a' : 'b'
  const dormie = !complete && leader != null && Math.abs(margin) === holesRemaining && holesRemaining > 0

  if (!complete && completedHoles >= totalHoles) {
    if (margin === 0) {
      complete = true
      finalResultLabel = 'Match Halved'
    } else {
      winner = margin > 0 ? 'a' : 'b'
      complete = true
      finalResultLabel = calculateFinalResultLabel({
        margin,
        holesRemaining,
        winner,
      })
    }
  }

  return {
    completedHoles,
    playerAHolesWon,
    playerBHolesWon,
    leader,
    currentLeaderParticipant: leader,
    margin,
    holesRemaining,
    dormie,
    complete,
    winner,
    finalResultLabel,
    statusLabel: statusLabelForState({
      leader,
      margin,
      dormie,
      complete,
      winner,
      holesRemaining,
      tieHandling,
      playerAName: params.playerAName ?? null,
      playerBName: params.playerBName ?? null,
      finalResultLabel,
    }),
  } satisfies MatchPlayStatusSummary
}

export function isMatchComplete(status: Pick<MatchPlayStatusSummary, 'complete'>) {
  return status.complete
}

export function buildMatchScorecardForPosting(input: MatchPlayScorecardInput): MatchPlayPostingPreview {
  const scorecard = scoreMatchPlayCard(input)
  const playedHoles = scorecard.holes.filter((hole) => hole.winner != null)
  const hasConcessions = scorecard.holes.some((hole) => (hole.concessionType ?? 'none') !== 'none')
  const endedEarly = scorecard.status.complete && scorecard.status.completedHoles < normalizedTotalHoles(input.holes ?? [], input.totalHoles)

  if (hasConcessions || endedEarly) {
    return {
      supported: false,
      requiresManualPosting: true,
      message: 'Match Play posting support is coming soon.',
      playedHoleCount: playedHoles.length,
      unplayedHoleNumbers: scorecard.holes
        .filter((hole) => hole.winner == null)
        .map((hole) => hole.holeNumber),
      grossScoresByHole: scorecard.holes.map((hole) => ({
        holeNumber: hole.holeNumber,
        playerAGross: hole.playerAGross ?? null,
        playerBGross: hole.playerBGross ?? null,
      })),
    }
  }

  return {
    supported: true,
    requiresManualPosting: false,
    message: 'Gross hole scores are ready for posting review.',
    playedHoleCount: playedHoles.length,
    unplayedHoleNumbers: scorecard.holes
      .filter((hole) => hole.winner == null)
      .map((hole) => hole.holeNumber),
    grossScoresByHole: scorecard.holes.map((hole) => ({
      holeNumber: hole.holeNumber,
      playerAGross: hole.playerAGross ?? null,
      playerBGross: hole.playerBGross ?? null,
    })),
  }
}

export function scoreMatchPlayCard(input: MatchPlayScorecardInput): MatchPlayScorecardResult {
  const holes = [...(input.holes ?? [])].sort((a, b) => a.holeNumber - b.holeNumber)
  const totalHoles = normalizedTotalHoles(holes, input.totalHoles)
  const strokeDefinitions = holes.map((hole) => ({
    holeNumber: hole.holeNumber,
    par: hole.par ?? null,
    strokeIndex: hole.strokeIndex ?? null,
  }))
  const strokes = calculateStrokesReceivedForMatch({
    playerAPlayingHandicap: input.playerAPlayingHandicap ?? null,
    playerBPlayingHandicap: input.playerBPlayingHandicap ?? null,
    handicapMode: input.handicapMode ?? 'full_difference',
    holes: strokeDefinitions,
  })

  const calculatedHoles: MatchPlayCalculatedHole[] = []

  for (const hole of holes) {
    const playerAStrokesReceived = strokes.playerAByHole[hole.holeNumber] ?? 0
    const playerBStrokesReceived = strokes.playerBByHole[hole.holeNumber] ?? 0
    const result =
      (input.scoringMode ?? 'net') === 'net' && strokes.handicapStatus !== 'ready'
        ? {
            playerANet: null,
            playerBNet: null,
            winner: null,
            resultLabel: strokes.handicapMessage,
          }
        : calculateMatchHoleResult({
            playerAGross: hole.playerAGross ?? null,
            playerBGross: hole.playerBGross ?? null,
            playerAStrokesReceived,
            playerBStrokesReceived,
            scoringMode: input.scoringMode ?? 'net',
            concededBy: hole.concededBy ?? null,
            concessionType: hole.concessionType ?? 'none',
          })
    const status = calculateMatchStatus({
      holes: [...calculatedHoles, {
        holeNumber: hole.holeNumber,
        winner: result.winner,
        concessionType: hole.concessionType ?? 'none',
        concededBy: hole.concededBy ?? null,
      }],
      playerAName: input.playerAName ?? null,
      playerBName: input.playerBName ?? null,
      tieHandling: input.tieHandling ?? 'sudden_death_playoff',
      totalHoles,
    })

    calculatedHoles.push({
      ...hole,
      playerAStrokesReceived,
      playerBStrokesReceived,
      playerANet: result.playerANet,
      playerBNet: result.playerBNet,
      winner: result.winner,
      resultLabel: result.resultLabel,
      status,
    })

    if (status.complete) break
  }

  const finalStatus =
    calculatedHoles[calculatedHoles.length - 1]?.status
    ?? calculateMatchStatus({
      holes: [],
      playerAName: input.playerAName ?? null,
      playerBName: input.playerBName ?? null,
      tieHandling: input.tieHandling ?? 'sudden_death_playoff',
      totalHoles,
    })

  return {
    strokes,
    holes: calculatedHoles,
    status: finalStatus,
  }
}

export const MATCH_PLAY_DEBUG_EXAMPLES = {
  handicapDifferenceExample: scoreMatchPlayCard({
    playerAName: 'Player A',
    playerBName: 'Player B',
    scoringMode: 'net',
    handicapMode: 'full_difference',
    playerAPlayingHandicap: 8,
    playerBPlayingHandicap: 14,
    holes: buildDefaultMatchPlayHoleDefinitions(6).map((hole, index) => ({
      ...hole,
      playerAGross: 4 + (index % 2),
      playerBGross: 5,
    })),
    totalHoles: 18,
  }),
}
