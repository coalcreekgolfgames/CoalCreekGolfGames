import { holes as courseHoles } from '@/constants/course';
import { supabase } from '@/lib/supabase';
import type { HoleDraft, LocalRoundDraft } from '@/types/round';

const DEBUG_STANDARD_LIVE_BOARD = false;

export type StandardRoundLiveBoardViewRow = {
  round_id: string;
  round_participant_id: string;
  user_id?: string | null;
  guest_profile_id?: string | null;
  display_name: string;
  participant_order?: number | null;
  is_scorer: boolean;
  holes_completed: number;
  gross_total: number;
  hole_score_row_count?: number | null;
  standing_rank: number;
};

export type StandardRoundLiveBoardData = {
  players: StandardRoundLiveBoardPlayer[];
  rows: StandardRoundLiveBoardViewRow[];
  participantCount: number;
  holeScoreCount: number;
  holeScoreRowCount: number;
};

export type StandardRoundLiveBoardPlayer = {
  participantId: string;
  userId?: string | null;
  displayName: string;
  totalScore: number | null;
  thru: number;
  plusMinus: number | null;
  holeScores: Record<number, number>;
  standingRank: number;
};

export type StandardRoundLiveBoardIdSource =
  | 'backend_round_id'
  | 'round_game_id'
  | 'local_draft'
  | 'companion_access'
  | 'unresolved';

export type ResolvedStandardRoundLiveBoardId = {
  originalRouteId: string | null;
  backendRoundId: string | null;
  source: StandardRoundLiveBoardIdSource;
};

export type StandardRoundHoleHistoryViewRow = {
  round_id: string;
  round_participant_id: string;
  user_id?: string | null;
  guest_profile_id?: string | null;
  display_name: string;
  participant_order?: number | null;
  is_scorer: boolean;
  hole_number?: number | null;
  strokes?: number | null;
};

export type StandardRoundParticipantHoleScoreRow = {
  round_id: string;
  round_mode: string | null;
  status: string | null;
  course_name: string | null;
  round_date: string | null;
  round_participant_id: string;
  participant_order?: number | null;
  user_id?: string | null;
  guest_profile_id?: string | null;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  display_name: string;
  is_scorer: boolean;
  hole_number?: number | null;
  strokes?: number | null;
  participant_total_score?: number | null;
  participant_holes_complete?: number | null;
};

export type StandardRoundBackendDetail = {
  roundId: string;
  roundMode: string | null;
  status: string | null;
  courseName: string | null;
  roundDate: string | null;
  currentUserScore: number;
  holeCount: number;
  teeName: string | null;
  isCreator: boolean;
  isScoringUser: boolean;
  isParticipant: boolean;
  hasHoleScores: boolean;
  statsSummary: {
    totalPutts: number | null;
    fairwaysHit: number | null;
    greensInRegulation: number | null;
    penalties: number | null;
    upAndDowns: number | null;
  } | null;
  holes: Array<{
    holeNumber: number;
    participantId: string;
    userId?: string | null;
    displayName: string;
    participantOrder?: number | null;
    isScorer: boolean;
    strokes: number | null;
    totalPutts?: number | null;
    fairwayHit?: boolean | null;
    hitGreen?: boolean | null;
    upAndDownMade?: boolean | null;
    penalty?: boolean | null;
  }>;
};

type StandardRoundHistoryDetailRpcRow = {
  round_id: string;
  round_mode: string | null;
  status: string | null;
  course_name: string | null;
  round_date: string | null;
  tee_name?: string | null;
  current_user_score: number | null;
  holes_complete: number | null;
  is_creator: boolean | null;
  is_scoring_user: boolean | null;
  is_participant: boolean | null;
  has_hole_scores: boolean | null;
  hole_number: number | null;
  strokes: number | null;
  display_name: string | null;
};

type StandardRoundParticipantHoleScoreRpcRow = StandardRoundParticipantHoleScoreRow;

