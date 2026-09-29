"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../../core/event-model.js");
require("../../../core/registry.js");
require("../../../sports/soccer/providers/espn.js");
require("../../../sports/soccer/layout.js");
require("../../../sports/soccer/demo-data.js");

const provider = global.SportsOverlay.espnMls;
const registry = global.SportsOverlay.registry;
const { EVENT_STATES } = global.SportsOverlay.model;

function liveSummary() {
  return {
    header: {
      id: "761837",
      competitions: [{
        id: "761837",
        date: "2026-09-27T00:30:00Z",
        status: { period: 2, displayClock: "83'", type: { state: "in", completed: false, description: "In Progress" } },
        competitors: [
          { id: "17362", homeAway: "away", score: "1", record: [{ type: "total", summary: "7-8-12" }], team: { id: "17362", abbreviation: "MIN", displayName: "Minnesota United FC", logos: [{ href: "min.png" }] } },
          { id: "9726", homeAway: "home", score: "3", record: [{ type: "total", summary: "9-8-9" }], team: { id: "9726", abbreviation: "SEA", displayName: "Seattle Sounders FC", logos: [{ href: "sea.png" }] } },
        ],
      }],
    },
    boxscore: {
      teams: [
        { team: { id: "17362", abbreviation: "MIN", displayName: "Minnesota United FC", logo: "min.png" }, statistics: [{ name: "possessionPct", displayValue: "44.9" }, { name: "shotsOnTarget", displayValue: "2" }] },
        { team: { id: "9726", abbreviation: "SEA", displayName: "Seattle Sounders FC", logo: "sea.png" }, statistics: [{ name: "possessionPct", displayValue: "55.1" }, { name: "shotsOnTarget", displayValue: "8" }] },
      ],
    },
    keyEvents: [
      { scoringPlay: true, text: "Goal! Seattle Sounders FC 3, Minnesota United FC 1.", type: { type: "goal" } },
      { scoringPlay: false, text: "Seattle makes a substitution.", type: { type: "substitution" } },
    ],
  };
}

test("normalizes ESPN MLS scores, details, and logos", () => {
  const event = provider.normalizeEvent(liveSummary(), "9726");
  assert.equal(event.state, EVENT_STATES.LIVE);
  assert.equal(event.teams.home.name, "Seattle Sounders FC");
  assert.equal(event.teams.home.featured, true);
  assert.equal(event.teams.home.logoUrl, "sea.png");
  assert.equal(event.details.period, "2ND");
  assert.equal(event.details.clock, "83'");
  assert.deepEqual([event.details.awayPossession, event.details.homePossession], [44.9, 55.1]);
  assert.deepEqual([event.details.awayShotsOnTarget, event.details.homeShotsOnTarget], [2, 8]);
  assert.equal(event.details.lastEvent, "Goal! Seattle Sounders FC 3, Minnesota United FC 1.");
});

test("supports every soccer lifecycle demo", () => {
  assert.equal(typeof registry.getLayout("soccer").createLayout, "function");
  assert.deepEqual(registry.listDemos("soccer"), ["pregame", "live", "interrupted", "final"]);
  assert.equal(registry.getDemo("soccer", "interrupted").state, EVENT_STATES.INTERRUPTED);
  assert.match(registry.getDemo("soccer", "live").teams.home.logoUrl, /9726\.png$/);
});

test("selects the live Sounders match before scheduled and final matches", () => {
  const live = { id: "live", date: "2026-09-27", status: { type: { state: "in" } }, competitions: liveSummary().header.competitions };
  const scheduled = structuredClone(live);
  scheduled.id = "scheduled";
  scheduled.status.type.state = "pre";
  scheduled.competitions[0].status.type.state = "pre";
  const final = structuredClone(live);
  final.id = "final";
  final.status.type.state = "post";
  final.competitions[0].status.type.state = "post";
  assert.equal(provider.chooseGame([scheduled, final, live], "9726").id, "live");
});

test("client calls Sounders schedule and MLS match-summary endpoints", async () => {
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    const body = url.includes("schedule") ? { events: [{ id: "761837" }] }
      : url.includes("scoreboard") ? { events: [{ id: "league-live" }] }
        : liveSummary();
    return { ok: true, json: async () => body };
  };
  const client = provider.createClient({ teamId: 9726, requestTimeoutMs: 1000, fetchImpl });
  assert.equal((await client.findGames(new Date("2026-09-28T12:00:00Z")))[0].id, "761837");
  assert.equal((await client.findLeagueGames())[0].id, "league-live");
  assert.equal((await client.getEvent("761837")).teams.home.abbreviation, "SEA");
  assert.match(requests[0], /teams\/9726\/schedule\?season=2026/);
  assert.match(requests[1], /soccer\/usa\.1\/scoreboard/);
  assert.match(requests[2], /summary\?event=761837/);
});
