import type { LocalRoundDraft } from '@/types/round';
import { getGroupRoundOfficialScoringGuard } from '@/lib/groupRoundCompanions';

export type GroupRoundPrimaryEntryDecision = {
  status: 'official' | 'companion' | 'loading' | 'unavailable';
  label: string;
  route: string | null;
  message?: string | null;
};

export async function getGroupRoundPrimaryEntryDecision(params: {
  round: LocalRoundDraft | null | undefined;
  userId?: string | null;
  authLoading?: boolean;
}): Promise<GroupRoundPrimaryEntryDecision> {
  const { round, userId, authLoading } = params;

  const logDecision = (event: string, payload: Record<string, unknown>) => {
    if (!__DEV__) return;
    console.debug(`[group-round-entry] ${event}`, payload);
  };

  if (!round || round.roundMode !== 'casual_group' || !round.backendRoundId) {
    logDecision('default_official', {
      roundId: round?.id ?? null,
      roundMode: round?.roundMode ?? null,
      backendRoundId: round?.backendRoundId ?? null,
      userId: userId ?? null,
    });
    return {
      status: 'official',
      label: 'Continue Hole',
      route: null,
      message: null,
    };
  }

  const guard = await getGroupRoundOfficialScoringGuard({
    round,
    userId,
    authLoading,
  });

  if (guard.status === 'loading') {
    logDecision('loading', {
      roundId: round.id,
      backendRoundId: round.backendRoundId,
      userId: userId ?? null,
      message: guard.message ?? null,
    });
    return {
      status: 'loading',
      label: 'Checking round access...',
      route: null,
      message: guard.message ?? null,
    };
  }

  if (guard.status === 'allow_official') {
    logDecision('official', {
      roundId: round.id,
      backendRoundId: round.backendRoundId,
      userId: userId ?? null,
    });
    return {
      status: 'official',
      label: 'Continue Hole',
      route: null,
      message: null,
    };
  }

  if (guard.status === 'redirect_companion' && guard.redirectRoute) {
    logDecision('companion', {
      roundId: round.id,
      backendRoundId: round.backendRoundId,
      userId: userId ?? null,
      route: guard.redirectRoute,
    });
    return {
      status: 'companion',
      label: 'Join Round',
      route: guard.redirectRoute,
      message: null,
    };
  }

  logDecision('unavailable', {
    roundId: round.id,
    backendRoundId: round.backendRoundId,
    userId: userId ?? null,
    message: guard.message ?? null,
  });
  return {
    status: 'unavailable',
    label: 'Round Unavailable',
    route: null,
    message: guard.message ?? 'This shared group round is unavailable for this account.',
  };
}