type RoundYardageStatRow = {
  putts: number | null;
  fairways_hit: number | null;
  greens_in_regulation: number | null;
  penalty_strokes: number | null;
  scrambling_successes: number | null;
};

type RoundYardageAnswerRow = {
  hole_number: number;
  question_key: 'fairway_hit' | 'green_in_regulation' | 'up_and_down' | 'penalty' | 'three_putt';
  answer_boolean: boolean | null;
  answer_number: number | null;
};

type StandardRoundDirectParticipantRow = {
  id: string;
  user_id?: string | null;
  guest_profile_id?: string | null;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  participant_order?: number | null;
  is_scorer?: boolean | null;
};

type StandardRoundDirectHoleScoreRow = {
  participant_id?: string | null;
  user_id?: string | null;
  hole_number?: number | null;
  strokes?: number | null;
};

export async function getStandardRoundLiveBoard(backendRoundId: string) {
  const { data, error } = await supabase
    .from('v_standard_round_live_board')
    .select(`
      round_id,
      round_participant_id,
      user_id,
      guest_profile_id,
      display_name,
      participant_order,
      is_scorer,
      holes_completed,
      gross_total,
      standing_rank
    `)
    .eq('round_id', backendRoundId)
    .order('standing_rank', { ascending: true });

  if (error) throw error;
  return (data ?? []) as StandardRoundLiveBoardViewRow[];
}

function buildDisplayName(firstName?: string | null, lastName?: string | null) {
  return [String(firstName ?? '').trim(), String(lastName ?? '').trim()].filter(Boolean).join(' ').trim() || 'Player';
}

async function lookupProfiles(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return {} as Record<string, { first_name?: string | null; last_name?: string | null }>;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name')
    .in('id', uniqueUserIds);

  if (error) {
    console.warn('[standard-live-board] profiles_lookup_failed', error?.message ?? error);
    return {} as Record<string, { first_name?: string | null; last_name?: string | null }>;
  }
  return Object.fromEntries((data ?? []).map((row: any) => [row.id, row]));
}

function parThroughHoleCount(holeCount: number) {
  return courseHoles.slice(0, Math.max(0, holeCount)).reduce((sum, hole) => sum + hole.par, 0);
}

