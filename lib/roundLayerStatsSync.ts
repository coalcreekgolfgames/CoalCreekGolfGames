import { holes } from '@/constants/course';
import { finalizeHoleStats, summarizeRound } from '@/lib/roundStats';
import { supabase } from '@/lib/supabase';
import type { HoleDraft, LocalRoundDraft } from '@/types/round';

type CanonicalYardageQuestionKey =
  | 'fairway_hit'
  | 'green_in_regulation'
  | 'up_and_down'
  | 'penalty'
  | 'three_putt';

function nowIso() {
  return new Date().toISOString();
}

async function upsertRoundYardageStat(roundId: string, userId: string, payload: any) {
  const res = await supabase
    .from('round_yardage_stats')
    .upsert({
      round_id: roundId,
      user_id: userId,
      ...payload,
    }, {
      onConflict: 'round_id,user_id',
    });

  if (res.error) throw res.error;
}

async function upsertRoundYardageAnswer(row: {
  round_id: string;
  user_id: string;
  hole_number: number;
  question_key: CanonicalYardageQuestionKey;
  answer_boolean?: boolean | null;
  answer_number?: number | null;
}) {
  const res = await supabase
    .from('round_yardage_answers')
    .upsert(row, {
      onConflict: 'round_id,user_id,hole_number,question_key',
    });

  if (res.error) throw res.error;
}

async function refreshRegularRoundLayerSummary(params: {
  roundId: string;
  finalizedHoles: HoleDraft[];
  userId: string;
}) {
  const summary = summarizeRound(params.finalizedHoles);

  await upsertRoundYardageStat(params.roundId, params.userId, {
    fairways_hit: summary.fairwaysHit,
    greens_in_regulation: summary.greensInRegulation,
    putts: summary.totalPutts,
    penalty_strokes: summary.penalties,
    scrambling_successes: summary.upAndDowns,
    sand_saves: 0,
  });

  const markRoundRes = await supabase
    .from('rounds')
    .update({
      has_yardage_data: true,
      yardage_entered_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq('id', params.roundId);

  if (markRoundRes.error) throw markRoundRes.error;
}

export function finalizeRoundLayerHoles(round: LocalRoundDraft): HoleDraft[] {
  return round.holes.map((hole) => {
    const courseHole = holes.find((entry) => entry.hole === hole.hole);
    return courseHole ? finalizeHoleStats(hole, courseHole.par) : hole;
  });
}

export async function persistRegularRoundLayerStats(params: {
  round: LocalRoundDraft;
  userId: string;
  finalizedHoles?: HoleDraft[];
}) {
  if (!params.round.backendRoundId || params.round.statsEnabled === false) return;

  const finalizedHoles = params.finalizedHoles ?? finalizeRoundLayerHoles(params.round);
  for (const hole of finalizedHoles) {
    await persistRegularRoundLayerStatsForHole({
      round: params.round,
      userId: params.userId,
      holeNumber: hole.hole,
      finalizedHoles,
    });
  }
}

export async function persistRegularRoundLayerStatsForHole(params: {
  round: LocalRoundDraft;
  userId: string;
  holeNumber: number;
  finalizedHoles?: HoleDraft[];
}) {
  if (!params.round.backendRoundId || params.round.statsEnabled === false) return;

  const finalizedHoles = params.finalizedHoles ?? finalizeRoundLayerHoles(params.round);
  const hole = finalizedHoles.find((entry) => entry.hole === params.holeNumber);
  if (!hole) return;

  const courseHole = holes.find((entry) => entry.hole === hole.hole);
  const isPar3 = courseHole?.par === 3;
  const fairwayHit = isPar3 ? null : (hole.driveSafe ?? null);
  const penalty = hole.drivePenalty === true || hole.girMissPenalty === true;

  if (fairwayHit !== null) {
    await upsertRoundYardageAnswer({
      round_id: params.round.backendRoundId,
      user_id: params.userId,
      hole_number: hole.hole,
      question_key: 'fairway_hit',
      answer_boolean: fairwayHit,
    });
  }

  if (typeof hole.hitGreen === 'boolean') {
    await upsertRoundYardageAnswer({
      round_id: params.round.backendRoundId,
      user_id: params.userId,
      hole_number: hole.hole,
      question_key: 'green_in_regulation',
      answer_boolean: hole.hitGreen,
    });
  }

  if (typeof hole.upAndDownMade === 'boolean') {
    await upsertRoundYardageAnswer({
      round_id: params.round.backendRoundId,
      user_id: params.userId,
      hole_number: hole.hole,
      question_key: 'up_and_down',
      answer_boolean: hole.upAndDownMade,
    });
  }

  await upsertRoundYardageAnswer({
    round_id: params.round.backendRoundId,
    user_id: params.userId,
    hole_number: hole.hole,
    question_key: 'penalty',
    answer_boolean: penalty,
  });

  if (typeof hole.totalPutts === 'number') {
    await upsertRoundYardageAnswer({
      round_id: params.round.backendRoundId,
      user_id: params.userId,
      hole_number: hole.hole,
      question_key: 'three_putt',
      answer_boolean: hole.threePutt ?? hole.totalPutts >= 3,
    });
  }

  await refreshRegularRoundLayerSummary({
    roundId: params.round.backendRoundId,
    userId: params.userId,
    finalizedHoles,
  });
}
