import { ensureGroupScoresForHole } from '@/lib/bingoBangoBongo';
import { BACKEND_REGULAR_GROUP_ROUND_MODE } from '@/lib/regularRoundBackendMode';
import { supabase } from '@/lib/supabase';
import {
  calculateWolfHoleResult,
  getHuntersForHole,
  type WolfScoringMode,
  type WolfHoleDecision,
} from '@/lib/wolf';
import type { LocalRoundDraft } from '@/types/round';

function nowIso() {
  return new Date().toISOString();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function scoreComplete(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getWolfParticipantIds(round: LocalRoundDraft) {
  const configuredIds = Array.from(new Set((round.wolfParticipantIds ?? []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
  if (configuredIds.length === 4) return configuredIds;
  return (round.group?.participants ?? []).map((participant) => participant.id).slice(0, 4);
}

function getWolfOrderParticipantIds(round: LocalRoundDraft) {
  const participantIds = getWolfParticipantIds(round);
  const configuredOrder = Array.isArray(round.wolfOrderParticipantIds)
    ? round.wolfOrderParticipantIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const seen = new Set<string>();
  const nextOrder: string[] = [];

  configuredOrder.forEach((participantId) => {
    if (!participantIds.includes(participantId) || seen.has(participantId)) return;
    seen.add(participantId);
    nextOrder.push(participantId);
  });

  participantIds.forEach((participantId) => {
    if (seen.has(participantId)) return;
    seen.add(participantId);
    nextOrder.push(participantId);
  });

  return nextOrder;
}

function getWolfScoringMode(round: LocalRoundDraft): WolfScoringMode {
  return round.wolfScoringMode ?? 'net';
}

function getWolfHoleDecision(round: LocalRoundDraft, holeNumber: number): WolfHoleDecision | null {
  const hole = round.holes.find((entry) => entry.hole === holeNumber);
  const draftDecision = round.wolfHoleDecisions?.[holeNumber];
  const wolfParticipantId = draftDecision?.wolfParticipantId ?? null;
  const partnerParticipantId = draftDecision?.partnerParticipantId ?? hole?.wolfPartnerParticipantId ?? null;
  const isLoneWolf = draftDecision?.isLoneWolf ?? (hole?.wolfIsLoneWolf === true);
  const isBlindWolf = draftDecision?.isBlindWolf ?? (hole?.wolfIsBlindWolf === true);

  if (!wolfParticipantId) return null;
  if (!isLoneWolf && !partnerParticipantId) return null;

  return {
    holeNumber,
    wolfParticipantId,
    partnerParticipantId,
    isLoneWolf,
    isBlindWolf,
  };
}

function buildWolfScoreMap(round: LocalRoundDraft, holeNumber: number, participantIds: string[]) {
  const hole = round.holes.find((entry) => entry.hole === holeNumber);
  if (!hole) return null;

  const groupParticipants = round.group?.participants?.filter((participant) => participantIds.includes(participant.id)) ?? [];
  const groupScores = ensureGroupScoresForHole(hole, groupParticipants);
  const scoresByParticipantId = Object.fromEntries(
    participantIds.map((participantId) => {
      const score = groupScores.find((entry) => entry.participantId === participantId)?.score ?? null;
      return [participantId, score];
    }),
  ) as Record<string, number | null | undefined>;

  return scoresByParticipantId;
}

function normalizePointsJson(pointsJson: any, participantIds: string[]) {
  return Object.fromEntries(participantIds.map((participantId) => [
    participantId,
    Number(pointsJson?.[participantId] ?? 0),
  ])) as Record<string, number>;
}

type WolfParticipantRow = {
  participant_id: string;
  user_id: string | null;
  display_name: string;
  seat_order: number | null;
  is_active: boolean | null;
};

type WolfHoleRow = {
  hole_number: number;
  wolf_participant_id: string;
  partner_participant_id: string | null;
  is_lone_wolf: boolean;
  is_blind_wolf: boolean;
  wolf_side_score: number | null;
  hunters_side_score: number | null;
  winning_side: 'wolf_side' | 'hunters' | 'tie' | null;
  points_json: Record<string, number> | null;
};

type WolfScoreRow = {
  hole_number: number;
  participant_id: string;
  score: number | null;
};

export type WolfHistoryHoleScore = {
  participant_id: string;
  display_name: string;
  user_id: string | null;
  seat_order: number | null;
  score: number | null;
};

export type WolfHistoryHoleSummary = {
  hole_number: number;
  wolf_participant_id: string;
  wolf_display_name: string | null;
  partner_participant_id: string | null;
  partner_display_name: string | null;
  hunters_participant_ids: string[];
  hunters_display_names: string[];
  is_lone_wolf: boolean;
  is_blind_wolf: boolean;
  wolf_side_score: number | null;
  hunters_side_score: number | null;
  winning_side: 'wolf_side' | 'hunters' | 'tie' | null;
  points_by_participant_id: Record<string, number>;
  scores: WolfHistoryHoleScore[];
};

export type WolfStandingRow = {
  participant_id: string;
  display_name: string;
  user_id: string | null;
  seat_order: number | null;
  total_points: number;
  gross_total: number | null;
  holes_complete: number;
  holes_won: number;
  holes_lost: number;
  tied_holes: number;
  lone_wolf_wins: number;
  lone_wolf_losses: number;
  blind_wolf_wins: number;
  blind_wolf_losses: number;
  standing_rank: number;
};

export type WolfGameSummary = {
  round_id: string;
  round_game_id: string;
  status: string | null;
  buy_in_cents: number;
  active_player_count: number;
  total_pot_cents: number;
  config_participant_ids: string[];
  wolf_order_participant_ids: string[];
  scoring_mode: WolfScoringMode;
  standings: WolfStandingRow[];
  holes: WolfHistoryHoleSummary[];
};

export async function ensureWolfBackendRound(params: {
  round: LocalRoundDraft;
  userId: string;
}) {
  const { round, userId } = params;
  if (round.roundMode !== 'casual_group' || round.groupGameMode !== 'wolf' || !round.group) {
    return round;
  }

  const group = round.group;
  const wolfParticipantIds = getWolfParticipantIds(round);
  const wolfOrderParticipantIds = getWolfOrderParticipantIds(round);
  const wolfScoringMode = getWolfScoringMode(round);
  if (wolfParticipantIds.length !== 4 || wolfOrderParticipantIds.length !== 4) {
    throw new Error('Wolf v1 requires exactly four participants.');
  }

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
        game_type: 'wolf',
        status: 'active',
        created_by_user_id: userId,
        name: `${group.groupName} Wolf`,
        buy_in_cents: round.roundGameBuyInCents ?? 0,
        config_json: {
          participant_count: wolfParticipantIds.length,
          participant_ids: wolfParticipantIds,
          wolf_order_participant_ids: wolfOrderParticipantIds,
          scoring_mode: wolfScoringMode,
          group_name: group.groupName,
          format: 'standard_wolf_v1',
          points: {
            partner_win: 1,
            lone_win: 3,
            blind_win: 6,
          },
          source: 'expo_wolf_round',
        },
      })
      .select('id')
      .single();

    if (gameRes.error) throw gameRes.error;

    const participantRows = group.participants
      .filter((participant) => wolfParticipantIds.includes(participant.id))
      .map((participant) => ({
        round_game_id: gameRes.data.id,
        participant_id: participant.id,
        user_id: participant.type === 'app_user' ? (participant.id === 'me' ? userId : participant.id) : null,
        display_name: participant.displayName,
        seat_order: wolfOrderParticipantIds.indexOf(participant.id) + 1,
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

export async function syncWolfHole(params: {
  round: LocalRoundDraft;
  holeNumber: number;
}) {
  if (!params.round.backendRoundGameId || !params.round.group) {
    throw new Error('Missing backend Wolf game id.');
  }

  const participantIds = getWolfParticipantIds(params.round);
  const scoringMode = getWolfScoringMode(params.round);
  if (participantIds.length !== 4) {
    throw new Error('Wolf v1 requires exactly four participants.');
  }

  const hole = params.round.holes.find((entry) => entry.hole === params.holeNumber);
  if (!hole) throw new Error('Wolf hole not found.');

  const decision = getWolfHoleDecision(params.round, params.holeNumber);
  if (!decision) {
    throw new Error('Wolf decision is required before sync.');
  }

  const scoresByParticipantId = buildWolfScoreMap(params.round, params.holeNumber, participantIds);
  if (!scoresByParticipantId) {
    throw new Error('Wolf scores are unavailable for sync.');
  }

  const allScoresReady = participantIds.every((participantId) => scoreComplete(scoresByParticipantId[participantId]));
  if (!allScoresReady) {
    throw new Error('Every Wolf participant needs a real score before sync.');
  }

  const result = calculateWolfHoleResult({
    participantIds,
    decision,
    holeScores: {
      holeNumber: params.holeNumber,
      scoresByParticipantId,
    },
    scoringMode,
  });

  if (!result) {
    throw new Error('Wolf hole could not be resolved.');
  }

  const holeRes = await supabase
    .from('round_game_wolf_holes')
    .upsert({
      round_game_id: params.round.backendRoundGameId,
      hole_number: params.holeNumber,
      wolf_participant_id: result.wolfParticipantId,
      partner_participant_id: result.partnerParticipantId,
      is_lone_wolf: result.isLoneWolf,
      is_blind_wolf: result.isBlindWolf,
      wolf_side_score: result.wolfSideScore,
      hunters_side_score: result.huntersSideScore,
      winning_side: result.winningSide,
      points_json: result.pointsByParticipantId,
      updated_at: nowIso(),
    }, {
      onConflict: 'round_game_id,hole_number',
    });

  if (holeRes.error) throw holeRes.error;

  const scoreRows = participantIds.map((participantId) => ({
    round_game_id: params.round.backendRoundGameId,
    hole_number: params.holeNumber,
    participant_id: participantId,
    score: Number(scoresByParticipantId[participantId]),
    updated_at: nowIso(),
  }));

  const scoreRes = await supabase
    .from('round_game_wolf_hole_scores')
    .upsert(scoreRows, {
      onConflict: 'round_game_id,hole_number,participant_id',
    });

  if (scoreRes.error) throw scoreRes.error;
}

export async function finalizeWolfRoundSync(params: {
  round: LocalRoundDraft;
  userId: string;
}) {
  if (!params.round.backendRoundGameId) return;

  const participantIds = getWolfParticipantIds(params.round);
  const wolfOrderParticipantIds = getWolfOrderParticipantIds(params.round);
  const wolfScoringMode = getWolfScoringMode(params.round);

  const gameRes = await supabase
    .from('round_games')
    .update({
      status: 'completed',
      config_json: {
        ...(params.round.group ? { group_name: params.round.group.groupName } : {}),
        participant_count: participantIds.length,
        participant_ids: participantIds,
        wolf_order_participant_ids: wolfOrderParticipantIds,
        scoring_mode: wolfScoringMode,
        format: 'standard_wolf_v1',
        points: {
          partner_win: 1,
          lone_win: 3,
          blind_win: 6,
        },
        synced_at: nowIso(),
      },
      updated_at: nowIso(),
    })
    .eq('id', params.round.backendRoundGameId);

  if (gameRes.error) throw gameRes.error;
}

export async function getWolfHistorySummary(roundGameId: string): Promise<WolfGameSummary | null> {
  const [gameRes, participantsRes, holeRes, scoreRes] = await Promise.all([
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
      .from('round_game_wolf_holes')
      .select('hole_number, wolf_participant_id, partner_participant_id, is_lone_wolf, is_blind_wolf, wolf_side_score, hunters_side_score, winning_side, points_json')
      .eq('round_game_id', roundGameId)
      .order('hole_number', { ascending: true }),
    supabase
      .from('round_game_wolf_hole_scores')
      .select('hole_number, participant_id, score')
      .eq('round_game_id', roundGameId)
      .order('hole_number', { ascending: true }),
  ]);

  if (gameRes.error) throw gameRes.error;
  if (participantsRes.error) throw participantsRes.error;
  if (holeRes.error) throw holeRes.error;
  if (scoreRes.error) throw scoreRes.error;

  const game = gameRes.data;
  const participantRows = ((participantsRes.data ?? []) as WolfParticipantRow[])
    .filter((row) => row.is_active !== false);
  const holeRows = (holeRes.data ?? []) as WolfHoleRow[];
  const scoreRows = (scoreRes.data ?? []) as WolfScoreRow[];

  if (!game && participantRows.length === 0 && holeRows.length === 0 && scoreRows.length === 0) {
    return null;
  }

  const configParticipantIds = Array.isArray((game as any)?.config_json?.participant_ids)
    ? ((game as any).config_json.participant_ids as unknown[]).filter((value): value is string => typeof value === 'string')
    : participantRows.map((row) => row.participant_id);
  const wolfOrderParticipantIds = Array.isArray((game as any)?.config_json?.wolf_order_participant_ids)
    ? ((game as any).config_json.wolf_order_participant_ids as unknown[]).filter((value): value is string => typeof value === 'string')
    : configParticipantIds;
  const scoringMode = (game as any)?.config_json?.scoring_mode === 'winner_only' ? 'winner_only' : 'net';
  const participants = participantRows
    .filter((participant) => configParticipantIds.length === 0 || configParticipantIds.includes(participant.participant_id))
    .sort((a, b) => Number(a.seat_order ?? 999) - Number(b.seat_order ?? 999) || a.display_name.localeCompare(b.display_name));
  const participantsById = new Map(participants.map((participant) => [participant.participant_id, participant]));

  const standingsById = new Map<string, WolfStandingRow>();
  participants.forEach((participant) => {
    standingsById.set(participant.participant_id, {
      participant_id: participant.participant_id,
      display_name: participant.display_name,
      user_id: participant.user_id ?? null,
      seat_order: participant.seat_order ?? null,
      total_points: 0,
      gross_total: 0,
      holes_complete: 0,
      holes_won: 0,
      holes_lost: 0,
      tied_holes: 0,
      lone_wolf_wins: 0,
      lone_wolf_losses: 0,
      blind_wolf_wins: 0,
      blind_wolf_losses: 0,
      standing_rank: 0,
    });
  });

  scoreRows.forEach((row) => {
    const standing = standingsById.get(row.participant_id);
    if (!standing || !scoreComplete(row.score)) return;
    standing.gross_total = Number(standing.gross_total ?? 0) + Number(row.score);
    standing.holes_complete += 1;
  });

  const scoreRowsByHole = new Map<number, WolfHistoryHoleScore[]>();
  scoreRows.forEach((row) => {
    const participant = participantsById.get(row.participant_id);
    const existing = scoreRowsByHole.get(row.hole_number) ?? [];
    existing.push({
      participant_id: row.participant_id,
      display_name: participant?.display_name ?? 'Player',
      user_id: participant?.user_id ?? null,
      seat_order: participant?.seat_order ?? null,
      score: row.score ?? null,
    });
    scoreRowsByHole.set(row.hole_number, existing);
  });

  const holes: WolfHistoryHoleSummary[] = holeRows.map((row) => {
    const huntersParticipantIds = getHuntersForHole(
      participants.map((participant) => participant.participant_id),
      row.wolf_participant_id,
      row.partner_participant_id ?? null,
      row.is_lone_wolf === true,
    );
    const pointsByParticipantId = normalizePointsJson(row.points_json, participants.map((participant) => participant.participant_id));
    const winnerIds = row.winning_side === 'wolf_side'
      ? [row.wolf_participant_id, ...(row.is_lone_wolf ? [] : (row.partner_participant_id ? [row.partner_participant_id] : []))]
      : row.winning_side === 'hunters'
        ? huntersParticipantIds
        : [];
    const loserIds = row.winning_side === 'tie'
      ? []
      : participants
        .map((participant) => participant.participant_id)
        .filter((participantId) => !winnerIds.includes(participantId));

    participants.forEach((participant) => {
      const standing = standingsById.get(participant.participant_id);
      if (!standing) return;
      standing.total_points += pointsByParticipantId[participant.participant_id] ?? 0;
      if (row.winning_side === 'tie') {
        standing.tied_holes += 1;
      } else if (winnerIds.includes(participant.participant_id)) {
        standing.holes_won += 1;
      } else if (loserIds.includes(participant.participant_id)) {
        standing.holes_lost += 1;
      }
    });

    const wolfStanding = standingsById.get(row.wolf_participant_id);
    if (wolfStanding && row.winning_side !== 'tie' && row.is_lone_wolf) {
      if (row.is_blind_wolf) {
        if (row.winning_side === 'wolf_side') wolfStanding.blind_wolf_wins += 1;
        if (row.winning_side === 'hunters') wolfStanding.blind_wolf_losses += 1;
      } else {
        if (row.winning_side === 'wolf_side') wolfStanding.lone_wolf_wins += 1;
        if (row.winning_side === 'hunters') wolfStanding.lone_wolf_losses += 1;
      }
    }

    return {
      hole_number: row.hole_number,
      wolf_participant_id: row.wolf_participant_id,
      wolf_display_name: participantsById.get(row.wolf_participant_id)?.display_name ?? null,
      partner_participant_id: row.partner_participant_id ?? null,
      partner_display_name: row.partner_participant_id ? (participantsById.get(row.partner_participant_id)?.display_name ?? null) : null,
      hunters_participant_ids: huntersParticipantIds,
      hunters_display_names: huntersParticipantIds.map((participantId) => participantsById.get(participantId)?.display_name ?? 'Player'),
      is_lone_wolf: row.is_lone_wolf === true,
      is_blind_wolf: row.is_blind_wolf === true,
      wolf_side_score: row.wolf_side_score ?? null,
      hunters_side_score: row.hunters_side_score ?? null,
      winning_side: row.winning_side ?? null,
      points_by_participant_id: pointsByParticipantId,
      scores: (scoreRowsByHole.get(row.hole_number) ?? []).sort((a, b) => Number(a.seat_order ?? 999) - Number(b.seat_order ?? 999) || a.display_name.localeCompare(b.display_name)),
    };
  });

  const standings = Array.from(standingsById.values())
    .map((standing) => ({
      ...standing,
      gross_total: standing.holes_complete > 0 ? standing.gross_total : null,
    }))
    .sort((a, b) => (
      b.total_points - a.total_points
      || Number(a.gross_total ?? Number.MAX_SAFE_INTEGER) - Number(b.gross_total ?? Number.MAX_SAFE_INTEGER)
      || Number(a.seat_order ?? 999) - Number(b.seat_order ?? 999)
      || a.display_name.localeCompare(b.display_name)
    ))
    .map((standing, index) => ({
      ...standing,
      standing_rank: index + 1,
    }));

  return {
    round_id: game?.round_id ?? '',
    round_game_id: roundGameId,
    status: game?.status ?? null,
    buy_in_cents: Number(game?.buy_in_cents ?? 0),
    active_player_count: participants.length,
    total_pot_cents: Number(game?.buy_in_cents ?? 0) * participants.length,
    config_participant_ids: configParticipantIds,
    wolf_order_participant_ids: wolfOrderParticipantIds,
    scoring_mode: scoringMode,
    standings,
    holes,
  };
}

export async function getWolfLiveSummary(roundGameId: string) {
  return getWolfHistorySummary(roundGameId);
}