async function getStandardRoundLiveBoardDataDirect(backendRoundId: string): Promise<StandardRoundLiveBoardData> {
  const [participantsRes, holeScoresRes, profilesById] = await Promise.all([
    supabase
      .from('round_participants')
      .select('id, user_id, guest_profile_id, guest_first_name, guest_last_name, participant_order, is_scorer')
      .eq('round_id', backendRoundId)
      .order('participant_order', { ascending: true }),
    supabase
      .from('hole_scores')
      .select('participant_id, user_id, hole_number, strokes')
      .eq('round_id', backendRoundId)
      .not('strokes', 'is', null),
    supabase
      .from('round_participants')
      .select('user_id')
      .eq('round_id', backendRoundId)
      .then(async ({ data, error }) => {
        if (error) throw error;
        const userIds = (data ?? []).map((row: any) => row.user_id).filter(Boolean) as string[];
        return lookupProfiles(userIds);
      }),
  ]);

  if (participantsRes.error) throw participantsRes.error;
  if (holeScoresRes.error) throw holeScoresRes.error;

  const participantRows = (participantsRes.data ?? []) as StandardRoundDirectParticipantRow[];
  const holeScoreRows = (holeScoresRes.data ?? []) as StandardRoundDirectHoleScoreRow[];
  const rows: StandardRoundLiveBoardViewRow[] = participantRows.map((participantRow) => {
    const matchingScores = holeScoreRows.filter((scoreRow) => (
      scoreRow.participant_id
        ? scoreRow.participant_id === participantRow.id
        : !!participantRow.user_id && scoreRow.user_id === participantRow.user_id
    ));
    const holesCompleted = new Set(
      matchingScores
        .filter((scoreRow) => typeof scoreRow.hole_number === 'number' && typeof scoreRow.strokes === 'number' && Number(scoreRow.strokes) > 0)
        .map((scoreRow) => Number(scoreRow.hole_number)),
    ).size;
    const grossTotal = matchingScores.reduce((sum, scoreRow) => (
      typeof scoreRow.strokes === 'number' && Number(scoreRow.strokes) > 0
        ? sum + Number(scoreRow.strokes)
        : sum
    ), 0);
    const profile = participantRow.user_id ? profilesById[participantRow.user_id] : null;
    const displayName = participantRow.user_id
      ? buildDisplayName(profile?.first_name, profile?.last_name)
      : buildDisplayName(participantRow.guest_first_name, participantRow.guest_last_name);

    return {
      round_id: backendRoundId,
      round_participant_id: participantRow.id,
      user_id: participantRow.user_id ?? null,
      guest_profile_id: participantRow.guest_profile_id ?? null,
      display_name: displayName,
      participant_order: participantRow.participant_order ?? null,
      is_scorer: participantRow.is_scorer === true,
      holes_completed: holesCompleted,
      gross_total: grossTotal,
      hole_score_row_count: matchingScores.length,
      standing_rank: 0,
    };
  }).sort((a, b) => (
    b.holes_completed - a.holes_completed
    || a.gross_total - b.gross_total
    || Number(a.participant_order ?? 999) - Number(b.participant_order ?? 999)
    || a.display_name.localeCompare(b.display_name)
  )).map((row, index) => ({
    ...row,
    standing_rank: index + 1,
  }));

  const players: StandardRoundLiveBoardPlayer[] = rows.map((row) => {
    const totalScore = row.holes_completed > 0 ? row.gross_total : null;
    const plusMinus = totalScore === null ? null : totalScore - parThroughHoleCount(row.holes_completed);
    return {
      participantId: row.round_participant_id,
      userId: row.user_id ?? null,
      displayName: row.display_name,
      totalScore,
      thru: row.holes_completed,
      plusMinus,
      holeScores: {},
      standingRank: row.standing_rank,
    };
  });

  return {
    players,
    rows,
    participantCount: rows.length,
    holeScoreCount: holeScoreRows.length,
    holeScoreRowCount: holeScoreRows.length,
  };
}

async function hasRoundParticipants(roundId: string) {
  const { count, error } = await supabase
    .from('round_participants')
    .select('id', { count: 'exact', head: true })
    .eq('round_id', roundId);

  if (error) {
    console.warn('[standard-live-board] round_participants_probe_failed', {
      roundId,
      message: error?.message ?? error,
    });
    return false;
  }

  return Number(count ?? 0) > 0;
}

async function resolveRoundIdFromRoundGame(routeId: string) {
  const { data, error } = await supabase
    .from('round_games')
    .select('round_id')
    .eq('id', routeId)
    .maybeSingle();

  if (error) {
    console.warn('[standard-live-board] round_game_probe_failed', {
      routeId,
      message: error?.message ?? error,
    });
    return null;
  }

  return data?.round_id ?? null;
}

async function resolveRoundIdFromCompanionAccess(roundId: string, userId: string) {
  const { data, error } = await supabase
    .from('v_group_round_participant_companion_access')
    .select('round_id')
    .eq('round_id', roundId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[standard-live-board] companion_access_probe_failed', {
      roundId,
      userId,
      message: error?.message ?? error,
    });
    return null;
  }

  return data?.round_id ?? null;
}

