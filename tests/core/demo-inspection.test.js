const test = require('node:test');
const assert = require('node:assert/strict');
global.window = globalThis;
require('../../core/config.js');
require('../../core/event-model.js');
require('../../core/registry.js');
require('../../sports/baseball/providers/mlb.js');
require('../../sports/chess/providers/lichess.js');
const { config, registry } = globalThis.SportsOverlay;
const { fixtures, modes } = require('../../core/demo-inspection.js');
const sports = config.SPORT_CATALOG.map(s => s.key);
for (const sport of sports) require(`../../sports/${sport}/demo-data.js`);

test('inspection covers every sport and requested state without mutating registered fixtures', () => {
  const original = registry.getDemo('football', 'pregame');
  for (const mode of modes) {
    const samples = fixtures({ registry, sports, mode, now: 1000000000000 });
    assert.equal(samples.length, sports.length * (mode === 'mixed' ? 4 : 1));
    for (const { event, state, message } of samples) {
      if (['no-event', 'offline', 'error'].includes(state)) assert.ok(message);
      else assert.equal(event.state, state);
      if (mode !== 'mixed') assert.equal(state, mode);
      if (state === 'pregame') assert.equal(Date.parse(event.startTime), 1000003600000);
      if (event.competitionType === 'individual') continue;
      for (const [side, other] of [['away', 'home'], ['home', 'away']]) {
        const team = event.teams[side], opponent = event.teams[other];
        if (state === 'pregame') assert.equal(team.score, null);
        else if (/Seattle|Nebraska Cornhuskers/.test(team.name)) assert.ok(team.score > opponent.score);
      }
    }
  }
  assert.deepEqual(registry.getDemo('football', 'pregame'), original);
});
