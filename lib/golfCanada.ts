import { supabase } from '@/lib/supabase';
import type { GolfCanadaPostingRecord, SavedRound } from '@/types/round';

export const GOLF_CANADA_SCORE_ENTRY_URL = 'https://scg.golfcanada.ca/';
const DEFAULT_COURSE_NAME = 'Coal Creek';

export type GolfCanadaHoleScore = {
  hole: number;
  score: number | null;
};

export type GolfCanadaBackendGameHoleScore = {
  participant_id?: string | null;
  user_id?: string | null;
  score: number | null;
};

export type GolfCanadaBackendGameHoleSummary = {
  hole_number: number;
  scores: GolfCanadaBackendGameHoleScore[];
};

export type GolfCanadaBackendParticipant = {
  participant_id: string;
  user_id?: string | null;
};

type ParticipantResolutionSource = 'round_game_summary';

type RoundGolfCanadaPostingRow = {
  round_id: string;
  user_id: string;
  posted_at: string;
  posting_method?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type GolfCanadaPostingPrep = {
  roundId: string;
  date: string;
  courseName: string;
  teeName: string | null;
  holeCount: number;
  grossTotal: number;
  frontTotal: number;
  backTotal: number;
  scores: GolfCanadaHoleScore[];
  postingState: GolfCanadaPostingRecord;
};

function buildDefaultPostingState(round: SavedRound): GolfCanadaPostingRecord {
  const existing = round.postingStates?.golfCanada ?? null;
  return {
    provider: 'golf_canada',
    method: 'manual',
    status: existing?.status ?? 'not_posted',
    postedAt: existing?.postedAt ?? null,
    playedAlone:
      typeof existing?.playedAlone === 'boolean'
        ? existing.playedAlone
        : round.roundMode === 'solo',
    playedWithOthers:
      typeof existing?.playedWithOthers === 'boolean'
        ? existing.playedWithOthers
        : round.roundMode === 'casual_group',
  };
}

function getCurrentUserGroupParticipantId(round: SavedRound, currentUserId?: string | null) {
  return round.group?.participants?.find((participant) =>
    participant.type === 'app_user'
    && (!currentUserId || participant.id === currentUserId || participant.id === round.draftOwnerUserId),
  )?.id
    ?? round.group?.participants?.find((participant) => participant.type === 'app_user')?.id
    ?? null;
}

function normalizePostingState(subject?: SavedRound | GolfCanadaPostingRecord | null) {
  if (!subject) return null;
  if ('provider' in subject) return subject;
  return buildDefaultPostingState(subject);
}

function buildPostingRecordFromRow(
  row: RoundGolfCanadaPostingRow,
  context: { playedAlone: boolean; playedWithOthers: boolean },
): GolfCanadaPostingRecord {
  return {
    provider: 'golf_canada',
    method: 'manual',
    status: 'posted_manually',
    postedAt: row.posted_at,
    playedAlone: context.playedAlone,
    playedWithOthers: context.playedWithOthers,
  };
}

function inferPlayedContext(round?: SavedRound | null) {
  return {
    playedAlone: round?.roundMode === 'solo',
    playedWithOthers: round?.roundMode === 'casual_group',
  };
}

function resolveCurrentUserParticipantId(params: {
  currentUserId: string;
  holes: GolfCanadaBackendGameHoleSummary[];
  participants?: GolfCanadaBackendParticipant[] | null;
}) {
  const { currentUserId, holes, participants } = params;
  const participantCandidates = (participants ?? [])
    .map((participant) => ({
      participantId: participant.participant_id,
      userId: participant.user_id ?? null,
    }));
  const directParticipantId = participants?.find((participant) => participant.user_id === currentUserId)?.participant_id ?? null;
  if (directParticipantId) {
    if (__DEV__) {
      console.debug('[golf-canada-participant-debug]', {
        source: 'round_game_summary' satisfies ParticipantResolutionSource,
        currentUserId,
        resolvedParticipantId: directParticipantId,
        participantCandidates,
        scoreRowCount: holes.reduce((sum, hole) => sum + hole.scores.length, 0),
        matchedScoreRowCount: holes.reduce((sum, hole) => (
          sum + hole.scores.filter((score) => score.participant_id === directParticipantId || score.user_id === currentUserId).length
        ), 0),
        completedHoleCount: holes.filter((hole) => hole.scores.some((score) => (
          (score.participant_id === directParticipantId || score.user_id === currentUserId)
          && typeof score.score === 'number'
        ))).length,
      });
    }
    return directParticipantId;
  }

  const scoreParticipantIds = new Set<string>();
  holes.forEach((hole) => {
    hole.scores.forEach((score) => {
      if (score.user_id === currentUserId && score.participant_id) {
        scoreParticipantIds.add(score.participant_id);
      }
    });
  });

  const resolvedParticipantId = scoreParticipantIds.size === 1 ? Array.from(scoreParticipantIds)[0] : null;

  if (__DEV__) {
    console.debug('[golf-canada-participant-debug]', {
      source: 'round_game_summary' satisfies ParticipantResolutionSource,
      currentUserId,
      resolvedParticipantId,
      participantCandidates,
      scoreRowCount: holes.reduce((sum, hole) => sum + hole.scores.length, 0),
      matchedScoreRowCount: holes.reduce((sum, hole) => (
        sum + hole.scores.filter((score) => score.user_id === currentUserId).length
      ), 0),
      completedHoleCount: holes.filter((hole) => hole.scores.some((score) => (
        score.user_id === currentUserId && typeof score.score === 'number'
      ))).length,
    });
  }

  return resolvedParticipantId;
}

export function resolveGolfCanadaPostingState(
  round?: SavedRound | null,
  backendPostingState?: GolfCanadaPostingRecord | null,
) {
  return backendPostingState ?? normalizePostingState(round);
}

export function isGolfCanadaPostingEligible(round: SavedRound) {
  return round.roundMode === 'solo' || round.roundMode === 'casual_group';
}

export function buildGolfCanadaPostingPrepFromScores(
  round: SavedRound,
  scores: GolfCanadaHoleScore[],
): GolfCanadaPostingPrep | null {
  if (!isGolfCanadaPostingEligible(round)) return null;

  const scoredHoles = scores.filter((entry) => typeof entry.score === 'number');
  if (scoredHoles.length === 0) return null;

  const frontTotal = scores
    .filter((entry) => entry.hole <= 9)
    .reduce((sum, entry) => sum + (entry.score ?? 0), 0);
  const backTotal = scores
    .filter((entry) => entry.hole >= 10)
    .reduce((sum, entry) => sum + (entry.score ?? 0), 0);

  return {
    roundId: round.id,
    date: round.date,
    courseName: DEFAULT_COURSE_NAME,
    teeName: round.tee ?? null,
    holeCount: scoredHoles.length,
    grossTotal: scoredHoles.reduce((sum, entry) => sum + (entry.score ?? 0), 0),
    frontTotal,
    backTotal,
    scores,
    postingState: buildDefaultPostingState(round),
  };
}

export function buildGolfCanadaPostingPrepFromRoundGameSummary(
  round: SavedRound,
  userId: string,
  holes: GolfCanadaBackendGameHoleSummary[] | null | undefined,
  participants?: GolfCanadaBackendParticipant[] | null,
): GolfCanadaPostingPrep | null {
  const scores = buildCurrentUserGolfScoresFromRoundGameSummary({
    currentUserId: userId,
    holes,
    participants,
  });

  if (!scores) return null;

  return buildGolfCanadaPostingPrepFromScores(round, scores);
}

export function buildCurrentUserGolfScoresFromRoundGameSummary(params: {
  currentUserId: string;
  holes: GolfCanadaBackendGameHoleSummary[] | null | undefined;
  participants?: GolfCanadaBackendParticipant[] | null;
}): GolfCanadaHoleScore[] | null {
  const { currentUserId, holes, participants } = params;
  if (!currentUserId || !holes?.length) return null;
  const participantId = resolveCurrentUserParticipantId({
    currentUserId,
    holes,
    participants,
  });

  const scores = Array.from({ length: 18 }, (_, index) => {
    const holeNumber = index + 1;
    const hole = holes.find((entry) => entry.hole_number === holeNumber) ?? null;
    const ownedScore = hole?.scores.find((entry) =>
      (participantId && entry.participant_id === participantId)
      || entry.user_id === currentUserId,
    )?.score ?? null;
    return {
      hole: holeNumber,
      score: typeof ownedScore === 'number' ? ownedScore : null,
    };
  });

  return scores;
}

export function getGolfCanadaPostingPrep(round: SavedRound, currentUserId?: string | null): GolfCanadaPostingPrep | null {
  if (!isGolfCanadaPostingEligible(round)) return null;

  const appUserParticipantId = getCurrentUserGroupParticipantId(round, currentUserId);
  const scores = round.holes.map((hole) => {
    if (round.roundMode === 'solo') {
      return {
        hole: hole.hole,
        score: typeof hole.score === 'number' ? hole.score : null,
      };
    }

    const currentUserGroupScore =
      hole.groupScores?.find((entry) => entry.participantId === appUserParticipantId)?.score ?? null;

    return {
      hole: hole.hole,
      score: typeof currentUserGroupScore === 'number'
        ? currentUserGroupScore
        : typeof hole.score === 'number'
          ? hole.score
          : null,
    };
  });

  return buildGolfCanadaPostingPrepFromScores(round, scores);
}

export function buildGolfCanadaPostedRound(
  round: SavedRound,
  context: { playedAlone: boolean; playedWithOthers: boolean; postedAt?: string | null },
): SavedRound {
  return {
    ...round,
    postingStates: {
      ...(round.postingStates ?? {}),
      golfCanada: {
        provider: 'golf_canada',
        method: 'manual',
        status: 'posted_manually',
        postedAt: context.postedAt ?? new Date().toISOString(),
        playedAlone: context.playedAlone,
        playedWithOthers: context.playedWithOthers,
      },
    },
  };
}

export function golfCanadaPostingStatusLabel(subject?: SavedRound | GolfCanadaPostingRecord | null) {
  return normalizePostingState(subject)?.status === 'posted_manually'
    ? 'Posted to Golf Canada (manual)'
    : 'Not posted';
}

export function golfCanadaPostingStatusTone(subject?: SavedRound | GolfCanadaPostingRecord | null) {
  return normalizePostingState(subject)?.status === 'posted_manually' ? 'posted' : 'pending';
}

export function golfCanadaPostedAtLabel(subject?: SavedRound | GolfCanadaPostingRecord | null) {
  const postedAt = normalizePostingState(subject)?.postedAt;
  if (!postedAt) return null;

  const parsed = new Date(postedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return `Marked posted ${parsed.toLocaleString()}`;
}

export async function getRoundGolfCanadaPostingState(roundId: string, userId: string, round?: SavedRound | null) {
  const { data, error } = await supabase
    .from('round_golf_canada_postings')
    .select('round_id, user_id, posted_at, posting_method, created_at, updated_at')
    .eq('round_id', roundId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return resolveGolfCanadaPostingState(round, null);

  return buildPostingRecordFromRow(data as RoundGolfCanadaPostingRow, inferPlayedContext(round));
}

export async function markRoundGolfCanadaPosted(params: {
  roundId: string;
  userId: string;
  round?: SavedRound | null;
}) {
  const context = inferPlayedContext(params.round);
  const { data, error } = await supabase
    .from('round_golf_canada_postings')
    .upsert({
      round_id: params.roundId,
      user_id: params.userId,
      posted_at: new Date().toISOString(),
      posting_method: 'manual',
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'round_id,user_id',
    })
    .select('round_id, user_id, posted_at, posting_method, created_at, updated_at')
    .single();

  if (error) throw error;
  return buildPostingRecordFromRow(data as RoundGolfCanadaPostingRow, context);
}