export async function resolveStandardRoundLiveBoardBackendRoundId(params: {
  routeId: string | null;
  draft: LocalRoundDraft | null;
  userId?: string | null;
}): Promise<ResolvedStandardRoundLiveBoardId> {
  const originalRouteId = params.routeId ?? null;
  const localDraftBackendRoundId = params.draft?.backendRoundId ?? null;

  if (originalRouteId && await hasRoundParticipants(originalRouteId)) {
    return {
      originalRouteId,
      backendRoundId: originalRouteId,
      source: 'backend_round_id',
    };
  }

  if (originalRouteId) {
    const roundGameRoundId = await resolveRoundIdFromRoundGame(originalRouteId);
    if (roundGameRoundId) {
      return {
        originalRouteId,
        backendRoundId: roundGameRoundId,
        source: 'round_game_id',
      };
    }
  }

  if (params.draft?.id && originalRouteId && params.draft.id === originalRouteId && localDraftBackendRoundId) {
    return {
      originalRouteId,
      backendRoundId: localDraftBackendRoundId,
      source: 'local_draft',
    };
  }

  if (!originalRouteId && localDraftBackendRoundId) {
    return {
      originalRouteId,
      backendRoundId: localDraftBackendRoundId,
      source: 'local_draft',
    };
  }

  if (params.userId) {
    const companionCandidateIds = Array.from(new Set(
      [originalRouteId, localDraftBackendRoundId].filter((value): value is string => !!value),
    ));
    for (const candidateId of companionCandidateIds) {
      const resolvedRoundId = await resolveRoundIdFromCompanionAccess(candidateId, params.userId);
      if (resolvedRoundId) {
        return {
          originalRouteId,
          backendRoundId: resolvedRoundId,
          source: 'companion_access',
        };
      }
    }
  }

  return {
    originalRouteId,
    backendRoundId: null,
    source: 'unresolved',
  };
}

export async function getStandardRoundLiveBoardData(backendRoundId: string): Promise<StandardRoundLiveBoardData> {
  if (__DEV__ && DEBUG_STANDARD_LIVE_BOARD) {
    console.log('[standard-live-board] rpc_start', {
      backendRoundId,
      rpc: 'get_standard_group_live_board',
    });
  }

  const { data, error } = await supabase.rpc('get_standard_group_live_board', {
    p_round_id: backendRoundId,
  });

  if (error) {
    if (__DEV__ && DEBUG_STANDARD_LIVE_BOARD) {
      console.log('[standard-live-board] rpc_error', {
        backendRoundId,
        rpc: 'get_standard_group_live_board',
        code: error.code ?? null,
        message: error.message ?? null,
        details: error.details ?? null,
      });
    }
    return getStandardRoundLiveBoardDataDirect(backendRoundId);
  }

  const rows = (data ?? []) as StandardRoundLiveBoardViewRow[];
  const directParticipantCount = await hasRoundParticipants(backendRoundId)
    ? await supabase
      .from('round_participants')
      .select('id', { count: 'exact', head: true })
      .eq('round_id', backendRoundId)
      .then(({ count }) => Number(count ?? 0))
    : 0;
  if (rows.length === 0 || (directParticipantCount > 0 && rows.length < directParticipantCount)) {
    return getStandardRoundLiveBoardDataDirect(backendRoundId);
  }
  const holeScoreRowCount = Number(rows[0]?.hole_score_row_count ?? 0);

  if (__DEV__ && DEBUG_STANDARD_LIVE_BOARD) {
    console.log('[standard-live-board] rpc_success', {
      backendRoundId,
      rpc: 'get_standard_group_live_board',
      rowCount: rows.length,
      holeScoreRowCount,
    });
  }

  const players: StandardRoundLiveBoardPlayer[] = rows.map((row) => {
    const holeScores: Record<number, number> = {};
    const totalScore = row.holes_completed > 0 ? row.gross_total : null;
    const plusMinus = totalScore === null ? null : totalScore - parThroughHoleCount(row.holes_completed);
    return {
      participantId: row.round_participant_id,
      userId: row.user_id ?? null,
      displayName: row.display_name,
      totalScore,
      thru: row.holes_completed,
      plusMinus,
      holeScores,
      standingRank: row.standing_rank,
    };
  });

  if (__DEV__ && DEBUG_STANDARD_LIVE_BOARD) {
    console.log('[standard-live-board] mapped_players', {
      backendRoundId,
      playersLength: players.length,
    });
  }

  return {
    players,
    rows,
    participantCount: rows.length,
    holeScoreCount: holeScoreRowCount,
    holeScoreRowCount,
  };
}

