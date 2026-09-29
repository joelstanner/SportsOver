"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../../core/event-model.js");
require("../../../core/registry.js");
require("../../../sports/hockey/providers/espn.js");
require("../../../sports/hockey/layout.js");
require("../../../sports/hockey/demo-data.js");

const provider = global.SportsOverlay.espnNhl;
const registry = global.SportsOverlay.registry;
const { EVENT_STATES } = global.SportsOverlay.model;

function liveSummary() {
  return {
    header: {
      id: "401900001",
      competitions: [{
        id: "401900001",
        date: "2026-10-05T00:00:00Z",
        status: { period: 2, displayClock: "08:42", type: { state: "in", completed: false, description: "In Progress" } },
        competitors: [
          { id: "23", homeAway: "away", score: "2", records: [{ name: "overall", summary: "2-1-0" }], team: { id: "23", abbreviation: "VAN", displayName: "Vancouver Canucks" } },
          { id: "124292", homeAway: "home", score: "3", records: [{ name: "overall", summary: "2-0-1" }], team: { id: "124292", abbreviation: "SEA", displayName: "Seattle Kraken" } },
        ],
      }],
    },
    boxscore: {
      teams: [
        { team: { id: "23", abbreviation: "VAN", displayName: "Vancouver Canucks", logo: "van.png" }, statistics: [{ name: "shotsTotal", displayValue: "19" }, { name: "powerPlayGoals", displayValue: "0" }, { name: "powerPlayOpportunities", displayValue: "2" }] },
        { team: { id: "124292", abbreviation: "SEA", displayName: "Seattle Kraken", logo: "sea.png" }, statistics: [{ name: "shotsTotal", displayValue: "24" }, { name: "powerPlayGoals", displayValue: "1" }, { name: "powerPlayOpportunities", displayValue: "3" }] },
      ],
    },
    plays: [
      { scoringPlay: true, text: "Jared McCann scores on a wrist shot." },
      { scoringPlay: false, text: "Faceoff won by Seattle." },
    ],
  };
}

test("normalizes ESPN hockey scores, details, and logos", () => {
  const event = provider.normalizeEvent(liveSummary(), "SEA");
  assert.equal(event.state, EVENT_STATES.LIVE);
  assert.equal(event.teams.home.name, "Seattle Kraken");
  assert.equal(event.teams.home.featured, true);
  assert.equal(event.teams.home.logoUrl, "sea.png");
  assert.equal(event.details.period, "2ND");
  assert.equal(event.details.clock, "08:42");
  assert.deepEqual([event.details.awayShots, event.details.homeShots], [19, 24]);
  assert.deepEqual([event.details.awayPowerPlay, event.details.homePowerPlay], ["0/2", "1/3"]);
  assert.equal(event.details.lastPlay, "Jared McCann scores on a wrist shot.");
});

test("supports every hockey lifecycle demo", () => {
  assert.equal(typeof registry.getLayout("hockey").createLayout, "function");
  assert.deepEqual(registry.listDemos("hockey"), ["pregame", "live", "interrupted", "final"]);
  assert.equal(registry.getDemo("hockey", "interrupted").state, EVENT_STATES.INTERRUPTED);
});

test("selects the live Kraken game and calculates the NHL season", () => {
  const live = { id: "live", date: "2026-10-05", status: { type: { state: "in" } }, competitions: liveSummary().header.competitions };
  const scheduled = structuredClone(live);
  scheduled.id = "scheduled";
  scheduled.status.type.state = "pre";
  scheduled.competitions[0].status.type.state = "pre";
  assert.equal(provider.chooseGame([scheduled, live], "SEA").id, "live");
  assert.equal(provider.seasonEndingYear(new Date("2026-09-28T12:00:00Z")), 2027);
  assert.equal(provider.seasonEndingYear(new Date("2027-02-01T12:00:00Z")), 2027);
});

test("client calls Kraken schedule and game summary endpoints", async () => {
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    const body = url.includes("schedule") ? { events: [{ id: "401900001" }] }
      : url.includes("scoreboard") ? { events: [{ id: "league-live" }] }
        : liveSummary();
    return { ok: true, json: async () => body };
  };
  const client = provider.createClient({ teamId: "SEA", requestTimeoutMs: 1000, fetchImpl });
  assert.equal((await client.findGames(new Date("2026-09-28T12:00:00Z")))[0].id, "401900001");
  assert.equal((await client.findLeagueGames())[0].id, "league-live");
  assert.equal((await client.getEvent("401900001")).teams.home.abbreviation, "SEA");
  assert.match(requests[0], /teams\/sea\/schedule\?season=2027/);
  assert.match(requests[1], /hockey\/nhl\/scoreboard/);
  assert.match(requests[2], /summary\?event=401900001/);
});
