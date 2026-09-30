"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
require("../../core/event-model.js");
require("../../core/registry.js");
require("../../core/timeouts.js");
for (const sport of ["basketball", "football", "college-football", "hockey", "soccer"]) {
  require(`../../sports/${sport}/providers/espn.js`);
}
require("../../sports/baseball/providers/mlb.js");
const { registry, model } = global.SportsOverlay;

for (const providerName of ["espn-nba", "espn-nfl", "espn-ncaaf", "espn-nhl", "espn-mls"]) {
  test(`${providerName}: game-level preseason only; no regular-season label`, () => {
    const provider = registry.getProvider(providerName);
    const payload = { id: "test", header: { season: { type: 1, slug: "preseason" }, competitions: [] } };
    assert.equal(provider.normalizeEvent(payload).details.preseason, true);
    payload.header.season = { type: 2, slug: "regular-season" };
    assert.equal(provider.normalizeEvent(payload).details.preseason, false);
    delete payload.header.season;
    payload.leagues = [{ season: { type: 1, slug: "preseason" } }];
    assert.equal(provider.normalizeEvent(payload).details.preseason, false);
  });
}

test("ESPN supports summary, scoreboard, and competition season fields", () => {
  assert.equal(model.espnPreseason({ header: { season: { type: 1 } } }), true);
  assert.equal(model.espnPreseason({ season: { type: "1" } }), true);
  assert.equal(model.espnPreseason({ competitions: [{ season: { type: { id: "1" } } }] }), true);
  assert.equal(model.espnPreseason({ season: { type: { name: "Preseason" } } }), true);
  for (const type of [undefined, null, 2, 3, 4, "invalid"]) {
    assert.equal(model.espnPreseason({ season: { type } }), false);
  }
  // Soccer season numbering varies; require an explicit preseason label.
  assert.equal(model.espnPreseason({ season: { type: 1 } }, false), false);
});

test("MLB marks spring training/exhibition but not regular, postseason, or unknown games", () => {
  for (const type of ["S", "E", "R", "F", "D", "L", "W", "A", undefined]) {
    const event = global.SportsOverlay.mlb.normalizeFeed({ gameData: { game: { type } } }, 136);
    assert.equal(event.details.preseason, ["S", "E"].includes(type));
  }
});

// ESPN team schedules separate season identity from the event's season type.
test("Suns–Pistons schedule seasonType identifies preseason despite season lacking type", () => {
  const game = {
    id: "401908947", name: "Phoenix Suns at Detroit Pistons", date: "2026-10-05T23:00Z",
    season: { year: 2027, displayName: "2026-27" },
    seasonType: { id: "1", type: 1, name: "Preseason", abbreviation: "pre" },
  };
  assert.equal(model.espnPreseason(game), true);
  assert.equal(registry.getProvider("espn-nba").normalizeEvent(game).details.preseason, true);
  for (const type of [2, 3]) {
    assert.equal(model.espnPreseason({ ...game, seasonType: { id: String(type), type } }), false);
  }
  const { seasonType, ...unknown } = game;
  assert.equal(model.espnPreseason(unknown), false);
});