export async function getStandardGroupCurrentUserOfficialTotal(backendRoundId: string, userId: string) {
  const liveBoard = await getStandardRoundLiveBoardData(backendRoundId);
  const matchingPlayer = liveBoard.players.find((player) => player.userId === userId) ?? null;
  return {
    totalScore: matchingPlayer?.totalScore ?? null,
    playerFound: !!matchingPlayer,
    playersLength: liveBoard.players.length,
    holeScoreRowCount: liveBoard.holeScoreRowCount,
  };
}

export async function getStandardRoundHoleHistory(backendRoundId: string) {
  const { data, error } = await supabase
    .from('v_standard_round_hole_history')
    .select(`
      round_id,
      round_participant_id,
      user_id,
      guest_profile_id,
      display_name,
      participant_order,
      is_scorer,
      hole_number,
      strokes
    `)
    .eq('round_id', backendRoundId)
    .order('hole_number', { ascending: true, nullsFirst: false })
    .order('participant_order', { ascending: true });

  if (error) throw error;
  return (data ?? []) as StandardRoundHoleHistoryViewRow[];
}

export async function getStandardRoundParticipantHoleScorecard(roundId: string) {
  const { data, error } = await supabase.rpc('get_standard_round_hole_scorecard', {
    p_round_id: roundId,
  });

  if (error) throw error;
  return (data ?? []) as StandardRoundParticipantHoleScoreRpcRow[];
}

