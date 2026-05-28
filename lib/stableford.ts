import { holes as courseHoles, ratingInfoFor, resolveTeeOption } from '@/constants/course'
import type {
  HoleDraft,
  LocalRoundDraft,
  TournamentSpecialHoleRule,
  TournamentStablefordHandicapSource,
  TournamentStablefordHandicapStatus,
  TournamentStablefordMode,
} from '@/types/round'

const MODIFIED_CLUB_DEFAULT_SUMMARY = 'Default preset: Albatross 4, Eagle 3, Birdie 2, Par 1, Bogey 0, More than bogey -1'

type StablefordHoleScore = {
  points: number
  basis: 'gross' | 'net'
  resultLabel: string
  netStrokes: number
  handicapStrokes: number
  handicapStatus: TournamentStablefordHandicapStatus
}

type StablefordHandicapResolution = {
  status: TournamentStablefordHandicapStatus
  source: TournamentStablefordHandicapSource
  playerHandicap: number | null
  courseHandicap: number | null
}

function normalizeStablefordMode(mode: TournamentStablefordMode | null | undefined) {
  if (mode === 'net') return 'net'
  if (mode === 'modified') return 'modified'
  return 'standard'
}

function totalCoursePar() {
  return courseHoles.reduce((sum, hole) => sum + Number(hole.par ?? 0), 0)
}

function roundCourseHandicap(value: number) {
  return Math.round(value)
}

function handicapStrokesForHole(courseHandicap: number, holeHandicapRank: number) {
  if (!Number.isFinite(courseHandicap) || !Number.isFinite(holeHandicapRank) || holeHandicapRank < 1) {
    return 0
  }

  if (courseHandicap === 0) return 0

  const absHandicap = Math.abs(Math.trunc(courseHandicap))
  const baseStrokes = Math.floor(absHandicap / 18)
  const remainder = absHandicap % 18
  const extraStroke = remainder > 0 && holeHandicapRank <= remainder ? 1 : 0
  const total = baseStrokes + extraStroke

  return courseHandicap > 0 ? total : -total
}

export function resolveStablefordHandicap(round: LocalRoundDraft): StablefordHandicapResolution {
  if (!isStablefordRound(round) || normalizeStablefordMode(round.tournamentStablefordMode) !== 'net') {
    return {
      status: 'not_applicable',
      source: 'not_applicable',
      playerHandicap: null,
      courseHandicap: null,
    }
  }

  if (round.tournamentHandicapEnabled !== true) {
    return {
      status: 'fallback_gross_pending_handicap',
      source: 'disabled',
      playerHandicap: null,
      courseHandicap: null,
    }
  }

  const playerHandicap = typeof round.tournamentPlayerHandicap === 'number' && Number.isFinite(round.tournamentPlayerHandicap)
    ? round.tournamentPlayerHandicap
    : null

  if (playerHandicap == null) {
    return {
      status: 'fallback_gross_pending_handicap',
      source: 'missing_profile',
      playerHandicap: null,
      courseHandicap: null,
    }
  }

  const ratingInfo = ratingInfoFor(resolveTeeOption(round.tee), round.ratingType) as { slope: number; rating: number } | null
  if (!ratingInfo) {
    return {
      status: 'fallback_gross_pending_handicap',
      source: 'missing_rating',
      playerHandicap,
      courseHandicap: null,
    }
  }

  const courseHandicap = roundCourseHandicap(
    playerHandicap * (Number(ratingInfo.slope) / 113) + (Number(ratingInfo.rating) - totalCoursePar()),
  )

  return {
    status: 'ready',
    source: 'profile',
    playerHandicap,
    courseHandicap,
  }
}

function standardStablefordPoints(deltaToPar: number) {
  if (deltaToPar <= -4) return { points: 6, resultLabel: 'Condor or better' }
  if (deltaToPar === -3) return { points: 5, resultLabel: 'Albatross' }
  if (deltaToPar === -2) return { points: 4, resultLabel: 'Eagle' }
  if (deltaToPar === -1) return { points: 3, resultLabel: 'Birdie' }
  if (deltaToPar === 0) return { points: 2, resultLabel: 'Par' }
  if (deltaToPar === 1) return { points: 1, resultLabel: 'Bogey' }
  return { points: 0, resultLabel: 'Double bogey or worse' }
}

