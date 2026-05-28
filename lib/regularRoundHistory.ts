import {
  buildGolfCanadaPostingPrepFromScores,
  type GolfCanadaPostingPrep,
} from '@/lib/golfCanada';
import { getBbbHistorySummary, type BbbHistorySummary } from '@/lib/bbbBackend';
import {
  getStandardRoundBackendDetail,
  getStandardRoundParticipantHoleScorecard,
  type StandardRoundBackendDetail,
  type StandardRoundParticipantHoleScoreRow,
} from '@/lib/standardRoundBackend';
import { getNassauHistorySummary, type NassauGameSummary } from '@/lib/nassauBackend';
import { getSkinsHistorySummary, type SkinsHistorySummary } from '@/lib/skinsBackend';
import { getWolfHistorySummary, type WolfGameSummary } from '@/lib/wolfBackend';
import { DEFAULT_TEE_OPTION, resolveTeeOption } from '@/constants/course';
import type { SavedRound } from '@/types/round';

const DEBUG_REGULAR_HISTORY = false;

export type RegularRoundHistoryType = 'standard' | 'group' | 'bbb' | 'skins' | 'nassau' | 'wolf';
export type RegularRoundBaseType = 'standard' | 'group';
export type RegularRoundGameType = 'bbb' | 'skins' | 'nassau' | 'wolf';

export type RegularRoundHistoryHoleScore = {
  holeNumber: number;
  strokes: number | null;
};

export type RegularRoundHistoryParticipant = {
  participantId: string;
  userId?: string | null;
  guestProfileId?: string | null;
  name: string;
  totalScore: number | null;
  holesComplete: number;
  isScorer: boolean;
  participantOrder?: number | null;
  holeScores: RegularRoundHistoryHoleScore[];
};

export type RegularRoundHistoryPersonalStatsSummary = {
  totalPutts: number | null;
  fairwaysHit: number | null;
  greensInRegulation: number | null;
  penalties: number | null;
  upAndDowns: number | null;
};

export type RegularRoundHistoryDetail = {
  roundId: string;
  roundGameId?: string | null;
  roundType: RegularRoundHistoryType;
  baseType: RegularRoundBaseType;
  gameType?: RegularRoundGameType | null;
  courseName: string | null;
  roundDate: string | null;
  status: string | null;
  currentUserId: string;
  currentUserScore: number;
  holesComplete: number;
  currentUserHoleScores: RegularRoundHistoryHoleScore[];
  participants: RegularRoundHistoryParticipant[];
  personalStatsSummary?: RegularRoundHistoryPersonalStatsSummary | null;
  personalStatsByHole?: StandardRoundBackendDetail['holes'];
  golfCanadaPostingPrep?: GolfCanadaPostingPrep | null;
  gameHistory?: BbbHistorySummary | SkinsHistorySummary | NassauGameSummary | WolfGameSummary | null;
  backendDetail: StandardRoundBackendDetail;
  source: 'backend_rpc_loader';
};

function buildBaseType(roundMode: string | null | undefined): RegularRoundBaseType {
  return roundMode === 'casual_group' ? 'group' : 'standard';
}

function buildRoundType(baseType: RegularRoundBaseType, gameType?: RegularRoundGameType | null): RegularRoundHistoryType {
  if (gameType === 'bbb') return 'bbb';
  if (gameType === 'skins') return 'skins';
  if (gameType === 'nassau') return 'nassau';
  if (gameType === 'wolf') return 'wolf';
  return baseType === 'group' ? 'group' : 'standard';
}

function sortHoleScores(a: RegularRoundHistoryHoleScore, b: RegularRoundHistoryHoleScore) {
  return a.holeNumber - b.holeNumber;
}

function buildParticipantName(row: StandardRoundParticipantHoleScoreRow) {
  const fullGuestName = [row.guest_first_name, row.guest_last_name].filter(Boolean).join(' ').trim();
  return row.display_name || fullGuestName || 'Player';
}

