import { calculateSettlementTransfersFromNetCents } from '@/lib/settlements';

export type WolfParticipantId = string;
export type WolfScoringMode = 'net' | 'winner_only';

export type WolfHoleDecision = {
  holeNumber: number;
  wolfParticipantId: WolfParticipantId;
  partnerParticipantId: WolfParticipantId | null;
  isLoneWolf: boolean;
  isBlindWolf?: boolean;
};

export type WolfHoleScores = {
  holeNumber: number;
  scoresByParticipantId: Record<WolfParticipantId, number | null | undefined>;
};

export type WolfHoleResult = {
  holeNumber: number;
  wolfParticipantId: WolfParticipantId;
  partnerParticipantId: WolfParticipantId | null;
  isLoneWolf: boolean;
  isBlindWolf: boolean;
  huntersParticipantIds: WolfParticipantId[];
  wolfSideScore: number;
  huntersSideScore: number;
  winningSide: 'wolf_side' | 'hunters' | 'tie';
  pointsByParticipantId: Record<WolfParticipantId, number>;
};

export type WolfStandingsRow = {
  participantId: WolfParticipantId;
  points: number;
};

export type WolfSettlementPlayerInput = {
  participantId: WolfParticipantId;
  displayName: string;
  finalPoints: number;
};

export type WolfSettlementPlayer = WolfSettlementPlayerInput & {
  eligiblePoints: number;
  grossWinningsCents: number;
  netCents: number;
};

export type WolfSettlementTransfer = {
  fromParticipantId: string;
  fromDisplayName: string;
  toParticipantId: string;
  toDisplayName: string;
  amountCents: number;
};

export type WolfSettlement = {
  buyInCents: number;
  totalPotCents: number;
  totalPoints: number;
  totalEligiblePoints: number;
  usedEvenSplitFallback: boolean;
  players: WolfSettlementPlayer[];
  settlements: WolfSettlementTransfer[];
};

