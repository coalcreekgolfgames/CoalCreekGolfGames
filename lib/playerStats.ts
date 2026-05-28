import {
  DEFAULT_TEE_OPTION,
  holes as courseHoles,
  isTeeOption,
  ratings,
  resolveTeeOption,
  teeDisplayLabel,
  teeOptions,
  type RatingType,
  type TeeOption,
} from '@/constants/course';
import { getBbbHistorySummary, type BbbHistorySummary } from '@/lib/bbbBackend';
import {
  buildCurrentUserGolfScoresFromRoundGameSummary,
  type GolfCanadaBackendParticipant,
  type GolfCanadaBackendGameHoleSummary,
} from '@/lib/golfCanada';
import {
  getMyRoundHistory,
  isValidBackendHistoryRow,
  localHistoryNumericScore,
  type MyRoundHistoryRow,
} from '@/lib/historyBackend';
import { loadRoundHistory, reconcileLocalRoundsWithBackend } from '@/lib/localRound';
import { getNassauHistorySummary, type NassauGameSummary } from '@/lib/nassauBackend';
import { getRegularRoundHistoryDetail } from '@/lib/regularRoundHistory';
import { getSkinsHistorySummary, type SkinsHistorySummary } from '@/lib/skinsBackend';
import { getWolfHistorySummary, type WolfGameSummary } from '@/lib/wolfBackend';
import { supabase } from '@/lib/supabase';
import type { SavedRound } from '@/types/round';

export type StatsFilterKey = 'all' | 'last5' | 'last10' | 'last20';
export type StatsTeeFilterKey = 'all' | TeeOption;

export type PlayerStatsHole = {
  holeNumber: number;
  par: number;
  score: number;
  scoreToPar: number;
  totalPutts: number | null;
  threePutt: boolean | null;
  fairwayHit: boolean | null;
  hitGreen: boolean | null;
  upAndDownMade: boolean | null;
  penalty: boolean | null;
};

export type PlayerStatsRound = {
  key: string;
  date: string;
  sortTimestamp: string;
  totalScore: number;
  totalPar: number;
  scoreToPar: number;
  teeKey: TeeOption;
  teeName: string;
  teeLabel: string;
  ratingType: RatingType | null;
  frontNineScore: number | null;
  backNineScore: number | null;
  totalPutts: number | null;
  fairwaysHit: number | null;
  greensInRegulation: number | null;
  penalties: number | null;
  upAndDowns: number | null;
  threePutts: number | null;
  holes: PlayerStatsHole[];
  source: 'local' | 'backend';
};

export type PlayerStatsHandicapEstimate = {
  teeKey: TeeOption;
  teeLabel: string;
  eligibleRoundCount: number;
  selectedDifferentialCount: number;
  estimatedHandicap: number | null;
  message: string | null;
};

export type PlayerStatsLoadResult = {
  rounds: PlayerStatsRound[];
  backendError: string | null;
};

export type PlayerStatsSummary = {
  roundsPlayed: number;
  scoringAverage: number;
  bestRound: number;
  worstRound: number;
  averageScoreToPar: number;
  averageFrontNine: number | null;
  averageBackNine: number | null;
  averagePar3Score: number | null;
  averagePar4Score: number | null;
  averagePar5Score: number | null;
  averagePar3ToPar: number | null;
  averagePar4ToPar: number | null;
  averagePar5ToPar: number | null;
  eaglesPerRound: number;
  birdiesPerRound: number;
  parsPerRound: number;
  bogeysPerRound: number;
  doublesPerRound: number;
  triplesOrWorsePerRound: number;
  parOrBetterPct: number;
  bogeyOrBetterPct: number;
  doubleBogeyAvoidancePct: number;
  puttsPerRound: number | null;
  puttsPerHole: number | null;
  threePuttsPerRound: number | null;
  threePuttAvoidancePct: number | null;
  fairwaysHitPct: number | null;
  girPct: number | null;
  scramblingPct: number | null;
  penaltiesPerRound: number | null;
  penaltyHolesPerRound: number | null;
};

function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}

function isExpectedStatsDetailSkip(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String((error as any)?.message ?? error ?? '');

  return message === 'No standard round history detail was returned.';
}

