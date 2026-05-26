import { supabase } from '@/lib/supabase';
import { ensureGroupScoresForHole } from '@/lib/bingoBangoBongo';
import { BACKEND_REGULAR_GROUP_ROUND_MODE } from '@/lib/regularRoundBackendMode';
import { resolveSkinsHole } from '@/lib/skins';
import type { LocalRoundDraft } from '@/types/round';

function nowIso() {
  return new Date().toISOString();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export type SkinsLiveStandingRow = {
  round_game_id: string;
  round_id: string;
  status: string;
  buy_in_cents?: number | null;
  participant_id: string;
  user_id?: string | null;
  display_name: string;
  seat_order?: number | null;
  skins_won: number;
  total_skin_count_won: number;
  gross_total: number;
  active_player_count: number;
  total_pot_cents: number;
  total_awarded_skin_count: number;
  unresolved_final_carryover_skin_count: number;
  skins_putt_off_winner_participant_id?: string | null;
  skins_putt_off_winner_display_name?: string | null;
  skins_putt_off_awarded_skin_count?: number | null;
  skins_putt_off_resolved_at?: string | null;
  per_skin_value_cents?: number | null;
  player_winnings_cents?: number | null;
  standing_rank: number;
};

export type SkinsHoleHistoryRow = {
  round_id: string;
  round_game_id: string;
  round_game_skins_hole_id: string;
  hole_number: number;
  winner_participant_id?: string | null;
  winner_display_name?: string | null;
  winning_score?: number | null;
  is_push?: boolean | null;
  carryover_skin_count?: number | null;
  awarded_skin_count?: number | null;
  participant_id?: string | null;
  user_id?: string | null;
  participant_display_name?: string | null;
  seat_order?: number | null;
  score?: number | null;
};

export type SkinsHistoryHoleSummary = {
  round_game_skins_hole_id: string;
  hole_number: number;
  winner_participant_id?: string | null;
  winner_display_name?: string | null;
  winning_score?: number | null;
  is_push: boolean;
  carryover_skin_count: number;
  awarded_skin_count: number;
  scores: Array<{
    participant_id: string;
    user_id?: string | null;
    display_name: string;
    seat_order?: number | null;
    score: number | null;
  }>;
};

export type SkinsHistorySummary = {
  round_id: string;
  round_game_id: string;
  buy_in_cents?: number | null;
  active_player_count: number;
  total_pot_cents: number;
  total_awarded_skin_count: number;
  unresolved_final_carryover_skin_count: number;
  skins_putt_off_winner_participant_id?: string | null;
  skins_putt_off_winner_display_name?: string | null;
  skins_putt_off_awarded_skin_count?: number | null;
  skins_putt_off_resolved_at?: string | null;
  per_skin_value_cents?: number | null;
  standings: SkinsLiveStandingRow[];
  holes: SkinsHistoryHoleSummary[];
};

function normalizeStandingRow(row: any): SkinsLiveStandingRow {
  return {
    round_game_id: row.round_game_id,
    round_id: row.round_id,
    status: row.status ?? 'active',
    buy_in_cents:
      row.buy_in_cents === null || row.buy_in_cents === undefined
        ? null
        : Number(row.buy_in_cents),
    participant_id: row.participant_id,
    user_id: row.user_id ?? null,
    display_name: row.display_name ?? 'Player',
    seat_order: row.seat_order ?? null,
    skins_won: Number(row.skins_won ?? 0),
    total_skin_count_won: Number(row.total_skin_count_won ?? 0),
    gross_total: Number(row.gross_total ?? 0),
    active_player_count: Number(row.active_player_count ?? 0),
    total_pot_cents: Number(row.total_pot_cents ?? 0),
    total_awarded_skin_count: Number(row.total_awarded_skin_count ?? 0),
    unresolved_final_carryover_skin_count: Number(row.unresolved_final_carryover_skin_count ?? 0),
    skins_putt_off_winner_participant_id: row.skins_putt_off_winner_participant_id ?? null,
    skins_putt_off_winner_display_name: row.skins_putt_off_winner_display_name ?? null,
    skins_putt_off_awarded_skin_count:
      row.skins_putt_off_awarded_skin_count === null || row.skins_putt_off_awarded_skin_count === undefined
        ? null
        : Number(row.skins_putt_off_awarded_skin_count),
    skins_putt_off_resolved_at: row.skins_putt_off_resolved_at ?? null,
    per_skin_value_cents:
      row.per_skin_value_cents === null || row.per_skin_value_cents === undefined
        ? null
        : Number(row.per_skin_value_cents),
    player_winnings_cents:
      row.player_winnings_cents === null || row.player_winnings_cents === undefined
        ? null
        : Number(row.player_winnings_cents),
    standing_rank: Number(row.standing_rank ?? 0),
  };
}

export async function ensureSkinsBackendRound(params: {
  round: LocalRoundDraft;
  userId: string;
}) {
  const { round, userId } = params;
  if (round.roundMode !== 'casual_group' || round.groupGameMode !== 'skins' || !round.group) {
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

    const roundParticipantsRes = await supabase.from('round_participants').insert(roundParticipantRows);
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
        game_type: 'skins',
        status: 'active',
        created_by_user_id: userId,
        name: `${group.groupName} Skins`,
        buy_in_cents: round.roundGameBuyInCents ?? 0,
        config_json: {
          participant_count: group.participants.length,
          group_name: group.groupName,
          scoring_mode: 'gross',
          source: 'expo_skins_round',
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

export async function syncSkinsHole(params: {
  round: LocalRoundDraft;
  holeNumber: number;
}) {
  if (!params.round.backendRoundGameId || !params.round.group) {
    throw new Error('Missing backend Skins game id.');
  }

  const hole = params.round.holes.find((entry) => entry.hole === params.holeNumber);
  if (!hole) throw new Error('Skins hole not found.');

  const scores = ensureGroupScoresForHole(hole, params.round.group.participants)
    .filter((entry) => typeof entry.score === 'number' && entry.score > 0);

  if (scores.length !== params.round.group.participants.length) {
    throw new Error('Every Skins participant needs a gross score before sync.');
  }

  const resolved = resolveSkinsHole(scores, hole.skinsCarryoverCount ?? 1);
  if (!resolved) {
    throw new Error('Skins hole could not be resolved.');
  }

  const holeRes = await supabase
    .from('round_game_skins_holes')
    .upsert({
      round_game_id: params.round.backendRoundGameId,
      hole_number: params.holeNumber,
      winner_participant_id: hole.skinsWinnerId ?? resolved.winnerParticipantId,
      winning_score: hole.skinsWinningScore ?? resolved.winningScore,
      is_push: hole.skinsIsPush ?? resolved.isPush,
      carryover_skin_count: hole.skinsCarryoverCount ?? resolved.carryoverSkinCount,
      awarded_skin_count: hole.skinsAwardedCount ?? resolved.awardedSkinCount,
    }, {
      onConflict: 'round_game_id,hole_number',
    })
    .select('id')
    .single();

  if (holeRes.error) throw holeRes.error;

  const scoreRows = scores.map((entry) => ({
    round_game_skins_hole_id: holeRes.data.id,
    participant_id: entry.participantId,
    score: Number(entry.score),
  }));

  if (__DEV__) {
    console.debug('[Skins sync] hole payload', {
      round_game_id: params.round.backendRoundGameId,
      hole_number: params.holeNumber,
      winner_participant_id: hole.skinsWinnerId ?? resolved.winnerParticipantId,
      winning_score: hole.skinsWinningScore ?? resolved.winningScore,
      is_push: hole.skinsIsPush ?? resolved.isPush,
      carryover_skin_count: hole.skinsCarryoverCount ?? resolved.carryoverSkinCount,
      awarded_skin_count: hole.skinsAwardedCount ?? resolved.awardedSkinCount,
    });
    console.debug('[Skins sync] score payload', scoreRows);
  }

  const scoreRes = await supabase
    .from('round_game_skins_hole_scores')
    .upsert(scoreRows, {
      onConflict: 'round_game_skins_hole_id,participant_id',
    });

  if (scoreRes.error) throw scoreRes.error;
}

export async function deleteSkinsHoleSync(params: {
  round: LocalRoundDraft;
  holeNumber: number;
}) {
  if (!params.round.backendRoundGameId) return;

  const deleteRes = await supabase
    .from('round_game_skins_holes')
    .delete()
    .eq('round_game_id', params.round.backendRoundGameId)
    .eq('hole_number', params.holeNumber);

  if (deleteRes.error) throw deleteRes.error;
}

export async function finalizeSkinsRoundSync(params: {
  round: LocalRoundDraft;
  userId: string;
}) {
  if (!params.round.backendRoundGameId) return;

  const gameRes = await supabase
    .from('round_games')
    .update({
      status: 'completed',
      config_json: {
        ...(params.round.group ? { group_name: params.round.group.groupName } : {}),
        participant_count: params.round.group?.participants.length ?? 0,
        synced_at: nowIso(),
      },
      updated_at: nowIso(),
    })
    .eq('id', params.round.backendRoundGameId);

  if (gameRes.error) throw gameRes.error;
}

export async function resolveSkinsPuttOff(params: {
  round: LocalRoundDraft;
  winnerParticipantId: string;
  awardedSkinCount: number;
}) {
  if (!params.round.backendRoundGameId) {
    throw new Error('Missing backend Skins game id.');
  }

  if (!params.round.group?.participants.some((participant) => participant.id === params.winnerParticipantId)) {
    throw new Error('Selected putt-off winner is not in this Skins round.');
  }

  if (!Number.isFinite(params.awardedSkinCount) || params.awardedSkinCount <= 0) {
    throw new Error('Putt-off skin count must be greater than zero.');
  }

  const res = await supabase
    .from('round_games')
    .update({
      skins_putt_off_winner_participant_id: params.winnerParticipantId,
      skins_putt_off_awarded_skin_count: Number(params.awardedSkinCount),
      skins_putt_off_resolved_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq('id', params.round.backendRoundGameId);

  if (res.error) throw res.error;
}

export async function deleteSkinsRoundSync(params: {
  round: LocalRoundDraft;
}) {
  if (!params.round.backendRoundId) return;

  const res = await supabase
    .from('rounds')
    .delete()
    .eq('id', params.round.backendRoundId);

  if (res.error) throw res.error;
}

export async function getSkinsLiveStandings(roundGameId: string) {
  const res = await supabase
    .from('v_round_game_skins_live_standings')
    .select(`
      round_game_id,
      round_id,
      status,
      buy_in_cents,
      participant_id,
      user_id,
      display_name,
      seat_order,
      skins_won,
      total_skin_count_won,
      gross_total,
      active_player_count,
      total_pot_cents,
      total_awarded_skin_count,
      unresolved_final_carryover_skin_count,
      skins_putt_off_winner_participant_id,
      skins_putt_off_winner_display_name,
      skins_putt_off_awarded_skin_count,
      skins_putt_off_resolved_at,
      per_skin_value_cents,
      player_winnings_cents,
      standing_rank
    `)
    .eq('round_game_id', roundGameId)
    .order('standing_rank', { ascending: true });

  if (res.error) throw res.error;
  return (res.data ?? []).map(normalizeStandingRow);
}

export async function getSkinsHistorySummary(roundGameId: string): Promise<SkinsHistorySummary | null> {
  const [standingsRes, historyRes] = await Promise.all([
    supabase
      .from('v_round_game_skins_live_standings')
      .select(`
        round_game_id,
        round_id,
        status,
        buy_in_cents,
        participant_id,
        user_id,
        display_name,
        seat_order,
        skins_won,
        total_skin_count_won,
        gross_total,
        active_player_count,
        total_pot_cents,
        total_awarded_skin_count,
        unresolved_final_carryover_skin_count,
        skins_putt_off_winner_participant_id,
        skins_putt_off_winner_display_name,
        skins_putt_off_awarded_skin_count,
        skins_putt_off_resolved_at,
        per_skin_value_cents,
        player_winnings_cents,
        standing_rank
      `)
      .eq('round_game_id', roundGameId)
      .order('standing_rank', { ascending: true }),
    supabase
      .from('v_round_game_skins_hole_history')
      .select(`
        round_id,
        round_game_id,
        round_game_skins_hole_id,
        hole_number,
        winner_participant_id,
        winner_display_name,
        winning_score,
        is_push,
        carryover_skin_count,
        awarded_skin_count,
        participant_id,
        user_id,
        participant_display_name,
        seat_order,
        score
      `)
      .eq('round_game_id', roundGameId)
      .order('hole_number', { ascending: true })
      .order('seat_order', { ascending: true }),
  ]);

  if (standingsRes.error) throw standingsRes.error;
  if (historyRes.error) throw historyRes.error;

  const standings = (standingsRes.data ?? []).map(normalizeStandingRow);
  const holeRows = (historyRes.data ?? []) as SkinsHoleHistoryRow[];
  if (standings.length === 0 && holeRows.length === 0) return null;

  const holesByNumber = new Map<number, SkinsHistoryHoleSummary>();
  for (const row of holeRows) {
    const existing = holesByNumber.get(row.hole_number) ?? {
      round_game_skins_hole_id: row.round_game_skins_hole_id,
      hole_number: row.hole_number,
      winner_participant_id: row.winner_participant_id ?? null,
      winner_display_name: row.winner_display_name ?? null,
      winning_score: row.winning_score ?? null,
      is_push: row.is_push === true,
      carryover_skin_count: Number(row.carryover_skin_count ?? 1),
      awarded_skin_count: Number(row.awarded_skin_count ?? 0),
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
    round_id: standings[0]?.round_id ?? holeRows[0]?.round_id ?? '',
    round_game_id: roundGameId,
    buy_in_cents: standings[0]?.buy_in_cents ?? null,
    active_player_count: Number(standings[0]?.active_player_count ?? 0),
    total_pot_cents: Number(standings[0]?.total_pot_cents ?? 0),
    total_awarded_skin_count: Number(standings[0]?.total_awarded_skin_count ?? 0),
    unresolved_final_carryover_skin_count: Number(standings[0]?.unresolved_final_carryover_skin_count ?? 0),
    skins_putt_off_winner_participant_id: standings[0]?.skins_putt_off_winner_participant_id ?? null,
    skins_putt_off_winner_display_name: standings[0]?.skins_putt_off_winner_display_name ?? null,
    skins_putt_off_awarded_skin_count:
      standings[0]?.skins_putt_off_awarded_skin_count === null || standings[0]?.skins_putt_off_awarded_skin_count === undefined
        ? null
        : Number(standings[0]?.skins_putt_off_awarded_skin_count),
    skins_putt_off_resolved_at: standings[0]?.skins_putt_off_resolved_at ?? null,
    per_skin_value_cents:
      standings[0]?.per_skin_value_cents === null || standings[0]?.per_skin_value_cents === undefined
        ? null
        : Number(standings[0]?.per_skin_value_cents),
    standings,
    holes: Array.from(holesByNumber.values()).sort((a, b) => a.hole_number - b.hole_number),
  };
}
