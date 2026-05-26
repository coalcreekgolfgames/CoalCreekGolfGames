export type NassauParticipantScoreInput = {
  participantId: string;
  score: number | null | undefined;
};

export type NassauHoleScoreInput = {
  holeNumber: number;
  scores: NassauParticipantScoreInput[];
};

export type NassauHoleResult = {
  winnerParticipantId: string | null;
  winnerParticipantIds: string[];
  winningScore: number | null;
  isHalved: boolean;
};

export type NassauSegmentKey = 'front' | 'back' | 'overall';

export type NassauSegmentWinner = {
  participantId: string;
  share: number;
};

export type NassauSegmentSummary = {
  key: NassauSegmentKey;
  label: string;
  holesComplete: number;
  participantTotals: Record<string, number>;
  winningScore: number | null;
  winnerParticipantIds: string[];
  winners: NassauSegmentWinner[];
  sharesByParticipantId: Record<string, number>;
};

export type NassauSegments = {
  front: NassauSegmentSummary;
  back: NassauSegmentSummary;
  overall: NassauSegmentSummary;
};

function scoreComplete(score: number | null | undefined) {
  return typeof score === 'number' && Number.isFinite(score) && score > 0;
}

function roundShare(value: number) {
  return Math.round(value * 1000) / 1000;
}

function buildSegmentLabel(key: NassauSegmentKey) {
  if (key === 'front') return 'Front';
  if (key === 'back') return 'Back';
  return 'Overall';
}

function buildEmptySegment(key: NassauSegmentKey, participantIds: string[]): NassauSegmentSummary {
  const participantTotals = Object.fromEntries(participantIds.map((participantId) => [participantId, 0]));
  const sharesByParticipantId = Object.fromEntries(participantIds.map((participantId) => [participantId, 0]));

  return {
    key,
    label: buildSegmentLabel(key),
    holesComplete: 0,
    participantTotals,
    winningScore: null,
    winnerParticipantIds: [],
    winners: [],
    sharesByParticipantId,
  };
}

function joinWinnerLabels(labels: string[]) {
  return labels.join(' / ');
}

export function determineNassauHoleResult(params: {
  participantScores: NassauParticipantScoreInput[];
}): NassauHoleResult | null {
  const validScores = params.participantScores.filter((entry) => scoreComplete(entry.score));
  if (validScores.length < 2 || validScores.length !== params.participantScores.length) return null;

  const winningScore = Math.min(...validScores.map((entry) => Number(entry.score)));
  const winnerParticipantIds = validScores
    .filter((entry) => Number(entry.score) === winningScore)
    .map((entry) => entry.participantId);

  return {
    winnerParticipantId: winnerParticipantIds.length === 1 ? winnerParticipantIds[0]! : null,
    winnerParticipantIds,
    winningScore,
    isHalved: winnerParticipantIds.length > 1,
  };
}

export function determineNassauSegmentWinners(params: {
  participantTotals: Record<string, number>;
  holesComplete: number;
}) {
  if (params.holesComplete === 0) {
    return {
      winningScore: null,
      winnerParticipantIds: [] as string[],
    };
  }

  const entries = Object.entries(params.participantTotals);
  if (entries.length === 0) {
    return {
      winningScore: null,
      winnerParticipantIds: [] as string[],
    };
  }

  const winningScore = Math.min(...entries.map(([, total]) => total));
  const winnerParticipantIds = entries
    .filter(([, total]) => total === winningScore)
    .map(([participantId]) => participantId);

  return {
    winningScore,
    winnerParticipantIds,
  };
}

export function calculateNassauSegmentShares(params: {
  participantIds: string[];
  winnerParticipantIds: string[];
}) {
  const sharesByParticipantId = Object.fromEntries(params.participantIds.map((participantId) => [participantId, 0]));

  if (params.winnerParticipantIds.length === 0) {
    return {
      sharesByParticipantId,
      winners: [] as NassauSegmentWinner[],
    };
  }

  const share = roundShare(1 / params.winnerParticipantIds.length);
  const winners = params.winnerParticipantIds.map((participantId) => ({
    participantId,
    share,
  }));

  winners.forEach((winner) => {
    sharesByParticipantId[winner.participantId] = winner.share;
  });

  return {
    sharesByParticipantId,
    winners,
  };
}

