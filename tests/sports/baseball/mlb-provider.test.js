"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../../core/event-model.js");
require("../../../core/registry.js");
require("../../../sports/baseball/providers/mlb.js");
require("../../../sports/baseball/demo-data.js");

const { EVENT_STATES } = global.SportsOverlay.model;
const { chooseGame, normalizeFeed } = global.SportsOverlay.mlb;

test("normalizes the live Mariners feed into the shared event envelope", () => {
  const event = normalizeFeed(global.MARINERS_DEMO_FEEDS.live, 136, "demo-live");

  assert.equal(event.id, "demo-live");
  assert.equal(event.sport, "baseball");
  assert.equal(event.league, "MLB");
  assert.equal(event.state, EVENT_STATES.LIVE);
  assert.deepEqual(
    { away: event.teams.away.abbreviation, home: event.teams.home.abbreviation },
    { away: "SEA", home: "ATH" },
  );
  assert.deepEqual(
    { away: event.teams.away.score, home: event.teams.home.score },
    { away: 4, home: 2 },
  );
  assert.equal(event.details.inningOrdinal, "6th");
  assert.deepEqual(event.details.bases, { first: true, second: false, third: true });
  assert.equal(event.details.pitcher.pitchCount, 73);
  assert.deepEqual(
    { hits: event.details.batter.hits, atBats: event.details.batter.atBats },
    { hits: 1, atBats: 2 },
  );
});

test("normalizes pregame, interrupted, and final lifecycle states", () => {
  const pregame = normalizeFeed(global.MARINERS_DEMO_FEEDS.pregame, 136, "pregame");
  const interrupted = normalizeFeed({
    gameData: {
      status: { abstractGameState: "Live", detailedState: "Rain Delay" },
      teams: global.MARINERS_DEMO_FEEDS.live.gameData.teams,
    },
    liveData: global.MARINERS_DEMO_FEEDS.live.liveData,
  }, 136, "interrupted");
  const final = normalizeFeed({
    gameData: {
      status: { abstractGameState: "Final", detailedState: "Final" },
      teams: global.MARINERS_DEMO_FEEDS.live.gameData.teams,
    },
    liveData: global.MARINERS_DEMO_FEEDS.live.liveData,
  }, 136, "final");

  assert.equal(pregame.state, EVENT_STATES.PREGAME);
  assert.equal(interrupted.state, EVENT_STATES.INTERRUPTED);
  assert.equal(final.state, EVENT_STATES.FINAL);
});

test("chooses live before preview and final games", () => {
  const games = [
    { gamePk: 1, gameDate: "2026-09-28T18:00:00Z", status: { abstractGameState: "Final" } },
    { gamePk: 2, gameDate: "2026-09-28T21:00:00Z", status: { abstractGameState: "Preview" } },
    { gamePk: 3, gameDate: "2026-09-28T20:00:00Z", status: { abstractGameState: "Live" } },
  ];

  assert.equal(chooseGame(games).gamePk, 3);
});
