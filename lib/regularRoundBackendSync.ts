import { ensureBbbBackendRound, finalizeBbbRoundSync, syncBbbHole } from '@/lib/bbbBackend';
import { loadDraftRound, saveDraftRound } from '@/lib/localRound';
import { ensureNassauBackendRound, finalizeNassauRoundSync, syncNassauHole } from '@/lib/nassauBackend';
import { ensureSkinsBackendRound, finalizeSkinsRoundSync, syncSkinsHole } from '@/lib/skinsBackend';
import { ensureWolfBackendRound, finalizeWolfRoundSync, syncWolfHole } from '@/lib/wolfBackend';
import { holes } from '@/constants/course';
import { BACKEND_REGULAR_GROUP_ROUND_MODE } from '@/lib/regularRoundBackendMode';
import { persistRegularRoundLayerStatsForHole } from '@/lib/roundLayerStatsSync';
import { supabase } from '@/lib/supabase';
import { finalizeHoleStats } from '@/lib/roundStats';
import type {
  GroupParticipant,
  HoleDraft,
  LocalRoundDraft,
  RegularRoundBackendChunkStatus,
  RegularRoundBackendChunkType,
  RegularRoundBackendSyncChunk,
  RegularRoundBackendGameType,
  RegularRoundBackendSyncState,
  SavedRound,
} from '@/types/round';

const RETRY_DELAY_MS = 30_000;
const FINAL_SYNC_BATCH_SIZE = 3;
const CANCEL_POLL_MS = 500;
const CHUNK_ATTEMPT_BATCH_SIZE = 3;
const DEBUG_SYNC_CHUNKS = false;
const activeRoundDrainQueuedByRoundId = new Set<string>();
const activeRoundDrainInFlightByRoundId = new Map<string, Promise<LocalRoundDraft | null>>();
const activeRoundRetryTimerByRoundId = new Map<string, ReturnType<typeof setTimeout>>();

type SyncableRegularRound = LocalRoundDraft | SavedRound;

type ChunkSpec = {
  chunkType: RegularRoundBackendChunkType;
  holeNumber?: number | null;
};

type StandardRoundParticipantRow = {
  id: string;
  user_id?: string | null;
  guest_profile_id?: string | null;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  participant_order?: number | null;
  is_scorer?: boolean | null;
};

type StandardHoleScoreRow = {
  participantId: string;
  backendParticipantId: string;
  userId: string | null;
  strokes: number;
  playerOrder: number;
  isScorer: boolean;
};

type StandardHoleScoreBuildResult = {
  rows: StandardHoleScoreRow[];
  expectedPlayerCount: number;
  skippedPlayers: Array<{
    participantId: string;
    displayName: string;
    reason: 'missing_backend_participant_id' | 'missing_score';
  }>;
};

type RoundSyncAdapter = {
  ensureBackendRound: (params: { round: LocalRoundDraft; userId: string }) => Promise<LocalRoundDraft>;
  syncHole: (params: { round: LocalRoundDraft; userId: string; holeNumber: number }) => Promise<void>;
  finalizeRound: (params: { round: LocalRoundDraft; userId: string }) => Promise<void>;
};

function nowIso() {
  return new Date().toISOString();
}

function chunkKey(chunkType: RegularRoundBackendChunkType, holeNumber?: number | null) {
  return holeNumber ? `${chunkType}:${holeNumber}` : chunkType;
}

function makeChunk(spec: ChunkSpec): RegularRoundBackendSyncChunk {
  return {
    key: chunkKey(spec.chunkType, spec.holeNumber),
    chunkType: spec.chunkType,
    holeNumber: spec.holeNumber ?? null,
    status: 'pending',
    attemptCount: 0,
    lastError: null,
    updatedAt: nowIso(),
    lastAttemptAt: null,
    retryScheduledAt: null,
  };
}

function isChunkOutstanding(chunk: RegularRoundBackendSyncChunk) {
  return chunk.status !== 'synced' && chunk.status !== 'cancelled';
}

function isChunkRetryReady(chunk: RegularRoundBackendSyncChunk) {
  if (chunk.status === 'pending' || chunk.status === 'failed') return true;
  if (chunk.status === 'retry_scheduled') {
    if (!chunk.retryScheduledAt) return true;
    return new Date(chunk.retryScheduledAt).getTime() <= Date.now();
  }
  return false;
}

function derivePendingHoleNumbers(chunks: RegularRoundBackendSyncChunk[]) {
  return Array.from(new Set(
    chunks
      .filter((chunk) => isChunkOutstanding(chunk) && typeof chunk.holeNumber === 'number')
      .map((chunk) => Number(chunk.holeNumber)),
  )).sort((a, b) => a - b);
}

function countOutstandingChunks(chunks: RegularRoundBackendSyncChunk[]) {
  return chunks.filter((chunk) => isChunkOutstanding(chunk)).length;
}

function countRunnableChunks(chunks: RegularRoundBackendSyncChunk[]) {
  return chunks.filter((chunk) => isChunkRetryReady(chunk)).length;
}

function collectDrainDebugStats(chunks: RegularRoundBackendSyncChunk[]) {
  return {
    outstandingCount: chunks.filter((chunk) => isChunkOutstanding(chunk)).length,
    runnableCount: chunks.filter((chunk) => isChunkRetryReady(chunk)).length,
    syncedCount: chunks.filter((chunk) => chunk.status === 'synced').length,
    retryWaitingCount: chunks.filter((chunk) => chunk.status === 'retry_scheduled' && !isChunkRetryReady(chunk)).length,
    failedCount: chunks.filter((chunk) => chunk.status === 'failed').length,
    cancelledCount: chunks.filter((chunk) => chunk.status === 'cancelled').length,
  };
}

function debugRoundSyncDrain(params: {
  trigger: string;
  pass: number;
  round: SyncableRegularRound;
  queuedHoleNumber?: number | null;
  processedChunkKeys?: string[];
}) {
  if (!__DEV__) return;
  const chunks = params.round.regularRoundBackendSync?.chunks ?? [];
  console.debug('[round-sync-drain-debug]', {
    trigger: params.trigger,
    pass: params.pass,
    roundId: params.round.id,
    queuedHoleNumber: params.queuedHoleNumber ?? null,
    ...collectDrainDebugStats(chunks),
    processedChunkKeys: params.processedChunkKeys ?? [],
  });
}

function clearActiveRoundRetryTimer(roundId: string) {
  const existingTimer = activeRoundRetryTimerByRoundId.get(roundId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    activeRoundRetryTimerByRoundId.delete(roundId);
  }
}

