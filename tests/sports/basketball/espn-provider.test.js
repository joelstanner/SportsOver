"use strict";
require('../../../scripts/offline-network.cjs');

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../../core/event-model.js");
require("../../../core/registry.js");
require("../../../core/timeouts.js");
require("../../../sports/basketball/providers/espn.js");
require("../../../sports/basketball/layout.js");
require("../../../sports/basketball/demo-data.js");

const provider = global.SportsOverlay.espnNba;
const registry = global.SportsOverlay.registry;
const { EVENT_STATES } = global.SportsOverlay.model;

function liveSummary() {
  return {
    header: {
      id: "401900008",
      competitions: [{
        id: "401900008",
        date: "2026-10-10T23:00:00Z",
        status: { period: 4, displayClock: "6:42", type: { state: "in", completed: false, description: "In Progress" } },
        competitors: [
          { id: "4", homeAway: "away", score: "84", timeoutsUsed: 3, record: [{ type: "total", summary: "2-1" }], team: { id: "4", abbreviation: "CHI", displayName: "Chicago Bulls", logos: [{ href: "chi.png" }] } },
          { id: "8", homeAway: "home", score: "91", timeoutsUsed: 5, record: [{ type: "total", summary: "3-0" }], team: { id: "8", abbreviation: "DET", displayName: "Detroit Pistons", logos: [{ href: "det.png" }] } },
        ],
      }],
    },
    boxscore: {
      teams: [
        { team: { id: "4", abbreviation: "CHI", displayName: "Chicago Bulls", logo: "chi.png" }, statistics: [{ name: "fieldGoalPct", displayValue: "44.1" }, { name: "totalRebounds", displayValue: "31" }] },
        { team: { id: "8", abbreviation: "DET", displayName: "Detroit Pistons", logo: "det.png" }, statistics: [{ name: "fieldGoalPct", displayValue: "49.3" }, { name: "totalRebounds", displayValue: "38" }] },
      ],
    },
    plays: [
      { scoringPlay: true, text: "Cade Cunningham makes a 16-foot pullup jump shot." },
      { scoringPlay: false, text: "Detroit timeout." },
    ],
  };
}

test("normalizes ESPN NBA scores, details, and logos", () => {
  const event = provider.normalizeEvent(liveSummary(), "DET");
  assert.equal(event.state, EVENT_STATES.LIVE);
  assert.equal(event.teams.home.name, "Detroit Pistons");
  assert.equal(event.teams.home.featured, true);
  assert.equal(event.teams.home.logoUrl, "det.png");
  assert.deepEqual([event.teams.away.timeoutsRemaining, event.teams.home.timeoutsRemaining], [4, 2]);
  assert.equal(event.details.period, "Q4");
  assert.equal(event.details.clock, "6:42");
  assert.deepEqual([event.details.awayFieldGoalPct, event.details.homeFieldGoalPct], [44.1, 49.3]);
  assert.deepEqual([event.details.awayRebounds, event.details.homeRebounds], [31, 38]);
  assert.equal(event.details.lastPlay, "Cade Cunningham makes a 16-foot pullup jump shot.");
});

test("supports every basketball lifecycle demo", () => {
  assert.equal(typeof registry.getLayout("basketball").createLayout, "function");
  assert.deepEqual(registry.listDemos("basketball"), ["pregame", "live", "interrupted", "final"]);
  assert.equal(registry.getDemo("basketball", "interrupted").state, EVENT_STATES.INTERRUPTED);
  assert.match(registry.getDemo("basketball", "live").teams.home.logoUrl, /det\.png$/);
});

test("selects the live Pistons game and calculates the NBA season", () => {
  const live = { id: "live", date: "2026-10-10", status: { type: { state: "in" } }, competitions: liveSummary().header.competitions };
  const scheduled = structuredClone(live);
  scheduled.id = "scheduled";
  scheduled.status.type.state = "pre";
  scheduled.competitions[0].status.type.state = "pre";
  assert.equal(provider.chooseGame([scheduled, live], "DET").id, "live");
  assert.equal(provider.seasonEndingYear(new Date("2026-09-28T12:00:00Z")), 2027);
  assert.equal(provider.seasonEndingYear(new Date("2027-02-01T12:00:00Z")), 2027);
});

test("client calls Pistons schedule and NBA game-summary endpoints", async () => {
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    const body = url.includes("schedule") ? { events: [{ id: "401900008" }] }
      : url.includes("scoreboard") ? { events: [{ id: "league-live" }] }
        : liveSummary();
    return { ok: true, json: async () => body };
  };
  const client = provider.createClient({ teamId: "DET", requestTimeoutMs: 1000, fetchImpl });
  assert.equal((await client.findGames(new Date("2026-09-28T12:00:00Z")))[0].id, "401900008");
  assert.equal((await client.findLeagueGames())[0].id, "league-live");
  assert.equal((await client.getEvent("401900008")).teams.home.abbreviation, "DET");
  assert.match(requests[0], /teams\/det\/schedule\?season=2027/);
  assert.match(requests[1], /basketball\/nba\/scoreboard/);
  assert.match(requests[2], /summary\?event=401900008/);
});
