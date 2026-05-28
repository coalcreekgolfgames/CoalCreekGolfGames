import { supabase } from '@/lib/supabase';
import { BACKEND_REGULAR_GROUP_ROUND_MODE } from '@/lib/regularRoundBackendMode';
import { isTeeOption, type TeeOption } from '@/constants/course';
import type { GroupParticipant, LocalRoundDraft } from '@/types/round';

export type GroupRoundParticipantCompanionAccess = {
  round_id: string;
  created_by_user_id: string;
  scoring_user_id?: string | null;
  round_date?: string | null;
  course_name?: string | null;
  status: string;
  round_participant_id: string;
  user_id: string;
  guest_profile_id?: string | null;
  display_name: string;
  participant_order?: number | null;
  is_scorer: boolean;
  companion_id?: string | null;
  wants_score_entry: boolean;
  wants_stats_entry: boolean;
  watch_only: boolean;
  companion_created_at?: string | null;
  companion_updated_at?: string | null;
  official_current_hole?: number | null;
  official_completed_hole?: number | null;
  live_progress_started_at?: string | null;
  live_progress_updated_at?: string | null;
  selected_tee?: TeeOption | null;
};

export type GroupRoundLiveProgress = {
  round_id: string;
  created_by_user_id: string;
  scoring_user_id?: string | null;
  status: string;
  current_official_hole?: number | null;
  completed_official_hole?: number | null;
  started_at?: string | null;
  updated_at?: string | null;
};

export type StartRegularGroupRoundResult = {
  round_id: string;
  round_game_id?: string | null;
  current_official_hole: number;
  completed_official_hole: number;
};

export type GroupRoundCompanionMode = {
  id: string;
  round_id: string;
  round_participant_id: string;
  user_id: string;
  wants_score_entry: boolean;
  wants_stats_entry: boolean;
  watch_only: boolean;
  created_at: string;
  updated_at: string;
};