function buildGolfCanadaPrepFromBackendDetail(params: {
  detail: StandardRoundBackendDetail;
  currentUserId: string;
  currentUserHoleScores: RegularRoundHistoryHoleScore[];
  currentUserScore: number;
  holesComplete: number;
}): GolfCanadaPostingPrep | null {
  const { detail, currentUserId, currentUserHoleScores, currentUserScore, holesComplete } = params;
  if (!currentUserHoleScores.length || currentUserScore <= 0 || holesComplete <= 0) return null;

  const scores = currentUserHoleScores.map((hole) => ({
    hole: hole.holeNumber,
    score: typeof hole.strokes === 'number' ? hole.strokes : null,
  }));

  return buildGolfCanadaPostingPrepFromScores({
    id: detail.roundId,
    draftOwnerUserId: currentUserId,
    date: detail.roundDate ?? new Date().toISOString(),
    tee: resolveTeeOption(detail.teeName ?? DEFAULT_TEE_OPTION),
    ratingType: 'middle' as any,
    currentHole: Math.max(1, detail.holeCount || 1),
    holes: scores.map((entry) => ({
      hole: entry.hole,
      score: entry.score,
    })),
    roundMode: detail.roundMode === 'casual_group' ? 'casual_group' : 'solo',
    group: null,
    groupGameMode: 'none',
    backendRoundId: detail.roundId,
    statsEnabled: detail.statsSummary !== null,
    postingStates: null,
    savedAt: detail.roundDate ?? new Date().toISOString(),
    totalScore: currentUserScore,
    totalPutts: detail.statsSummary?.totalPutts ?? 0,
    onePutts: 0,
    threePutts: 0,
    upAndDowns: detail.statsSummary?.upAndDowns ?? 0,
    fairwaysHit: detail.statsSummary?.fairwaysHit ?? 0,
    greensInRegulation: detail.statsSummary?.greensInRegulation ?? 0,
    nearGreenCount: 0,
    penalties: detail.statsSummary?.penalties ?? 0,
    doublesOrWorse: 0,
  } as SavedRound, scores);
}

function mapParticipantScorecardRows(rows: StandardRoundParticipantHoleScoreRow[]): RegularRoundHistoryParticipant[] {
  const participants = new Map<string, RegularRoundHistoryParticipant>();

  rows.forEach((row) => {
    const participantId = row.round_participant_id;
    const existing = participants.get(participantId) ?? {
      participantId,
      userId: row.user_id ?? null,
      guestProfileId: row.guest_profile_id ?? null,
      name: buildParticipantName(row),
      totalScore: typeof row.participant_total_score === 'number' ? row.participant_total_score : null,
      holesComplete: Number(row.participant_holes_complete ?? 0),
      isScorer: row.is_scorer === true,
      participantOrder: row.participant_order ?? null,
      holeScores: [],
    };

    if (typeof row.hole_number === 'number') {
      existing.holeScores.push({
        holeNumber: row.hole_number,
        strokes: typeof row.strokes === 'number' ? row.strokes : null,
      });
    }

    if ((existing.totalScore === null || existing.totalScore === 0) && typeof row.participant_total_score === 'number') {
      existing.totalScore = row.participant_total_score;
    }
    if (!existing.holesComplete && typeof row.participant_holes_complete === 'number') {
      existing.holesComplete = row.participant_holes_complete;
    }
    participants.set(participantId, existing);
  });

  return Array.from(participants.values())
    .map((participant) => ({
      ...participant,
      holeScores: participant.holeScores.sort(sortHoleScores),
    }))
    .sort((a, b) => (
      Number(a.participantOrder ?? 999) - Number(b.participantOrder ?? 999)
      || a.name.localeCompare(b.name)
    ));
}

