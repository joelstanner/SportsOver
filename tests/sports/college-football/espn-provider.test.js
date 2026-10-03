"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../../core/event-model.js");
require("../../../core/registry.js");
require("../../../core/timeouts.js");
require("../../../sports/college-football/providers/espn.js");

const provider = global.SportsOverlay.espnNcaaf;
const { EVENT_STATES } = global.SportsOverlay.model;

function liveEvent() {
  return {
    id: "401752001",
    date: "2026-10-31T19:30:00Z",
    status: { period: 2, displayClock: "08:42", type: { state: "in", completed: false, description: "In Progress" } },
    competitions: [{
      id: "401752001",
      date: "2026-10-31T19:30:00Z",
      competitors: [
        { id: "264", homeAway: "away", score: "17", timeoutsUsed: 2, records: [{ name: "overall", summary: "5-1" }], team: { id: "264", abbreviation: "WASH", displayName: "Washington Huskies", logos: [{ href: "wash.png" }] } },
        { id: "158", homeAway: "home", score: "21", timeoutsUsed: 0, records: [{ name: "overall", summary: "4-2" }], team: { id: "158", abbreviation: "NEB", displayName: "Nebraska Cornhuskers", logos: [{ href: "neb.png" }] } },
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
  assert.deepEqual([event.teams.away.timeoutsRemaining, event.teams.home.timeoutsRemaining], [1, 3]);
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

const timeoutFixture = require("./timeouts-summary.json");
const counts = event => [event.teams.away.timeoutsRemaining, event.teams.home.timeoutsRemaining];
function timeoutPlay(id, period, teamId, text = "Timeout") {
  return { id, period: { number: period }, clock: { displayValue: "11:00" },
    type: { id: "21", text: "Timeout" }, text,
    teamParticipants: [{ id: teamId, timeout: true }] };
}
function timeoutGame(period, plays) {
  const payload = liveEvent();
  payload.status.period = period;
  payload.drives = { previous: [{ plays: [
    { id: "kickoff", period: { number: 1 }, clock: { displayValue: "15:00" }, type: { id: "53" } },
    ...plays,
  ] }], current: { plays: [{ id: "latest", period: { number: period }, type: { id: "5" } }] } };
  return payload;
}

test("real ESPN summary counts only this half and deduplicates current/previous drive plays", () => {
  // Reduced Oct 2, 2026 Liberty–Delaware summary, event 401871050 at 10:51 Q3.
  // ESPN reports four Liberty and two Delaware timeouts used across both halves.
  const event = provider.normalizeEvent(timeoutFixture);
  assert.deepEqual(counts(event), [2, 3]);
  assert.equal(event.details.timeoutMaximum, 3);
  const corrected = structuredClone(timeoutFixture);
  for (const drive of [...corrected.drives.previous, corrected.drives.current]) {
    drive.plays = drive.plays.filter(play => play.id !== "401871050416");
  }
  assert.deepEqual(counts(provider.normalizeEvent(corrected)), [3, 3], "a corrected feed does not retain an old timeout");
});

test("timeouts carry across quarters, reset at halftime, and update in the second half", () => {
  const first = timeoutPlay("first", 1, "264");
  const second = timeoutPlay("second", 2, "264");
  assert.deepEqual(counts(provider.normalizeEvent(timeoutGame(1, [first]))), [2, 3]);
  assert.deepEqual(counts(provider.normalizeEvent(timeoutGame(2, [first, second]))), [1, 3]);
  const halftime = timeoutGame(2, [first, second]);
  halftime.status.type.description = "Halftime";
  assert.deepEqual(counts(provider.normalizeEvent(halftime)), [3, 3]);
  assert.deepEqual(counts(provider.normalizeEvent(timeoutGame(3, [first, second]))), [3, 3]);
  const third = timeoutPlay("third", 3, "158");
  assert.deepEqual(counts(provider.normalizeEvent(timeoutGame(3, [first, second, third]))), [3, 2]);
  assert.deepEqual(counts(provider.normalizeEvent(timeoutGame(4, [first, second, third]))), [3, 2]);
});

test("college overtime grants one each in 1OT and 2OT, then one shared from 3OT onward", () => {
  const regulation = timeoutPlay("regulation", 4, "264");
  const first = timeoutPlay("ot1", 5, "264");
  const second = timeoutPlay("ot2", 6, "158");
  const third = timeoutPlay("ot3", 7, "264");
  for (const [period, plays, expected] of [
    [5, [regulation], [1, 1]], [5, [regulation, first], [0, 1]],
    [6, [regulation, first], [1, 1]], [6, [regulation, first, second], [1, 0]],
    [7, [regulation, first, second], [1, 1]], [7, [regulation, first, second, third], [0, 1]],
    [8, [regulation, first, second, third], [0, 1]],
    [9, [regulation, first, second, third, timeoutPlay("ot4", 8, "158")], [0, 0]],
  ]) {
    const event = provider.normalizeEvent(timeoutGame(period, plays));
    assert.deepEqual(counts(event), expected, `period ${period}`);
    assert.equal(event.details.timeoutMaximum, 1);
  }
});

test("charge flags identify defensive and injury timeouts; neutral stoppages do not consume one", () => {
  const defensive = timeoutPlay("defense", 3, "264");
  defensive.start = defensive.end = { team: { id: "158" } };
  const injury = timeoutPlay("injury", 3, "158", "Injury timeout");
  const official = { id: "official", period: { number: 3 }, type: { id: "21" }, text: "Official Timeout", start: defensive.start };
  const media = { ...official, id: "media", text: "Media Timeout" };
  const warning = { ...official, id: "warning", text: "Two-minute timeout" };
  const event = provider.normalizeEvent(timeoutGame(3, [defensive, injury, official, media, warning]));
  assert.deepEqual(counts(event), [2, 2]);
});

test("named timeout fallback uses team identity, never possession", () => {
  const play = { id: "named", period: { number: 3 }, type: { id: "21" },
    text: "Timeout WASH, clock 11:00", start: { team: { id: "158" } } };
  assert.deepEqual(counts(provider.normalizeEvent(timeoutGame(3, [play]))), [2, 3]);
  play.text = "Timeout unknown, clock 11:00";
  assert.deepEqual(counts(provider.normalizeEvent(timeoutGame(3, [play]))), [null, null]);
});

test("later periods without sufficient history hide counts instead of using cumulative totals", () => {
  for (const period of [3, 4, 5, 8]) {
    const payload = liveEvent();
    payload.status.period = period;
    assert.deepEqual(counts(provider.normalizeEvent(payload)), [null, null]);
    payload.drives = { current: { plays: [timeoutPlay("partial", period, "264")] } };
    assert.deepEqual(counts(provider.normalizeEvent(payload)), [null, null]);
    payload.competitions[0].competitors[0].timeoutsRemaining = 0;
    payload.competitions[0].competitors[1].timeoutsRemaining = 1;
    assert.deepEqual(counts(provider.normalizeEvent(payload)), [0, 1], "explicit remaining counts are usable, including zero");
  }
  const gap = timeoutGame(8, [timeoutPlay("second-ot", 6, "264")]);
  assert.deepEqual(counts(provider.normalizeEvent(gap)), [null, null], "missing 3OT cannot replenish its shared allowance in 4OT");
  const injury = timeoutGame(3, [{ id: "injury", period: { number: 3 }, type: { id: "21" }, text: "Injury timeout" }]);
  assert.deepEqual(counts(provider.normalizeEvent(injury)), [null, null], "an injury stoppage without charge information is ambiguous");
});
