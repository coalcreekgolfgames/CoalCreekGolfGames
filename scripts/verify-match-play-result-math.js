const cases = [
  {
    name: 'after 10 holes, 6 up, 8 remaining',
    completedHoleCount: 10,
    matchLead: 6,
    expected: { complete: false, label: 'Player A 6 Up' },
  },
  {
    name: 'after 10 holes, 9 up, 8 remaining',
    completedHoleCount: 10,
    matchLead: 9,
    expected: { complete: true, label: 'Player A wins 9 and 8' },
  },
  {
    name: 'after 17 holes, 2 up, 1 remaining',
    completedHoleCount: 17,
    matchLead: 2,
    expected: { complete: true, label: 'Player A wins 2 and 1' },
  },
  {
    name: 'after 18 holes, 1 up, 0 remaining',
    completedHoleCount: 18,
    matchLead: 1,
    expected: { complete: true, label: 'Player A wins 1 Up' },
  },
  {
    name: 'after 18 holes, tied',
    completedHoleCount: 18,
    matchLead: 0,
    expected: { complete: true, label: 'Match Halved' },
  },
];

function resolveMatchStatus({ completedHoleCount, matchLead, totalMatchHoles = 18 }) {
  const holesRemaining = Math.max(0, totalMatchHoles - completedHoleCount);
  const lead = Math.abs(matchLead);
  const leaderName = matchLead >= 0 ? 'Player A' : 'Player B';

  if (lead === 0 && holesRemaining === 0) {
    return { complete: true, label: 'Match Halved' };
  }

  if (lead === 0) {
    return { complete: false, label: 'All Square' };
  }

  if (lead > holesRemaining) {
    return {
      complete: true,
      label: holesRemaining > 0
        ? `${leaderName} wins ${lead} and ${holesRemaining}`
        : `${leaderName} wins ${lead} Up`,
    };
  }

  return { complete: false, label: `${leaderName} ${lead} Up` };
}

for (const testCase of cases) {
  const actual = resolveMatchStatus(testCase);
  if (
    actual.complete !== testCase.expected.complete
    || actual.label !== testCase.expected.label
  ) {
    throw new Error(`${testCase.name}: expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log(`Verified ${cases.length} match-play result math cases.`);