function modifiedStablefordPoints(deltaToPar: number) {
  if (deltaToPar <= -3) return { points: 4, resultLabel: 'Albatross' }
  if (deltaToPar === -2) return { points: 3, resultLabel: 'Eagle' }
  if (deltaToPar === -1) return { points: 2, resultLabel: 'Birdie' }
  if (deltaToPar === 0) return { points: 1, resultLabel: 'Par' }
  if (deltaToPar === 1) return { points: 0, resultLabel: 'Bogey' }
  return { points: -1, resultLabel: 'More than bogey' }
}

export function isStablefordRound(round: LocalRoundDraft | null | undefined) {
  return round?.roundMode === 'tournament' && round?.tournamentScoringFormat === 'stableford'
}

export function getStablefordModifiedPresetSummary(round: LocalRoundDraft | null | undefined) {
  if (round?.tournamentStablefordMode === 'modified' && round?.tournamentStablefordModifiedPreset === 'club_default') {
    return MODIFIED_CLUB_DEFAULT_SUMMARY
  }
  return null
}

export function getStablefordSpecialHoleRule(
  round: LocalRoundDraft | null | undefined,
  holeNumber: number,
): TournamentSpecialHoleRule | null {
  return round?.tournamentSpecialHoleRules?.find((rule) => rule.hole_number === holeNumber) ?? null
}

export function requiresStablefordHoleOut(
  round: LocalRoundDraft | null | undefined,
  holeNumber: number,
) {
  return getStablefordSpecialHoleRule(round, holeNumber)?.must_hole_out === true
}

export function describeStablefordMode(round: LocalRoundDraft | null | undefined) {
  const mode = normalizeStablefordMode(round?.tournamentStablefordMode)
  if (mode === 'net') return 'Net Stableford'
  if (mode === 'modified') return 'Modified Stableford'
  return 'Standard Stableford'
}

export function computeStablefordHoleScore(
  round: LocalRoundDraft,
  holeNumber: number,
  strokes: number,
): StablefordHoleScore | null {
  const courseHole = courseHoles.find((item) => item.hole === holeNumber)
  if (!courseHole || !(strokes > 0)) return null

  const mode = normalizeStablefordMode(round.tournamentStablefordMode)
  let basis: 'gross' | 'net' = 'gross'
  let handicapStrokes = 0
  let handicapStatus: StablefordHoleScore['handicapStatus'] = 'not_applicable'

  if (mode === 'net') {
    basis = 'net'
    const handicapResolution = resolveStablefordHandicap(round)
    handicapStatus = handicapResolution.status
    handicapStrokes =
      handicapResolution.status === 'ready' && handicapResolution.courseHandicap != null
        ? handicapStrokesForHole(handicapResolution.courseHandicap, Number(courseHole.hcp ?? 0))
        : 0
  }

  const netStrokes = strokes - handicapStrokes
  const deltaToPar = netStrokes - Number(courseHole.par ?? 0)
  const pointsResult = mode === 'modified'
    ? modifiedStablefordPoints(deltaToPar)
    : standardStablefordPoints(deltaToPar)

  return {
    points: pointsResult.points,
    basis,
    resultLabel: pointsResult.resultLabel,
    netStrokes,
    handicapStrokes,
    handicapStatus,
  }
}

export function applyStablefordToHole(round: LocalRoundDraft, hole: HoleDraft): HoleDraft {
  if (!isStablefordRound(round) || typeof hole.score !== 'number' || hole.score <= 0) {
    return {
      ...hole,
      stablefordPoints: null,
      stablefordBasis: null,
      stablefordResultLabel: null,
      stablefordNetStrokes: null,
      stablefordHandicapStrokes: null,
      stablefordHandicapStatus: null,
    }
  }

  const computed = computeStablefordHoleScore(round, hole.hole, hole.score)
  if (!computed) return hole

  return {
    ...hole,
    stablefordPoints: computed.points,
    stablefordBasis: computed.basis,
    stablefordResultLabel: computed.resultLabel,
    stablefordNetStrokes: computed.netStrokes,
    stablefordHandicapStrokes: computed.handicapStrokes,
    stablefordHandicapStatus: computed.handicapStatus,
  }
}

export function getStablefordRoundTotal(round: LocalRoundDraft | null | undefined) {
  return (round?.holes ?? []).reduce((sum, hole) => sum + Number(hole.stablefordPoints ?? 0), 0)
}

export function countStablefordScoredHoles(round: LocalRoundDraft | null | undefined) {
  return (round?.holes ?? []).filter((hole) => typeof hole.stablefordPoints === 'number').length
}
