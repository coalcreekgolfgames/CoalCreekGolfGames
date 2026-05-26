import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MyRoundHistoryRow } from '@/lib/historyBackend';
import type { GroupParticipant, LocalRoundDraft, SavedRound } from '@/types/round';

const KEYS = {
  liveRound: 'cc-expo-live-round',
  roundHistory: 'cc-expo-round-history',
  recentGuests: 'cc-expo-recent-guests',
};

type DraftRoundListener = (round: LocalRoundDraft | null) => void;

const draftRoundListeners = new Set<DraftRoundListener>();

function emitDraftRoundChange(round: LocalRoundDraft | null) {
  draftRoundListeners.forEach((listener) => {
    try {
      listener(round);
    } catch (error) {
      console.error('draft round listener failed', error);
    }
  });
}

export function subscribeDraftRound(listener: DraftRoundListener) {
  draftRoundListeners.add(listener);
  return () => {
    draftRoundListeners.delete(listener);
  };
}

export async function loadDraftRound(): Promise<LocalRoundDraft | null> {
  const raw = await AsyncStorage.getItem(KEYS.liveRound);
  return raw ? JSON.parse(raw) : null;
}

export async function saveDraftRound(round: LocalRoundDraft) {
  await AsyncStorage.setItem(KEYS.liveRound, JSON.stringify(round));
  emitDraftRoundChange(round);
}

export async function clearDraftRound() {
  await AsyncStorage.removeItem(KEYS.liveRound);
  emitDraftRoundChange(null);
}

export async function loadRoundHistory(): Promise<SavedRound[]> {
  const raw = await AsyncStorage.getItem(KEYS.roundHistory);
  return raw ? JSON.parse(raw) : [];
}

async function saveRoundHistory(rounds: SavedRound[]) {
  await AsyncStorage.setItem(KEYS.roundHistory, JSON.stringify(rounds));
}

export type LocalRoundCleanupSummary = {
  checkedCount: number;
  removedCount: number;
  keptUnsyncedCount: number;
  skippedActiveCount: number;
};

type LocalRoundCleanupParams = {
  localRounds?: SavedRound[];
  activeRound?: LocalRoundDraft | null;
};

type LocalRoundReconcileParams = LocalRoundCleanupParams & {
  backendRows: MyRoundHistoryRow[];
};

export type LiveRoundVisibilityState = {
  activeRound: LocalRoundDraft | null;
  staleRound: LocalRoundDraft | null;
  hiddenReason: string | null;
};

type RoundProgressState = Pick<
  LocalRoundDraft,
  | 'id'
  | 'currentHole'
  | 'holes'
  | 'holeSequence'
  | 'tournamentHoleCount'
  | 'backendRoundId'
  | 'backendRoundGameId'
  | 'backendSyncState'
  | 'regularRoundBackendSync'
  | 'pendingScoreSyncs'
  | 'bbbSyncState'
  | 'skinsSyncState'
> & Partial<Pick<SavedRound, 'savedAt'>>;

export function getIntendedHoleCount(round: RoundProgressState) {
  if (typeof round.tournamentHoleCount === 'number' && round.tournamentHoleCount > 0) {
    return round.tournamentHoleCount;
  }

  if (Array.isArray(round.holeSequence) && round.holeSequence.length > 0) {
    return round.holeSequence.length;
  }

  return round.holes.length;
}

export function getCompletedHoleCount(round: RoundProgressState) {
  return round.holes.filter((hole) => {
    if (typeof hole.score === 'number' && hole.score > 0) return true;
    return (hole.groupScores ?? []).some((entry) => typeof entry.score === 'number' && entry.score > 0);
  }).length;
}

export function getSavedHoleNumbers(round: RoundProgressState) {
  return round.holes
    .filter((hole) => {
      if (typeof hole.score === 'number' && hole.score > 0) return true;
      return (hole.groupScores ?? []).some((entry) => typeof entry.score === 'number' && entry.score > 0);
    })
    .map((hole) => hole.hole)
    .filter((holeNumber) => Number.isInteger(holeNumber))
    .sort((a, b) => a - b);
}

export function getGrossFromSavedHoles(round: RoundProgressState) {
  return round.holes.reduce((sum, hole) => {
    if (typeof hole.score === 'number' && hole.score > 0) {
      return sum + Number(hole.score);
    }
    return sum;
  }, 0);
}

function isSavedRoundFinished(round: SavedRound) {
  if (!round.savedAt) return false;
  const intendedHoleCount = getIntendedHoleCount(round);
  const completedHoleCount = getCompletedHoleCount(round);
  return completedHoleCount > 0 && completedHoleCount >= intendedHoleCount;
}