function backendRowPriority(row: MyRoundHistoryRow) {
  const gameType = row.gameType ?? row.game_type ?? 'standard';
  if (gameType === 'bbb' || gameType === 'skins' || gameType === 'nassau' || gameType === 'wolf') return 2;
  return 1;
}

function selectPreferredBackendRows(rows: MyRoundHistoryRow[]) {
  const byRoundId = new Map<string, MyRoundHistoryRow>();
  rows.forEach((row) => {
    const roundId = row.roundId ?? row.round_id;
    const existing = byRoundId.get(roundId);
    if (!existing) {
      byRoundId.set(roundId, row);
      return;
    }

    const existingPriority = backendRowPriority(existing);
    const nextPriority = backendRowPriority(row);
    if (nextPriority > existingPriority) {
      byRoundId.set(roundId, row);
      return;
    }

    if (
      nextPriority === existingPriority
      && String(row.updated_at ?? row.created_at ?? '') > String(existing.updated_at ?? existing.created_at ?? '')
    ) {
      byRoundId.set(roundId, row);
    }
  });

  return Array.from(byRoundId.values());
}

function isValidLocalStatsRound(round: SavedRound, userId?: string | null) {
  return localHistoryNumericScore(round, userId) > 0;
}

function currentUserParticipantId(round: SavedRound, userId?: string | null) {
  if (!round.group?.participants?.length) return null;
  const exactMatch = userId
    ? round.group.participants.find((participant) => participant.type === 'app_user' && participant.id === userId)
    : null;
  if (exactMatch) return exactMatch.id;

  const draftOwnerMatch = round.draftOwnerUserId
    ? round.group.participants.find((participant) => participant.type === 'app_user' && participant.id === round.draftOwnerUserId)
    : null;
  if (draftOwnerMatch) return draftOwnerMatch.id;

  const firstAppUser = round.group.participants.find((participant) => participant.type === 'app_user');
  return firstAppUser?.id ?? null;
}

function currentUserParticipant(round: SavedRound, userId?: string | null) {
  const participantId = currentUserParticipantId(round, userId);
  return participantId
    ? round.group?.participants?.find((participant) => participant.id === participantId) ?? null
    : null;
}

function resolveRoundStatsTee(params: {
  participantSelectedTee?: unknown;
  roundTee?: unknown;
  ratingType?: RatingType | null;
}) {
  const teeKey = isTeeOption(params.participantSelectedTee)
    ? params.participantSelectedTee
    : resolveTeeOption(params.roundTee ?? DEFAULT_TEE_OPTION);

  return {
    teeKey,
    teeName: teeKey,
    teeLabel: teeDisplayLabel(teeKey),
    ratingType: params.ratingType ?? null,
  };
}

async function resolveBackendUserTee(params: {
  roundId: string;
  userId: string;
}) {
  const [participantRes, roundRes] = await Promise.all([
    supabase
      .from('round_participants')
      .select('selected_tee')
      .eq('round_id', params.roundId)
      .eq('user_id', params.userId)
      .maybeSingle(),
    supabase
      .from('rounds')
      .select('tee_name')
      .eq('id', params.roundId)
      .maybeSingle(),
  ]);

  if (participantRes.error) {
    console.warn('[player-stats] participant tee lookup failed', participantRes.error.message);
  }
  if (roundRes.error) {
    console.warn('[player-stats] round tee lookup failed', roundRes.error.message);
  }

  return resolveRoundStatsTee({
    participantSelectedTee: participantRes.data?.selected_tee ?? null,
    roundTee: roundRes.data?.tee_name ?? null,
    ratingType: null,
  });
}

function localRoundMatchesBackendRow(round: SavedRound, row: MyRoundHistoryRow) {
  if (row.round_game_id && round.backendRoundGameId === row.round_game_id) return true;
  if (round.backendRoundId && round.backendRoundId === row.round_id) return true;
  return false;
}

function buildLocalPenaltyValue(round: SavedRound, holePenaltyCount: number) {
  if (round.statsEnabled === false) return null;
  return typeof round.penalties === 'number' ? round.penalties : holePenaltyCount;
}

function normalizeBackendGameType(row: MyRoundHistoryRow) {
  const gameType = row.gameType ?? row.game_type ?? null;
  if (gameType === 'bbb' || gameType === 'skins' || gameType === 'nassau' || gameType === 'wolf') return gameType;
  return null;
}

