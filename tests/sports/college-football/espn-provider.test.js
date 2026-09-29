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
        { id: "264", homeAway: "away", score: "17", records: [{ name: "overall", summary: "5-1" }], team: { id: "264", abbreviation: "WASH", displayName: "Washington Huskies", logos: [{ href: "wash.png" }] } },
        { id: "158", homeAway: "home", score: "21", records: [{ name: "overall", summary: "4-2" }], team: { id: "158", abbreviation: "NEB", displayName: "Nebraska Cornhuskers", logos: [{ href: "neb.png" }] } },
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
  assert.equal(event.teams.home.logoUrl, "neb.png");
  assert.equal(event.teams.away.name, "Washington Huskies");
  assert.equal(event.teams.away.logoUrl, "wash.png");
  assert.equal(event.details.possessionTeam, "NEB");
});

test("derives college live situation from the latest drive", () => {
  const payload = liveEvent();
  delete payload.competitions[0].situation;
  payload.drives = { current: { plays: [{
    text: "Run for five yards.",
    end: { down: 2, distance: 5, possessionText: "NEB 30", shortDownDistanceText: "2nd & 5", team: { id: "158" } },
  }] } };
  const event = provider.normalizeEvent(payload, "158");
  assert.deepEqual(
    { down: event.details.down, distance: event.details.distance, yardLine: event.details.yardLine, possessionTeam: event.details.possessionTeam },
    { down: 2, distance: 5, yardLine: "NEB 30", possessionTeam: "NEB" },
  );
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
    const body = url.includes("schedule") ? { events: [liveEvent()] }
      : url.includes("scoreboard") ? { events: [{ id: "league-live" }] }
        : liveEvent();
    return { ok: true, json: async () => body };
  };
  const client = provider.createClient({ teamId: "158", requestTimeoutMs: 1000, fetchImpl });
  assert.equal((await client.findGames()).length, 1);
  assert.equal((await client.findLeagueGames())[0].id, "league-live");
  assert.equal((await client.getEvent("401752001")).teams.home.abbreviation, "NEB");
  assert.match(requests[0], /football\/college-football\/teams\/158\/schedule\?season=/);
  assert.match(requests[1], /football\/college-football\/scoreboard\?groups=80&limit=1000/);
  assert.match(requests[2], /football\/college-football\/summary\?event=401752001/);
});
