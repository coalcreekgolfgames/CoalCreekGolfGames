import { supabase } from '@/lib/supabase';
import { ensureGroupScoresForHole } from '@/lib/bingoBangoBongo';
import {
  calculateNassauSegments,
  calculateNassauWinnings,
  determineNassauHoleResult,
  type NassauSegmentSummary,
} from '@/lib/nassau';
import { BACKEND_REGULAR_GROUP_ROUND_MODE } from '@/lib/regularRoundBackendMode';
import type { LocalRoundDraft } from '@/types/round';

function nowIso() {
  return new Date().toISOString();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getSelectedNassauParticipants(round: LocalRoundDraft) {
  const allParticipants = round.group?.participants ?? [];
  const selectedIds = Array.from(new Set((round.nassauParticipantIds ?? []).filter((value) => typeof value === 'string' && value.trim().length > 0)));
  const selectedParticipants = allParticipants.filter((participant) => selectedIds.includes(participant.id));

  if (selectedParticipants.length >= 2 && selectedParticipants.length <= 4) {
    return selectedParticipants;
  }

  if (allParticipants.length >= 2 && allParticipants.length <= 4) {
    return allParticipants;
  }

  return selectedParticipants;
}

export type NassauHistoryHoleScore = {
  participant_id: string;
  display_name: string;
  user_id: string | null;
  seat_order: number | null;
  score: number | null;
};

export type NassauHistoryHoleSummary = {
  hole_number: number;
  winner_participant_id: string | null;
  winner_display_name: string | null;
  winning_score: number | null;
  is_halved: boolean;
  scores: NassauHistoryHoleScore[];
};

export type NassauStandingRow = {
  participant_id: string;
  display_name: string;
  user_id: string | null;
  seat_order: number | null;
  holes_complete: number;
  front_total: number | null;
  back_total: number | null;
  overall_total: number | null;
  front_share: number;
  back_share: number;
  overall_share: number;
  total_shares: number;
  gross_total: number | null;
  winnings_cents: number;
};

export type NassauGameSummary = {
  round_id: string;
  round_game_id: string;
  status: string | null;
  buy_in_cents: number;
  active_player_count: number;
  total_pot_cents: number;
  segment_value_cents: number;
  config_participant_ids: string[];
  standings: NassauStandingRow[];
  holes: NassauHistoryHoleSummary[];
  segments: {
    front: NassauSegmentSummary;
    back: NassauSegmentSummary;
    overall: NassauSegmentSummary;
  };
};

type NassauGameParticipantRow = {
  participant_id: string;
  user_id: string | null;
  display_name: string;
  seat_order: number | null;
  is_active: boolean | null;
};

type NassauHoleHistoryRow = {
  round_id: string;
  round_game_id: string;
  hole_number: number;
  winner_participant_id: string | null;
  winning_score: number | null;
  is_halved: boolean | null;
  participant_id: string | null;
  display_name: string | null;
  user_id: string | null;
  seat_order: number | null;
  score: number | null;
};

export async function ensureNassauBackendRound(params: {
  round: LocalRoundDraft;
  userId: string;
}) {
  const { round, userId } = params;
  if (round.roundMode !== 'casual_group' || round.groupGameMode !== 'nassau' || !round.group) {
    return round;
  }

  const group = round.group;
  const nassauParticipants = getSelectedNassauParticipants(round);
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
        game_type: 'nassau',
        status: 'active',
        created_by_user_id: userId,
        name: `${group.groupName} Nassau`,
        buy_in_cents: round.roundGameBuyInCents ?? 0,
        config_json: {
          participant_count: nassauParticipants.length,
          participant_ids: nassauParticipants.map((participant) => participant.id),
          group_name: group.groupName,
          format: 'segment_totals',
          source: 'expo_nassau_round',
        },
      })
      .select('id')
      .single();

    if (gameRes.error) throw gameRes.error;

    const participantRows = nassauParticipants.map((participant, index) => ({
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

export async function syncNassauHole(params: {
  round: LocalRoundDraft;
  holeNumber: number;
}) {
  if (!params.round.backendRoundGameId || !params.round.group) {
    throw new Error('Missing backend Nassau game id.');
  }

  const participants = getSelectedNassauParticipants(params.round);
  if (participants.length < 2 || participants.length > 4) {
    throw new Error('Nassau v1 supports 2 to 4 participants.');
  }

  const hole = params.round.holes.find((entry) => entry.hole === params.holeNumber);
  if (!hole) throw new Error('Nassau hole not found.');

  const scores = ensureGroupScoresForHole(hole, participants)
    .filter((entry) => typeof entry.score === 'number' && entry.score > 0);

  if (scores.length !== participants.length) {
    throw new Error('Every Nassau participant needs a score before sync.');
  }

  const resolved = determineNassauHoleResult({
    participantScores: scores.map((entry) => ({
      participantId: entry.participantId,
      score: entry.score ?? null,
    })),
  });

  if (!resolved) {
    throw new Error('Nassau hole could not be resolved.');
  }

  const holeRes = await supabase
    .from('round_game_nassau_holes')
    .upsert({
      round_game_id: params.round.backendRoundGameId,
      hole_number: params.holeNumber,
      winner_participant_id: resolved.winnerParticipantId,
      winning_score: resolved.winningScore,
      is_halved: resolved.isHalved,
      updated_at: nowIso(),
    }, {
      onConflict: 'round_game_id,hole_number',
    })
    .select('id')
    .single();

  if (holeRes.error) throw holeRes.error;

  const scoreRows = scores.map((entry) => ({
    round_game_nassau_hole_id: holeRes.data.id,
    participant_id: entry.participantId,
    score: Number(entry.score),
    updated_at: nowIso(),
  }));

  const scoreRes = await supabase
    .from('round_game_nassau_hole_scores')
    .upsert(scoreRows, {
      onConflict: 'round_game_nassau_hole_id,participant_id',
    });

  if (scoreRes.error) throw scoreRes.error;
}

export async function finalizeNassauRoundSync(params: {
  round: LocalRoundDraft;
  userId: string;
}) {
  if (!params.round.backendRoundGameId) return;
  const participants = getSelectedNassauParticipants(params.round);

  const gameRes = await supabase
    .from('round_games')
    .update({
      status: 'completed',
      config_json: {
        ...(params.round.group ? { group_name: params.round.group.groupName } : {}),
        participant_count: participants.length,
        participant_ids: participants.map((participant) => participant.id),
        format: 'segment_totals',
        synced_at: nowIso(),
      },
      updated_at: nowIso(),
    })
    .eq('id', params.round.backendRoundGameId);

  if (gameRes.error) throw gameRes.error;
}

export async function deleteNassauRoundSync(params: {
  round: LocalRoundDraft;
}) {
  if (!params.round.backendRoundId) return;

  const res = await supabase
    .from('rounds')
    .delete()
    .eq('id', params.round.backendRoundId);

  if (res.error) throw res.error;
}

function buildWinnerDisplayName(
  participantId: string | null,
  participantsById: Map<string, NassauGameParticipantRow>,
) {
  if (!participantId) return null;
  return participantsById.get(participantId)?.display_name ?? null;
}

export async function getNassauHistorySummary(roundGameId: string): Promise<NassauGameSummary | null> {
  const [gameRes, participantsRes, holeHistoryRes] = await Promise.all([
    supabase
      .from('round_games')
      .select('id, round_id, status, buy_in_cents, config_json')
      .eq('id', roundGameId)
      .maybeSingle(),
    supabase
      .from('round_game_participants')
      .select('participant_id, user_id, display_name, seat_order, is_active')
      .eq('round_game_id', roundGameId)
      .order('seat_order', { ascending: true }),
    supabase
      .from('v_round_game_nassau_hole_history')
      .select(`
        round_id,
        round_game_id,
        hole_number,
        winner_participant_id,
        winning_score,
        is_halved,
        participant_id,
        display_name,
        user_id,
        seat_order,
        score
      `)
      .eq('round_game_id', roundGameId)
      .order('hole_number', { ascending: true })
      .order('seat_order', { ascending: true }),
  ]);

  if (gameRes.error) throw gameRes.error;
  if (participantsRes.error) throw participantsRes.error;
  if (holeHistoryRes.error) throw holeHistoryRes.error;

  const game = gameRes.data;
  const participantRows = ((participantsRes.data ?? []) as NassauGameParticipantRow[])
    .filter((row) => row.is_active !== false);
  const holeRows = (holeHistoryRes.data ?? []) as NassauHoleHistoryRow[];

  if (!game && participantRows.length === 0 && holeRows.length === 0) return null;

  const configParticipantIds = Array.isArray((game as any)?.config_json?.participant_ids)
    ? ((game as any).config_json.participant_ids as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];
  const fallbackParticipants = Array.from(new Map(
    holeRows
      .filter((row) => row.participant_id)
      .map((row) => [
        row.participant_id!,
        {
          participant_id: row.participant_id!,
          user_id: row.user_id ?? null,
          display_name: row.display_name ?? 'Player',
          seat_order: row.seat_order ?? null,
          is_active: true,
        } satisfies NassauGameParticipantRow,
      ]),
  ).values());

  const participantSource = participantRows.length > 0 ? participantRows : fallbackParticipants;
  const participants = participantSource
    .filter((participant) => configParticipantIds.length === 0 || configParticipantIds.includes(participant.participant_id))
    .sort((a, b) => Number(a.seat_order ?? 999) - Number(b.seat_order ?? 999) || a.display_name.localeCompare(b.display_name));
  const participantIds = participants.map((participant) => participant.participant_id);
  const participantsById = new Map(participants.map((participant) => [participant.participant_id, participant]));

  const holesByNumber = new Map<number, NassauHistoryHoleSummary>();
  for (const row of holeRows) {
    const existing = holesByNumber.get(row.hole_number) ?? {
      hole_number: row.hole_number,
      winner_participant_id: row.winner_participant_id ?? null,
      winner_display_name: buildWinnerDisplayName(row.winner_participant_id ?? null, participantsById),
      winning_score: row.winning_score ?? null,
      is_halved: row.is_halved === true,
      scores: [],
    };

    if (row.participant_id && (configParticipantIds.length === 0 || configParticipantIds.includes(row.participant_id))) {
      existing.scores.push({
        participant_id: row.participant_id,
        display_name: row.display_name ?? participantsById.get(row.participant_id)?.display_name ?? 'Player',
        user_id: row.user_id ?? null,
        seat_order: row.seat_order ?? null,
        score: row.score ?? null,
      });
    }

    holesByNumber.set(row.hole_number, existing);
  }

  const holes = Array.from(holesByNumber.values())
    .sort((a, b) => a.hole_number - b.hole_number)
    .map((hole) => ({
      ...hole,
      scores: [...hole.scores].sort((a, b) => Number(a.seat_order ?? 999) - Number(b.seat_order ?? 999) || a.display_name.localeCompare(b.display_name)),
    }));

  const segments = calculateNassauSegments({
    participantIds,
    holes: holes.map((hole) => ({
      holeNumber: hole.hole_number,
      scores: participantIds.map((participantId) => ({
        participantId,
        score: hole.scores.find((entry) => entry.participant_id === participantId)?.score ?? null,
      })),
    })),
  });

  const buyInCents = Math.max(0, Number(game?.buy_in_cents ?? 0));
  const winnings = calculateNassauWinnings({
    participantIds,
    buyInCents,
    segments,
  });

  const completedHoleNumbers = new Set(
    holes
      .filter((hole) => hole.scores.length === participantIds.length && hole.scores.every((entry) => typeof entry.score === 'number' && entry.score > 0))
      .map((hole) => hole.hole_number),
  );

  const standings: NassauStandingRow[] = participants.map((participant) => ({
    participant_id: participant.participant_id,
    display_name: participant.display_name,
    user_id: participant.user_id ?? null,
    seat_order: participant.seat_order ?? null,
    holes_complete: completedHoleNumbers.size,
    front_total: segments.front.holesComplete > 0 ? (segments.front.participantTotals[participant.participant_id] ?? 0) : null,
    back_total: segments.back.holesComplete > 0 ? (segments.back.participantTotals[participant.participant_id] ?? 0) : null,
    overall_total: segments.overall.holesComplete > 0 ? (segments.overall.participantTotals[participant.participant_id] ?? 0) : null,
    front_share: segments.front.sharesByParticipantId[participant.participant_id] ?? 0,
    back_share: segments.back.sharesByParticipantId[participant.participant_id] ?? 0,
    overall_share: segments.overall.sharesByParticipantId[participant.participant_id] ?? 0,
    total_shares:
      (segments.front.sharesByParticipantId[participant.participant_id] ?? 0)
      + (segments.back.sharesByParticipantId[participant.participant_id] ?? 0)
      + (segments.overall.sharesByParticipantId[participant.participant_id] ?? 0),
    gross_total: segments.overall.holesComplete > 0 ? (segments.overall.participantTotals[participant.participant_id] ?? 0) : null,
    winnings_cents: Math.round(winnings.winningsByParticipantId[participant.participant_id] ?? 0),
  }));

  return {
    round_id: game?.round_id ?? holeRows[0]?.round_id ?? '',
    round_game_id: roundGameId,
    status: game?.status ?? null,
    buy_in_cents: buyInCents,
    active_player_count: participants.length,
    total_pot_cents: buyInCents * participants.length,
    segment_value_cents: (buyInCents * participants.length) / 3,
    config_participant_ids: configParticipantIds,
    standings,
    holes,
    segments,
  };
}

export async function getNassauLiveSummary(roundGameId: string) {
  return getNassauHistorySummary(roundGameId);
}
