"use strict";
require('../../../scripts/offline-network.cjs');

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../../core/event-model.js");
require("../../../core/registry.js");
require("../../../sports/college-football/demo-data.js");

test("Nebraska always leads Washington and has the better demo record", () => {
  ["pregame", "live", "interrupted", "final"].forEach(state => {
    const event = global.SportsOverlay.registry.getDemo("college-football", state);
    assert.equal(event.teams.home.name, "Nebraska Cornhuskers");
    assert.ok(event.teams.home.score > event.teams.away.score);
    assert.equal(event.teams.home.record, "6–0");
    assert.equal(event.teams.away.record, "5–1");
    assert.match(event.teams.home.logoUrl, /\/158\.png$/);
    assert.match(event.teams.away.logoUrl, /\/264\.png$/);
  });
});
