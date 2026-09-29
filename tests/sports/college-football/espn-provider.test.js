"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../../core/event-model.js");
require("../../../core/registry.js");
require("../../../sports/college-football/providers/espn.js");

const provider = global.SportsOverlay.espnNcaaf;
const { EVENT_STATES } = global.SportsOverlay.model;

function liveEvent() {
  return {
    id: "401752001",
    date: "2026-10-31T19:30:00Z",
    status: { period: 3, displayClock: "08:42", type: { state: "in", completed: false, description: "In Progress" } },
    competitions: [{
      id: "401752001",
      date: "2026-10-31T19:30:00Z",
      competitors: [
        { id: "264", homeAway: "away", score: "17", records: [{ name: "overall", summary: "5-1" }], team: { id: "264", abbreviation: "WASH", displayName: "Washington Huskies", logo: "wash.png" } },
        { id: "158", homeAway: "home", score: "21", records: [{ name: "overall", summary: "4-2" }], team: { id: "158", abbreviation: "NEB", displayName: "Nebraska Cornhuskers", logo: "neb.png" } },
      ],
      situation: { down: 3, distance: 4, possession: "158", possessionText: "WASH 18", isRedZone: true, lastPlay: { text: "Pass complete for 12 yards." } },
    }],
  };
}

test("normalizes college football separately from the NFL", () => {
  const event = provider.normalizeEvent(liveEvent(), "158");
  assert.equal(event.sport, "college-football");
  assert.equal(event.league, "NCAAF");
  assert.equal(event.state, EVENT_STATES.LIVE);
  assert.equal(event.teams.home.name, "Nebraska Cornhuskers");
  assert.equal(event.teams.home.featured, true);
  assert.equal(event.teams.away.name, "Washington Huskies");
  assert.equal(event.details.possessionTeam, "NEB");
});

test("selects games by ESPN college team id", () => {
  assert.equal(provider.chooseGame([liveEvent()], "264").id, "401752001");
  assert.equal(provider.chooseGame([liveEvent()], "158").id, "401752001");
  assert.equal(provider.chooseGame([liveEvent()], "999"), undefined);
});

test("client uses the college-football schedule and summary feeds", async () => {
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    return { ok: true, json: async () => url.includes("schedule") ? { events: [liveEvent()] } : liveEvent() };
  };
  const client = provider.createClient({ teamId: "158", requestTimeoutMs: 1000, fetchImpl });
  assert.equal((await client.findGames()).length, 1);
  assert.equal((await client.getEvent("401752001")).teams.home.abbreviation, "NEB");
  assert.match(requests[0], /football\/college-football\/teams\/158\/schedule\?season=/);
  assert.match(requests[1], /football\/college-football\/summary\?event=401752001/);
});
