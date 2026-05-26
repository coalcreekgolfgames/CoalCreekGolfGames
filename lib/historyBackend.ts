import { supabase } from '@/lib/supabase';
import type { SavedRound } from '@/types/round';

export type HistoryBackendGameType = 'standard' | 'bbb' | 'skins' | 'nassau' | 'wolf';

export type MyRoundHistoryRow = {
  round_id: string;
  round_game_id: string | null;
  game_type: HistoryBackendGameType | null;
  round_mode: string | null;
  status: string | null;
  course_name: string | null;
  round_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  current_user_score: number | null;
  holes_complete: number | null;
  hole_score_row_count?: number | null;
  standard_score?: number | null;
  standard_holes_complete?: number | null;
  standard_hole_score_count?: number | null;
  game_score?: number | null;
  game_holes_complete?: number | null;
  game_hole_score_count?: number | null;
  selected_score_source?: string | null;
  is_participant: boolean;
  is_scorer: boolean;
  participant_count?: number | null;
  player_count?: number | null;
  roundId?: string;
  roundGameId?: string | null;
  gameType?: HistoryBackendGameType | null;
  currentUserScore?: number | null;
  holesComplete?: number | null;
  holeScoreRowCount?: number | null;
  standardScore?: number | null;
  standardHolesComplete?: number | null;
  standardHoleScoreCount?: number | null;
  gameScore?: number | null;
  gameHolesComplete?: number | null;
  gameHoleScoreCount?: number | null;
  selectedScoreSource?: string | null;
};

export async function getMyRoundHistory(): Promise<MyRoundHistoryRow[]> {
  const { data, error } = await supabase.rpc('get_my_round_history');
  if (error) throw error;
  return ((data ?? []) as MyRoundHistoryRow[]).map((row) => ({
    ...row,
    roundId: row.round_id,
    roundGameId: row.round_game_id ?? null,
    gameType: row.game_type ?? null,
    currentUserScore: row.current_user_score ?? null,
    holesComplete: row.holes_complete ?? null,
    holeScoreRowCount: row.hole_score_row_count ?? null,
    standardScore: row.standard_score ?? null,
    standardHolesComplete: row.standard_holes_complete ?? null,
    standardHoleScoreCount: row.standard_hole_score_count ?? null,
    gameScore: row.game_score ?? null,
    gameHolesComplete: row.game_holes_complete ?? null,
    gameHoleScoreCount: row.game_hole_score_count ?? null,
    selectedScoreSource: row.selected_score_source ?? null,
  }));
}

export function inferLocalHistoryGameType(round: SavedRound): HistoryBackendGameType {
  if (round.roundMode === 'casual_group' && round.groupGameMode === 'bingo_bango_bongo') return 'bbb';
  if (round.roundMode === 'casual_group' && round.groupGameMode === 'skins') return 'skins';
  if (round.roundMode === 'casual_group' && round.groupGameMode === 'nassau') return 'nassau';
  if (round.roundMode === 'casual_group' && round.groupGameMode === 'wolf') return 'wolf';
  return 'standard';
}

export function findLocalHistoryRoundByAnyId(rounds: SavedRound[], routeId: string) {
  return rounds.find((entry) =>
    entry.id === routeId
    || entry.backendRoundId === routeId
    || entry.backendRoundGameId === routeId,
  ) ?? null;
}

export function findHistoryBackendRowByRouteId(rows: MyRoundHistoryRow[], routeId: string) {
  return rows.find((row) => row.round_game_id === routeId || row.round_id === routeId) ?? null;
}

export function regularRoundBaseTypeLabelFromBackendRow(row: MyRoundHistoryRow) {
  if ((row.participant_count ?? 0) > 1 || (row.player_count ?? 0) > 1 || row.round_mode === 'casual_group') {
    return 'Group';
  }
  return 'Standard';
}

export function historyTypeLabelFromBackendRow(row: MyRoundHistoryRow) {
  const baseType = regularRoundBaseTypeLabelFromBackendRow(row);
  if (row.game_type === 'bbb') return `${baseType} + BBB`;
  if (row.game_type === 'skins') return `${baseType} + Skins`;
  if (row.game_type === 'nassau') return `${baseType} + Nassau`;
  if (row.game_type === 'wolf') return `${baseType} + Wolf`;
  return baseType;
}

export function historyDateFromBackendRow(row: MyRoundHistoryRow) {
  return row.round_date
    ?? row.updated_at?.slice(0, 10)
    ?? row.created_at?.slice(0, 10)
    ?? 'Unknown';
}

export function formatRegularRoundStatus(status?: string | null) {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();

  if (!normalizedStatus) return null;

  if ([
    'pending_confirmation',
    'confirmed',
    'submitted',
    'complete',
    'completed',
  ].includes(normalizedStatus)) {
    return 'Saved';
  }

  if (normalizedStatus === 'draft') {
    return 'Saved';
  }

  return null;
}

export function localHistoryNumericScore(round: SavedRound, userId?: string | null) {
  if (round.roundMode !== 'casual_group') {
    return typeof round.totalScore === 'number' ? round.totalScore : 0;
  }

  const participantId = round.group?.participants?.find((participant) =>
    participant.type === 'app_user' && participant.id === (userId ?? round.draftOwnerUserId),
  )?.id ?? round.group?.participants?.find((participant) => participant.type === 'app_user')?.id ?? null;

  if (participantId) {
    const total = round.holes.reduce((sum, hole) => {
      const score = hole.groupScores?.find((entry) => entry.participantId === participantId)?.score;
      return sum + (typeof score === 'number' ? score : 0);
    }, 0);
    if (total > 0) return total;
  }

  return typeof round.totalScore === 'number' ? round.totalScore : 0;
}

export function isValidBackendHistoryRow(row: MyRoundHistoryRow) {
  const parsedScore = Number(row.currentUserScore ?? row.current_user_score);
  const parsedHoles = Number(row.holesComplete ?? row.holes_complete);
  const parsedHoleRows = Number(row.holeScoreRowCount ?? row.hole_score_row_count ?? row.holesComplete ?? row.holes_complete ?? 0);
  const normalizedStatus = String(row.status ?? '').toLowerCase();

  let reason = 'valid';
  let isValid = true;

  if (!Number.isFinite(parsedScore) || parsedScore <= 0) {
    isValid = false;
    reason = 'score_not_positive';
  } else if (!Number.isFinite(parsedHoles) || parsedHoles <= 0) {
    isValid = false;
    reason = 'holes_complete_zero';
  } else if (!Number.isFinite(parsedHoleRows) || parsedHoleRows <= 0) {
    isValid = false;
    reason = 'no_hole_score_rows';
  } else if (['deleted', 'cancelled', 'canceled', 'abandoned'].includes(normalizedStatus)) {
    isValid = false;
    reason = 'excluded_status';
  } else if (normalizedStatus === 'draft' && parsedHoles < 18) {
    isValid = false;
    reason = 'draft_under_18_holes';
  } else if (((row.gameType ?? row.game_type) === 'skins' || (row.gameType ?? row.game_type) === 'nassau' || (row.gameType ?? row.game_type) === 'wolf') && !(row.roundGameId ?? row.round_game_id)) {
    isValid = false;
    reason = 'missing_round_game_id';
  } else if (((row.gameType ?? row.game_type) === 'bbb' || (row.gameType ?? row.game_type) === 'standard') && !(row.roundId ?? row.round_id)) {
    isValid = false;
    reason = 'missing_round_id';
  }

  return {
    valid: isValid as boolean,
    reason,
    parsedScore,
    parsedHoles,
    parsedHoleRows,
  };
}