type RoundGameStatsSummary = BbbHistorySummary | SkinsHistorySummary | NassauGameSummary | WolfGameSummary;

function buildStatsRoundFromHoleSet(params: {
  key: string;
  date: string;
  sortTimestamp: string;
  teeKey: TeeOption;
  teeName: string;
  teeLabel: string;
  ratingType?: RatingType | null;
  holes: PlayerStatsHole[];
  totalPutts?: number | null;
  fairwaysHit?: number | null;
  greensInRegulation?: number | null;
  penalties?: number | null;
  upAndDowns?: number | null;
  source: 'backend';
}) {
  const { key, date, sortTimestamp, teeKey, teeName, teeLabel, ratingType = null, holes, totalPutts = null, fairwaysHit = null, greensInRegulation = null, penalties = null, upAndDowns = null, source } = params;
  if (holes.length === 0) return null;

  const totalScore = holes.reduce((sum, hole) => sum + hole.score, 0);
  if (totalScore <= 0) return null;

  const totalPar = holes.reduce((sum, hole) => sum + hole.par, 0);
  const frontNine = holes.filter((hole) => hole.holeNumber <= 9);
  const backNine = holes.filter((hole) => hole.holeNumber >= 10);
  const penaltyHoleCount = holes.filter((hole) => hole.penalty === true).length;

  return {
    key,
    date,
    sortTimestamp,
    totalScore,
    totalPar,
    scoreToPar: totalScore - totalPar,
    teeKey,
    teeName,
    teeLabel,
    ratingType,
    frontNineScore: frontNine.length > 0 ? frontNine.reduce((sum, hole) => sum + hole.score, 0) : null,
    backNineScore: backNine.length > 0 ? backNine.reduce((sum, hole) => sum + hole.score, 0) : null,
    totalPutts,
    fairwaysHit,
    greensInRegulation,
    penalties: penalties ?? (penaltyHoleCount > 0 ? penaltyHoleCount : null),
    upAndDowns,
    threePutts: holes.some((hole) => hole.threePutt !== null) ? holes.filter((hole) => hole.threePutt === true).length : null,
    holes,
    source,
  } satisfies PlayerStatsRound;
}

function mapScoreEntriesToStatsHoles(
  scores: Array<{ hole: number; score: number | null }>,
): PlayerStatsHole[] {
  return scores
    .map((entry) => {
      const courseHole = courseHoles.find((hole) => hole.hole === entry.hole);
      if (!courseHole || typeof entry.score !== 'number' || entry.score <= 0) return null;

      return {
        holeNumber: entry.hole,
        par: courseHole.par,
        score: entry.score,
        scoreToPar: entry.score - courseHole.par,
        totalPutts: null,
        threePutt: null,
        fairwayHit: null,
        hitGreen: null,
        upAndDownMade: null,
        penalty: null,
      } satisfies PlayerStatsHole;
    })
    .filter(isDefined)
    .sort((a, b) => a.holeNumber - b.holeNumber);
}

function buildSummaryParticipants(summary: RoundGameStatsSummary): GolfCanadaBackendParticipant[] {
  if ('standings' in summary) {
    return summary.standings.map((participant) => ({
      participant_id: participant.participant_id,
      user_id: participant.user_id ?? null,
    }));
  }
  return [];
}

function buildSummaryHoles(summary: RoundGameStatsSummary): GolfCanadaBackendGameHoleSummary[] {
  return summary.holes.map((hole) => ({
    hole_number: hole.hole_number,
    scores: hole.scores.map((score) => ({
      participant_id: score.participant_id,
      user_id: score.user_id ?? null,
      score: score.score ?? null,
    })),
  }));
}

async function getBackendGameStatsSummary(row: MyRoundHistoryRow): Promise<RoundGameStatsSummary | null> {
  const roundId = row.roundId ?? row.round_id;
  const roundGameId = row.roundGameId ?? row.round_game_id ?? null;
  const gameType = normalizeBackendGameType(row);

  if (gameType === 'bbb' && roundId) return getBbbHistorySummary(roundId);
  if (gameType === 'skins' && roundGameId) return getSkinsHistorySummary(roundGameId);
  if (gameType === 'nassau' && roundGameId) return getNassauHistorySummary(roundGameId);
  if (gameType === 'wolf' && roundGameId) return getWolfHistorySummary(roundGameId);
  return null;
}

