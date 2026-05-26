export type SettlementPlayerInput = {
  id: string;
  displayName: string;
};

export type SettlementUnitInput = SettlementPlayerInput & {
  units: number;
};

export type SettlementWinningsInput = SettlementPlayerInput & {
  grossWinningsCents: number;
};

export type PlayerSettlementResult = SettlementUnitInput & {
  grossWinningsCents: number;
  netCents: number;
};

export type SettlementTransfer = {
  fromParticipantId: string;
  fromDisplayName: string;
  toParticipantId: string;
  toDisplayName: string;
  amountCents: number;
};

export type SettlementNetInput = SettlementPlayerInput & {
  netCents: number;
};

export type GameSettlement = {
  buyInCents: number;
  activePlayerCount: number;
  totalPotCents: number;
  totalUnits: number;
  unitValueCents: number | null;
  players: PlayerSettlementResult[];
  settlements: SettlementTransfer[];
};

export function calculateGameSettlement(params: {
  players: SettlementUnitInput[];
  buyInCents: number;
}): GameSettlement {
  const buyInCents = Math.max(0, Math.round(Number(params.buyInCents) || 0));
  const players = params.players.map((player) => ({
    ...player,
    units: Math.max(0, Number(player.units) || 0),
  }));
  const totalPotCents = buyInCents * players.length;
  const totalUnits = players.reduce((sum, player) => sum + player.units, 0);

  if (totalPotCents <= 0 || totalUnits <= 0) {
    const emptyPlayers = players.map((player) => ({
      ...player,
      grossWinningsCents: 0,
      netCents: -buyInCents,
    }));

    return {
      buyInCents,
      activePlayerCount: players.length,
      totalPotCents,
      totalUnits,
      unitValueCents: null,
      players: emptyPlayers,
      settlements: reduceSettlementTransfers(emptyPlayers),
    };
  }

  const exactShares = players.map((player, index) => {
    const exactCents = (totalPotCents * player.units) / totalUnits;
    const floorCents = Math.floor(exactCents);
    return {
      player,
      index,
      floorCents,
      remainder: exactCents - floorCents,
    };
  });

  let remainderCents = totalPotCents - exactShares.reduce((sum, share) => sum + share.floorCents, 0);
  const payoutById = new Map<string, number>();

  // Rounding is centralized here: every player's exact fractional share is
  // floored, then leftover cents are assigned to the largest fractional
  // remainders. This keeps total payouts equal to the pot in integer cents.
  [...exactShares]
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach((share) => {
      const extraCent = remainderCents > 0 ? 1 : 0;
      payoutById.set(share.player.id, share.floorCents + extraCent);
      remainderCents -= extraCent;
    });

  const settledPlayers = players.map((player) => {
    const grossWinningsCents = payoutById.get(player.id) ?? 0;
    return {
      ...player,
      grossWinningsCents,
      netCents: grossWinningsCents - buyInCents,
    };
  });

  return {
    buyInCents,
    activePlayerCount: players.length,
    totalPotCents,
    totalUnits,
    unitValueCents: totalPotCents / totalUnits,
    players: settledPlayers,
    settlements: reduceSettlementTransfers(settledPlayers),
  };
}

export function calculateGameSettlementFromWinnings(params: {
  players: SettlementWinningsInput[];
  buyInCents: number;
}): GameSettlement {
  const buyInCents = Math.max(0, Math.round(Number(params.buyInCents) || 0));
  const players = params.players.map((player) => ({
    ...player,
    grossWinningsCents: Math.max(0, Math.round(Number(player.grossWinningsCents) || 0)),
  }));
  const totalPotCents = players.reduce((sum, player) => sum + player.grossWinningsCents, 0);
  const settledPlayers = players.map((player) => ({
    id: player.id,
    displayName: player.displayName,
    units: 0,
    grossWinningsCents: player.grossWinningsCents,
    netCents: player.grossWinningsCents - buyInCents,
  }));

  return {
    buyInCents,
    activePlayerCount: players.length,
    totalPotCents,
    totalUnits: 0,
    unitValueCents: null,
    players: settledPlayers,
    settlements: reduceSettlementTransfers(settledPlayers),
  };
}

export function calculateSettlementTransfersFromNetCents(players: SettlementNetInput[]) {
  return reduceSettlementTransfers(players.map((player) => ({
    id: player.id,
    displayName: player.displayName,
    units: 0,
    grossWinningsCents: 0,
    netCents: Math.round(Number(player.netCents) || 0),
  })));
}

function reduceSettlementTransfers(players: PlayerSettlementResult[]): SettlementTransfer[] {
  const debtors = players
    .filter((player) => player.netCents < 0)
    .map((player) => ({ ...player, remainingCents: Math.abs(player.netCents) }))
    .sort((a, b) => b.remainingCents - a.remainingCents || a.displayName.localeCompare(b.displayName));

  const creditors = players
    .filter((player) => player.netCents > 0)
    .map((player) => ({ ...player, remainingCents: player.netCents }))
    .sort((a, b) => b.remainingCents - a.remainingCents || a.displayName.localeCompare(b.displayName));

  const transfers: SettlementTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.remainingCents, creditor.remainingCents);

    if (amountCents > 0) {
      transfers.push({
        fromParticipantId: debtor.id,
        fromDisplayName: debtor.displayName,
        toParticipantId: creditor.id,
        toDisplayName: creditor.displayName,
        amountCents,
      });
    }

    debtor.remainingCents -= amountCents;
    creditor.remainingCents -= amountCents;

    if (debtor.remainingCents === 0) debtorIndex += 1;
    if (creditor.remainingCents === 0) creditorIndex += 1;
  }

  return transfers;
}
