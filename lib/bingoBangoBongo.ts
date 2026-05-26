import type { GroupParticipant, HoleDraft, LocalRoundDraft } from '@/types/round';
import { calculateGameSettlement, type GameSettlement } from '@/lib/settlements';

export type BingoBangoBongoCategory = 'bingoWinnerId' | 'bangoWinnerId' | 'bongoWinnerId';

export type BingoBangoBongoTotalsRow = {
  participantId: string;
  displayName: string;
  bingo: number;
  bango: number;
  bongo: number;
  total: number;
  strokeTotal: number;
  winningsCents?: number;
  netCents?: number;
};

export type BingoBangoBongoPayoutSummary = {
  buyInCents: number;
  activePlayerCount: number;
  totalPotCents: number;
  totalBbbPoints: number;
  pointValueCents: number | null;
  settlement: GameSettlement;
};

export function isBingoBangoBongoRound(round: LocalRoundDraft | null | undefined) {
  return round?.roundMode === 'casual_group' && round?.groupGameMode === 'bingo_bango_bongo';
}

export function ensureGroupScoresForHole(hole: HoleDraft, participants: GroupParticipant[]) {
  const scoresByParticipantId = new Map(
    (hole.groupScores ?? []).map((entry) => [entry.participantId, typeof entry.score === 'number' ? entry.score : null]),
  );

  return participants.map((participant) => ({
    participantId: participant.id,
    score: scoresByParticipantId.get(participant.id) ?? null,
  }));
}

export function isBbbHoleComplete(hole: HoleDraft, participants: GroupParticipant[]) {
  const scores = ensureGroupScoresForHole(hole, participants);
  const hasAllScores = scores.every((entry) => typeof entry.score === 'number' && entry.score > 0);

  return hasAllScores && !!hole.bingoWinnerId && !!hole.bangoWinnerId && !!hole.bongoWinnerId;
}

export function summarizeBingoBangoBongo(round: LocalRoundDraft) {
  const participants = round.group?.participants ?? [];
  const totals = new Map<string, BingoBangoBongoTotalsRow>();

  participants.forEach((participant) => {
    totals.set(participant.id, {
      participantId: participant.id,
      displayName: participant.displayName,
      bingo: 0,
      bango: 0,
      bongo: 0,
      total: 0,
      strokeTotal: 0,
    });
  });

  round.holes.forEach((hole) => {
    ensureGroupScoresForHole(hole, participants).forEach((entry) => {
      const row = totals.get(entry.participantId);
      if (!row) return;
      row.strokeTotal += typeof entry.score === 'number' ? entry.score : 0;
    });

    const bingoRow = hole.bingoWinnerId ? totals.get(hole.bingoWinnerId) : null;
    if (bingoRow) {
      bingoRow.bingo += 1;
      bingoRow.total += 1;
    }

    const bangoRow = hole.bangoWinnerId ? totals.get(hole.bangoWinnerId) : null;
    if (bangoRow) {
      bangoRow.bango += 1;
      bangoRow.total += 1;
    }

    const bongoRow = hole.bongoWinnerId ? totals.get(hole.bongoWinnerId) : null;
    if (bongoRow) {
      bongoRow.bongo += 1;
      bongoRow.total += 1;
    }
  });

  const sortedTotals = Array.from(totals.values());
  const settlement = calculateGameSettlement({
    buyInCents: Number(round.roundGameBuyInCents ?? 0),
    players: sortedTotals.map((row) => ({
      id: row.participantId,
      displayName: row.displayName,
      units: row.total,
    })),
  });
  const settlementPlayersById = new Map(settlement.players.map((player) => [player.id, player]));

  return {
    totals: sortedTotals.map((row) => {
      const settlementPlayer = settlementPlayersById.get(row.participantId);
      return {
        ...row,
        winningsCents: settlementPlayer?.grossWinningsCents ?? 0,
        netCents: settlementPlayer?.netCents ?? 0,
      };
    }),
    completedHoleCount: round.holes.filter((hole) => isBbbHoleComplete(hole, participants)).length,
    payout: {
      buyInCents: settlement.buyInCents,
      activePlayerCount: settlement.activePlayerCount,
      totalPotCents: settlement.totalPotCents,
      totalBbbPoints: settlement.totalUnits,
      pointValueCents: settlement.unitValueCents,
      settlement,
    } satisfies BingoBangoBongoPayoutSummary,
  };
}

export function bbbWinnerLabel(participants: GroupParticipant[], participantId: string | null | undefined) {
  if (!participantId) return 'Not selected';
  return participants.find((participant) => participant.id === participantId)?.displayName ?? 'Unknown player';
}