function mapRoundGameSummaryToStatsRound(params: {
  row: MyRoundHistoryRow;
  summary: RoundGameStatsSummary;
  userId: string;
  teeInfo: ReturnType<typeof resolveRoundStatsTee>;
}): PlayerStatsRound | null {
  const { row, summary, userId, teeInfo } = params;
  const scores = buildCurrentUserGolfScoresFromRoundGameSummary({
    currentUserId: userId,
    holes: buildSummaryHoles(summary),
    participants: buildSummaryParticipants(summary),
  });

  const holes = mapScoreEntriesToStatsHoles(scores ?? []);
  const result = buildStatsRoundFromHoleSet({
    key: `backend:${(row.roundGameId ?? row.round_game_id) || (row.roundId ?? row.round_id)}`,
    date: row.round_date ?? 'Unknown',
    sortTimestamp: row.round_date ?? row.updated_at ?? row.created_at ?? (row.roundId ?? row.round_id),
    ...teeInfo,
    holes,
    source: 'backend',
  });

  if (__DEV__) {
    console.debug('[player-stats-round-debug]', {
      source: 'round_game_summary',
      historyId: (row.roundGameId ?? row.round_game_id) || (row.roundId ?? row.round_id),
      backendRoundId: row.roundId ?? row.round_id,
      roundGameId: row.roundGameId ?? row.round_game_id,
      gameType: row.gameType ?? row.game_type,
      currentUserId: userId,
      hasRegularDetail: false,
      hasGameSummary: true,
      hasScorecard: holes.length > 0,
      holeCount: holes.length,
      scoreTotal: result?.totalScore ?? 0,
      teeKey: result?.teeKey ?? null,
      hasOptionalStats: false,
      included: !!result,
      skipReason: result ? null : 'no_current_user_scorecard_in_summary',
    });
  }

  return result;
}

function mapLocalRoundToStatsRound(round: SavedRound, userId?: string | null): PlayerStatsRound | null {
  const participantId = currentUserParticipantId(round, userId);
  const participant = currentUserParticipant(round, userId);
  const teeInfo = resolveRoundStatsTee({
    participantSelectedTee: participant?.selectedTee ?? null,
    roundTee: round.tee,
    ratingType: round.ratingType,
  });
  const holes = round.holes
    .map((hole) => {
      const courseHole = courseHoles.find((entry) => entry.hole === hole.hole);
      if (!courseHole) return null;

      const groupScore = participantId
        ? hole.groupScores?.find((entry) => entry.participantId === participantId)?.score
        : null;
      const score = round.roundMode === 'casual_group' ? groupScore : hole.score;
      if (typeof score !== 'number' || score <= 0) return null;

      const penaltyKnown = hole.drivePenalty === true || hole.girMissPenalty === true
        ? true
        : hole.drivePenalty === false || hole.girMissPenalty === false
          ? false
          : null;

      return {
        holeNumber: hole.hole,
        par: courseHole.par,
        score,
        scoreToPar: score - courseHole.par,
        totalPutts: typeof hole.totalPutts === 'number' ? hole.totalPutts : null,
        threePutt: typeof hole.threePutt === 'boolean' ? hole.threePutt : (typeof hole.totalPutts === 'number' ? hole.totalPutts >= 3 : null),
        fairwayHit: courseHole.par === 3 ? null : (typeof hole.driveSafe === 'boolean' ? hole.driveSafe : null),
        hitGreen: typeof hole.hitGreen === 'boolean' ? hole.hitGreen : null,
        upAndDownMade: typeof hole.upAndDownMade === 'boolean' ? hole.upAndDownMade : null,
        penalty: penaltyKnown,
      } satisfies PlayerStatsHole;
    })
    .filter(isDefined)
    .sort((a, b) => a.holeNumber - b.holeNumber);

  if (holes.length === 0) return null;

  const totalScore = holes.reduce((sum, hole) => sum + hole.score, 0);
  const totalPar = holes.reduce((sum, hole) => sum + hole.par, 0);
  const frontNine = holes.filter((hole) => hole.holeNumber <= 9);
  const backNine = holes.filter((hole) => hole.holeNumber >= 10);
  const penaltyHoleCount = holes.filter((hole) => hole.penalty === true).length;

  return {
    key: `local:${round.id}`,
    date: round.date,
    sortTimestamp: round.savedAt ?? round.date,
    totalScore,
    totalPar,
    scoreToPar: totalScore - totalPar,
    ...teeInfo,
    frontNineScore: frontNine.length > 0 ? frontNine.reduce((sum, hole) => sum + hole.score, 0) : null,
    backNineScore: backNine.length > 0 ? backNine.reduce((sum, hole) => sum + hole.score, 0) : null,
    totalPutts: round.statsEnabled === false ? null : round.totalPutts,
    fairwaysHit: round.statsEnabled === false ? null : round.fairwaysHit,
    greensInRegulation: round.statsEnabled === false ? null : round.greensInRegulation,
    penalties: buildLocalPenaltyValue(round, penaltyHoleCount),
    upAndDowns: round.statsEnabled === false ? null : round.upAndDowns,
    threePutts: round.statsEnabled === false ? null : round.threePutts,
    holes,
    source: 'local',
  };
}

