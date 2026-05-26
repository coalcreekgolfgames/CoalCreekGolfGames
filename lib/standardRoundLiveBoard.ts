import type { LocalRoundDraft } from '@/types/round';

export type StandardRoundLiveBoardRow = {
  participantId: string;
  displayName: string;
  grossTotal: number;
  holesCompleted: number;
  standingRank: number;
};

function completedScore(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function isStandardLiveBoardRound(round: LocalRoundDraft | null | undefined) {
  return round?.roundMode === 'solo'
    || (round?.roundMode === 'casual_group' && (!round.groupGameMode || round.groupGameMode === 'none'));
}

export function buildStandardRoundLiveBoardRows(
  round: LocalRoundDraft,
  currentUserDisplayName = 'You',
): StandardRoundLiveBoardRow[] {
  if (round.roundMode === 'solo') {
    const completedHoles = round.holes.filter((hole) => completedScore(hole.score));
    return [{
      participantId: 'solo',
      displayName: currentUserDisplayName,
      grossTotal: completedHoles.reduce((sum, hole) => sum + Number(hole.score ?? 0), 0),
      holesCompleted: completedHoles.length,
      standingRank: 1,
    }];
  }

  const participants = round.group?.participants ?? [];
  const rows = participants.map((participant) => {
    let grossTotal = 0;
    let holesCompleted = 0;

    round.holes.forEach((hole) => {
      const score = hole.groupScores?.find((entry) => entry.participantId === participant.id)?.score
        ?? (participant.type === 'app_user' ? hole.score : null);
      if (!completedScore(score)) return;
      grossTotal += score;
      holesCompleted += 1;
    });

    return {
      participantId: participant.id,
      displayName: participant.displayName,
      grossTotal,
      holesCompleted,
      standingRank: 0,
    };
  });

  return rows
    .sort((a, b) =>
      a.grossTotal - b.grossTotal
      || b.holesCompleted - a.holesCompleted
      || a.displayName.localeCompare(b.displayName),
    )
    .map((row, index) => ({ ...row, standingRank: index + 1 }));
}