function matchesActiveRound(round: SavedRound, activeRound: LocalRoundDraft | null) {
  if (!activeRound) return false;
  if (round.id === activeRound.id) return true;
  if (round.backendRoundId && activeRound.backendRoundId && round.backendRoundId === activeRound.backendRoundId) return true;
  if (
    round.backendRoundGameId
    && activeRound.backendRoundGameId
    && round.backendRoundGameId === activeRound.backendRoundGameId
  ) {
    return true;
  }
  return false;
}

export function hasOutstandingSyncWork(round: RoundProgressState) {
  if ((round.pendingScoreSyncs ?? []).length > 0) return true;

  const regularSync = round.regularRoundBackendSync;
  if (regularSync && regularSync.status !== 'synced') return true;
  if ((regularSync?.chunks ?? []).some((chunk) => chunk.status !== 'synced')) return true;

  if (round.backendSyncState === 'score_only' || round.backendSyncState === 'finalizing' || round.backendSyncState === 'error') {
    return true;
  }

  if (round.bbbSyncState && round.bbbSyncState !== 'synced') return true;
  if (round.skinsSyncState && round.skinsSyncState !== 'synced') return true;

  return false;
}

function roundExistsInHistory(round: RoundProgressState, history: SavedRound[]) {
  return history.some((entry) => {
    if (entry.id === round.id) return true;
    if (entry.backendRoundId && round.backendRoundId && entry.backendRoundId === round.backendRoundId) return true;
    if (
      entry.backendRoundGameId
      && round.backendRoundGameId
      && entry.backendRoundGameId === round.backendRoundGameId
    ) {
      return true;
    }
    return false;
  });
}

function activeRoundStatus(round: RoundProgressState, completedHoleCount: number, intendedHoleCount: number) {
  const savedAt = 'savedAt' in round ? round.savedAt : null;
  if (savedAt) return 'completed';
  if (completedHoleCount >= intendedHoleCount && intendedHoleCount > 0) return 'completed';
  return 'active';
}

export function filterActiveDraftRound(
  round: LocalRoundDraft | null,
  history: SavedRound[] = [],
): {
  round: LocalRoundDraft | null;
  hiddenReason: string | null;
  shouldClearDraftPointer: boolean;
} {
  if (!round) {
    return {
      round: null,
      hiddenReason: null,
      shouldClearDraftPointer: false,
    };
  }

  const intendedHoleCount = getIntendedHoleCount(round);
  const completedHoleCount = getCompletedHoleCount(round);
  const historyMatch = roundExistsInHistory(round, history);
  const hasPendingSync = hasOutstandingSyncWork(round);
  const completed = completedHoleCount >= intendedHoleCount && intendedHoleCount > 0;
  const savedAt = 'savedAt' in round ? round.savedAt : null;

  let hiddenReason: string | null = null;
  if (historyMatch) {
    hiddenReason = 'already_in_history';
  } else if (savedAt) {
    hiddenReason = 'saved_at_present';
  } else if (completed) {
    hiddenReason = hasPendingSync ? 'completed_pending_sync' : 'completed';
  }

  if (__DEV__ && hiddenReason) {
    console.debug('[active-live-round-filter-debug]', {
      roundId: round.id,
      backendRoundId: round.backendRoundId ?? null,
      status: activeRoundStatus(round, completedHoleCount, intendedHoleCount),
      completedAt: savedAt ?? null,
      finishedAt: savedAt ?? null,
      completedHoleCount,
      hasPendingSync,
      hiddenReason,
    });
  }

  return {
    round: hiddenReason ? null : round,
    hiddenReason,
    shouldClearDraftPointer: !!hiddenReason && historyMatch,
  };
}

export async function loadActiveDraftRound(): Promise<LocalRoundDraft | null> {
  const [round, history] = await Promise.all([loadDraftRound(), loadRoundHistory()]);
  const result = filterActiveDraftRound(round, history);

  if (result.shouldClearDraftPointer) {
    await clearDraftRound();
  }

  return result.round;
}

export async function loadLiveRoundVisibilityState(): Promise<LiveRoundVisibilityState> {
  const [round, history] = await Promise.all([loadDraftRound(), loadRoundHistory()]);
  const result = filterActiveDraftRound(round, history);
  const completedHoleCount = round ? getCompletedHoleCount(round) : 0;
  const savedHoleNumbers = round ? getSavedHoleNumbers(round) : [];
  const grossFromSavedHoles = round ? getGrossFromSavedHoles(round) : 0;

  if (__DEV__ && round) {
    console.debug('[solo-live-round-filter-debug]', {
      roundId: round.id,
      status: result.hiddenReason ? 'hidden' : 'active',
      completedHoleCount,
      savedHoleNumbers,
      grossFromSavedHoles,
      projectedParScoreWasUsed: false,
      hiddenReason: result.hiddenReason,
      shownOnLiveRound: !result.hiddenReason,
      shownOnLiveBoard: !result.hiddenReason,
    });
  }

  return {
    activeRound: result.round,
    staleRound: result.hiddenReason ? round : null,
    hiddenReason: result.hiddenReason,
  };
}

