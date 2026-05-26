import { supabase } from '@/lib/supabase';
import { ensureGroupScoresForHole, summarizeBingoBangoBongo } from '@/lib/bingoBangoBongo';
import { BACKEND_REGULAR_GROUP_ROUND_MODE } from '@/lib/regularRoundBackendMode';
import type { GroupParticipant, HoleDraft, LocalRoundDraft } from '@/types/round';

function nowIso() {
  return new Date().toISOString();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export type BbbLiveStandingRow = {
  round_game_id: string;
  round_id: string;
  status: string;
  buy_in_cents?: number | null;
  participant_id: string;
  user_id?: string | null;
  display_name: string;
  seat_order?: number | null;
  bingo_count: number;
  bango_count: number;
  bongo_count: number;
  total_bbb_points: number;
  stroke_total: number;
  standing_rank: number;
};

export type BbbHoleHistoryRow = {
  round_id: string;
  round_game_id: string;
  buy_in_cents?: number | null;
  round_game_bbb_hole_id: string;
  hole_number: number;
  bingo_winner_participant_id?: string | null;
  bango_winner_participant_id?: string | null;
  bongo_winner_participant_id?: string | null;
  bingo_winner_display_name?: string | null;
  bango_winner_display_name?: string | null;
  bongo_winner_display_name?: string | null;
  participant_id?: string | null;
  user_id?: string | null;
  participant_display_name?: string | null;
  seat_order?: number | null;
  score?: number | null;
};

export type BbbHistoryHoleSummary = {
  round_game_bbb_hole_id: string;
  hole_number: number;
  bingo_winner_participant_id?: string | null;
  bingo_winner_display_name?: string | null;
  bango_winner_participant_id?: string | null;
  bango_winner_display_name?: string | null;
  bongo_winner_participant_id?: string | null;
  bongo_winner_display_name?: string | null;
  scores: Array<{
    participant_id: string;
    user_id?: string | null;
    display_name: string;
    seat_order?: number | null;
    score: number | null;
  }>;
};

export type BbbHistorySummary = {
  round_id: string;
  round_game_id: string;
  buy_in_cents?: number | null;
  standings: BbbLiveStandingRow[];
  holes: BbbHistoryHoleSummary[];
};

function normalizeStandingRow(row: any): BbbLiveStandingRow {
  return {
    round_game_id: row.round_game_id,
    round_id: row.round_id,
    status: row.status ?? 'active',
    buy_in_cents: Number.isFinite(Number(row.buy_in_cents)) ? Number(row.buy_in_cents) : null,
    participant_id: row.participant_id,
    user_id: row.user_id ?? null,
    display_name: row.display_name ?? 'Player',
    seat_order: row.seat_order ?? null,
    bingo_count: Number(row.bingo_count ?? 0),
    bango_count: Number(row.bango_count ?? 0),
    bongo_count: Number(row.bongo_count ?? 0),
    total_bbb_points: Number(row.total_bbb_points ?? 0),
    stroke_total: Number(row.stroke_total ?? 0),
    standing_rank: Number(row.standing_rank ?? 0),
  };
}

export async function ensureBbbBackendRound(params: {
  round: LocalRoundDraft;
  userId: string;
}) {
  const { round, userId } = params;
  if (round.roundMode !== 'casual_group' || round.groupGameMode !== 'bingo_bango_bongo' || !round.group) {
    return round;
  }

  const group = round.group;
  let nextRound = { ...round };

  if (!nextRound.backendRoundId) {
    const roundRes = await supabase
      .from('rounds')
      .insert({
        course_name: 'Coal Creek',
        round_date: round.date || todayIsoDate(),
        tournament_id: null,
        created_by_user_id: userId,
        scoring_user_id: userId,
        round_mode: BACKEND_REGULAR_GROUP_ROUND_MODE,
        player_count: group.participants.length,
        status: 'draft',
      })
      .select('id')
      .single();

    if (roundRes.error) throw roundRes.error;

    nextRound = {
      ...nextRound,
      backendRoundId: roundRes.data.id,
    };

    const roundParticipantRows = group.participants.map((participant, index) => ({
      round_id: roundRes.data.id,
      user_id: participant.type === 'app_user' ? (participant.id === 'me' ? userId : participant.id) : null,
      guest_profile_id: participant.type === 'guest' && !participant.id.startsWith('guest-') ? participant.id : null,
      guest_first_name: participant.type === 'guest' ? participant.firstName : null,
      guest_last_name: participant.type === 'guest' ? participant.lastName : null,
      participant_order: index + 1,
      is_scorer: participant.isScorekeeper === true,
    }));

    const roundParticipantsRes = await supabase
      .from('round_participants')
      .insert(roundParticipantRows);

    if (roundParticipantsRes.error) throw roundParticipantsRes.error;

    const roundPlayersRes = await supabase
      .from('round_players')
      .upsert({
        round_id: roundRes.data.id,
        user_id: userId,
        player_order: 1,
        gross_total: 0,
        is_scorer: group.participants[0]?.isScorekeeper === true,
      }, {
        onConflict: 'round_id,user_id',
      });

    if (roundPlayersRes.error) throw roundPlayersRes.error;
  }

  if (!nextRound.backendRoundGameId) {
    const gameRes = await supabase
      .from('round_games')
      .insert({
        round_id: nextRound.backendRoundId,
        game_type: 'bingo_bango_bongo',
        status: 'active',
        created_by_user_id: userId,
        name: `${group.groupName} BBB`,
        buy_in_cents: round.roundGameBuyInCents ?? 0,
        config_json: {
          participant_count: group.participants.length,
          group_name: group.groupName,
          source: 'expo_bbb_round',
        },
      })
      .select('id')
      .single();

    if (gameRes.error) throw gameRes.error;

    const participantRows = group.participants.map((participant, index) => ({
      round_game_id: gameRes.data.id,
      participant_id: participant.id,
      user_id: participant.type === 'app_user' ? (participant.id === 'me' ? userId : participant.id) : null,
      display_name: participant.displayName,
      seat_order: index + 1,
      is_active: true,
    }));

    const participantsRes = await supabase
      .from('round_game_participants')
      .upsert(participantRows, {
        onConflict: 'round_game_id,participant_id',
      });

    if (participantsRes.error) throw participantsRes.error;

    nextRound = {
      ...nextRound,
      backendRoundGameId: gameRes.data.id,
    };
  }

  return nextRound;
}

export async function syncBbbHole(params: {
  round: LocalRoundDraft;
  holeNumber: number;
}) {
  if (!params.round.backendRoundGameId || !params.round.group) {
    throw new Error('Missing backend BBB game id.');
  }

  const hole = params.round.holes.find((entry) => entry.hole === params.holeNumber);
  if (!hole) throw new Error('BBB hole not found.');

  const holeRes = await supabase
    .from('round_game_bbb_holes')
    .upsert({
      round_game_id: params.round.backendRoundGameId,
      hole_number: params.holeNumber,
      bingo_winner_participant_id: hole.bingoWinnerId ?? null,
      bango_winner_participant_id: hole.bangoWinnerId ?? null,
      bongo_winner_participant_id: hole.bongoWinnerId ?? null,
    }, {
      onConflict: 'round_game_id,hole_number',
    })
    .select('id')
    .single();

  if (holeRes.error) throw holeRes.error;

  const scoreRows = ensureGroupScoresForHole(hole, params.round.group.participants)
    .filter((entry) => typeof entry.score === 'number' && entry.score > 0)
    .map((entry) => ({
      round_game_bbb_hole_id: holeRes.data.id,
      participant_id: entry.participantId,
      score: Number(entry.score),
    }));

  if (scoreRows.length > 0) {
    const scoreRes = await supabase
      .from('round_game_bbb_hole_scores')
      .upsert(scoreRows, {
        onConflict: 'round_game_bbb_hole_id,participant_id',
      });

    if (scoreRes.error) throw scoreRes.error;
  }
}

export async function deleteBbbHoleSync(params: {
  round: LocalRoundDraft;
  holeNumber: number;
}) {
  if (!params.round.backendRoundGameId) return;

  const deleteRes = await supabase
    .from('round_game_bbb_holes')
    .delete()
    .eq('round_game_id', params.round.backendRoundGameId)
    .eq('hole_number', params.holeNumber);

  if (deleteRes.error) throw deleteRes.error;
}

export async function finalizeBbbRoundSync(params: {
  round: LocalRoundDraft;
  userId: string;
}) {
  if (!params.round.backendRoundGameId) return;

  const totals = summarizeBingoBangoBongo(params.round);

  const gameRes = await supabase
    .from('round_games')
    .update({
      status: 'completed',
      config_json: {
        ...(params.round.group ? { group_name: params.round.group.groupName } : {}),
        participant_count: params.round.group?.participants.length ?? 0,
        completed_holes: totals.completedHoleCount,
        total_bbb_points: totals.payout.totalBbbPoints,
        total_pot_cents: totals.payout.totalPotCents,
        synced_at: nowIso(),
      },
      updated_at: nowIso(),
    })
    .eq('id', params.round.backendRoundGameId);

  if (gameRes.error) throw gameRes.error;
}

export async function deleteBbbRoundSync(params: {
  round: LocalRoundDraft;
}) {
  if (!params.round.backendRoundId) return;

  const res = await supabase
    .from('rounds')
    .delete()
    .eq('id', params.round.backendRoundId);

  if (res.error) throw res.error;
}

export async function getBbbLiveStandings(roundId: string) {
  const res = await supabase
    .from('v_round_game_bbb_live_standings')
    .select(`
      round_game_id,
      round_id,
      status,
      buy_in_cents,
      participant_id,
      user_id,
      display_name,
      seat_order,
      bingo_count,
      bango_count,
      bongo_count,
      total_bbb_points,
      stroke_total,
      standing_rank
    `)
    .eq('round_id', roundId)
    .order('standing_rank', { ascending: true });

  if (res.error) throw res.error;
  return (res.data ?? []).map(normalizeStandingRow);
}

export async function getBbbHistorySummary(roundId: string): Promise<BbbHistorySummary | null> {
  const [standingsRes, historyRes] = await Promise.all([
    supabase
      .from('v_round_game_bbb_live_standings')
      .select(`
        round_game_id,
        round_id,
        status,
        buy_in_cents,
        participant_id,
        user_id,
        display_name,
        seat_order,
        bingo_count,
        bango_count,
        bongo_count,
        total_bbb_points,
        stroke_total,
        standing_rank
      `)
      .eq('round_id', roundId)
      .order('standing_rank', { ascending: true }),
    supabase
      .from('v_round_game_bbb_hole_history')
      .select(`
        round_id,
        round_game_id,
        buy_in_cents,
        round_game_bbb_hole_id,
        hole_number,
        bingo_winner_participant_id,
        bango_winner_participant_id,
        bongo_winner_participant_id,
        bingo_winner_display_name,
        bango_winner_display_name,
        bongo_winner_display_name,
        participant_id,
        user_id,
        participant_display_name,
        seat_order,
        score
      `)
      .eq('round_id', roundId)
      .order('hole_number', { ascending: true })
      .order('seat_order', { ascending: true }),
  ]);

  if (standingsRes.error) throw standingsRes.error;
  if (historyRes.error) throw historyRes.error;

  const standings = (standingsRes.data ?? []).map(normalizeStandingRow);
  const holeRows = (historyRes.data ?? []) as BbbHoleHistoryRow[];

  if (standings.length === 0 && holeRows.length === 0) return null;

  const holesByNumber = new Map<number, BbbHistoryHoleSummary>();
  for (const row of holeRows) {
    const existing = holesByNumber.get(row.hole_number) ?? {
      round_game_bbb_hole_id: row.round_game_bbb_hole_id,
      hole_number: row.hole_number,
      bingo_winner_participant_id: row.bingo_winner_participant_id ?? null,
      bingo_winner_display_name: row.bingo_winner_display_name ?? null,
      bango_winner_participant_id: row.bango_winner_participant_id ?? null,
      bango_winner_display_name: row.bango_winner_display_name ?? null,
      bongo_winner_participant_id: row.bongo_winner_participant_id ?? null,
      bongo_winner_display_name: row.bongo_winner_display_name ?? null,
      scores: [],
    };

    if (row.participant_id) {
      existing.scores.push({
        participant_id: row.participant_id,
        user_id: row.user_id ?? null,
        display_name: row.participant_display_name ?? 'Player',
        seat_order: row.seat_order ?? null,
        score: row.score ?? null,
      });
    }

    holesByNumber.set(row.hole_number, existing);
  }

  return {
    round_id: roundId,
    round_game_id: standings[0]?.round_game_id ?? holeRows[0]?.round_game_id ?? '',
    buy_in_cents: standings[0]?.buy_in_cents ?? holeRows[0]?.buy_in_cents ?? null,
    standings,
    holes: Array.from(holesByNumber.values()).sort((a, b) => a.hole_number - b.hole_number),
  };
}

