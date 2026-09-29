"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../../core/event-model.js");
require("../../../core/registry.js");
require("../../../sports/football/layout.js");
require("../../../sports/football/demo-data.js");

const { EVENT_STATES } = global.SportsOverlay.model;
const registry = global.SportsOverlay.registry;

test("registers a distinct football layout and all lifecycle demos", () => {
  assert.equal(typeof registry.getLayout("football").createLayout, "function");
  assert.deepEqual(registry.listDemos("football"), ["pregame", "live", "interrupted", "final"]);
  assert.equal(registry.getDemo("football", "pregame").state, EVENT_STATES.PREGAME);
  assert.equal(registry.getDemo("football", "interrupted").state, EVENT_STATES.INTERRUPTED);
  assert.equal(registry.getDemo("football", "final").state, EVENT_STATES.FINAL);
});

test("football live demo preserves sport-specific context", () => {
  const event = registry.getDemo("football", "live");

  assert.equal(event.sport, "football");
  assert.equal(event.league, "NFL");
  assert.equal(event.state, EVENT_STATES.LIVE);
  assert.deepEqual(
    { quarter: event.details.quarter, clock: event.details.clock, down: event.details.down, distance: event.details.distance },
    { quarter: "3RD", clock: "08:42", down: 3, distance: 4 },
  );
  assert.equal(event.details.possessionTeam, "SEA");
  assert.equal(event.details.yardLine, "DET 18");
  assert.equal(global.SportsOverlay.footballLayout.isRedZone(event), true);
});

test("detects red zone only inside the opponent's 20-yard line", () => {
  const event = registry.getDemo("football", "live");
  assert.equal(global.SportsOverlay.footballLayout.isRedZone({
    ...event,
    details: { ...event.details, yardLine: "SEA 18" },
  }), false);
  assert.equal(global.SportsOverlay.footballLayout.isRedZone({
    ...event,
    details: { ...event.details, yardLine: "DET 20" },
  }), true);
  assert.equal(global.SportsOverlay.footballLayout.isRedZone({
    ...event,
    details: { ...event.details, yardLine: "DET 21" },
  }), false);
});

test("never formats missing down data as null text", () => {
  assert.equal(global.SportsOverlay.footballLayout.formatDown({ down: null, distance: null }), "");
  assert.equal(global.SportsOverlay.footballLayout.formatDown({ down: 1, distance: 10 }), "1ST & 10");
});