function scoreComplete(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function emptyPoints(participantIds: WolfParticipantId[]) {
  return Object.fromEntries(participantIds.map((participantId) => [participantId, 0])) as Record<WolfParticipantId, number>;
}

export function getWolfForHole(participantIds: WolfParticipantId[], holeNumber: number) {
  if (participantIds.length === 0 || holeNumber < 1) return null;
  return participantIds[(holeNumber - 1) % participantIds.length] ?? null;
}

export function getHuntersForHole(
  participantIds: WolfParticipantId[],
  wolfParticipantId: WolfParticipantId,
  partnerParticipantId: WolfParticipantId | null,
  isLoneWolf: boolean,
) {
  return participantIds.filter((participantId) => (
    participantId !== wolfParticipantId
    && (isLoneWolf || participantId !== partnerParticipantId)
  ));
}

export function calculateWolfHoleResult(params: {
  participantIds: WolfParticipantId[];
  decision: WolfHoleDecision | null | undefined;
  holeScores: WolfHoleScores;
  scoringMode?: WolfScoringMode | null | undefined;
}): WolfHoleResult | null {
  const { participantIds, decision, holeScores } = params;
  const scoringMode = params.scoringMode ?? 'net';
  if (!decision || participantIds.length !== 4) return null;
  if (decision.isLoneWolf && decision.partnerParticipantId) return null;
  if (!decision.isLoneWolf && !decision.partnerParticipantId) return null;
  if (decision.isBlindWolf && !decision.isLoneWolf) return null;
  if (!participantIds.includes(decision.wolfParticipantId)) return null;
  if (decision.partnerParticipantId && !participantIds.includes(decision.partnerParticipantId)) return null;
  if (decision.partnerParticipantId === decision.wolfParticipantId) return null;

  const allScoresReady = participantIds.every((participantId) => scoreComplete(holeScores.scoresByParticipantId[participantId]));
  if (!allScoresReady) return null;

  const huntersParticipantIds = getHuntersForHole(
    participantIds,
    decision.wolfParticipantId,
    decision.partnerParticipantId,
    decision.isLoneWolf,
  );
  if ((!decision.isLoneWolf && huntersParticipantIds.length !== 2) || (decision.isLoneWolf && huntersParticipantIds.length !== 3)) {
    return null;
  }

  const wolfScore = Number(holeScores.scoresByParticipantId[decision.wolfParticipantId]);
  const partnerScore = decision.partnerParticipantId
    ? Number(holeScores.scoresByParticipantId[decision.partnerParticipantId])
    : null;
  const hunterScores = huntersParticipantIds.map((participantId) => Number(holeScores.scoresByParticipantId[participantId]));

  const wolfSideScore = decision.isLoneWolf
    ? wolfScore
    : Math.min(wolfScore, Number(partnerScore));
  const huntersSideScore = Math.min(...hunterScores);
  const pointsByParticipantId = emptyPoints(participantIds);

  let winningSide: 'wolf_side' | 'hunters' | 'tie' = 'tie';
  if (wolfSideScore < huntersSideScore) {
    winningSide = 'wolf_side';
    if (decision.isLoneWolf) {
      const wolfPoints = decision.isBlindWolf ? 6 : 3;
      const hunterPoints = scoringMode === 'winner_only' ? 0 : decision.isBlindWolf ? -2 : -1;
      pointsByParticipantId[decision.wolfParticipantId] = wolfPoints;
      huntersParticipantIds.forEach((participantId) => {
        pointsByParticipantId[participantId] = hunterPoints;
      });
    } else {
      pointsByParticipantId[decision.wolfParticipantId] = 1;
      pointsByParticipantId[decision.partnerParticipantId!] = 1;
      huntersParticipantIds.forEach((participantId) => {
        pointsByParticipantId[participantId] = scoringMode === 'winner_only' ? 0 : -1;
      });
    }
  } else if (huntersSideScore < wolfSideScore) {
    winningSide = 'hunters';
    if (decision.isLoneWolf) {
      const wolfPoints = scoringMode === 'winner_only' ? 0 : decision.isBlindWolf ? -6 : -3;
      const hunterPoints = decision.isBlindWolf ? 2 : 1;
      pointsByParticipantId[decision.wolfParticipantId] = wolfPoints;
      huntersParticipantIds.forEach((participantId) => {
        pointsByParticipantId[participantId] = hunterPoints;
      });
    } else {
      pointsByParticipantId[decision.wolfParticipantId] = scoringMode === 'winner_only' ? 0 : -1;
      pointsByParticipantId[decision.partnerParticipantId!] = scoringMode === 'winner_only' ? 0 : -1;
      huntersParticipantIds.forEach((participantId) => {
        pointsByParticipantId[participantId] = 1;
      });
    }
  }

  return {
    holeNumber: holeScores.holeNumber,
    wolfParticipantId: decision.wolfParticipantId,
    partnerParticipantId: decision.partnerParticipantId,
    isLoneWolf: decision.isLoneWolf,
    isBlindWolf: decision.isBlindWolf === true,
    huntersParticipantIds,
    wolfSideScore,
    huntersSideScore,
    winningSide,
    pointsByParticipantId,
  };
}

export function calculateWolfStandings(params: {
  participantIds: WolfParticipantId[];
  results: Array<WolfHoleResult | null | undefined>;
}) {
  const pointsByParticipantId = emptyPoints(params.participantIds);
  params.results.forEach((result) => {
    if (!result) return;
    params.participantIds.forEach((participantId) => {
      pointsByParticipantId[participantId] = (pointsByParticipantId[participantId] ?? 0) + (result.pointsByParticipantId[participantId] ?? 0);
    });
  });

  return params.participantIds
    .map((participantId) => ({
      participantId,
      points: pointsByParticipantId[participantId] ?? 0,
    }))
    .sort((a, b) => b.points - a.points || a.participantId.localeCompare(b.participantId));
}

export function formatWolfPoints(value: number) {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : `${value}`;
}

export function formatWolfSideLabel(params: {
  wolfDisplayName: string;
  partnerDisplayName?: string | null;
  isLoneWolf: boolean;
  isBlindWolf?: boolean;
}) {
  if (params.isBlindWolf) return `${params.wolfDisplayName} blind`;
  if (params.isLoneWolf) return `${params.wolfDisplayName} alone`;
  if (params.partnerDisplayName) return `${params.wolfDisplayName} and ${params.partnerDisplayName}`;
  return params.wolfDisplayName;
}

export function calculateWolfSettlement(params: {
  players: WolfSettlementPlayerInput[];
  buyInCents: number;
}): WolfSettlement | null {
  const buyInCents = Math.max(0, Math.round(Number(params.buyInCents) || 0));
  const players = params.players.map((player) => ({
    participantId: player.participantId,
    displayName: player.displayName,
    finalPoints: Number(player.finalPoints ?? 0),
  }));

  if (buyInCents <= 0 || players.length !== 4) return null;

  const totalPoints = players.reduce((sum, player) => sum + player.finalPoints, 0);
  const totalPotCents = buyInCents * players.length;
  const playersWithEligiblePoints = players.map((player, index) => ({
    ...player,
    eligiblePoints: Math.max(player.finalPoints, 0),
    index,
  }));
  const totalEligiblePoints = playersWithEligiblePoints.reduce((sum, player) => sum + player.eligiblePoints, 0);
  const usedEvenSplitFallback = totalEligiblePoints <= 0;

  const exactShares = playersWithEligiblePoints.map((player) => {
    const exactCents = usedEvenSplitFallback
      ? totalPotCents / playersWithEligiblePoints.length
      : (totalPotCents * player.eligiblePoints) / totalEligiblePoints;
    const floorCents = Math.floor(exactCents);
    return {
      ...player,
      exactCents,
      floorCents,
      remainder: exactCents - floorCents,
    };
  });

  let remainderCents = totalPotCents - exactShares.reduce((sum, player) => sum + player.floorCents, 0);
  const payoutById = new Map<string, number>();

  [...exactShares]
    .sort((a, b) => (
      b.remainder - a.remainder
      || b.eligiblePoints - a.eligiblePoints
      || a.index - b.index
    ))
    .forEach((player) => {
      const extraCent = remainderCents > 0 ? 1 : 0;
      payoutById.set(player.participantId, player.floorCents + extraCent);
      remainderCents -= extraCent;
    });

  const settlementPlayers = playersWithEligiblePoints.map((player) => {
    const grossWinningsCents = payoutById.get(player.participantId) ?? 0;
    return {
      participantId: player.participantId,
      displayName: player.displayName,
      finalPoints: player.finalPoints,
      eligiblePoints: player.eligiblePoints,
      grossWinningsCents,
      netCents: grossWinningsCents - buyInCents,
    };
  });

  return {
    buyInCents,
    totalPotCents,
    totalPoints,
    totalEligiblePoints,
    usedEvenSplitFallback,
    players: settlementPlayers,
    settlements: calculateSettlementTransfersFromNetCents(
      settlementPlayers.map((player) => ({
        id: player.participantId,
        displayName: player.displayName,
        netCents: player.netCents,
      })),
    ),
  };
}
