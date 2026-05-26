import { ensureGroupScoresForHole } from '@/lib/bingoBangoBongo';
import { calculateGameSettlement, type GameSettlement } from '@/lib/settlements';
import type { GroupParticipant, HoleDraft, LocalRoundDraft } from '@/types/round';

export type SkinsHoleResult = {
  winnerParticipantId: string | null;
  winningScore: number | null;
  isPush: boolean;
  carryoverSkinCount: number;
  awardedSkinCount: number;
};

export type SkinsTotalsRow = {
  participantId: string;
  displayName: string;
  seatOrder: number;
  skinsWon: number;
  totalSkinCountWon: number;
  grossTotal: number;
  standingRank: number;
};

export type SkinsPayoutSummary = {
  buyInCents: number;
  activePlayerCount: number;
  totalPotCents: number;
  totalAwardedSkinCount: number;
  unresolvedFinalCarryoverSkinCount: number;
  skinsPuttOffWinnerId: string | null;
  skinsPuttOffAwardedCount: number | null;
  skinsPuttOffResolvedAt: string | null;
  perSkinValueCents: number | null;
  settlement: GameSettlement | null;
};

export type SkinsHoleSummary = SkinsHoleResult & {
  holeNumber: number;
  scores: Array<{
    participantId: string;
    displayName: string;
    score: number | null;
  }>;
  isComplete: boolean;
};

export function isSkinsRound(round: LocalRoundDraft | null | undefined) {
  return round?.roundMode === 'casual_group' && round?.groupGameMode === 'skins';
}

export function resolveSkinsHole(
  scores: Array<{ participantId: string; score: number | null | undefined }>,
  carryoverSkinCount: number,
): SkinsHoleResult | null {
  const validScores = scores.filter((entry) => typeof entry.score === 'number' && entry.score > 0);
  if (validScores.length !== scores.length || validScores.length === 0) return null;

  const winningScore = Math.min(...validScores.map((entry) => Number(entry.score)));
  const tiedLowScores = validScores.filter((entry) => Number(entry.score) === winningScore);

  if (tiedLowScores.length === 1) {
    return {
      winnerParticipantId: tiedLowScores[0]?.participantId ?? null,
      winningScore,
      isPush: false,
      carryoverSkinCount,
      awardedSkinCount: carryoverSkinCount,
    };
  }

  return {
    winnerParticipantId: null,
    winningScore,
    isPush: true,
    carryoverSkinCount,
    awardedSkinCount: 0,
  };
}

function getStoredOrDerivedSkinsHole(
  hole: HoleDraft,
  participants: GroupParticipant[],
  carryoverSkinCount: number,
): SkinsHoleSummary {
  const scores = ensureGroupScoresForHole(hole, participants).map((entry) => ({
    participantId: entry.participantId,
    displayName: participants.find((participant) => participant.id === entry.participantId)?.displayName ?? 'Player',
    score: entry.score ?? null,
  }));

  const isComplete = scores.every((entry) => typeof entry.score === 'number' && entry.score > 0);
  const derived = isComplete
    ? resolveSkinsHole(scores.map((entry) => ({ participantId: entry.participantId, score: entry.score })), carryoverSkinCount)
    : null;

  return {
    holeNumber: hole.hole,
    scores,
    isComplete,
    winnerParticipantId: hole.skinsWinnerId ?? derived?.winnerParticipantId ?? null,
    winningScore: hole.skinsWinningScore ?? derived?.winningScore ?? null,
    isPush: hole.skinsIsPush ?? derived?.isPush ?? false,
    carryoverSkinCount: hole.skinsCarryoverCount ?? derived?.carryoverSkinCount ?? carryoverSkinCount,
    awardedSkinCount: hole.skinsAwardedCount ?? derived?.awardedSkinCount ?? 0,
  };
}

export function getSkinsCarryoverForHole(round: LocalRoundDraft, holeNumber: number) {
  const participants = round.group?.participants ?? [];
  let carryover = 1;

  for (const hole of [...round.holes].sort((a, b) => a.hole - b.hole)) {
    if (hole.hole >= holeNumber) break;
    const summary = getStoredOrDerivedSkinsHole(hole, participants, carryover);
    if (!summary.isComplete) break;
    carryover = summary.isPush ? carryover + 1 : 1;
  }

  return carryover;
}