async function mapBackendRowToStatsRound(row: MyRoundHistoryRow, userId: string): Promise<PlayerStatsRound | null> {
  const roundId = row.roundId ?? row.round_id;
  if (!roundId) return null;

  let detailError: unknown = null;
  const backendTeeInfo = await resolveBackendUserTee({ roundId, userId });

  try {
    const detail = await getRegularRoundHistoryDetail({
      roundId,
      roundGameId: row.roundGameId ?? row.round_game_id ?? null,
      gameType: normalizeBackendGameType(row),
      userId,
      source: 'history_screen',
    });

    const statsByHole = new Map((detail.personalStatsByHole ?? []).map((hole) => [hole.holeNumber, hole]));
    const holes = detail.currentUserHoleScores
      .map((holeScore) => {
        const courseHole = courseHoles.find((entry) => entry.hole === holeScore.holeNumber);
        if (!courseHole || typeof holeScore.strokes !== 'number' || holeScore.strokes <= 0) return null;
        const statHole = statsByHole.get(holeScore.holeNumber);
        return {
          holeNumber: holeScore.holeNumber,
          par: courseHole.par,
          score: holeScore.strokes,
          scoreToPar: holeScore.strokes - courseHole.par,
          totalPutts: typeof statHole?.totalPutts === 'number' ? statHole.totalPutts : null,
          threePutt: typeof statHole?.totalPutts === 'number' ? statHole.totalPutts >= 3 : null,
          fairwayHit: typeof statHole?.fairwayHit === 'boolean' ? statHole.fairwayHit : null,
          hitGreen: typeof statHole?.hitGreen === 'boolean' ? statHole.hitGreen : null,
          upAndDownMade: typeof statHole?.upAndDownMade === 'boolean' ? statHole.upAndDownMade : null,
          penalty: typeof statHole?.penalty === 'boolean' ? statHole.penalty : null,
        } satisfies PlayerStatsHole;
      })
      .filter(isDefined)
      .sort((a, b) => a.holeNumber - b.holeNumber);

    const detailResult = buildStatsRoundFromHoleSet({
      key: `backend:${detail.roundGameId ?? detail.roundId}`,
      date: detail.roundDate ?? 'Unknown',
      sortTimestamp: detail.roundDate ?? row.updated_at ?? row.created_at ?? detail.roundId,
      ...resolveRoundStatsTee({
        participantSelectedTee: backendTeeInfo.teeKey,
        roundTee: detail.backendDetail.teeName ?? backendTeeInfo.teeKey,
        ratingType: null,
      }),
      holes,
      totalPutts: detail.personalStatsSummary?.totalPutts ?? null,
      fairwaysHit: detail.personalStatsSummary?.fairwaysHit ?? null,
      greensInRegulation: detail.personalStatsSummary?.greensInRegulation ?? null,
      penalties: detail.personalStatsSummary?.penalties ?? null,
      upAndDowns: detail.personalStatsSummary?.upAndDowns ?? null,
      source: 'backend',
    });

    if (__DEV__) {
      console.debug('[player-stats-round-debug]', {
        source: 'regular_detail',
        historyId: (row.roundGameId ?? row.round_game_id) || roundId,
        backendRoundId: roundId,
        roundGameId: row.roundGameId ?? row.round_game_id,
        gameType: row.gameType ?? row.game_type,
        currentUserId: userId,
        hasRegularDetail: true,
        hasGameSummary: false,
        hasScorecard: holes.length > 0,
        holeCount: holes.length,
        scoreTotal: detailResult?.totalScore ?? 0,
        teeKey: detailResult?.teeKey ?? null,
        hasOptionalStats: !!detail.personalStatsSummary,
        included: !!detailResult,
        skipReason: detailResult ? null : 'regular_detail_missing_current_user_scores',
      });
    }

    if (detailResult) return detailResult;
  } catch (error) {
    detailError = error;
  }

  const summary = await getBackendGameStatsSummary(row);
  if (summary) {
    const summaryResult = mapRoundGameSummaryToStatsRound({
      row,
      summary,
      userId,
      teeInfo: backendTeeInfo,
    });
    if (summaryResult) return summaryResult;
  }

  if (detailError) throw detailError;
  return null;
}

