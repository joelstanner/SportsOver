"use strict";
require('../../../scripts/offline-network.cjs');

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../../core/event-model.js");
require("../../../core/registry.js");
require("../../../core/timeouts.js");
require("../../../sports/football/providers/espn.js");

const provider = global.SportsOverlay.espnNfl;
const { EVENT_STATES } = global.SportsOverlay.model;

function liveEvent(overrides = {}) {
  return {
    id: "401000001",
    date: "2026-10-04T20:05:00Z",
    status: {
      period: 3,
      displayClock: "08:42",
      type: { state: "in", completed: false, description: "In Progress" },
    },
    competitions: [{
      id: "401000001",
      date: "2026-10-04T20:05:00Z",
      competitors: [
        { id: "8", homeAway: "away", score: "17", timeoutsUsed: 1, records: [{ name: "overall", summary: "3-1" }], team: { id: "8", abbreviation: "DET", displayName: "Detroit Lions", logo: "det.png" } },
        { id: "26", homeAway: "home", score: "21", timeoutsUsed: 2, records: [{ name: "overall", summary: "2-2" }], team: { id: "26", abbreviation: "SEA", displayName: "Seattle Seahawks", logo: "sea.png" } },
      ],
      situation: {
        down: 3,
        distance: 4,
        possession: "26",
        possessionText: "DET 18",
        isRedZone: true,
        lastPlay: { text: "Pass complete for 12 yards." },
      },
      ...overrides.competition,
    }],
    ...overrides.event,
  };
}

test("normalizes ESPN live football details", () => {
  const event = provider.normalizeEvent(liveEvent(), "SEA");
  assert.equal(event.state, EVENT_STATES.LIVE);
  assert.equal(event.teams.home.name, "Seattle Seahawks");
  assert.equal(event.teams.home.featured, true);
  assert.equal(event.teams.home.score, 21);
  assert.equal(event.teams.home.logoUrl, "sea.png");
  assert.deepEqual([event.teams.away.timeoutsRemaining, event.teams.home.timeoutsRemaining], [2, 1]);
  assert.equal(event.details.quarter, "3RD");
  assert.equal(event.details.clock, "08:42");
  assert.equal(event.details.down, 3);
  assert.equal(event.details.distance, 4);
  assert.equal(event.details.yardLine, "DET 18");
  assert.equal(event.details.possessionTeam, "SEA");
  assert.equal(event.details.redZone, true);
  assert.equal(event.details.lastPlay, "Pass complete for 12 yards.");
});

test("derives live situation from the latest drive when ESPN omits situation", () => {
  const payload = liveEvent({
    competition: { situation: undefined },
    event: { drives: { current: { plays: [{
      text: "Official Timeout.",
      end: { down: 1, distance: 10, possessionText: "SEA 32", shortDownDistanceText: "1st & 10", team: { id: "26" } },
    }] } } },
  });
  const event = provider.normalizeEvent(payload, "SEA");
  assert.deepEqual(
    { down: event.details.down, distance: event.details.distance, yardLine: event.details.yardLine, possessionTeam: event.details.possessionTeam },
    { down: 1, distance: 10, yardLine: "SEA 32", possessionTeam: "SEA" },
  );
});

test("normalizes scheduled, halftime, and final states", () => {
  assert.equal(provider.normalizeState("pre", false, "Scheduled"), EVENT_STATES.PREGAME);
  assert.equal(provider.normalizeState("in", false, "Halftime"), EVENT_STATES.INTERRUPTED);
  assert.equal(provider.normalizeState("post", true, "Final"), EVENT_STATES.FINAL);
});

test("chooses the Seahawks live game before other states", () => {
  const live = liveEvent();
  const scheduled = liveEvent({
    event: { id: "scheduled", date: "2026-10-11T20:05:00Z" },
    competition: { id: "scheduled", status: { type: { state: "pre" } } },
  });
  const unrelated = liveEvent({
    event: { id: "unrelated" },
    competition: {
      id: "unrelated",
      competitors: [
        { homeAway: "away", team: { id: "8", abbreviation: "DET" } },
        { homeAway: "home", team: { id: "3", abbreviation: "CHI" } },
      ],
    },
  });
  assert.equal(provider.chooseGame([scheduled, unrelated, live], "SEA").id, live.id);
});

test("client uses the scoreboard and summary feeds", async () => {
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    return { ok: true, json: async () => url.includes("scoreboard") ? { events: [liveEvent()] } : liveEvent() };
  };
  const client = provider.createClient({ teamId: "SEA", requestTimeoutMs: 1000, fetchImpl });
  assert.equal((await client.findGames()).length, 1);
  assert.equal((await client.findLeagueGames()).length, 1);
  assert.equal((await client.getEvent("401000001")).teams.home.abbreviation, "SEA");
  assert.match(requests[0], /scoreboard/);
  assert.match(requests[1], /scoreboard/);
  assert.match(requests[2], /summary\?event=401000001/);
});

test("client expands today's scoreboard to the current week when Seahawks are absent", async () => {
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    const body = url.includes("week=3")
      ? { events: [liveEvent()] }
      : { events: [], season: { year: 2026, type: 2 }, week: { number: 3 } };
    return { ok: true, json: async () => body };
  };
  const client = provider.createClient({ teamId: "SEA", requestTimeoutMs: 1000, fetchImpl });
  assert.equal((await client.findGames())[0].id, "401000001");
  assert.match(requests[1], /dates=2026&seasontype=2&week=3/);
});