export function summarizeSkins(round: LocalRoundDraft) {
  const participants = round.group?.participants ?? [];
  const totals = new Map<string, Omit<SkinsTotalsRow, 'standingRank'>>();

  participants.forEach((participant, index) => {
    totals.set(participant.id, {
      participantId: participant.id,
      displayName: participant.displayName,
      seatOrder: index + 1,
      skinsWon: 0,
      totalSkinCountWon: 0,
      grossTotal: 0,
    });
  });

  let carryover = 1;
  const holes = [...round.holes]
    .sort((a, b) => a.hole - b.hole)
    .map((hole) => {
      const summary = getStoredOrDerivedSkinsHole(hole, participants, carryover);

      summary.scores.forEach((score) => {
        const row = totals.get(score.participantId);
        if (!row) return;
        row.grossTotal += typeof score.score === 'number' ? score.score : 0;
      });

      if (summary.isComplete) {
        if (summary.winnerParticipantId) {
          const winner = totals.get(summary.winnerParticipantId);
          if (winner) {
            winner.skinsWon += 1;
            winner.totalSkinCountWon += summary.awardedSkinCount;
          }
        }
        carryover = summary.isPush ? summary.carryoverSkinCount + 1 : 1;
      }

      return summary;
    });

  const finalHole = [...round.holes].find((hole) => hole.hole === 18) ?? null;
  const unresolvedFinalCarryoverSkinCount =
    finalHole?.skinsIsPush === true && typeof finalHole.skinsCarryoverCount === 'number'
      ? Number(finalHole.skinsCarryoverCount)
      : 0;

  if (round.skinsPuttOffWinnerId) {
    const winner = totals.get(round.skinsPuttOffWinnerId);
    if (winner) {
      winner.totalSkinCountWon += Number(round.skinsPuttOffAwardedCount ?? 0);
    }
  }

  const sortedTotals = Array.from(totals.values())
    .sort((a, b) => (
      b.totalSkinCountWon - a.totalSkinCountWon
      || b.skinsWon - a.skinsWon
      || a.grossTotal - b.grossTotal
      || a.seatOrder - b.seatOrder
      || a.displayName.localeCompare(b.displayName)
    ))
    .map((row, index) => ({
      ...row,
      standingRank: index + 1,
    }));

  const totalAwardedSkinCount = sortedTotals.reduce((sum, row) => sum + row.totalSkinCountWon, 0);
  const activePlayerCount = participants.length;
  const buyInCents = Number(round.roundGameBuyInCents ?? 0);
  const totalPotCents = buyInCents * activePlayerCount;
  const settlement =
    unresolvedFinalCarryoverSkinCount > 0 || totalAwardedSkinCount <= 0
      ? null
      : calculateGameSettlement({
        buyInCents,
        players: sortedTotals.map((row) => ({
          id: row.participantId,
          displayName: row.displayName,
          units: row.totalSkinCountWon,
        })),
      });
  const perSkinValueCents = settlement?.unitValueCents ?? null;

  return {
    totals: sortedTotals,
    holes,
    completedHoleCount: holes.filter((hole) => hole.isComplete).length,
    nextCarryoverSkinCount: carryover,
    payout: {
      buyInCents,
      activePlayerCount,
      totalPotCents,
      totalAwardedSkinCount,
      unresolvedFinalCarryoverSkinCount,
      skinsPuttOffWinnerId: round.skinsPuttOffWinnerId ?? null,
      skinsPuttOffAwardedCount:
        round.skinsPuttOffAwardedCount === null || round.skinsPuttOffAwardedCount === undefined
          ? null
          : Number(round.skinsPuttOffAwardedCount),
      skinsPuttOffResolvedAt: round.skinsPuttOffResolvedAt ?? null,
      perSkinValueCents,
      settlement,
    } satisfies SkinsPayoutSummary,
  };
}