export async function getRegularRoundHistoryDetail(params: {
  roundId: string;
  roundGameId?: string | null;
  gameType?: RegularRoundGameType | null;
  userId: string;
  source?: 'history_screen' | 'detail_screen';
}): Promise<RegularRoundHistoryDetail> {
  const { roundId, roundGameId = null, gameType = null, userId } = params;
  const [standardDetail, scorecardResult, gameHistory] = await Promise.all([
    getStandardRoundBackendDetail(roundId, userId),
    getStandardRoundParticipantHoleScorecard(roundId).catch((error) => {
      console.warn('[regular-history] participant_scorecard_fallback', error?.message ?? error);
      return [] as StandardRoundParticipantHoleScoreRow[];
    }),
    gameType === 'bbb'
      ? getBbbHistorySummary(roundId)
      : gameType === 'skins' && roundGameId
        ? getSkinsHistorySummary(roundGameId)
        : gameType === 'nassau' && roundGameId
          ? getNassauHistorySummary(roundGameId)
          : gameType === 'wolf' && roundGameId
            ? getWolfHistorySummary(roundGameId)
        : Promise.resolve(null),
  ]);

  const participants = mapParticipantScorecardRows(scorecardResult);
  const currentUserParticipant = participants.find((participant) => participant.userId === userId) ?? null;
  const currentUserHoleScores = currentUserParticipant?.holeScores.length
    ? currentUserParticipant.holeScores
    : standardDetail.holes.map((hole) => ({
      holeNumber: hole.holeNumber,
      strokes: hole.strokes,
    })).sort(sortHoleScores);
  const participantDerivedScore = currentUserParticipant?.totalScore ?? null;
  const participantDerivedHoleCount = currentUserParticipant?.holesComplete ?? null;
  const currentUserScore = typeof participantDerivedScore === 'number' && participantDerivedScore > 0
    ? participantDerivedScore
    : standardDetail.currentUserScore;
  const holesComplete = typeof participantDerivedHoleCount === 'number' && participantDerivedHoleCount > 0
    ? participantDerivedHoleCount
    : standardDetail.holeCount;

  const detail: RegularRoundHistoryDetail = {
    roundId,
    roundGameId: roundGameId ?? gameHistory?.round_game_id ?? null,
    roundType: buildRoundType(buildBaseType(standardDetail.roundMode), gameType),
    baseType: buildBaseType(standardDetail.roundMode),
    gameType,
    courseName: standardDetail.courseName,
    roundDate: standardDetail.roundDate,
    status: standardDetail.status,
    currentUserId: userId,
    currentUserScore,
    holesComplete,
    currentUserHoleScores,
    participants: participants.length > 0 ? participants : [{
      participantId: userId,
      userId,
      guestProfileId: null,
      name: standardDetail.holes[0]?.displayName ?? 'Player',
      totalScore: standardDetail.currentUserScore,
      holesComplete: standardDetail.holeCount,
      isScorer: standardDetail.isScoringUser,
      participantOrder: 1,
      holeScores: currentUserHoleScores,
    }],
    personalStatsSummary: standardDetail.statsSummary,
    personalStatsByHole: standardDetail.holes,
    golfCanadaPostingPrep: buildGolfCanadaPrepFromBackendDetail({
      detail: standardDetail,
      currentUserId: userId,
      currentUserHoleScores,
      currentUserScore,
      holesComplete,
    }),
    gameHistory,
    backendDetail: standardDetail,
    source: 'backend_rpc_loader',
  };

  if (__DEV__ && DEBUG_REGULAR_HISTORY) {
    const participantHoleScoreCellCount = detail.participants.reduce((sum, participant) => sum + participant.holeScores.length, 0);
    console.log('[regular-history] detail_loaded', {
      roundId: detail.roundId,
      roundGameId: detail.roundGameId ?? null,
      gameType: detail.gameType ?? null,
      source: detail.source,
      currentUserScore: detail.currentUserScore,
      currentUserHoleCount: detail.currentUserHoleScores.length,
      participantCount: detail.participants.length,
      participantHoleScoreCellCount,
      hasStats: !!detail.personalStatsSummary,
      hasGolfCanadaPrep: !!detail.golfCanadaPostingPrep,
      hasGameHistory: !!detail.gameHistory,
      hasSettlement: detail.gameType === 'bbb' || detail.gameType === 'skins' || detail.gameType === 'nassau' || detail.gameType === 'wolf',
    });
  }

  return detail;
}
