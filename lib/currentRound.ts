import { deleteBbbRoundSync } from '@/lib/bbbBackend';
import { clearDraftRound } from '@/lib/localRound';
import { deleteNassauRoundSync } from '@/lib/nassauBackend';
import { deleteRegularRoundBackendSync } from '@/lib/regularRoundBackendSync';
import { deleteSkinsRoundSync } from '@/lib/skinsBackend';
import type { LocalRoundDraft } from '@/types/round';

export type DeleteCurrentRoundResult = {
  backendCleanupError?: string | null;
};

export type ActiveLiveBoardRoute = {
  route: string;
  label: 'Live Board';
};

export function isLiveSoloRound(round: LocalRoundDraft | null | undefined) {
  return round?.roundMode === 'solo';
}

export function resolveActiveLiveBoardRoute(round: LocalRoundDraft | null | undefined): ActiveLiveBoardRoute | null {
  if (!round) return null;

  if (round.roundMode === 'tournament') {
    return round.tournamentId
      ? { route: `/tournament/${round.tournamentId}/live`, label: 'Live Board' }
      : null;
  }

  if (round.roundMode === 'casual_group') {
    if (round.groupGameMode === 'bingo_bango_bongo') {
      return { route: '/round/bbb-live', label: 'Live Board' };
    }
    if (round.groupGameMode === 'skins') {
      return { route: '/round/skins-live', label: 'Live Board' };
    }
    if (round.groupGameMode === 'nassau') {
      return { route: '/round/nassau-live', label: 'Live Board' };
    }
    if (round.groupGameMode === 'wolf') {
      return { route: '/round/wolf-live', label: 'Live Board' };
    }
    return { route: '/round/live', label: 'Live Board' };
  }

  if (round.roundMode === 'solo') {
    return { route: '/round/live', label: 'Live Board' };
  }

  return null;
}

export function describeCurrentRound(round: LocalRoundDraft) {
  if (round.roundMode === 'casual_group' && round.groupGameMode === 'bingo_bango_bongo') {
    return 'in-progress Bingo Bango Bongo round';
  }

  if (round.roundMode === 'casual_group' && round.groupGameMode === 'skins') {
    return 'in-progress Skins round';
  }

  if (round.roundMode === 'casual_group' && round.groupGameMode === 'nassau') {
    return 'in-progress Nassau round';
  }

  if (round.roundMode === 'casual_group' && round.groupGameMode === 'wolf') {
    return 'in-progress Wolf round';
  }

  if (round.roundMode === 'casual_group') {
    return 'in-progress group round';
  }

  return 'in-progress round';
}

export function getDeleteCurrentRoundMessage(round: LocalRoundDraft) {
  if (isLiveSoloRound(round)) {
    return 'This will remove the active live solo round from this device and try to remove its backend draft too if one was already created.';
  }

  if (round.roundMode === 'casual_group' && round.groupGameMode === 'bingo_bango_bongo') {
    return 'This deletes the in-progress Bingo Bango Bongo round from this device. If a backend draft already exists, the app will try to remove that too.';
  }

  if (round.roundMode === 'casual_group' && round.groupGameMode === 'skins') {
    return 'This deletes the in-progress Skins round from this device. If a backend draft already exists, the app will try to remove that too.';
  }

  if (round.roundMode === 'casual_group' && round.groupGameMode === 'nassau') {
    return 'This deletes the in-progress Nassau round from this device. If a backend draft already exists, the app will try to remove that too.';
  }

  if (round.roundMode === 'casual_group' && round.groupGameMode === 'wolf') {
    return 'This deletes the in-progress Wolf round from this device. If a backend draft already exists, the app will try to remove that too.';
  }

  return 'This deletes the current in-progress round from this device. If a backend draft already exists, the app will try to remove that too.';
}

export function getDeleteCurrentRoundTitle(round: LocalRoundDraft) {
  if (isLiveSoloRound(round)) return 'Delete this live solo round?';
  return 'Delete current round?';
}

export function getDeleteCurrentRoundButtonLabel(round: LocalRoundDraft) {
  if (isLiveSoloRound(round)) return 'Delete Live Solo Round';
  return 'Delete Current Round';
}

export function getDeleteCurrentRoundConfirmLabel(round: LocalRoundDraft) {
  if (isLiveSoloRound(round)) return 'Delete Solo Round';
  return 'Delete Round';
}

export async function deleteCurrentRound(round: LocalRoundDraft): Promise<DeleteCurrentRoundResult> {
  let backendCleanupError: string | null = null;

  if (round.backendRoundId && round.roundMode !== 'tournament') {
    try {
      if (round.groupGameMode === 'bingo_bango_bongo') {
        await deleteBbbRoundSync({ round });
      } else if (round.groupGameMode === 'skins') {
        await deleteSkinsRoundSync({ round });
      } else if (round.groupGameMode === 'nassau') {
        await deleteNassauRoundSync({ round });
      } else {
        await deleteRegularRoundBackendSync(round);
      }
    } catch (error: any) {
      console.error(error?.message ?? 'Delete round backend cleanup failed');
      backendCleanupError = error?.message ?? 'Backend cleanup failed.';
    }
  }

  await clearDraftRound();

  console.info('[solo-live-round-delete-debug]', {
    roundId: round.id,
    backendRoundId: round.backendRoundId ?? null,
    completedHoleCount: round.holes.filter((hole) => typeof hole.score === 'number' && hole.score > 0).length,
    deleteLocalSuccess: true,
    deleteBackendSuccess: !backendCleanupError,
    error: backendCleanupError,
  });

  return {
    backendCleanupError,
  };
}

export async function deleteLiveSoloRound(round: LocalRoundDraft): Promise<DeleteCurrentRoundResult> {
  let backendCleanupError: string | null = null;

  if (round.backendRoundId) {
    try {
      await deleteRegularRoundBackendSync(round);
    } catch (error: any) {
      console.error(error?.message ?? 'Delete live solo round backend cleanup failed');
      backendCleanupError = error?.message ?? 'Backend cleanup failed.';
    }
  }

  if (backendCleanupError) {
    console.info('[solo-live-round-delete-debug]', {
      roundId: round.id,
      backendRoundId: round.backendRoundId ?? null,
      completedHoleCount: round.holes.filter((hole) => typeof hole.score === 'number' && hole.score > 0).length,
      deleteLocalSuccess: false,
      deleteBackendSuccess: false,
      error: backendCleanupError,
    });
    return {
      backendCleanupError,
    };
  }

  await clearDraftRound();

  console.info('[solo-live-round-delete-debug]', {
    roundId: round.id,
    backendRoundId: round.backendRoundId ?? null,
    completedHoleCount: round.holes.filter((hole) => typeof hole.score === 'number' && hole.score > 0).length,
    deleteLocalSuccess: true,
    deleteBackendSuccess: true,
    error: null,
  });

  return {
    backendCleanupError: null,
  };
}
