const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'lib', 'tournaments', 'ryderCup.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

const sandbox = {
  exports: {},
  require,
  module: { exports: {} },
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled, sandbox, { filename: sourcePath });

const {
  getRyderCupDisplayFormat,
  getRyderCupMatchPoints,
  summarizeRyderCupSessionPoints,
} = sandbox.module.exports;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

assert.deepEqual(
  plain(getRyderCupMatchPoints({ result: 'team_a' })),
  { teamAPoints: 1, teamBPoints: 0, result: 'team_a' },
);
assert.deepEqual(
  plain(getRyderCupMatchPoints({ result: 'team_b' })),
  { teamAPoints: 0, teamBPoints: 1, result: 'team_b' },
);
assert.deepEqual(
  plain(getRyderCupMatchPoints({ result: 'halved' })),
  { teamAPoints: 0.5, teamBPoints: 0.5, result: 'halved' },
);
assert.deepEqual(
  plain(getRyderCupMatchPoints({ status: 'scheduled' })),
  { teamAPoints: 0, teamBPoints: 0, result: 'incomplete' },
);

const sessionSummary = plain(summarizeRyderCupSessionPoints(
  [
    { id: 'm1', sessionId: 's1', result: 'team_a' },
    { id: 'm2', sessionId: 's1', result: 'halved' },
    { id: 'm3', sessionId: 's1', status: 'scheduled' },
    { id: 'm4', sessionId: 's2', result: 'team_b' },
  ],
  [
    { id: 's1', name: 'Day 1 Morning', display_order: 1 },
    { id: 's2', name: 'Final Singles', display_order: 2 },
  ],
));

assert.deepEqual(sessionSummary, [
  {
    sessionId: 's1',
    sessionName: 'Day 1 Morning',
    teamAPoints: 1.5,
    teamBPoints: 0.5,
    completedMatchCount: 2,
    remainingMatchCount: 1,
  },
  {
    sessionId: 's2',
    sessionName: 'Final Singles',
    teamAPoints: 0,
    teamBPoints: 1,
    completedMatchCount: 1,
    remainingMatchCount: 0,
  },
]);

assert.equal(getRyderCupDisplayFormat('singles'), 'Singles');
assert.equal(getRyderCupDisplayFormat('four_ball'), 'Four-Ball / Better Ball');
assert.equal(getRyderCupDisplayFormat('foursomes'), 'Foursomes / Alternate Shot');
assert.equal(getRyderCupDisplayFormat('scramble'), 'Scramble');

console.log('Verified Ryder Cup point helpers: Team A win 1/0, halve 0.5/0.5, Team B win 0/1, incomplete 0/0, session totals, and format labels.');
