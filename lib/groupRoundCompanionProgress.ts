import {
  getGroupRoundCompanionGameType,
  type GroupRoundCompanionCrossCardScore,
  type GroupRoundCompanionGameType,
  type GroupRoundCompanionHoleStats,
  type GroupRoundParticipantCompanionAccess,
} from '@/lib/groupRoundCompanions';

export type GroupRoundCompanionEntryProgress = {
  gameType: GroupRoundCompanionGameType;
  officialCompletedHole: number;
  officialCurrentHole: number;
  allowedHoleNumbers: number[];
  nextHoleNumber: number | null;
  pendingHoleNumber: number | null;
  waitingForOfficialCompletion: boolean;
  allAllowedHolesComplete: boolean;
};

function clampCompletedHole(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(18, Math.trunc(value)));
}

function clampCurrentHole(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(18, Math.trunc(value)));
}

function hasParticipantScore(scores: GroupRoundCompanionCrossCardScore[], holeNumber: number) {
  return scores.some((entry) => entry.hole_number === holeNumber && typeof entry.strokes === 'number' && entry.strokes > 0);
}

function hasParticipantStats(stats: GroupRoundCompanionHoleStats[], holeNumber: number) {
  return stats.some((entry) => entry.hole_number === holeNumber);
}

function isHoleCompleteForParticipantMode(params: {
  access: GroupRoundParticipantCompanionAccess;
  scores: GroupRoundCompanionCrossCardScore[];
  stats: GroupRoundCompanionHoleStats[];
  holeNumber: number;
}) {
  const scoreReady = !params.access.wants_score_entry || hasParticipantScore(params.scores, params.holeNumber);
  const statsReady = !params.access.wants_stats_entry || hasParticipantStats(params.stats, params.holeNumber);
  return scoreReady && statsReady;
}

function inferOfficialCurrentHole(officialCompletedHole: number, status: string | null | undefined) {
  if (officialCompletedHole >= 18) return 18;
  if (status === 'submitted' || status === 'completed' || status === 'cancelled') {
    return officialCompletedHole;
  }
  return Math.min(18, officialCompletedHole + 1);
}

export async function getGroupRoundCompanionEntryProgress(params: {
  roundId: string;
  access: GroupRoundParticipantCompanionAccess;
  scores: GroupRoundCompanionCrossCardScore[];
  stats: GroupRoundCompanionHoleStats[];
}) {
  const gameType = await getGroupRoundCompanionGameType(params.roundId);
  const officialCompletedHole = clampCompletedHole(Number(params.access.official_completed_hole ?? 0));
  const officialCurrentHole = clampCurrentHole(
    Number(params.access.official_current_hole ?? inferOfficialCurrentHole(officialCompletedHole, params.access.status)),
  );
  const allowedHoleNumbers = Array.from({ length: officialCurrentHole }, (_, index) => index + 1);

  const nextHoleNumber = allowedHoleNumbers.find((holeNumber) => !isHoleCompleteForParticipantMode({
    access: params.access,
    scores: params.scores,
    stats: params.stats,
    holeNumber,
  })) ?? null;
  const pendingHoleNumber = officialCurrentHole > officialCompletedHole
    ? officialCurrentHole
    : null;
  const waitingForOfficialCompletion = pendingHoleNumber !== null
    && isHoleCompleteForParticipantMode({
      access: params.access,
      scores: params.scores,
      stats: params.stats,
      holeNumber: pendingHoleNumber,
    })
    && allowedHoleNumbers
      .filter((holeNumber) => holeNumber !== pendingHoleNumber)
      .every((holeNumber) => isHoleCompleteForParticipantMode({
        access: params.access,
        scores: params.scores,
        stats: params.stats,
        holeNumber,
      }));

  return {
    gameType,
    officialCompletedHole,
    officialCurrentHole,
    allowedHoleNumbers,
    nextHoleNumber,
    pendingHoleNumber,
    waitingForOfficialCompletion,
    allAllowedHolesComplete: officialCurrentHole > 0 && nextHoleNumber === null,
  } satisfies GroupRoundCompanionEntryProgress;
}