export type GroupRoundCompanionCrossCardScore = {
  id: string;
  companion_id: string;
  round_id: string;
  round_participant_id: string;
  user_id: string;
  hole_number: number;
  strokes: number;
  official_strokes?: number | null;
  official_score_source?: string | null;
  score_delta?: number | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type GroupRoundCompanionHoleStats = {
  id: string;
  companion_id: string;
  round_id: string;
  round_participant_id: string;
  user_id: string;
  hole_number: number;
  fairway_hit?: boolean | null;
  green_in_regulation?: boolean | null;
  putts?: number | null;
  penalties?: number | null;
  sand_shots?: number | null;
  up_and_down_attempted?: boolean | null;
  up_and_down_success?: boolean | null;
  stat_json: Record<string, any>;
  created_at: string;
  updated_at: string;
};

export type GroupRoundCompanionGameType = 'standard' | 'bingo_bango_bongo' | 'skins' | 'nassau' | 'wolf';

export type GroupRoundCompanionMismatchReviewStatus =
  | 'no_mismatch'
  | 'mismatch_exists'
  | 'reviewed'
  | 'corrected'
  | 'accepted_as_official';

export type GroupRoundCompanionMismatchResolutionStatus =
  | 'reviewed'
  | 'corrected'
  | 'accepted_as_official';

export type GroupRoundCompanionMismatchReviewRow = {
  cross_card_score_id: string;
  companion_id: string;
  round_id: string;
  round_participant_id: string;
  user_id: string;
  display_name: string;
  participant_order?: number | null;
  hole_number: number;
  official_strokes?: number | null;
  participant_strokes: number;
  official_score_source?: string | null;
  official_score_record_id?: string | null;
  round_game_id?: string | null;
  score_delta?: number | null;
  mismatch_exists: boolean;
  resolution_id?: string | null;
  review_status: GroupRoundCompanionMismatchReviewStatus;
  resolution_status?: GroupRoundCompanionMismatchResolutionStatus | null;
  official_strokes_at_review?: number | null;
  participant_strokes_at_review?: number | null;
  corrected_strokes?: number | null;
  reviewed_by_user_id?: string | null;
  resolution_notes?: string | null;
  resolution_created_at?: string | null;
  resolution_updated_at?: string | null;
  participant_notes?: string | null;
  participant_score_created_at: string;
  participant_score_updated_at: string;
};

export type ResolveGroupRoundCompanionMismatchInput = {
  roundId: string;
  roundParticipantId: string;
  holeNumber: number;
  resolutionStatus: GroupRoundCompanionMismatchResolutionStatus;
  correctedStrokes?: number | null;
  notes?: string | null;
  applyOfficialCorrection?: boolean;
};

export type GroupRoundMismatchReviewSummary = {
  total: number;
  unresolved: number;
  resolved: number;
  clean: number;
  reviewComplete: boolean;
};

export type GroupRoundOfficialScoringGuardResult = {
  status: 'allow_official' | 'redirect_companion' | 'deny_non_participant' | 'loading' | 'blocked';
  allowOfficialScoring: boolean;
  redirectRoute: string | null;
  access: GroupRoundParticipantCompanionAccess | null;
  message?: string | null;
};

export type ActiveGroupRoundSummary = {
  roundId: string;
  displayName: string;
  courseName?: string | null;
  roundDate?: string | null;
  status: string;
  isScorer: boolean;
  officialCurrentHole?: number | null;
  officialCompletedHole?: number | null;
  liveProgressUpdatedAt?: string | null;
};

const BACKEND_LIVE_ROUND_STALE_CUTOFF_HOURS = 12;
const BACKEND_LIVE_ROUND_TERMINAL_STATUSES = new Set([
  'completed',
  'finished',
  'cancelled',
  'abandoned',
  'deleted',
]);

function findLocalGroupParticipant(round: LocalRoundDraft, userId: string) {
  return round.group?.participants?.find((participant) => participant.type === 'app_user' && participant.id === userId) ?? null;
}

function isLocalDraftOwner(round: LocalRoundDraft, userId: string) {
  if (round.draftOwnerUserId) return round.draftOwnerUserId === userId;
  return round.scoringUserId === userId;
}

function valueFromRow<T>(row: any, snakeKey: string, camelKey: string) {
  if (row?.[snakeKey] !== undefined) return row[snakeKey] as T;
  return row?.[camelKey] as T;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAccess(row: any): GroupRoundParticipantCompanionAccess {
  return {
    ...row,
    created_by_user_id: valueFromRow<string>(row, 'created_by_user_id', 'createdByUserId'),
    scoring_user_id: valueFromRow<string | null | undefined>(row, 'scoring_user_id', 'scoringUserId') ?? null,
    round_date: valueFromRow<string | null | undefined>(row, 'round_date', 'roundDate') ?? null,
    course_name: valueFromRow<string | null | undefined>(row, 'course_name', 'courseName') ?? null,
    round_participant_id: valueFromRow<string>(row, 'round_participant_id', 'roundParticipantId'),
    user_id: valueFromRow<string>(row, 'user_id', 'userId'),
    guest_profile_id: valueFromRow<string | null | undefined>(row, 'guest_profile_id', 'guestProfileId') ?? null,
    display_name: valueFromRow<string>(row, 'display_name', 'displayName'),
    participant_order: numberOrNull(valueFromRow(row, 'participant_order', 'participantOrder')),
    is_scorer: valueFromRow(row, 'is_scorer', 'isScorer') === true,
    companion_id: valueFromRow<string | null | undefined>(row, 'companion_id', 'companionId') ?? null,
    wants_score_entry: valueFromRow(row, 'wants_score_entry', 'wantsScoreEntry') === true,
    wants_stats_entry: valueFromRow(row, 'wants_stats_entry', 'wantsStatsEntry') === true,
    watch_only: valueFromRow(row, 'watch_only', 'watchOnly') !== false,
    companion_created_at: valueFromRow<string | null | undefined>(row, 'companion_created_at', 'companionCreatedAt') ?? null,
    companion_updated_at: valueFromRow<string | null | undefined>(row, 'companion_updated_at', 'companionUpdatedAt') ?? null,
    official_current_hole: numberOrNull(valueFromRow(row, 'official_current_hole', 'officialCurrentHole')),
    official_completed_hole: numberOrNull(valueFromRow(row, 'official_completed_hole', 'officialCompletedHole')),
    live_progress_started_at: valueFromRow<string | null | undefined>(row, 'live_progress_started_at', 'liveProgressStartedAt') ?? null,
    live_progress_updated_at: valueFromRow<string | null | undefined>(row, 'live_progress_updated_at', 'liveProgressUpdatedAt') ?? null,
    selected_tee: isTeeOption(valueFromRow(row, 'selected_tee', 'selectedTee'))
      ? valueFromRow<TeeOption>(row, 'selected_tee', 'selectedTee')
      : null,
  };
}

function normalizeLiveProgress(row: any): GroupRoundLiveProgress {
  return {
    ...row,
    round_id: valueFromRow<string>(row, 'round_id', 'roundId'),
    created_by_user_id: valueFromRow<string>(row, 'created_by_user_id', 'createdByUserId'),
    scoring_user_id: valueFromRow<string | null | undefined>(row, 'scoring_user_id', 'scoringUserId') ?? null,
    status: valueFromRow<string>(row, 'status', 'status'),
    current_official_hole: numberOrNull(valueFromRow(row, 'current_official_hole', 'currentOfficialHole')),
    completed_official_hole: numberOrNull(valueFromRow(row, 'completed_official_hole', 'completedOfficialHole')),
    started_at: valueFromRow<string | null | undefined>(row, 'started_at', 'startedAt') ?? null,
    updated_at: valueFromRow<string | null | undefined>(row, 'updated_at', 'updatedAt') ?? null,
  };
}

function normalizeCrossCardScore(row: any): GroupRoundCompanionCrossCardScore {
  return {
    ...row,
    id: valueFromRow<string>(row, 'id', 'id'),
    companion_id: valueFromRow<string>(row, 'companion_id', 'companionId'),
    round_id: valueFromRow<string>(row, 'round_id', 'roundId'),
    round_participant_id: valueFromRow<string>(row, 'round_participant_id', 'roundParticipantId'),
    user_id: valueFromRow<string>(row, 'user_id', 'userId'),
    hole_number: Number(valueFromRow(row, 'hole_number', 'holeNumber')),
    strokes: Number(valueFromRow(row, 'strokes', 'strokes')),
    official_strokes: numberOrNull(valueFromRow(row, 'official_strokes', 'officialStrokes')),
    official_score_source: valueFromRow<string | null | undefined>(row, 'official_score_source', 'officialScoreSource') ?? null,
    score_delta: numberOrNull(valueFromRow(row, 'score_delta', 'scoreDelta')),
    notes: valueFromRow<string | null | undefined>(row, 'notes', 'notes') ?? null,
    created_at: valueFromRow<string>(row, 'created_at', 'createdAt'),
    updated_at: valueFromRow<string>(row, 'updated_at', 'updatedAt'),
  };
}

function normalizeMismatchReviewRow(row: any): GroupRoundCompanionMismatchReviewRow {
  return {
    ...row,
    cross_card_score_id: valueFromRow<string>(row, 'cross_card_score_id', 'crossCardScoreId'),
    companion_id: valueFromRow<string>(row, 'companion_id', 'companionId'),
    round_id: valueFromRow<string>(row, 'round_id', 'roundId'),
    round_participant_id: valueFromRow<string>(row, 'round_participant_id', 'roundParticipantId'),
    user_id: valueFromRow<string>(row, 'user_id', 'userId'),
    display_name: valueFromRow<string>(row, 'display_name', 'displayName'),
    participant_order: numberOrNull(valueFromRow(row, 'participant_order', 'participantOrder')),
    hole_number: Number(valueFromRow(row, 'hole_number', 'holeNumber')),
    official_strokes: numberOrNull(valueFromRow(row, 'official_strokes', 'officialStrokes')),
    participant_strokes: Number(valueFromRow(row, 'participant_strokes', 'participantStrokes')),
    official_score_source: valueFromRow<string | null | undefined>(row, 'official_score_source', 'officialScoreSource') ?? null,
    official_score_record_id: valueFromRow<string | null | undefined>(row, 'official_score_record_id', 'officialScoreRecordId') ?? null,
    round_game_id: valueFromRow<string | null | undefined>(row, 'round_game_id', 'roundGameId') ?? null,
    score_delta: numberOrNull(valueFromRow(row, 'score_delta', 'scoreDelta')),
    mismatch_exists: valueFromRow(row, 'mismatch_exists', 'mismatchExists') === true,
    resolution_id: valueFromRow<string | null | undefined>(row, 'resolution_id', 'resolutionId') ?? null,
    review_status: valueFromRow(row, 'review_status', 'reviewStatus'),
    resolution_status: valueFromRow(row, 'resolution_status', 'resolutionStatus') ?? null,
    official_strokes_at_review: numberOrNull(valueFromRow(row, 'official_strokes_at_review', 'officialStrokesAtReview')),
    participant_strokes_at_review: numberOrNull(valueFromRow(row, 'participant_strokes_at_review', 'participantStrokesAtReview')),
    corrected_strokes: numberOrNull(valueFromRow(row, 'corrected_strokes', 'correctedStrokes')),
    reviewed_by_user_id: valueFromRow<string | null | undefined>(row, 'reviewed_by_user_id', 'reviewedByUserId') ?? null,
    resolution_notes: valueFromRow<string | null | undefined>(row, 'resolution_notes', 'resolutionNotes') ?? null,
    resolution_created_at: valueFromRow<string | null | undefined>(row, 'resolution_created_at', 'resolutionCreatedAt') ?? null,
    resolution_updated_at: valueFromRow<string | null | undefined>(row, 'resolution_updated_at', 'resolutionUpdatedAt') ?? null,
    participant_notes: valueFromRow<string | null | undefined>(row, 'participant_notes', 'participantNotes') ?? null,
    participant_score_created_at: valueFromRow<string>(row, 'participant_score_created_at', 'participantScoreCreatedAt'),
    participant_score_updated_at: valueFromRow<string>(row, 'participant_score_updated_at', 'participantScoreUpdatedAt'),
  };
}

export function mergeGroupRoundLiveProgressIntoAccess(
  access: GroupRoundParticipantCompanionAccess | null,
  liveProgress: GroupRoundLiveProgress | null,
): GroupRoundParticipantCompanionAccess | null {
  if (!access) return null;
  if (!liveProgress) return access;

  return {
    ...access,
    official_current_hole: liveProgress.current_official_hole ?? access.official_current_hole ?? null,
    official_completed_hole: liveProgress.completed_official_hole ?? access.official_completed_hole ?? null,
    live_progress_started_at: liveProgress.started_at ?? access.live_progress_started_at ?? null,
    live_progress_updated_at: liveProgress.updated_at ?? access.live_progress_updated_at ?? null,
  };
}

function mapStartRegularGroupRoundParticipant(participant: GroupParticipant, scoringUserId: string, participantOrder: number) {
  return {
    participant_id: participant.id,
    user_id: participant.type === 'app_user' ? (participant.id === 'me' ? scoringUserId : participant.id) : null,
    guest_profile_id:
      participant.type === 'guest' && !participant.id.startsWith('guest-')
        ? participant.id
        : null,
    guest_first_name: participant.type === 'guest' ? participant.firstName : null,
    guest_last_name: participant.type === 'guest' ? participant.lastName : null,
    display_name: participant.displayName,
    participant_order: participantOrder,
    is_scorer: participant.isScorekeeper === true,
    selected_tee: participant.selectedTee ?? null,
  };
}

function logGroupRoundAccessDebug(event: string, payload: Record<string, unknown>) {
  if (!__DEV__) return;
  console.debug(`[group-round-access] ${event}`, payload);
}

function hoursSince(timestamp: string | null | undefined) {
  if (!timestamp) return null;
  const timeMs = new Date(timestamp).getTime();
  if (!Number.isFinite(timeMs)) return null;
  return (Date.now() - timeMs) / (1000 * 60 * 60);
}

function logActiveBackendRoundFilterDebug(params: {
  source: 'backend_companion_access';
  roundId: string | null | undefined;
  status: string | null | undefined;
  liveProgressUpdatedAt: string | null | undefined;
  completedOfficialHole: number | null;
  currentOfficialHole: number | null;
  hasAccessRow: boolean;
  isScorer: boolean | null | undefined;
  hiddenReason: string | null;
}) {
  if (!__DEV__) return;
  console.debug('[active-live-round-filter-debug]', {
    source: params.source,
    roundId: params.roundId ?? null,
    status: params.status ?? null,
    liveProgressUpdatedAt: params.liveProgressUpdatedAt ?? null,
    ageHours: hoursSince(params.liveProgressUpdatedAt),
    completedOfficialHole: params.completedOfficialHole,
    currentOfficialHole: params.currentOfficialHole,
    hasAccessRow: params.hasAccessRow,
    isScorer: params.isScorer ?? null,
    hiddenReason: params.hiddenReason,
  });
}

export function isBackendLiveRoundActive(params: {
  source?: 'backend_companion_access';
  roundId: string | null | undefined;
  status: string | null | undefined;
  liveProgressUpdatedAt: string | null | undefined;
  completedOfficialHole?: number | null;
  currentOfficialHole?: number | null;
  hasAccessRow?: boolean;
  isScorer?: boolean | null;
}) {
  const normalizedStatus = String(params.status ?? '').trim().toLowerCase();
  const ageHours = hoursSince(params.liveProgressUpdatedAt);

  let hiddenReason: string | null = null;
  if (BACKEND_LIVE_ROUND_TERMINAL_STATUSES.has(normalizedStatus)) {
    hiddenReason = 'terminal_status';
  } else if (!params.liveProgressUpdatedAt) {
    hiddenReason = 'missing_live_progress';
  } else if (ageHours == null) {
    hiddenReason = 'invalid_live_progress_timestamp';
  } else if (ageHours > BACKEND_LIVE_ROUND_STALE_CUTOFF_HOURS) {
    hiddenReason = 'stale_live_progress';
  }

  if (hiddenReason) {
    logActiveBackendRoundFilterDebug({
      source: params.source ?? 'backend_companion_access',
      roundId: params.roundId,
      status: normalizedStatus || null,
      liveProgressUpdatedAt: params.liveProgressUpdatedAt,
      completedOfficialHole: numberOrNull(params.completedOfficialHole),
      currentOfficialHole: numberOrNull(params.currentOfficialHole),
      hasAccessRow: params.hasAccessRow === true,
      isScorer: params.isScorer,
      hiddenReason,
    });
  }

  return {
    active: hiddenReason == null,
    hiddenReason,
    ageHours,
  };
}

export async function getCurrentSupabaseSessionUserId() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  logGroupRoundAccessDebug('session_user', {
    sessionUserId: data.session?.user?.id ?? null,
  });
  return data.session?.user?.id ?? null;
}

export async function getGroupRoundCompanionAccess(roundId: string, userId: string) {
  const { data, error } = await supabase
    .from('v_group_round_participant_companion_access')
    .select(`
      round_id,
      created_by_user_id,
      scoring_user_id,
      round_date,
      course_name,
      status,
      round_participant_id,
      user_id,
      guest_profile_id,
      display_name,
      participant_order,
      is_scorer,
      companion_id,
      wants_score_entry,
      wants_stats_entry,
      watch_only,
      companion_created_at,
      companion_updated_at,
      official_current_hole,
      official_completed_hole,
      live_progress_started_at,
      live_progress_updated_at
    `)
    .eq('round_id', roundId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  let selectedTee: TeeOption | null = null;
  if (data?.round_participant_id) {
    const teeRes = await supabase
      .from('round_participants')
      .select('selected_tee')
      .eq('id', data.round_participant_id)
      .maybeSingle();
    if (teeRes.error) {
      console.warn('[group-round-access] participant_tee_lookup_failed', teeRes.error?.message ?? teeRes.error);
    } else if (isTeeOption(teeRes.data?.selected_tee)) {
      selectedTee = teeRes.data.selected_tee;
    }
  }
  logGroupRoundAccessDebug('companion_access_query', {
    roundId,
    requestedUserId: userId,
    returnedUserId: data?.user_id ?? null,
    isScorer: data?.is_scorer ?? null,
    officialCurrentHole: data?.official_current_hole ?? null,
    officialCompletedHole: data?.official_completed_hole ?? null,
    liveProgressUpdatedAt: data?.live_progress_updated_at ?? null,
    hasAccessRow: !!data,
  });
  return data ? normalizeAccess({ ...data, selected_tee: selectedTee }) : null;
}

export async function updateRoundParticipantSelectedTee(params: {
  roundParticipantId: string;
  selectedTee: TeeOption;
}) {
  const { error } = await supabase
    .from('round_participants')
    .update({ selected_tee: params.selectedTee })
    .eq('id', params.roundParticipantId);

  if (error) throw error;
}

export async function getCurrentUserActiveGroupRound(userId: string): Promise<ActiveGroupRoundSummary | null> {
  const { data, error } = await supabase
    .from('v_group_round_participant_companion_access')
    .select(`
      round_id,
      course_name,
      round_date,
      status,
      display_name,
      is_scorer,
      official_current_hole,
      official_completed_hole,
      live_progress_updated_at,
      participant_order
    `)
    .eq('user_id', userId)
    .in('status', ['draft', 'active'])
    .order('live_progress_updated_at', { ascending: false, nullsFirst: false })
    .order('round_date', { ascending: false, nullsFirst: false })
    .order('participant_order', { ascending: true })
    .limit(10);

  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];

  for (const row of rows) {
    if (!row?.round_id) continue;
    const activeCheck = isBackendLiveRoundActive({
      source: 'backend_companion_access',
      roundId: row.round_id,
      status: row.status ?? null,
      liveProgressUpdatedAt: row.live_progress_updated_at ?? null,
      completedOfficialHole: row.official_completed_hole ?? null,
      currentOfficialHole: row.official_current_hole ?? null,
      hasAccessRow: true,
      isScorer: row.is_scorer === true,
    });
    if (!activeCheck.active) continue;

    return {
      roundId: row.round_id,
      displayName: row.display_name ?? 'Player',
      courseName: row.course_name ?? null,
      roundDate: row.round_date ?? null,
      status: row.status ?? 'draft',
      isScorer: row.is_scorer === true,
      officialCurrentHole: numberOrNull(row.official_current_hole),
      officialCompletedHole: numberOrNull(row.official_completed_hole),
      liveProgressUpdatedAt: row.live_progress_updated_at ?? null,
    };
  }

  return null;
}

export async function getGroupRoundLiveProgress(roundId: string) {
  const { data, error } = await supabase
    .from('v_group_round_live_progress')
    .select(`
      round_id,
      created_by_user_id,
      scoring_user_id,
      status,
      current_official_hole,
      completed_official_hole,
      started_at,
      updated_at
    `)
    .eq('round_id', roundId)
    .maybeSingle();

  if (error) throw error;
  logGroupRoundAccessDebug('live_progress_query', {
    roundId,
    currentOfficialHole: data?.current_official_hole ?? null,
    completedOfficialHole: data?.completed_official_hole ?? null,
    updatedAt: data?.updated_at ?? null,
    hasLiveProgressRow: !!data,
  });
  return data ? normalizeLiveProgress(data) : null;
}

export async function startRegularGroupRound(params: {
  roundDate: string;
  teeName: TeeOption;
  scoringUserId: string;
  participants: GroupParticipant[];
  gameType: GroupRoundCompanionGameType;
  gameName?: string | null;
  buyInCents?: number | null;
  gameParticipantIds?: string[] | null;
  gameConfig?: Record<string, any> | null;
}) {
  if (params.gameType === 'nassau' || params.gameType === 'wolf') {
    const participantPayload = params.participants.map((participant, index) =>
      mapStartRegularGroupRoundParticipant(participant, params.scoringUserId, index + 1));
    const selectedGameParticipantIds = Array.from(new Set((params.gameParticipantIds ?? []).filter((value) => typeof value === 'string' && value.trim().length > 0)));

    if (params.gameType === 'nassau' && (selectedGameParticipantIds.length < 2 || selectedGameParticipantIds.length > 4)) {
      throw new Error('Unsupported regular group game type configuration.');
    }

    if (params.gameType === 'wolf' && selectedGameParticipantIds.length !== 4) {
      throw new Error('Unsupported regular group game type configuration.');
    }

    const gameParticipantPayload = participantPayload.filter((participant) => selectedGameParticipantIds.includes(participant.participant_id));
    if (gameParticipantPayload.length !== selectedGameParticipantIds.length) {
      throw new Error('Unsupported regular group game type configuration.');
    }

    const roundRes = await supabase
      .from('rounds')
      .insert({
        course_name: 'Coal Creek',
        round_date: params.roundDate,
        tee_name: params.teeName,
        created_by_user_id: params.scoringUserId,
        scoring_user_id: params.scoringUserId,
        round_mode: BACKEND_REGULAR_GROUP_ROUND_MODE,
        player_count: params.participants.length,
        status: 'draft',
      })
      .select('id')
      .single();

    if (roundRes.error) throw roundRes.error;

    const roundParticipantsRes = await supabase.from('round_participants').insert(
      participantPayload.map((participant) => ({
        round_id: roundRes.data.id,
        user_id: participant.user_id,
        guest_profile_id: participant.guest_profile_id,
        guest_first_name: participant.guest_first_name,
        guest_last_name: participant.guest_last_name,
        participant_order: participant.participant_order,
        is_scorer: participant.is_scorer,
        selected_tee: participant.selected_tee,
      })),
    );

    if (roundParticipantsRes.error) throw roundParticipantsRes.error;

    const roundPlayerRows = participantPayload
      .filter((participant) => participant.user_id)
      .map((participant) => ({
        round_id: roundRes.data.id,
        user_id: participant.user_id!,
        player_order: participant.participant_order,
        gross_total: 0,
        is_scorer: participant.is_scorer,
      }));

    if (roundPlayerRows.length > 0) {
      const roundPlayersRes = await supabase
        .from('round_players')
        .upsert(roundPlayerRows, {
          onConflict: 'round_id,user_id',
        });

      if (roundPlayersRes.error) throw roundPlayersRes.error;
    }

    const gameRes = await supabase
      .from('round_games')
      .insert({
        round_id: roundRes.data.id,
        game_type: params.gameType,
        status: 'active',
        created_by_user_id: params.scoringUserId,
        name: params.gameName ?? null,
        buy_in_cents: params.buyInCents ?? 0,
        config_json: params.gameType === 'wolf'
          ? {
              participant_count: gameParticipantPayload.length,
              participant_ids: selectedGameParticipantIds,
              format: 'standard_wolf_v1',
              source: 'expo_wolf_round',
              ...(params.gameConfig ?? {}),
            }
          : {
              participant_count: gameParticipantPayload.length,
              participant_ids: selectedGameParticipantIds,
              format: 'segment_totals',
              source: 'expo_nassau_round',
              ...(params.gameConfig ?? {}),
            },
      })
      .select('id')
      .single();

    if (gameRes.error) throw gameRes.error;

    const gameParticipantsRes = await supabase
      .from('round_game_participants')
      .upsert(
        gameParticipantPayload.map((participant) => ({
          round_game_id: gameRes.data.id,
          participant_id: participant.participant_id,
          user_id: participant.user_id,
          display_name: participant.display_name,
          seat_order: participant.participant_order,
          is_active: true,
        })),
        {
          onConflict: 'round_game_id,participant_id',
        },
      );

    if (gameParticipantsRes.error) throw gameParticipantsRes.error;

    return {
      round_id: roundRes.data.id,
      round_game_id: gameRes.data.id,
      current_official_hole: 1,
      completed_official_hole: 0,
    } satisfies StartRegularGroupRoundResult;
  }

  const participantPayload = params.participants.map((participant, index) =>
    mapStartRegularGroupRoundParticipant(participant, params.scoringUserId, index + 1));

  const { data, error } = await supabase.rpc('start_regular_group_round', {
    p_round_date: params.roundDate,
    p_course_name: 'Coal Creek',
    p_participants: participantPayload,
    p_game_type: params.gameType,
    p_game_name: params.gameName ?? null,
    p_buy_in_cents: params.buyInCents ?? null,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.round_id) {
    throw new Error('Regular group round start did not return a backend round id.');
  }

  const roundUpdateRes = await supabase
    .from('rounds')
    .update({ tee_name: params.teeName })
    .eq('id', row.round_id);
  if (roundUpdateRes.error) throw roundUpdateRes.error;

  await Promise.all(participantPayload.map(async (participant) => {
    if (!participant.selected_tee) return;
    const participantUpdateRes = await supabase
      .from('round_participants')
      .update({ selected_tee: participant.selected_tee })
      .eq('round_id', row.round_id)
      .eq('participant_order', participant.participant_order);
    if (participantUpdateRes.error) throw participantUpdateRes.error;
  }));

  return {
    round_id: row.round_id,
    round_game_id: row.round_game_id ?? null,
    current_official_hole: Number(row.current_official_hole ?? 1),
    completed_official_hole: Number(row.completed_official_hole ?? 0),
  } satisfies StartRegularGroupRoundResult;
}

export async function getGroupRoundOfficialScoringGuard(params: {
  round: LocalRoundDraft | null | undefined;
  userId?: string | null;
  authLoading?: boolean;
}): Promise<GroupRoundOfficialScoringGuardResult> {
  const { round, userId, authLoading } = params;

  if (round?.roundMode !== 'casual_group') {
    logGroupRoundAccessDebug('guard_non_group', {
      roundMode: round?.roundMode ?? null,
    });
    return {
      status: 'allow_official',
      allowOfficialScoring: true,
      redirectRoute: null,
      access: null,
      message: null,
    };
  }

  if (authLoading) {
    logGroupRoundAccessDebug('guard_loading_auth', {
      userId: userId ?? null,
      backendRoundId: round?.backendRoundId ?? null,
    });
    return {
      status: 'loading',
      allowOfficialScoring: false,
      redirectRoute: null,
      access: null,
      message: 'Checking group-round access...',
    };
  }

  if (!userId) {
    logGroupRoundAccessDebug('guard_no_user', {
      backendRoundId: round.backendRoundId ?? null,
    });
    return {
      status: 'deny_non_participant',
      allowOfficialScoring: false,
      redirectRoute: null,
      access: null,
      message: 'Sign in as a registered participant to open this shared group round.',
    };
  }

  if (!round.backendRoundId) {
    const localParticipant = isLocalDraftOwner(round, userId) ? findLocalGroupParticipant(round, userId) : null;
    const isLocalScorekeeper = round.scoringUserId === userId || localParticipant?.isScorekeeper === true;

    if (isLocalScorekeeper) {
      logGroupRoundAccessDebug('guard_local_scorekeeper', {
        userId,
        roundId: round.id,
      });
      return {
        status: 'allow_official',
        allowOfficialScoring: true,
        redirectRoute: null,
        access: null,
        message: null,
      };
    }

    logGroupRoundAccessDebug('guard_pre_backend_block', {
      userId,
      roundId: round.id,
      hasLocalParticipant: !!localParticipant,
    });
    return {
      status: localParticipant ? 'blocked' : 'deny_non_participant',
      allowOfficialScoring: false,
      redirectRoute: null,
      access: null,
      message: localParticipant
        ? 'This shared group round is still syncing on the scorekeeper device. Companion access will appear after the backend round is ready.'
        : 'You are not a registered participant in this shared group round.',
    };
  }

  const sessionUserId = await getCurrentSupabaseSessionUserId();
  if (!sessionUserId || sessionUserId !== userId) {
    logGroupRoundAccessDebug('guard_session_mismatch', {
      requestedUserId: userId,
      sessionUserId,
      backendRoundId: round.backendRoundId,
    });
    return {
      status: 'loading',
      allowOfficialScoring: false,
      redirectRoute: null,
      access: null,
      message: 'Updating group-round access for the current signed-in account...',
    };
  }

  const access = await getGroupRoundCompanionAccess(round.backendRoundId, userId);
  const localParticipant = isLocalDraftOwner(round, userId) ? findLocalGroupParticipant(round, userId) : null;
  const isLocalScorekeeper = isLocalDraftOwner(round, userId)
    && (round.scoringUserId === userId || localParticipant?.isScorekeeper === true);
  const isOfficialScorekeeper = access?.is_scorer === true || access?.scoring_user_id === userId || (!access && isLocalScorekeeper);
  const status = access
    ? (access.is_scorer === true || access.scoring_user_id === userId ? 'allow_official' : 'redirect_companion')
    : isLocalScorekeeper
      ? 'allow_official'
      : localParticipant
        ? 'blocked'
        : 'deny_non_participant';

  logGroupRoundAccessDebug('guard_result', {
    requestedUserId: userId,
    sessionUserId,
    backendRoundId: round.backendRoundId,
    draftOwnerUserId: round.draftOwnerUserId ?? null,
    scoringUserId: round.scoringUserId ?? null,
    hasAccessRow: !!access,
    accessUserId: access?.user_id ?? null,
    accessIsScorer: access?.is_scorer ?? null,
    accessScoringUserId: access?.scoring_user_id ?? null,
    localParticipantId: localParticipant?.id ?? null,
    isLocalScorekeeper,
    status,
  });

  return {
    status,
    allowOfficialScoring: isOfficialScorekeeper,
    redirectRoute: status === 'redirect_companion' ? `/round/companion/${round.backendRoundId}` : null,
    access,
    message: isOfficialScorekeeper
      ? null
      : status === 'redirect_companion'
        ? 'Open participant companion mode for your own score, stats, and live board.'
        : status === 'blocked'
          ? 'This shared group round is still syncing participant access for this account. Try again when backend access is available.'
          : 'You are not a registered participant in this shared group round.',
  };
}

export async function getGroupRoundCompanionGameType(roundId: string): Promise<GroupRoundCompanionGameType> {
  const { data, error } = await supabase
    .from('round_games')
    .select('game_type')
    .eq('round_id', roundId)
    .in('game_type', ['bingo_bango_bongo', 'skins', 'nassau', 'wolf'])
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) throw error;
  const gameType = data?.[0]?.game_type;
  if (gameType === 'bingo_bango_bongo' || gameType === 'skins' || gameType === 'nassau' || gameType === 'wolf') return gameType;
  return 'standard';
}

export async function getSkinsRoundGameIdForRound(roundId: string) {
  const { data, error } = await supabase
    .from('round_games')
    .select('id')
    .eq('round_id', roundId)
    .eq('game_type', 'skins')
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export async function getNassauRoundGameIdForRound(roundId: string) {
  const { data, error } = await supabase
    .from('round_games')
    .select('id')
    .eq('round_id', roundId)
    .eq('game_type', 'nassau')
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export async function getWolfRoundGameIdForRound(roundId: string) {
  const { data, error } = await supabase
    .from('round_games')
    .select('id')
    .eq('round_id', roundId)
    .eq('game_type', 'wolf')
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export async function upsertGroupRoundCompanionMode(params: {
  roundId: string;
  roundParticipantId: string;
  userId: string;
  wantsScoreEntry: boolean;
  wantsStatsEntry: boolean;
}) {
  const watchOnly = !params.wantsScoreEntry && !params.wantsStatsEntry;
  const { data, error } = await supabase
    .from('round_participant_companions')
    .upsert({
      round_id: params.roundId,
      round_participant_id: params.roundParticipantId,
      user_id: params.userId,
      wants_score_entry: params.wantsScoreEntry,
      wants_stats_entry: params.wantsStatsEntry,
      watch_only: watchOnly,
    }, {
      onConflict: 'round_id,user_id',
    })
    .select(`
      id,
      round_id,
      round_participant_id,
      user_id,
      wants_score_entry,
      wants_stats_entry,
      watch_only,
      created_at,
      updated_at
    `)
    .single();

  if (error) throw error;
  return data as GroupRoundCompanionMode;
}

export async function getGroupRoundCompanionScores(roundId: string, userId: string) {
  const { data, error } = await supabase
    .from('v_group_round_participant_cross_card_scores')
    .select(`
      id,
      companion_id,
      round_id,
      round_participant_id,
      user_id,
      hole_number,
      strokes,
      official_strokes,
      official_score_source,
      score_delta,
      notes,
      created_at,
      updated_at
    `)
    .eq('round_id', roundId)
    .eq('user_id', userId)
    .order('hole_number', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => normalizeCrossCardScore(row));
}

export async function getGroupRoundCompanionStats(roundId: string, userId: string) {
  const { data, error } = await supabase
    .from('v_group_round_participant_hole_stats')
    .select(`
      id,
      companion_id,
      round_id,
      round_participant_id,
      user_id,
      hole_number,
      fairway_hit,
      green_in_regulation,
      putts,
      penalties,
      sand_shots,
      up_and_down_attempted,
      up_and_down_success,
      stat_json,
      created_at,
      updated_at
    `)
    .eq('round_id', roundId)
    .eq('user_id', userId)
    .order('hole_number', { ascending: true });

  if (error) throw error;
  return (data ?? []) as GroupRoundCompanionHoleStats[];
}

export async function getGroupRoundCompanionMismatchReview(roundId: string) {
  const { data, error } = await supabase
    .from('v_group_round_participant_score_mismatch_review')
    .select(`
      cross_card_score_id,
      companion_id,
      round_id,
      round_participant_id,
      user_id,
      display_name,
      participant_order,
      hole_number,
      official_strokes,
      participant_strokes,
      official_score_source,
      official_score_record_id,
      round_game_id,
      score_delta,
      mismatch_exists,
      resolution_id,
      review_status,
      resolution_status,
      official_strokes_at_review,
      participant_strokes_at_review,
      corrected_strokes,
      reviewed_by_user_id,
      resolution_notes,
      resolution_created_at,
      resolution_updated_at,
      participant_notes,
      participant_score_created_at,
      participant_score_updated_at
    `)
    .eq('round_id', roundId)
    .order('participant_order', { ascending: true, nullsFirst: false })
    .order('display_name', { ascending: true })
    .order('hole_number', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => normalizeMismatchReviewRow(row));
}

export async function resolveGroupRoundCompanionMismatch(params: ResolveGroupRoundCompanionMismatchInput) {
  const { data, error } = await supabase.rpc('resolve_group_round_participant_score_mismatch', {
    p_round_id: params.roundId,
    p_round_participant_id: params.roundParticipantId,
    p_hole_number: params.holeNumber,
    p_resolution_status: params.resolutionStatus,
    p_corrected_strokes: params.correctedStrokes ?? null,
    p_notes: params.notes ?? null,
    p_apply_official_correction: params.applyOfficialCorrection ?? true,
  });

  if (error) throw error;
  return data;
}

export function summarizeGroupRoundCompanionMismatchReview(rows: GroupRoundCompanionMismatchReviewRow[]): GroupRoundMismatchReviewSummary {
  const unresolved = rows.filter((row) => row.review_status === 'mismatch_exists').length;
  const resolved = rows.filter((row) => (
    row.review_status === 'reviewed'
    || row.review_status === 'corrected'
    || row.review_status === 'accepted_as_official'
  )).length;
  const clean = rows.filter((row) => row.review_status === 'no_mismatch').length;
  return {
    total: rows.length,
    unresolved,
    resolved,
    clean,
    reviewComplete: rows.length > 0 && unresolved === 0,
  };
}

export async function upsertGroupRoundCompanionScore(params: {
  companionId: string;
  roundId: string;
  roundParticipantId: string;
  userId: string;
  holeNumber: number;
  strokes: number;
  notes?: string | null;
}) {
  const { data, error } = await supabase
    .from('round_participant_cross_card_scores')
    .upsert({
      companion_id: params.companionId,
      round_id: params.roundId,
      round_participant_id: params.roundParticipantId,
      user_id: params.userId,
      hole_number: params.holeNumber,
      strokes: params.strokes,
      notes: params.notes ?? null,
    }, {
      onConflict: 'companion_id,hole_number',
    })
    .select('id')
    .single();

  if (error) throw error;
  return data;
}

export async function upsertGroupRoundCompanionStats(params: {
  companionId: string;
  roundId: string;
  roundParticipantId: string;
  userId: string;
  holeNumber: number;
  fairwayHit?: boolean | null;
  greenInRegulation?: boolean | null;
  putts?: number | null;
  penalties?: number | null;
  sandShots?: number | null;
  upAndDownAttempted?: boolean | null;
  upAndDownSuccess?: boolean | null;
  statJson?: Record<string, any>;
}) {
  const { data, error } = await supabase
    .from('round_participant_hole_stats')
    .upsert({
      companion_id: params.companionId,
      round_id: params.roundId,
      round_participant_id: params.roundParticipantId,
      user_id: params.userId,
      hole_number: params.holeNumber,
      fairway_hit: params.fairwayHit ?? null,
      green_in_regulation: params.greenInRegulation ?? null,
      putts: params.putts ?? null,
      penalties: params.penalties ?? null,
      sand_shots: params.sandShots ?? null,
      up_and_down_attempted: params.upAndDownAttempted ?? null,
      up_and_down_success: params.upAndDownSuccess ?? null,
      stat_json: params.statJson ?? {},
    }, {
      onConflict: 'companion_id,hole_number',
    })
    .select('id')
    .single();

  if (error) throw error;
  return data;
}