function summarizeSegment(params: {
  key: NassauSegmentKey;
  holes: NassauHoleScoreInput[];
  participantIds: string[];
}) {
  const segment = buildEmptySegment(params.key, params.participantIds);

  params.holes.forEach((hole) => {
    const validScores = hole.scores.filter((entry) => scoreComplete(entry.score));
    if (validScores.length !== params.participantIds.length) return;

    segment.holesComplete += 1;
    validScores.forEach((entry) => {
      segment.participantTotals[entry.participantId] = (segment.participantTotals[entry.participantId] ?? 0) + Number(entry.score);
    });
  });

  const winners = determineNassauSegmentWinners({
    participantTotals: segment.participantTotals,
    holesComplete: segment.holesComplete,
  });
  const shares = calculateNassauSegmentShares({
    participantIds: params.participantIds,
    winnerParticipantIds: winners.winnerParticipantIds,
  });

  return {
    ...segment,
    winningScore: winners.winningScore,
    winnerParticipantIds: winners.winnerParticipantIds,
    winners: shares.winners,
    sharesByParticipantId: shares.sharesByParticipantId,
  };
}

export function calculateNassauSegments(params: {
  holes: NassauHoleScoreInput[];
  participantIds: string[];
}): NassauSegments {
  const sorted = [...params.holes].sort((a, b) => a.holeNumber - b.holeNumber);

  return {
    front: summarizeSegment({
      key: 'front',
      holes: sorted.filter((hole) => hole.holeNumber >= 1 && hole.holeNumber <= 9),
      participantIds: params.participantIds,
    }),
    back: summarizeSegment({
      key: 'back',
      holes: sorted.filter((hole) => hole.holeNumber >= 10 && hole.holeNumber <= 18),
      participantIds: params.participantIds,
    }),
    overall: summarizeSegment({
      key: 'overall',
      holes: sorted.filter((hole) => hole.holeNumber >= 1 && hole.holeNumber <= 18),
      participantIds: params.participantIds,
    }),
  };
}

export function calculateNassauWinnings(params: {
  participantIds: string[];
  buyInCents: number;
  segments: NassauSegments;
}) {
  const totalPotCents = Math.max(0, params.buyInCents) * params.participantIds.length;
  const segmentValueCents = totalPotCents / 3;
  const winningsByParticipantId = Object.fromEntries(params.participantIds.map((participantId) => [participantId, 0]));

  const segmentValues = {
    front: segmentValueCents,
    back: segmentValueCents,
    overall: segmentValueCents,
  };

  (Object.entries(params.segments) as Array<[NassauSegmentKey, NassauSegmentSummary]>).forEach(([key, segment]) => {
    if (segment.winnerParticipantIds.length === 0) return;
    const segmentPayout = segmentValues[key];
    const splitValue = segmentPayout / segment.winnerParticipantIds.length;

    segment.winnerParticipantIds.forEach((participantId) => {
      winningsByParticipantId[participantId] = winningsByParticipantId[participantId] + splitValue;
    });
  });

  return {
    totalPotCents,
    segmentValueCents,
    winningsByParticipantId,
  };
}

export function formatNassauSegmentStatus(params: {
  segment: NassauSegmentSummary;
  participantLabelsById: Record<string, string>;
}) {
  const { segment, participantLabelsById } = params;
  if (segment.holesComplete === 0) return `${segment.label} in progress`;
  if (segment.winnerParticipantIds.length === 0) return `${segment.label} in progress`;

  const labels = segment.winnerParticipantIds.map((participantId) => participantLabelsById[participantId] ?? participantId);
  if (labels.length === 1) {
    return `${labels[0]} wins ${segment.label}`;
  }

  return `${joinWinnerLabels(labels)} split ${segment.label}`;
}