async function resolveCleanupContext(params: LocalRoundCleanupParams) {
  const [localRounds, activeRound] = await Promise.all([
    params.localRounds ? Promise.resolve(params.localRounds) : loadRoundHistory(),
    params.activeRound !== undefined ? Promise.resolve(params.activeRound) : loadDraftRound(),
  ]);

  return {
    localRounds,
    activeRound,
  };
}

export async function reconcileLocalRoundsWithBackend(
  params: LocalRoundReconcileParams,
): Promise<LocalRoundCleanupSummary> {
  const { localRounds, activeRound } = await resolveCleanupContext(params);
  const backendRoundIds = new Set(
    params.backendRows
      .map((row) => row.roundId ?? row.round_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const backendRoundGameIds = new Set(
    params.backendRows
      .map((row) => row.roundGameId ?? row.round_game_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );

  const summary: LocalRoundCleanupSummary = {
    checkedCount: localRounds.length,
    removedCount: 0,
    keptUnsyncedCount: 0,
    skippedActiveCount: 0,
  };

  const nextRounds = localRounds.filter((round) => {
    if (matchesActiveRound(round, activeRound)) {
      summary.skippedActiveCount += 1;
      return true;
    }

    if (!isSavedRoundFinished(round)) {
      return true;
    }

    if (hasOutstandingSyncWork(round)) {
      summary.keptUnsyncedCount += 1;
      return true;
    }

    const missingBackendRound =
      typeof round.backendRoundId === 'string'
      && round.backendRoundId.length > 0
      && !backendRoundIds.has(round.backendRoundId);
    const missingBackendRoundGame =
      typeof round.backendRoundGameId === 'string'
      && round.backendRoundGameId.length > 0
      && !backendRoundGameIds.has(round.backendRoundGameId);

    if (!missingBackendRound && !missingBackendRoundGame) {
      return true;
    }

    summary.removedCount += 1;
    return false;
  });

  if (summary.removedCount > 0) {
    await saveRoundHistory(nextRounds);
  }

  return summary;
}

export async function clearLocalOnlyTestRounds(
  params: LocalRoundCleanupParams = {},
): Promise<LocalRoundCleanupSummary> {
  const { localRounds, activeRound } = await resolveCleanupContext(params);
  const summary: LocalRoundCleanupSummary = {
    checkedCount: localRounds.length,
    removedCount: 0,
    keptUnsyncedCount: 0,
    skippedActiveCount: 0,
  };

  const nextRounds = localRounds.filter((round) => {
    if (matchesActiveRound(round, activeRound)) {
      summary.skippedActiveCount += 1;
      return true;
    }

    if (!isSavedRoundFinished(round)) {
      return true;
    }

    if (hasOutstandingSyncWork(round)) {
      summary.keptUnsyncedCount += 1;
      return true;
    }

    if (round.backendRoundId || round.backendRoundGameId) {
      return true;
    }

    summary.removedCount += 1;
    return false;
  });

  if (summary.removedCount > 0) {
    await saveRoundHistory(nextRounds);
  }

  return summary;
}

export async function loadRecentGuests(): Promise<GroupParticipant[]> {
  const raw = await AsyncStorage.getItem(KEYS.recentGuests);
  return raw ? JSON.parse(raw) : [];
}

export async function saveRecentGuests(guests: GroupParticipant[]) {
  await AsyncStorage.setItem(KEYS.recentGuests, JSON.stringify(guests));
}

function dedupeGuests(guests: GroupParticipant[]) {
  const map = new Map<string, GroupParticipant>();

  guests.forEach((guest) => {
    const key = `${guest.firstName.trim().toLowerCase()}::${guest.lastName.trim().toLowerCase()}`;
    if (!guest.firstName.trim() || !guest.lastName.trim()) return;
    if (!map.has(key)) map.set(key, guest);
  });

  return Array.from(map.values());
}

export async function saveCompletedRound(round: SavedRound) {
  const history = await loadRoundHistory();
  const next = [round, ...history.filter((entry) => entry.id !== round.id)];
  await saveRoundHistory(next);

  const guestParticipants =
    round.group?.participants?.filter((participant) => participant.type === 'guest') ?? [];

  if (guestParticipants.length > 0) {
    const existing = await loadRecentGuests();
    const recent = dedupeGuests([...guestParticipants, ...existing]).slice(0, 12);
    await saveRecentGuests(recent);
  }

  await clearDraftRound();
}

export async function updateSavedRound(
  roundId: string,
  updater: (round: SavedRound) => SavedRound,
) {
  const history = await loadRoundHistory();
  const next = history.map((entry) => (entry.id === roundId ? updater(entry) : entry));
  await saveRoundHistory(next);
  return next.find((entry) => entry.id === roundId) ?? null;
}