function scheduleActiveRoundRetryTimer(params: {
  round: LocalRoundDraft;
  userId: string;
  onUpdate?: (round: LocalRoundDraft) => void;
}) {
  const gameType = getRegularRoundBackendGameType(params.round);
  if (!gameType) {
    clearActiveRoundRetryTimer(params.round.id);
    return;
  }

  const chunks = params.round.regularRoundBackendSync?.chunks ?? [];
  const nextRetryAtMs = chunks
    .filter((chunk) => chunk.status === 'retry_scheduled')
    .map((chunk) => {
      const retryAtMs = chunk.retryScheduledAt ? new Date(chunk.retryScheduledAt).getTime() : NaN;
      return Number.isFinite(retryAtMs) ? retryAtMs : Date.now() + RETRY_DELAY_MS;
    })
    .sort((a, b) => a - b)[0];

  clearActiveRoundRetryTimer(params.round.id);

  if (!nextRetryAtMs || countOutstandingChunks(chunks) === 0) {
    return;
  }

  const delayMs = Math.max(nextRetryAtMs - Date.now(), 0);
  const timer = setTimeout(() => {
    activeRoundRetryTimerByRoundId.delete(params.round.id);
    void drainActiveRegularRoundSync({
      userId: params.userId,
      trigger: 'retry_timer',
      onUpdate: params.onUpdate,
    }).catch(() => {});
  }, delayMs);

  activeRoundRetryTimerByRoundId.set(params.round.id, timer);
}

function deriveOverallStatus(chunks: RegularRoundBackendSyncChunk[]): RegularRoundBackendSyncState['status'] {
  if (chunks.some((chunk) => chunk.status === 'failed')) return 'sync_failed';
  if (chunks.some((chunk) => chunk.status === 'retry_scheduled')) return 'retry_scheduled';
  if (chunks.some((chunk) => chunk.status === 'pending' || chunk.status === 'syncing')) return 'sync_pending';
  if (chunks.some((chunk) => chunk.status === 'cancelled')) return 'cancelled';
  return 'synced';
}

function normalizeChunks(
  round: SyncableRegularRound,
  gameType: RegularRoundBackendGameType,
): RegularRoundBackendSyncChunk[] {
  const chunks = round.regularRoundBackendSync?.chunks ?? [];
  if (chunks.length > 0) return chunks;

  const pendingHoleNumbers = round.regularRoundBackendSync?.pendingHoleNumbers ?? [];
  const specs = pendingHoleNumbers.flatMap((holeNumber) => getHoleChunkSpecs(round, gameType, holeNumber));
  return mergeQueuedChunks([], specs);
}

function mergeQueuedChunks(
  existing: RegularRoundBackendSyncChunk[],
  specs: ChunkSpec[],
): RegularRoundBackendSyncChunk[] {
  const byKey = new Map(existing.map((chunk) => [chunk.key, chunk]));

  for (const spec of specs) {
    const key = chunkKey(spec.chunkType, spec.holeNumber);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, makeChunk(spec));
      continue;
    }

    const resetToPending =
      spec.chunkType === 'round_setup'
        ? current.status === 'cancelled'
        : current.status === 'synced' || current.status === 'cancelled';

    byKey.set(key, {
      ...current,
      holeNumber: spec.holeNumber ?? current.holeNumber ?? null,
      status: resetToPending ? 'pending' : current.status,
      lastError: null,
      retryScheduledAt: null,
      updatedAt: nowIso(),
    });
  }

  return sortChunks(Array.from(byKey.values()));
}

function sortChunks(chunks: RegularRoundBackendSyncChunk[]) {
  const order: Record<RegularRoundBackendChunkType, number> = {
    round_setup: 0,
    hole_official: 1,
    hole_game: 2,
    hole_stats: 3,
    hole_mirror: 4,
    finalize_game: 5,
    finalize_round: 6,
  };

  return [...chunks].sort((a, b) => (
    order[a.chunkType] - order[b.chunkType]
    || Number(a.holeNumber ?? 0) - Number(b.holeNumber ?? 0)
    || a.key.localeCompare(b.key)
  ));
}

function applyChunksToRound<T extends SyncableRegularRound>(
  round: T,
  gameType: RegularRoundBackendGameType,
  chunks: RegularRoundBackendSyncChunk[],
  overrides?: Partial<RegularRoundBackendSyncState>,
): T {
  const status = overrides?.status ?? deriveOverallStatus(chunks);
  const nextRound: T = {
    ...round,
    regularRoundBackendSync: {
      gameType,
      status,
      pendingHoleNumbers: derivePendingHoleNumbers(chunks),
      chunks: sortChunks(chunks),
      finalizeRequested: overrides?.finalizeRequested ?? round.regularRoundBackendSync?.finalizeRequested ?? false,
      lastAttemptAt: overrides?.lastAttemptAt ?? round.regularRoundBackendSync?.lastAttemptAt ?? null,
      lastSuccessAt: overrides?.lastSuccessAt ?? round.regularRoundBackendSync?.lastSuccessAt ?? null,
      lastError: overrides?.lastError ?? round.regularRoundBackendSync?.lastError ?? null,
      retryScheduledAt: overrides?.retryScheduledAt ?? round.regularRoundBackendSync?.retryScheduledAt ?? null,
    },
  };

  return withLegacySyncFields(nextRound, gameType, status, nextRound.regularRoundBackendSync?.lastError ?? null, nowIso());
}