export async function getStandardRoundBackendDetail(roundId: string, userId: string): Promise<StandardRoundBackendDetail> {
  const [{ data, error }, statsRes, answersRes] = await Promise.all([
    supabase.rpc('get_standard_round_history_detail', {
      p_round_id: roundId,
    }),
    supabase
      .from('round_yardage_stats')
      .select('putts, fairways_hit, greens_in_regulation, penalty_strokes, scrambling_successes')
      .eq('round_id', roundId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('round_yardage_answers')
      .select('hole_number, question_key, answer_boolean, answer_number')
      .eq('round_id', roundId)
      .eq('user_id', userId)
      .order('hole_number', { ascending: true }),
  ]);

  if (error) throw error;
  if (statsRes.error) {
    console.warn('[standard-history] stats_lookup_failed', statsRes.error?.message ?? statsRes.error);
  }
  if (answersRes.error) {
    console.warn('[standard-history] answers_lookup_failed', answersRes.error?.message ?? answersRes.error);
  }

  const rows = (data ?? []) as StandardRoundHistoryDetailRpcRow[];
  if (rows.length === 0) {
    const emptyError = new Error('No standard round history detail was returned.');
    (emptyError as any).code = 'EMPTY_HISTORY_DETAIL';
    throw emptyError;
  }

  const firstRow = rows[0];
  const isCreator = firstRow.is_creator === true;
  const isScoringUser = firstRow.is_scoring_user === true;
  const isParticipant = firstRow.is_participant === true;
  const hasHoleScores = firstRow.has_hole_scores === true;
  const allowed = isCreator || isScoringUser || isParticipant || hasHoleScores;

  if (__DEV__ && DEBUG_STANDARD_LIVE_BOARD) {
    console.log('[standard-history] access_check', {
      roundId,
      authUserId: userId,
      isCreator,
      isScoringUser,
      isParticipant,
      hasHoleScores,
      allowed,
    });
  }

  if (!allowed) {
    const accessError = new Error('You do not have access to this round history.');
    (accessError as any).code = 'ACCESS_DENIED';
    throw accessError;
  }

  const answerRows = (answersRes.data ?? []) as RoundYardageAnswerRow[];
  const answersByHole = new Map<number, Partial<{
    fairwayHit: boolean | null;
    hitGreen: boolean | null;
    upAndDownMade: boolean | null;
    penalty: boolean | null;
    totalPutts: number | null;
  }>>();
  answerRows.forEach((row) => {
    const existing = answersByHole.get(row.hole_number) ?? {};
    if (row.question_key === 'fairway_hit') existing.fairwayHit = row.answer_boolean;
    if (row.question_key === 'green_in_regulation') existing.hitGreen = row.answer_boolean;
    if (row.question_key === 'up_and_down') existing.upAndDownMade = row.answer_boolean;
    if (row.question_key === 'penalty') existing.penalty = row.answer_boolean;
    if (row.question_key === 'three_putt') existing.totalPutts = row.answer_boolean === true ? 3 : null;
    answersByHole.set(row.hole_number, existing);
  });

  const holes = rows
    .filter((row) => typeof row.hole_number === 'number')
    .map((row) => ({
      ...(answersByHole.get(Number(row.hole_number)) ?? {}),
      holeNumber: Number(row.hole_number),
      participantId: userId,
      userId,
      displayName: row.display_name ?? 'Player',
      participantOrder: 1,
      isScorer: isScoringUser,
      strokes: typeof row.strokes === 'number' ? row.strokes : null,
    }));

  return {
    roundId,
    roundMode: firstRow.round_mode ?? null,
    status: firstRow.status ?? null,
    courseName: firstRow.course_name ?? null,
    roundDate: firstRow.round_date ?? null,
    teeName: firstRow.tee_name ?? null,
    currentUserScore: Number(firstRow.current_user_score ?? 0),
    holeCount: Number(firstRow.holes_complete ?? 0),
    isCreator,
    isScoringUser,
    isParticipant,
    hasHoleScores,
    statsSummary: statsRes.data ? {
      totalPutts: statsRes.data.putts ?? null,
      fairwaysHit: statsRes.data.fairways_hit ?? null,
      greensInRegulation: statsRes.data.greens_in_regulation ?? null,
      penalties: statsRes.data.penalty_strokes ?? null,
      upAndDowns: statsRes.data.scrambling_successes ?? null,
    } : null,
    holes,
  };
}

export function mergeStandardRoundBackendHoleScores<T extends LocalRoundDraft>(
  round: T,
  backendRows: StandardRoundHoleHistoryViewRow[],
): T {
  if (round.roundMode !== 'casual_group' || !round.group?.participants.length || backendRows.length === 0) {
    return round;
  }

  const rowsByHole = new Map<number, StandardRoundHoleHistoryViewRow[]>();
  backendRows.forEach((row) => {
    if (typeof row.hole_number !== 'number' || typeof row.strokes !== 'number') return;
    const rows = rowsByHole.get(row.hole_number) ?? [];
    rows.push(row);
    rowsByHole.set(row.hole_number, rows);
  });

  return {
    ...round,
    holes: round.holes.map((hole): HoleDraft => {
      const rows = rowsByHole.get(hole.hole) ?? [];
      if (rows.length === 0) return hole;

      const groupScores = round.group!.participants.map((participant, index) => {
        const seat = index + 1;
        const row = rows.find((entry) => Number(entry.participant_order ?? 0) === seat);
        return {
          participantId: participant.id,
          score: typeof row?.strokes === 'number' ? row.strokes : null,
        };
      });
      const appUserParticipant = round.group!.participants.find((participant) => participant.type === 'app_user') ?? round.group!.participants[0];
      const appUserScore = groupScores.find((entry) => entry.participantId === appUserParticipant?.id)?.score ?? null;

      return {
        ...hole,
        score: typeof appUserScore === 'number' ? appUserScore : hole.score,
        groupScores,
      };
    }),
  };
}
