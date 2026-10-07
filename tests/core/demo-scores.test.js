'use strict';
require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = globalThis;
require('../../core/config.js');
require('../../core/event-model.js');
require('../../core/registry.js');
require('../../sports/baseball/providers/mlb.js');
require('../../sports/chess/providers/lichess.js');
const { config, registry } = globalThis.SportsOverlay;

// Exercise every registered demo and lifecycle state, including future sports.
for (const { key: sport } of config.SPORT_CATALOG) {
  require(`../../sports/${sport}/demo-data.js`);
  test(`${sport} demos always give Seattle and Nebraska the lead when scored`, () => {
    const demos = registry.listDemos(sport);
    assert.ok(demos.length, `${sport} has demos to check`);
    for (const name of demos) {
      const event = registry.getDemo(sport, name);
      if (event.competitionType === 'individual') continue;
      for (const [side, other] of [['away', 'home'], ['home', 'away']]) {
        const team = event.teams[side], opponent = event.teams[other];
        if (!/\bSeattle\b|\bNebraska Cornhuskers\b/i.test(team.name) && !/^(SEA|NEB)$/i.test(team.abbreviation)) continue;
        if (event.state === 'pregame' && team.score == null && opponent.score == null) continue;
        assert.ok(Number.isFinite(team.score) && Number.isFinite(opponent.score), `${sport}/${name}: scores must be available`);
        assert.ok(team.score > opponent.score, `${sport}/${name}: ${team.name} must lead ${opponent.name}, got ${team.score}–${opponent.score}`);
      }
    }
  });
}