export async function loadPlayerStatsRounds(userId?: string | null): Promise<PlayerStatsLoadResult> {
  let localRounds = await loadRoundHistory();

  let backendRows: MyRoundHistoryRow[] = [];
  let backendError: string | null = null;

  if (userId) {
    try {
      backendRows = selectPreferredBackendRows(await getMyRoundHistory()).filter((row) => isValidBackendHistoryRow(row).valid);
      const reconcileSummary = await reconcileLocalRoundsWithBackend({
        backendRows,
        localRounds,
      });
      if (reconcileSummary.removedCount > 0) {
        localRounds = await loadRoundHistory();
      }
    } catch (error: any) {
      backendError = error?.message ?? 'Backend history failed to load.';
    }
  }

  const validLocalRounds = localRounds.filter((round) => isValidLocalStatsRound(round, userId));

  const matchedBackendRoundIds = new Set<string>();
  validLocalRounds.forEach((round) => {
    const matchedRow = backendRows.find((row) => localRoundMatchesBackendRow(round, row));
    if (matchedRow) {
      matchedBackendRoundIds.add(matchedRow.roundId ?? matchedRow.round_id);
    }
  });

  const localStatsRounds = validLocalRounds
    .map((round) => mapLocalRoundToStatsRound(round, userId))
    .filter((round): round is PlayerStatsRound => !!round);

  const backendOnlyRows = userId
    ? backendRows.filter((row) => !matchedBackendRoundIds.has(row.roundId ?? row.round_id))
    : [];

  const backendStatsRounds = userId
    ? (await Promise.all(
        backendOnlyRows.map(async (row) => {
          try {
            return await mapBackendRowToStatsRound(row, userId);
          } catch (error: any) {
            if (!isExpectedStatsDetailSkip(error)) {
              console.error('[stats-load] backend detail failed', {
                roundId: row.roundId ?? row.round_id,
                roundGameId: row.roundGameId ?? row.round_game_id,
                message: error?.message ?? error,
              });
            }
            return null;
          }
        }),
      )).filter((round): round is PlayerStatsRound => !!round)
    : [];

  const rounds = [...localStatsRounds, ...backendStatsRounds]
    .sort((a, b) => String(b.sortTimestamp).localeCompare(String(a.sortTimestamp)));

  return {
    rounds,
    backendError,
  };
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentage(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

export function filterStatsRounds(rounds: PlayerStatsRound[], filter: StatsFilterKey) {
  if (filter === 'last5') return rounds.slice(0, 5);
  if (filter === 'last10') return rounds.slice(0, 10);
  if (filter === 'last20') return rounds.slice(0, 20);
  return rounds;
}

export function filterStatsRoundsByTee(rounds: PlayerStatsRound[], teeFilter: StatsTeeFilterKey) {
  if (teeFilter === 'all') return rounds;
  return rounds.filter((round) => round.teeKey === teeFilter);
}

export function availableStatsTeeFilters(rounds: PlayerStatsRound[]) {
  void rounds;
  return [...teeOptions];
}

function handicapDifferentialCount(roundCount: number) {
  if (roundCount < 3) return 0;
  if (roundCount <= 5) return 1;
  if (roundCount <= 8) return 2;
  if (roundCount <= 11) return 3;
  if (roundCount <= 14) return 4;
  if (roundCount <= 16) return 5;
  if (roundCount <= 18) return 6;
  if (roundCount === 19) return 7;
  return 8;
}

function ratingInfoForStatsRound(round: PlayerStatsRound) {
  const ratingRow = ratings[round.teeKey];
  const ratingType = round.ratingType && round.ratingType in ratingRow
    ? round.ratingType
    : 'men' in ratingRow
      ? 'men'
      : 'women' in ratingRow
        ? 'women'
        : null;
  if (!ratingType) return null;
  return ratingRow[ratingType as keyof typeof ratingRow] as { rating: number; slope: number } | undefined;
}

export function estimateHandicapForStatsRounds(
  rounds: PlayerStatsRound[],
  teeFilter: StatsTeeFilterKey,
): PlayerStatsHandicapEstimate {
  const targetRounds = teeFilter === 'all' ? rounds : rounds.filter((round) => round.teeKey === teeFilter);
  const teeKey = teeFilter === 'all' ? DEFAULT_TEE_OPTION : teeFilter;
  const teeLabel = teeFilter === 'all' ? 'All Tees' : teeDisplayLabel(teeFilter);

  const eligibleRounds = targetRounds
    .slice(0, 20)
    .map((round) => {
      const ratingInfo = ratingInfoForStatsRound(round);
      if (!ratingInfo || typeof ratingInfo.rating !== 'number' || typeof ratingInfo.slope !== 'number' || ratingInfo.slope <= 0) {
        return null;
      }
      return {
        round,
        differential: ((round.totalScore - ratingInfo.rating) * 113) / ratingInfo.slope,
      };
    })
    .filter(isDefined);

  const missingRatingRound = targetRounds.find((round) => !ratingInfoForStatsRound(round));
  if (targetRounds.length > 0 && eligibleRounds.length === 0 && missingRatingRound) {
    return {
      teeKey,
      teeLabel,
      eligibleRoundCount: 0,
      selectedDifferentialCount: 0,
      estimatedHandicap: null,
      message: `Handicap estimate unavailable for ${teeDisplayLabel(missingRatingRound.teeKey)} because rating/slope is missing.`,
    };
  }

  const selectedCount = handicapDifferentialCount(eligibleRounds.length);
  if (selectedCount === 0) {
    return {
      teeKey,
      teeLabel,
      eligibleRoundCount: eligibleRounds.length,
      selectedDifferentialCount: 0,
      estimatedHandicap: null,
      message: 'Not enough eligible rounds for an estimated handicap. At least 3 rounds with rating/slope are needed.',
    };
  }

  const selectedDifferentials = eligibleRounds
    .map((entry) => entry.differential)
    .sort((a, b) => a - b)
    .slice(0, selectedCount);

  return {
    teeKey,
    teeLabel,
    eligibleRoundCount: eligibleRounds.length,
    selectedDifferentialCount: selectedDifferentials.length,
    estimatedHandicap: average(selectedDifferentials),
    message: 'Estimated from gross score differentials. Adjusted gross score limits are not applied yet.',
  };
}

export function summarizePlayerStats(rounds: PlayerStatsRound[]): PlayerStatsSummary | null {
  if (rounds.length === 0) return null;

  const allHoles = rounds.flatMap((round) => round.holes);
  const par3Holes = allHoles.filter((hole) => hole.par === 3);
  const par4Holes = allHoles.filter((hole) => hole.par === 4);
  const par5Holes = allHoles.filter((hole) => hole.par === 5);

  const eagles = allHoles.filter((hole) => hole.scoreToPar <= -2).length;
  const birdies = allHoles.filter((hole) => hole.scoreToPar === -1).length;
  const pars = allHoles.filter((hole) => hole.scoreToPar === 0).length;
  const bogeys = allHoles.filter((hole) => hole.scoreToPar === 1).length;
  const doubles = allHoles.filter((hole) => hole.scoreToPar === 2).length;
  const triplesOrWorse = allHoles.filter((hole) => hole.scoreToPar >= 3).length;

  const puttRounds = rounds.filter((round) => typeof round.totalPutts === 'number');
  const puttHoles = allHoles.filter((hole) => typeof hole.totalPutts === 'number');
  const threePuttHoles = allHoles.filter((hole) => hole.threePutt !== null);
  const fairwayHoles = allHoles.filter((hole) => hole.fairwayHit !== null);
  const girHoles = allHoles.filter((hole) => hole.hitGreen !== null);
  const scrambleOpportunities = allHoles.filter((hole) => hole.hitGreen === false && hole.upAndDownMade !== null);
  const penaltyRounds = rounds.filter((round) => typeof round.penalties === 'number');
  const penaltyTrackedHoles = allHoles.filter((hole) => hole.penalty !== null);

  return {
    roundsPlayed: rounds.length,
    scoringAverage: rounds.reduce((sum, round) => sum + round.totalScore, 0) / rounds.length,
    bestRound: Math.min(...rounds.map((round) => round.totalScore)),
    worstRound: Math.max(...rounds.map((round) => round.totalScore)),
    averageScoreToPar: rounds.reduce((sum, round) => sum + round.scoreToPar, 0) / rounds.length,
    averageFrontNine: average(rounds.map((round) => round.frontNineScore).filter((value): value is number => typeof value === 'number')),
    averageBackNine: average(rounds.map((round) => round.backNineScore).filter((value): value is number => typeof value === 'number')),
    averagePar3Score: average(par3Holes.map((hole) => hole.score)),
    averagePar4Score: average(par4Holes.map((hole) => hole.score)),
    averagePar5Score: average(par5Holes.map((hole) => hole.score)),
    averagePar3ToPar: average(par3Holes.map((hole) => hole.scoreToPar)),
    averagePar4ToPar: average(par4Holes.map((hole) => hole.scoreToPar)),
    averagePar5ToPar: average(par5Holes.map((hole) => hole.scoreToPar)),
    eaglesPerRound: eagles / rounds.length,
    birdiesPerRound: birdies / rounds.length,
    parsPerRound: pars / rounds.length,
    bogeysPerRound: bogeys / rounds.length,
    doublesPerRound: doubles / rounds.length,
    triplesOrWorsePerRound: triplesOrWorse / rounds.length,
    parOrBetterPct: percentage(allHoles.filter((hole) => hole.scoreToPar <= 0).length, allHoles.length) ?? 0,
    bogeyOrBetterPct: percentage(allHoles.filter((hole) => hole.scoreToPar <= 1).length, allHoles.length) ?? 0,
    doubleBogeyAvoidancePct: percentage(allHoles.filter((hole) => hole.scoreToPar < 2).length, allHoles.length) ?? 0,
    puttsPerRound: puttRounds.length > 0
      ? puttRounds.reduce((sum, round) => sum + Number(round.totalPutts ?? 0), 0) / puttRounds.length
      : null,
    puttsPerHole: puttHoles.length > 0
      ? puttHoles.reduce((sum, hole) => sum + Number(hole.totalPutts ?? 0), 0) / puttHoles.length
      : null,
    threePuttsPerRound: rounds.some((round) => typeof round.threePutts === 'number')
      ? rounds.reduce((sum, round) => sum + Number(round.threePutts ?? 0), 0) / rounds.length
      : null,
    threePuttAvoidancePct: percentage(threePuttHoles.filter((hole) => hole.threePutt !== true).length, threePuttHoles.length),
    fairwaysHitPct: percentage(fairwayHoles.filter((hole) => hole.fairwayHit === true).length, fairwayHoles.length),
    girPct: percentage(girHoles.filter((hole) => hole.hitGreen === true).length, girHoles.length),
    scramblingPct: percentage(scrambleOpportunities.filter((hole) => hole.upAndDownMade === true).length, scrambleOpportunities.length),
    penaltiesPerRound: penaltyRounds.length > 0
      ? penaltyRounds.reduce((sum, round) => sum + Number(round.penalties ?? 0), 0) / penaltyRounds.length
      : null,
    penaltyHolesPerRound: penaltyTrackedHoles.length > 0
      ? penaltyTrackedHoles.filter((hole) => hole.penalty === true).length / rounds.length
      : null,
  };
}