function updateChunkStatus(
  chunks: RegularRoundBackendSyncChunk[],
  key: string,
  updater: (chunk: RegularRoundBackendSyncChunk) => RegularRoundBackendSyncChunk,
) {
  return sortChunks(chunks.map((chunk) => (chunk.key === key ? updater(chunk) : chunk)));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isStandardRegularRound(round: SyncableRegularRound) {
  return (
    round.roundMode === 'solo'
    || (round.roundMode === 'casual_group' && (!round.groupGameMode || round.groupGameMode === 'none'))
  );
}

function getHoleChunkSpecs(
  round: SyncableRegularRound,
  gameType: RegularRoundBackendGameType,
  holeNumber: number,
): ChunkSpec[] {
  if (gameType === 'standard') {
    return [
      { chunkType: 'round_setup' },
      { chunkType: 'hole_official', holeNumber },
      ...(round.statsEnabled === false ? [] : [{ chunkType: 'hole_stats', holeNumber } satisfies ChunkSpec]),
      ...(round.roundMode === 'casual_group' ? [{ chunkType: 'hole_mirror', holeNumber } satisfies ChunkSpec] : []),
    ];
  }

  return [
    { chunkType: 'round_setup' },
    { chunkType: 'hole_game', holeNumber },
    ...(round.statsEnabled === false ? [] : [{ chunkType: 'hole_stats', holeNumber } satisfies ChunkSpec]),
  ];
}

function getFinalizeChunkSpecs(gameType: RegularRoundBackendGameType): ChunkSpec[] {
  if (gameType === 'standard') {
    return [{ chunkType: 'finalize_round' }];
  }

  return [{ chunkType: 'finalize_game' }];
}

function participantUserId(participant: GroupParticipant, scoringUserId: string) {
  if (participant.type !== 'app_user') return null;
  return participant.id === 'me' ? scoringUserId : participant.id;
}

function participantGuestProfileId(participant: GroupParticipant) {
  if (participant.type !== 'guest') return null;
  return participant.id.startsWith('guest-') ? null : participant.id;
}

function sameTextValue(a: string | null | undefined, b: string | null | undefined) {
  return String(a ?? '').trim() === String(b ?? '').trim();
}

function scoreComplete(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

async function loadStandardRoundParticipantRows(roundId: string) {
  const { data, error } = await supabase
    .from('round_participants')
    .select('id, user_id, guest_profile_id, guest_first_name, guest_last_name, participant_order, is_scorer')
    .eq('round_id', roundId)
    .order('participant_order', { ascending: true });

  if (error) throw error;
  return (data ?? []) as StandardRoundParticipantRow[];
}

async function ensureStandardRoundParticipantBindings(round: LocalRoundDraft, scoringUserId: string) {
  if (round.roundMode !== 'casual_group' || !round.group?.participants.length || !round.backendRoundId) {
    return round;
  }

  const existingRows = await loadStandardRoundParticipantRows(round.backendRoundId);
  const rowsByOrder = new Map(
    existingRows
      .filter((row) => typeof row.participant_order === 'number')
      .map((row) => [Number(row.participant_order), row]),
  );

  for (const [index, participant] of round.group.participants.entries()) {
    const participantOrder = index + 1;
    const desiredRow = {
      round_id: round.backendRoundId,
      user_id: participantUserId(participant, scoringUserId),
      guest_profile_id: participantGuestProfileId(participant),
      guest_first_name: participant.type === 'guest' ? participant.firstName : null,
      guest_last_name: participant.type === 'guest' ? participant.lastName : null,
      participant_order: participantOrder,
      is_scorer: participant.isScorekeeper === true,
    };
    const existingRow = rowsByOrder.get(participantOrder) ?? null;

    if (!existingRow) {
      const insertRes = await supabase.from('round_participants').insert(desiredRow);
      if (insertRes.error) throw insertRes.error;
      continue;
    }

    const rowNeedsUpdate =
      existingRow.user_id !== desiredRow.user_id
      || existingRow.guest_profile_id !== desiredRow.guest_profile_id
      || !sameTextValue(existingRow.guest_first_name, desiredRow.guest_first_name)
      || !sameTextValue(existingRow.guest_last_name, desiredRow.guest_last_name)
      || Number(existingRow.participant_order ?? 0) !== participantOrder
      || (existingRow.is_scorer === true) !== desiredRow.is_scorer;

    if (!rowNeedsUpdate) continue;

    const updateRes = await supabase
      .from('round_participants')
      .update({
        user_id: desiredRow.user_id,
        guest_profile_id: desiredRow.guest_profile_id,
        guest_first_name: desiredRow.guest_first_name,
        guest_last_name: desiredRow.guest_last_name,
        participant_order: desiredRow.participant_order,
        is_scorer: desiredRow.is_scorer,
      })
      .eq('id', existingRow.id);

    if (updateRes.error) throw updateRes.error;
  }

  const refreshedRows = await loadStandardRoundParticipantRows(round.backendRoundId);
  const refreshedRowsByOrder = new Map(
    refreshedRows
      .filter((row) => typeof row.participant_order === 'number')
      .map((row) => [Number(row.participant_order), row]),
  );
  const backendRoundParticipantIds: Record<string, string> = {};

  round.group.participants.forEach((participant, index) => {
    const row = refreshedRowsByOrder.get(index + 1);
    if (row?.id) backendRoundParticipantIds[participant.id] = row.id;
  });

  return {
    ...round,
    backendRoundParticipantIds,
  };
}

function getStandardHoleScoreRows(round: LocalRoundDraft, hole: HoleDraft, scoringUserId: string): StandardHoleScoreBuildResult {
  if (round.roundMode !== 'casual_group' || !round.group?.participants.length) {
    return {
      rows: scoreComplete(hole.score)
        ? [{
            participantId: scoringUserId,
            backendParticipantId: scoringUserId,
            userId: scoringUserId,
            strokes: Number(hole.score),
            playerOrder: 1,
            isScorer: true,
          }]
        : [],
      expectedPlayerCount: 1,
      skippedPlayers: scoreComplete(hole.score)
        ? []
        : [{
            participantId: scoringUserId,
            displayName: 'Player',
            reason: 'missing_score',
          }],
    };
  }

  const rows: StandardHoleScoreRow[] = [];
  const skippedPlayers: StandardHoleScoreBuildResult['skippedPlayers'] = [];

  round.group.participants.forEach((participant, index) => {
      const backendParticipantId = round.backendRoundParticipantIds?.[participant.id] ?? null;
      const userId = participantUserId(participant, scoringUserId);
      if (!backendParticipantId) {
        skippedPlayers.push({
          participantId: participant.id,
          displayName: participant.displayName,
          reason: 'missing_backend_participant_id',
        });
        return;
      }

      const participantScore = hole.groupScores?.find((entry) => entry.participantId === participant.id)?.score
        ?? (participant.id === scoringUserId || participant.id === 'me' ? hole.score : null);
      if (!scoreComplete(participantScore)) {
        skippedPlayers.push({
          participantId: participant.id,
          displayName: participant.displayName,
          reason: 'missing_score',
        });
        return;
      }

      rows.push({
        participantId: participant.id,
        backendParticipantId,
        userId,
        strokes: Number(participantScore),
        playerOrder: index + 1,
        isScorer: participant.isScorekeeper === true,
      });
  });

  return {
    rows,
    expectedPlayerCount: round.group.participants.length,
    skippedPlayers,
  };
}

export async function ensureStandardRegularBackendRound(params: {
  round: LocalRoundDraft;
  userId: string;
}) {
  const { round, userId } = params;
  if (!isStandardRegularRound(round)) return round;

  let nextRound = { ...round };

  if (!nextRound.backendRoundId) {
    const participantCount = round.roundMode === 'casual_group'
      ? Math.max(round.group?.participants.length ?? 0, 1)
      : 1;

    const roundRes = await supabase
      .from('rounds')
      .insert({
        course_name: 'Coal Creek',
        round_date: round.date || todayIsoDate(),
        tournament_id: null,
        created_by_user_id: userId,
        scoring_user_id: userId,
        round_mode: round.roundMode === 'casual_group' ? BACKEND_REGULAR_GROUP_ROUND_MODE : 'solo',
        player_count: participantCount,
        status: 'draft',
      })
      .select('id')
      .single();

    if (roundRes.error) throw roundRes.error;

    nextRound = {
      ...nextRound,
      backendRoundId: roundRes.data.id,
    };

    const playerRows =
      round.roundMode === 'casual_group' && round.group?.participants.length
        ? round.group.participants
            .filter((participant) => participant.type === 'app_user')
            .map((participant, index) => ({
              round_id: roundRes.data.id,
              user_id: participantUserId(participant, userId) ?? userId,
              player_order: index + 1,
              gross_total: 0,
              is_scorer: participant.isScorekeeper === true,
            }))
        : [{
            round_id: roundRes.data.id,
            user_id: userId,
            player_order: 1,
            gross_total: 0,
            is_scorer: true,
          }];

    const roundPlayersRes = await supabase
      .from('round_players')
      .upsert(playerRows.length > 0 ? playerRows : [{
        round_id: roundRes.data.id,
        user_id: userId,
        player_order: 1,
        gross_total: 0,
        is_scorer: true,
      }], {
        onConflict: 'round_id,user_id',
      });

    if (roundPlayersRes.error) throw roundPlayersRes.error;
  }

  nextRound = await ensureStandardRoundParticipantBindings(nextRound, userId);

  return nextRound;
}

async function refreshStandardRegularPlayerTotal(
  roundId: string,
  userId: string,
  options?: { playerOrder?: number; isScorer?: boolean },
) {
  const scoreRes = await supabase
    .from('hole_scores')
    .select('strokes')
    .eq('round_id', roundId)
    .eq('user_id', userId);

  if (scoreRes.error) throw scoreRes.error;

  const grossTotal = (scoreRes.data ?? []).reduce((sum, row: any) => sum + Number(row.strokes ?? 0), 0);
  const playerRes = await supabase
    .from('round_players')
    .upsert({
      round_id: roundId,
      user_id: userId,
      player_order: options?.playerOrder ?? 1,
      gross_total: grossTotal,
      is_scorer: options?.isScorer ?? true,
    }, {
      onConflict: 'round_id,user_id',
    });

  if (playerRes.error) throw playerRes.error;
}

async function syncStandardRegularHole(params: {
  round: LocalRoundDraft;
  userId: string;
  holeNumber: number;
}) {
  if (!params.round.backendRoundId) throw new Error('Missing backend round id.');

  const hole = params.round.holes.find((entry) => entry.hole === params.holeNumber);
  if (!hole) {
    throw new Error('Hole score is required before backend sync.');
  }

  const courseHole = holes.find((entry) => entry.hole === params.holeNumber);
  const finalizedHole = courseHole ? finalizeHoleStats(hole, courseHole.par) : hole;
  const preparedRound = params.round.roundMode === 'casual_group'
    ? await ensureStandardRoundParticipantBindings(params.round, params.userId)
    : params.round;
  const scoreBuild = getStandardHoleScoreRows(preparedRound, finalizedHole, params.userId);
  const scoreRows = scoreBuild.rows;

  if (__DEV__ && preparedRound.roundMode === 'casual_group') {
    console.debug('[standard-group-score-sync-debug]', {
      backendRoundId: params.round.backendRoundId,
      holeNumber: params.holeNumber,
      expectedPlayerCount: scoreBuild.expectedPlayerCount,
      payloadCount: scoreRows.length,
      skippedPlayers: scoreBuild.skippedPlayers,
    });
  }

  if (scoreRows.length === 0) {
    if (preparedRound.roundMode === 'casual_group') return;
    throw new Error('Hole score is required before backend sync.');
  }

  if (preparedRound.roundMode === 'casual_group' && scoreRows.length !== scoreBuild.expectedPlayerCount) {
    throw new Error(`Group hole sync payload incomplete: expected ${scoreBuild.expectedPlayerCount} score rows, built ${scoreRows.length}.`);
  }

  if (preparedRound.roundMode === 'casual_group') {
    const scoreRes = await supabase
      .from('hole_scores')
      .upsert(scoreRows.map((row) => ({
        round_id: params.round.backendRoundId,
        participant_id: row.backendParticipantId,
        user_id: row.userId,
        hole_number: params.holeNumber,
        strokes: row.strokes,
      })), {
        onConflict: 'round_id,hole_number,participant_id',
      })
      .select('id');

    if (scoreRes.error) throw scoreRes.error;

    const writtenRows = scoreRes.data?.length ?? 0;
    const success = writtenRows === scoreRows.length;
    if (__DEV__) {
      console.debug('[standard-group-score-sync-result]', {
        backendRoundId: params.round.backendRoundId,
        holeNumber: params.holeNumber,
        expectedRows: scoreRows.length,
        writtenRows,
        success,
      });
    }
    if (!success) {
      throw new Error(`Group hole sync wrote ${writtenRows} of ${scoreRows.length} expected score rows.`);
    }
  } else {
    const scoreRes = await supabase
      .from('hole_scores')
      .upsert(scoreRows.map((row) => ({
        round_id: params.round.backendRoundId,
        participant_id: null,
        user_id: row.userId,
        hole_number: params.holeNumber,
        strokes: row.strokes,
      })), {
        onConflict: 'round_id,user_id,hole_number',
      })
      .select('id');

    if (scoreRes.error) throw scoreRes.error;
    const writtenRows = scoreRes.data?.length ?? 0;
    if (writtenRows !== scoreRows.length) {
      throw new Error(`Hole sync wrote ${writtenRows} of ${scoreRows.length} expected score rows.`);
    }
  }

  for (const row of scoreRows.filter((entry) => !!entry.userId)) {
    if (!row.userId) continue;
    await refreshStandardRegularPlayerTotal(params.round.backendRoundId, row.userId, {
      playerOrder: row.playerOrder,
      isScorer: row.isScorer,
    });
  }
}

async function syncStandardRegularHoleMirror(params: {
  round: LocalRoundDraft;
  holeNumber: number;
}) {
  if (!params.round.backendRoundId || params.round.roundMode !== 'casual_group') return;

  const { error } = await supabase.rpc('sync_standard_group_participant_hole_mirror', {
    p_round_id: params.round.backendRoundId,
    p_hole_number: params.holeNumber,
  });

  if (error) throw error;
}

async function syncRegularRoundStatsHole(params: {
  round: LocalRoundDraft;
  userId: string;
  holeNumber: number;
}) {
  await persistRegularRoundLayerStatsForHole({
    round: params.round,
    userId: params.userId,
    holeNumber: params.holeNumber,
  });
}

async function finalizeStandardRegularRoundSync(params: {
  round: LocalRoundDraft;
  userId: string;
}) {
  if (!params.round.backendRoundId) throw new Error('Missing backend round id.');

  const submitRes = await supabase.rpc('submit_round', {
    p_round_id: params.round.backendRoundId,
    p_submitted_by: params.userId,
  });

  if (submitRes.error) {
    console.warn('submit_round failed', submitRes.error.message);
  }
}

const ADAPTERS: Record<RegularRoundBackendGameType, RoundSyncAdapter> = {
  standard: {
    ensureBackendRound: ensureStandardRegularBackendRound,
    syncHole: syncStandardRegularHole,
    finalizeRound: finalizeStandardRegularRoundSync,
  },
  bingo_bango_bongo: {
    ensureBackendRound: ensureBbbBackendRound,
    syncHole: async ({ round, holeNumber }) => syncBbbHole({ round, holeNumber }),
    finalizeRound: async ({ round, userId }) => finalizeBbbRoundSync({ round, userId }),
  },
  nassau: {
    ensureBackendRound: ensureNassauBackendRound,
    syncHole: async ({ round, holeNumber }) => syncNassauHole({ round, holeNumber }),
    finalizeRound: async ({ round, userId }) => finalizeNassauRoundSync({ round, userId }),
  },
  skins: {
    ensureBackendRound: ensureSkinsBackendRound,
    syncHole: async ({ round, holeNumber }) => syncSkinsHole({ round, holeNumber }),
    finalizeRound: async ({ round, userId }) => finalizeSkinsRoundSync({ round, userId }),
  },
  wolf: {
    ensureBackendRound: ensureWolfBackendRound,
    syncHole: async ({ round, holeNumber }) => syncWolfHole({ round, holeNumber }),
    finalizeRound: async ({ round, userId }) => finalizeWolfRoundSync({ round, userId }),
  },
};

function withLegacySyncFields<T extends SyncableRegularRound>(
  round: T,
  gameType: RegularRoundBackendGameType,
  status: RegularRoundBackendSyncState['status'],
  errorMessage: string | null,
  timestamp: string,
): T {
  if (gameType === 'bingo_bango_bongo') {
    return {
      ...round,
      bbbSyncState:
        status === 'synced'
          ? 'synced'
          : status === 'sync_pending' || status === 'retry_scheduled'
            ? 'syncing'
            : 'error',
      bbbLastSyncAt: status === 'synced' ? timestamp : round.bbbLastSyncAt ?? null,
      bbbLastSyncError: status === 'synced' ? null : errorMessage,
    };
  }

  if (gameType === 'standard') {
    return {
      ...round,
      backendSyncState:
        status === 'synced'
          ? 'finalized'
          : status === 'sync_pending' || status === 'retry_scheduled'
            ? 'score_only'
            : 'error',
      lastScoreSyncAt: status === 'synced' ? timestamp : round.lastScoreSyncAt ?? null,
      lastSyncError: status === 'synced' ? null : errorMessage,
    };
  }

  return {
    ...round,
    skinsSyncState:
      status === 'synced'
        ? 'synced'
        : status === 'sync_pending' || status === 'retry_scheduled'
          ? 'syncing'
          : 'error',
    skinsLastSyncAt: status === 'synced' ? timestamp : round.skinsLastSyncAt ?? null,
    skinsLastSyncError: status === 'synced' ? null : errorMessage,
  };
}

export function getRegularRoundBackendGameType(round: SyncableRegularRound): RegularRoundBackendGameType | null {
  if (isStandardRegularRound(round)) return 'standard';
  if (round.roundMode !== 'casual_group') return null;
  if (round.groupGameMode === 'bingo_bango_bongo' || round.groupGameMode === 'skins' || round.groupGameMode === 'nassau' || round.groupGameMode === 'wolf') return round.groupGameMode;
  return null;
}

export function isRegularRoundBackendSyncEnabled(round: SyncableRegularRound) {
  return !!getRegularRoundBackendGameType(round);
}

export function getRegularRoundBackendSyncState(round: SyncableRegularRound): RegularRoundBackendSyncState | null {
  return round.regularRoundBackendSync ?? null;
}

export function queueRegularRoundHoleSync<T extends SyncableRegularRound>(round: T, holeNumber: number): T {
  const gameType = getRegularRoundBackendGameType(round);
  if (!gameType) return round;
  const existingChunks = normalizeChunks(round, gameType);
  const chunkSpecs = getHoleChunkSpecs(round, gameType, holeNumber);
  const chunks = mergeQueuedChunks(existingChunks, chunkSpecs);

  if (__DEV__ && DEBUG_SYNC_CHUNKS) {
    chunkSpecs.forEach((spec) => {
      console.debug('[regular-sync] chunk_queued', {
        roundId: round.backendRoundId ?? round.id,
        roundGameId: round.backendRoundGameId ?? null,
        chunkType: spec.chunkType,
        holeNumber: spec.holeNumber ?? null,
      });
    });
  }

  return applyChunksToRound(round, gameType, chunks, {
    status: 'sync_pending',
    lastError: null,
    retryScheduledAt: null,
  });
}

export function markRegularRoundFinalizeRequested<T extends SyncableRegularRound>(round: T): T {
  const gameType = getRegularRoundBackendGameType(round);
  if (!gameType) return round;
  const existingChunks = normalizeChunks(round, gameType);
  const chunks = mergeQueuedChunks(existingChunks, getFinalizeChunkSpecs(gameType));
  return applyChunksToRound(round, gameType, chunks, {
    status: 'sync_pending',
    finalizeRequested: true,
  });
}

export function prepareRegularRoundManualRetry<T extends SyncableRegularRound>(round: T): T {
  const existing = round.regularRoundBackendSync;
  const gameType = existing?.gameType ?? getRegularRoundBackendGameType(round);
  if (!gameType) return round;

  const chunks = sortChunks((existing?.chunks ?? []).map((chunk) => (
    chunk.status === 'synced'
      ? chunk
      : {
          ...chunk,
          status: 'pending',
          lastError: null,
          retryScheduledAt: null,
          updatedAt: nowIso(),
        }
  )));

  return applyChunksToRound(round, gameType, chunks, {
    status: chunks.some((chunk) => chunk.status === 'pending' || chunk.status === 'syncing') ? 'sync_pending' : 'synced',
    finalizeRequested: existing?.finalizeRequested ?? false,
    lastError: null,
    retryScheduledAt: null,
  });
}

export function markRegularRoundSyncCancelled<T extends SyncableRegularRound>(round: T): T {
  const existing = round.regularRoundBackendSync;
  const gameType = existing?.gameType ?? getRegularRoundBackendGameType(round);
  if (!gameType) return round;
  const chunks = sortChunks((existing?.chunks ?? []).map((chunk) => (
    isChunkOutstanding(chunk)
      ? { ...chunk, status: 'cancelled', updatedAt: nowIso(), retryScheduledAt: null }
      : chunk
  )));
  return applyChunksToRound(round, gameType, chunks, {
    status: 'cancelled',
    retryScheduledAt: null,
  });
}

export function markRegularRoundSyncFailure<T extends SyncableRegularRound>(
  round: T,
  errorMessage: string,
  options?: { scheduleRetryAt?: string | null },
): T {
  const existing = round.regularRoundBackendSync;
  const gameType = existing?.gameType ?? getRegularRoundBackendGameType(round);
  if (!gameType) return round;

  const status = options?.scheduleRetryAt ? 'retry_scheduled' : 'sync_failed';
  const chunks = sortChunks((existing?.chunks ?? []).map((chunk) => (
    chunk.status === 'failed' || chunk.status === 'pending' || chunk.status === 'syncing' || chunk.status === 'retry_scheduled'
      ? {
          ...chunk,
          status: options?.scheduleRetryAt ? 'retry_scheduled' : chunk.status === 'syncing' ? 'failed' : chunk.status,
          lastError: errorMessage,
          retryScheduledAt: options?.scheduleRetryAt ?? null,
          updatedAt: nowIso(),
        }
      : chunk
  )));

  return applyChunksToRound(round, gameType, chunks, {
    status,
    lastAttemptAt: nowIso(),
    lastError: errorMessage,
    retryScheduledAt: options?.scheduleRetryAt ?? null,
  });
}

export function markRegularRoundSyncSuccess<T extends SyncableRegularRound>(
  round: T,
  options?: { syncedHoleNumber?: number | null; finalized?: boolean },
): T {
  const existing = round.regularRoundBackendSync;
  const gameType = existing?.gameType ?? getRegularRoundBackendGameType(round);
  if (!gameType) return round;
  const chunks = sortChunks(existing?.chunks ?? []);
  return applyChunksToRound(round, gameType, chunks, {
    lastAttemptAt: nowIso(),
    lastSuccessAt: nowIso(),
    lastError: null,
    retryScheduledAt: null,
    finalizeRequested: options?.finalized === true ? false : existing?.finalizeRequested === true,
  });
}

export function getRegularRoundBackendStatusLabel(round: SyncableRegularRound): string | null {
  const state = round.regularRoundBackendSync;
  if (!state && isStandardRegularRound(round) && !round.backendRoundId && 'savedAt' in round) {
    return 'Not saved to backend';
  }
  if (!state || state.status === 'synced') return null;

  if (state.status === 'sync_pending') {
    return state.finalizeRequested ? 'Finishing sync...' : 'Waiting to save to backend...';
  }
  if (state.status === 'retry_scheduled') return 'Retry scheduled';
  return 'Not saved to backend';
}

export function getRegularRoundBackendStatusDetail(round: SyncableRegularRound): string | null {
  const state = round.regularRoundBackendSync;
  if (!state && isStandardRegularRound(round) && !round.backendRoundId && 'savedAt' in round) {
    return 'This round is in History on this device only. Retry backend save when you have a connection.';
  }
  if (!state || state.status === 'synced') return null;

  if (state.status === 'retry_scheduled') {
    return state.lastError
      ? `Latest backend save failed. Retry scheduled. ${state.lastError}`
      : 'Latest backend save failed. Retry scheduled.';
  }

  if (state.status === 'sync_pending') {
    const pendingChunks = state.chunks?.filter((chunk) => isChunkOutstanding(chunk)).length ?? state.pendingHoleNumbers.length;
    return state.finalizeRequested
      ? `Finishing sync... ${pendingChunks} backend chunk${pendingChunks === 1 ? '' : 's'} remaining.`
      : `Background save is still pending. ${pendingChunks} backend chunk${pendingChunks === 1 ? '' : 's'} remaining.`;
  }

  if (state.status === 'cancelled') {
    return 'Backend sync was cancelled. Retry when you have a better connection.';
  }

  return state.lastError ?? 'This round has not been saved to the backend yet.';
}

export function shouldRetryRegularRoundSyncNow(round: SyncableRegularRound) {
  const chunks = round.regularRoundBackendSync?.chunks ?? [];
  return countRunnableChunks(chunks) > 0;
}

export async function processPendingRegularRoundSyncChunks<T extends SyncableRegularRound>(params: {
  round: T;
  userId: string;
  persist: (round: T) => Promise<void>;
  onUpdate?: (round: T) => void;
  trigger?: string;
}): Promise<T> {
  const pendingCount = countOutstandingChunks(params.round.regularRoundBackendSync?.chunks ?? []);
  if (__DEV__) {
    console.debug('[regular-round-sync] background_sync_started', {
      roundLocalId: params.round.id,
      backendRoundId: params.round.backendRoundId ?? null,
      gameType: params.round.regularRoundBackendSync?.gameType ?? getRegularRoundBackendGameType(params.round),
      pendingCount,
    });
  }

  if (!shouldRetryRegularRoundSyncNow(params.round)) {
    if (__DEV__) {
      console.debug('[regular-round-sync] background_sync_complete', {
        roundLocalId: params.round.id,
        backendRoundId: params.round.backendRoundId ?? null,
        pendingCount,
      });
    }
    return params.round;
  }

  let nextRound = params.round;
  let pass = 0;

  while (shouldRetryRegularRoundSyncNow(nextRound)) {
    pass += 1;
    debugRoundSyncDrain({
      trigger: params.trigger ?? 'process_pending',
      pass,
      round: nextRound,
    });

    let attemptResult: { round: T; processedChunkKeys: string[] };
    try {
      attemptResult = await attemptRegularRoundSyncOnce({
        round: nextRound,
        userId: params.userId,
      });
      nextRound = attemptResult.round;
    } catch (error: any) {
      const failedRound = (error?.round ?? nextRound) as T;
      const retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
      nextRound = markRegularRoundSyncFailure(
        failedRound,
        error?.message ?? 'Backend sync failed',
        { scheduleRetryAt: retryAt },
      );
      attemptResult = { round: nextRound, processedChunkKeys: [] };
    }
    params.onUpdate?.(nextRound);
    await params.persist(nextRound);

    debugRoundSyncDrain({
      trigger: params.trigger ?? 'process_pending',
      pass,
      round: nextRound,
      processedChunkKeys: attemptResult.processedChunkKeys,
    });

    if (!shouldRetryRegularRoundSyncNow(nextRound)) break;
  }

  const remainingCount = countOutstandingChunks(nextRound.regularRoundBackendSync?.chunks ?? []);
  if (__DEV__) {
    if (nextRound.regularRoundBackendSync?.status === 'sync_failed' || nextRound.regularRoundBackendSync?.status === 'retry_scheduled') {
      console.debug('[regular-round-sync] background_sync_failed_chunk', {
        roundLocalId: nextRound.id,
        backendRoundId: nextRound.backendRoundId ?? null,
        pendingCount: remainingCount,
        lastError: nextRound.regularRoundBackendSync?.lastError ?? null,
      });
    } else {
      console.debug('[regular-round-sync] background_sync_complete', {
        roundLocalId: nextRound.id,
        backendRoundId: nextRound.backendRoundId ?? null,
        pendingCount: remainingCount,
      });
    }
  }

  return nextRound;
}

export async function drainActiveRegularRoundSync(params: {
  userId: string;
  trigger: string;
  queuedHoleNumber?: number | null;
  onUpdate?: (round: LocalRoundDraft) => void;
}): Promise<LocalRoundDraft | null> {
  const initialRound = await loadDraftRound();
  if (!initialRound || !getRegularRoundBackendGameType(initialRound)) return initialRound;

  const roundId = initialRound.id;
  clearActiveRoundRetryTimer(roundId);
  const activeDrain = activeRoundDrainInFlightByRoundId.get(roundId);
  if (activeDrain) {
    activeRoundDrainQueuedByRoundId.add(roundId);
    return activeDrain;
  }

  const runDrain = async () => {
    try {
      let latestRound: LocalRoundDraft | null = initialRound;
      let pass = 0;

      for (;;) {
        activeRoundDrainQueuedByRoundId.delete(roundId);
        latestRound = await loadDraftRound();

        if (!latestRound || latestRound.id !== roundId || !getRegularRoundBackendGameType(latestRound)) {
          clearActiveRoundRetryTimer(roundId);
          return latestRound;
        }

        if (shouldRetryRegularRoundSyncNow(latestRound)) {
          pass += 1;
          latestRound = await processPendingRegularRoundSyncChunks({
            round: latestRound,
            userId: params.userId,
            trigger: params.trigger,
            onUpdate: params.onUpdate,
            persist: async (updatedRound) => {
              await saveDraftRound(updatedRound);
            },
          });

          params.onUpdate?.(latestRound);
        }

        debugRoundSyncDrain({
          trigger: params.trigger,
          pass,
          round: latestRound,
          queuedHoleNumber: params.queuedHoleNumber,
        });

        if (!activeRoundDrainQueuedByRoundId.has(roundId)) {
          scheduleActiveRoundRetryTimer({
            round: latestRound,
            userId: params.userId,
            onUpdate: params.onUpdate,
          });
          return latestRound;
        }
      }
    } finally {
      activeRoundDrainQueuedByRoundId.delete(roundId);
      activeRoundDrainInFlightByRoundId.delete(roundId);
    }
  };

  const runPromise = runDrain();
  activeRoundDrainInFlightByRoundId.set(roundId, runPromise);
  return runPromise;
}

export async function deleteRegularRoundBackendSync(round: SyncableRegularRound) {
  if (!round.backendRoundId) return;

  const res = await supabase
    .from('rounds')
    .delete()
    .eq('id', round.backendRoundId);

  if (res.error) throw res.error;
}

async function attemptRegularRoundSyncOnce<T extends SyncableRegularRound>(params: {
  round: T;
  userId: string;
}): Promise<{ round: T; processedChunkKeys: string[] }> {
  const gameType = getRegularRoundBackendGameType(params.round);
  if (!gameType) return { round: params.round, processedChunkKeys: [] };

  const adapter = ADAPTERS[gameType];
  let nextRound = applyChunksToRound(
    params.round,
    gameType,
    normalizeChunks(params.round, gameType),
    {
      status: 'sync_pending',
      lastAttemptAt: nowIso(),
      lastError: null,
      retryScheduledAt: null,
    },
  );

  const runnableChunks = (nextRound.regularRoundBackendSync?.chunks ?? [])
    .filter((chunk) => isChunkRetryReady(chunk))
    .slice(0, CHUNK_ATTEMPT_BATCH_SIZE);
  const processedChunkKeys = runnableChunks.map((chunk) => chunk.key);

  if (runnableChunks.length === 0) {
    return {
      round: applyChunksToRound(nextRound, gameType, nextRound.regularRoundBackendSync?.chunks ?? [], {
        lastSuccessAt: nowIso(),
        lastError: null,
        retryScheduledAt: null,
      }),
      processedChunkKeys,
    };
  }

  try {
    for (const chunk of runnableChunks) {
      const startTimestamp = nowIso();
      nextRound = applyChunksToRound(
        nextRound,
        gameType,
        updateChunkStatus(nextRound.regularRoundBackendSync?.chunks ?? [], chunk.key, (current) => ({
          ...current,
          status: 'syncing',
          attemptCount: current.attemptCount + 1,
          lastAttemptAt: startTimestamp,
          lastError: null,
          retryScheduledAt: null,
          updatedAt: startTimestamp,
        })),
        {
          status: 'sync_pending',
          lastAttemptAt: startTimestamp,
          lastError: null,
          retryScheduledAt: null,
        },
      );

      if (__DEV__) {
        console.debug('[regular-round-sync] chunk_sync_start', {
          roundLocalId: nextRound.id,
          backendRoundId: nextRound.backendRoundId ?? null,
          gameType,
          chunkType: chunk.chunkType,
          holeNumber: chunk.holeNumber ?? null,
          attemptCount: (nextRound.regularRoundBackendSync?.chunks ?? []).find((entry) => entry.key === chunk.key)?.attemptCount ?? null,
        });
      }

      try {
        if (chunk.chunkType === 'round_setup') {
          nextRound = await adapter.ensureBackendRound({ round: nextRound, userId: params.userId }) as T;
        } else if (chunk.chunkType === 'hole_official' && typeof chunk.holeNumber === 'number') {
          await syncStandardRegularHole({ round: nextRound, userId: params.userId, holeNumber: chunk.holeNumber });
        } else if (chunk.chunkType === 'hole_game' && typeof chunk.holeNumber === 'number') {
          await adapter.syncHole({ round: nextRound, userId: params.userId, holeNumber: chunk.holeNumber });
        } else if (chunk.chunkType === 'hole_stats' && typeof chunk.holeNumber === 'number') {
          await syncRegularRoundStatsHole({ round: nextRound, userId: params.userId, holeNumber: chunk.holeNumber });
        } else if (chunk.chunkType === 'hole_mirror' && typeof chunk.holeNumber === 'number') {
          await syncStandardRegularHoleMirror({ round: nextRound, holeNumber: chunk.holeNumber });
        } else if (chunk.chunkType === 'finalize_round') {
          await finalizeStandardRegularRoundSync({ round: nextRound, userId: params.userId });
        } else if (chunk.chunkType === 'finalize_game') {
          await adapter.finalizeRound({ round: nextRound, userId: params.userId });
        }

        nextRound = applyChunksToRound(
          nextRound,
          gameType,
          updateChunkStatus(nextRound.regularRoundBackendSync?.chunks ?? [], chunk.key, (current) => ({
            ...current,
            status: 'synced',
            lastError: null,
            retryScheduledAt: null,
            updatedAt: nowIso(),
          })),
          {
            lastSuccessAt: nowIso(),
            lastError: null,
            retryScheduledAt: null,
            finalizeRequested:
              chunk.chunkType === 'finalize_round' || chunk.chunkType === 'finalize_game'
                ? false
                : nextRound.regularRoundBackendSync?.finalizeRequested ?? false,
          },
        );

        if (__DEV__) {
          console.debug('[regular-round-sync] chunk_sync_success', {
            roundLocalId: nextRound.id,
            backendRoundId: nextRound.backendRoundId ?? null,
            gameType,
            chunkType: chunk.chunkType,
            holeNumber: chunk.holeNumber ?? null,
            pendingChunks: countOutstandingChunks(nextRound.regularRoundBackendSync?.chunks ?? []),
          });
        }
      } catch (error: any) {
        const failedAt = nowIso();
        nextRound = applyChunksToRound(
          nextRound,
          gameType,
          updateChunkStatus(nextRound.regularRoundBackendSync?.chunks ?? [], chunk.key, (current) => ({
            ...current,
            status: 'failed',
            lastError: error?.message ?? 'Backend sync failed',
            retryScheduledAt: null,
            updatedAt: failedAt,
          })),
          {
            status: 'sync_failed',
            lastAttemptAt: failedAt,
            lastError: error?.message ?? 'Backend sync failed',
            retryScheduledAt: null,
          },
        );

        if (__DEV__) {
          console.debug('[regular-round-sync] chunk_sync_failed', {
            roundLocalId: nextRound.id,
            backendRoundId: nextRound.backendRoundId ?? null,
            gameType,
            chunkType: chunk.chunkType,
            holeNumber: chunk.holeNumber ?? null,
            attemptCount: (nextRound.regularRoundBackendSync?.chunks ?? []).find((entry) => entry.key === chunk.key)?.attemptCount ?? null,
            error: error?.message ?? String(error),
          });
        }

        error.round = nextRound;
        throw error;
      }
    }
  } catch (error: any) {
    error.round = nextRound;
    throw error;
  }

  return { round: nextRound, processedChunkKeys };
}

export async function retryRegularRoundSyncIfNeeded<T extends SyncableRegularRound>(params: {
  round: T;
  userId: string;
}): Promise<T> {
  if (!shouldRetryRegularRoundSyncNow(params.round)) return params.round;

  try {
    return (await attemptRegularRoundSyncOnce(params)).round;
  } catch (error: any) {
    const failedRound = (error?.round ?? params.round) as T;
    const retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
    const nextRound = markRegularRoundSyncFailure(
      failedRound,
      error?.message ?? 'Backend sync failed',
      { scheduleRetryAt: retryAt },
    );
    if (__DEV__) {
      console.debug('[regular-round-sync] final_sync_incomplete', {
        roundLocalId: nextRound.id,
        backendRoundId: nextRound.backendRoundId ?? null,
        pendingChunks: countOutstandingChunks(nextRound.regularRoundBackendSync?.chunks ?? []),
        retryAt,
      });
    }
    return nextRound;
  }
}

async function waitForRetryWindow(shouldCancel?: () => boolean) {
  const start = Date.now();
  while (Date.now() - start < RETRY_DELAY_MS) {
    if (shouldCancel?.()) return false;
    await new Promise((resolve) => setTimeout(resolve, CANCEL_POLL_MS));
  }
  return true;
}

export async function runRegularRoundFinalSyncLoop<T extends SyncableRegularRound>(params: {
  round: T;
  userId: string;
  persist: (round: T) => Promise<void>;
  onUpdate?: (round: T) => void;
  shouldCancel?: () => boolean;
}): Promise<{ round: T; synced: boolean; cancelled: boolean }> {
  let nextRound = markRegularRoundFinalizeRequested(params.round);
  params.onUpdate?.(nextRound);
  await params.persist(nextRound);

  for (;;) {
    for (let attempt = 0; attempt < FINAL_SYNC_BATCH_SIZE; attempt += 1) {
      if (params.shouldCancel?.()) {
        nextRound = markRegularRoundSyncCancelled(nextRound);
        params.onUpdate?.(nextRound);
        await params.persist(nextRound);
        return { round: nextRound, synced: false, cancelled: true };
      }

      try {
        nextRound = (await attemptRegularRoundSyncOnce({
          round: nextRound,
          userId: params.userId,
        })).round;
        params.onUpdate?.(nextRound);
        await params.persist(nextRound);
        if (__DEV__) {
          console.debug('[regular-round-sync] final_sync_complete', {
            roundLocalId: nextRound.id,
            backendRoundId: nextRound.backendRoundId ?? null,
            pendingChunks: countOutstandingChunks(nextRound.regularRoundBackendSync?.chunks ?? []),
          });
        }
        if (countOutstandingChunks(nextRound.regularRoundBackendSync?.chunks ?? []) === 0) {
          return { round: nextRound, synced: true, cancelled: false };
        }
      } catch (error: any) {
        nextRound = (error?.round ?? nextRound) as T;
        nextRound = markRegularRoundSyncFailure(
          nextRound,
          error?.message ?? 'Backend sync failed',
        );
        params.onUpdate?.(nextRound);
        await params.persist(nextRound);
      }
    }

    const retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
    nextRound = markRegularRoundSyncFailure(
      nextRound,
      nextRound.regularRoundBackendSync?.lastError ?? 'Backend sync failed',
      { scheduleRetryAt: retryAt },
    );
    params.onUpdate?.(nextRound);
    await params.persist(nextRound);

    if (__DEV__) {
      console.debug('[regular-round-sync] final_sync_incomplete', {
        roundLocalId: nextRound.id,
        backendRoundId: nextRound.backendRoundId ?? null,
        pendingChunks: countOutstandingChunks(nextRound.regularRoundBackendSync?.chunks ?? []),
        retryAt,
      });
    }

    const shouldContinue = await waitForRetryWindow(params.shouldCancel);
    if (!shouldContinue) {
      nextRound = markRegularRoundSyncCancelled(nextRound);
      params.onUpdate?.(nextRound);
      await params.persist(nextRound);
      return { round: nextRound, synced: false, cancelled: true };
    }
  }
}
