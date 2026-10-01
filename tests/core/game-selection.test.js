"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../core/game-selection.js");

const selection = global.SportsOverlay.selection;

function espnGame(id, state, awayId, homeId, overrides = {}) {
  return {
    id,
    date: overrides.date || "2026-10-10T20:00:00Z",
    season: { type: overrides.seasonType || 2 },
    competitions: [{
      status: { period: overrides.period || 2, type: { state } },
      broadcasts: overrides.national ? [{ market: "national", names: ["ABC"] }] : [],
      odds: overrides.spread === undefined ? [] : [{ spread: overrides.spread }],
      competitors: [
        { id: awayId, score: String(overrides.awayScore ?? 10), curatedRank: { current: overrides.awayRank ?? 99 }, team: { id: awayId, abbreviation: awayId } },
        { id: homeId, score: String(overrides.homeScore ?? 13), curatedRank: { current: overrides.homeRank ?? 99 }, team: { id: homeId, abbreviation: homeId } },
      ],
    }],
  };
}

const candidate = game => selection.espnCandidate(game, "football");

test("live favorite suppresses non-favorite spotlight rotation", () => {
  const favorite = espnGame("favorite-live", "in", "SEA", "SF");
  const marquee = espnGame("marquee", "in", "KC", "BUF", { national: true, spread: 1 });
  const queue = selection.buildRotationQueue({
    favoriteGames: [favorite],
    leagueGames: [favorite, marquee],
    favoriteTeamIds: ["SEA"],
    toCandidate: candidate,
  });
  assert.deepEqual(queue.map(entry => [entry.kind, entry.candidate.id]), [["favorite-live", "favorite-live"]]);
});

test("live favorite selection respects favorite ranking", () => {
  const topFavorite = espnGame("top-live", "in", "NEB", "IOWA");
  const secondFavorite = espnGame("second-live", "in", "WASH", "ORE");
  const queue = selection.buildRotationQueue({
    favoriteGames: [secondFavorite],
    leagueGames: [secondFavorite, topFavorite],
    favoriteTeamIds: ["NEB", "WASH"],
    toCandidate: candidate,
  });
  assert.deepEqual(queue.map(entry => [entry.candidate.id, entry.featuredTeamId]), [["top-live", "NEB"], ["second-live", "WASH"]]);
});

test("pregame favorite rotates with the biggest non-favorite live game", () => {
  const favorite = espnGame("favorite-pregame", "pre", "SEA", "SF");
  const local = espnGame("local", "in", "NYJ", "MIA", { awayScore: 3, homeScore: 20 });
  const marquee = espnGame("marquee", "in", "KC", "BUF", { national: true, spread: 1, awayScore: 17, homeScore: 20 });
  const queue = selection.buildRotationQueue({
    favoriteGames: [favorite],
    leagueGames: [local, marquee],
    favoriteTeamIds: ["SEA"],
    toCandidate: candidate,
  });
  assert.deepEqual(queue.map(entry => [entry.kind, entry.candidate.id]), [
    ["favorite", "favorite-pregame"],
    ["spotlight", "marquee"],
  ]);
});

test("public-interest signals rank postseason, broadcasts, rankings, close lines, and close scores", () => {
  const plain = candidate(espnGame("plain", "in", "A", "B", { awayScore: 3, homeScore: 24 }));
  const marquee = candidate(espnGame("marquee", "in", "C", "D", { seasonType: 3, national: true, spread: 1.5, awayRank: 2, homeRank: 5, awayScore: 20, homeScore: 21 }));
  assert.ok(selection.interestScore(marquee) > selection.interestScore(plain));
});

test("fallback mode controls whether upcoming or recent favorite games enter rotation", () => {
  const pregame = espnGame("pregame", "pre", "SEA", "SF", { date: "2026-10-12T20:00:00Z" });
  const final = espnGame("final", "post", "SEA", "LAR", { date: "2026-10-05T20:00:00Z" });
  const base = { favoriteGames: [final, pregame], leagueGames: [], favoriteTeamIds: ["SEA"], toCandidate: candidate, includeSpotlight: false };
  assert.equal(selection.buildRotationQueue({ ...base, fallbackMode: "up-next" })[0].candidate.id, "pregame");
  assert.equal(selection.buildRotationQueue({ ...base, fallbackMode: "recent-final" })[0].candidate.id, "final");
  assert.deepEqual(selection.buildRotationQueue({ ...base, fallbackMode: "hide" }), []);
});

test("hybrid rotation adds manual games, honors exclusions, and preserves explicit order", () => {
  const first = { candidate: candidate(espnGame("first", "in", "SEA", "SF")) };
  const second = { candidate: candidate(espnGame("second", "in", "KC", "BUF")) };
  const third = { candidate: candidate(espnGame("third", "pre", "NYJ", "MIA")) };
  const queue = selection.applyRotationControls({
    automaticEntries: [first, second],
    availableEntries: [first, second, third],
    mode: "hybrid",
    includedGameKeys: ["football:third"],
    excludedGameKeys: ["football:second"],
    rotationOrder: ["football:third", "football:first"],
  });
  assert.deepEqual(queue.map(entry => entry.candidate.id), ["third", "first"]);
});

test("curated rotation contains only manually included games", () => {
  const automatic = { candidate: candidate(espnGame("automatic", "in", "SEA", "SF")) };
  const manual = { candidate: candidate(espnGame("manual", "in", "KC", "BUF")) };
  const queue = selection.applyRotationControls({
    automaticEntries: [automatic],
    availableEntries: [automatic, manual],
    mode: "curated",
    includedGameKeys: ["football:manual"],
  });
  assert.deepEqual(queue.map(entry => entry.candidate.id), ["manual"]);
});

test("game locks select one held game or a rotating subset", () => {
  const entries = ["first", "second", "third"].map(id => ({ candidate: candidate(espnGame(id, "in", "SEA", "SF")) }));
  assert.deepEqual(selection.applyGameLocks(entries, ["football:second"]).map(entry => entry.candidate.id), ["second"]);
  assert.deepEqual(selection.applyGameLocks(entries, ["football:first", "football:third"]).map(entry => entry.candidate.id), ["first", "third"]);
  assert.deepEqual(selection.applyGameLocks(entries, ["football:missing"]).map(entry => entry.candidate.id), ["first", "second", "third"]);
});

test("auto-added live games remain for one hour after becoming final", () => {
  const live = { kind: "spotlight", candidate: candidate(espnGame("game", "in", "KC", "BUF")) };
  const final = { kind: "manual", candidate: candidate(espnGame("game", "post", "KC", "BUF")) };
  const unrelatedFinal = { kind: "manual", candidate: candidate(espnGame("other", "post", "NYJ", "MIA")) };
  const first = selection.retainAutoFinals([live], [], [final, unrelatedFinal], { now: 1_000 });
  assert.deepEqual(first.map(entry => entry.candidate.id), ["game"]);
  assert.equal(first[0].candidate.state, "final");
  assert.equal(first[0].autoRetainUntil, 3_601_000);
  assert.deepEqual(selection.retainAutoFinals(first, [], [final], { now: 3_600_999 }).map(entry => entry.candidate.id), ["game"]);
  assert.deepEqual(selection.retainAutoFinals(first, [], [final], { now: 3_601_000 }), []);
});

test("game timing uses state defaults and five-second overrides", () => {
  const live = { candidate: candidate(espnGame("live", "in", "SEA", "SF")) };
  const upcoming = { candidate: candidate(espnGame("upcoming", "pre", "SEA", "SF")) };
  const final = { candidate: candidate(espnGame("final", "post", "SEA", "SF")) };
  assert.equal(selection.gameDurationSeconds(live), 20);
  assert.equal(selection.gameDurationSeconds(upcoming), 5);
  assert.equal(selection.gameDurationSeconds(final), 10);
  assert.equal(selection.gameDurationSeconds(live, { "football:live": 33 }), 35);
});

test("custom state durations apply unless a game has an override", () => {
  const defaults = { live: 40, pregame: 15, final: 25 };
  for (const [state, expected] of [["live", 40], ["interrupted", 40], ["pregame", 15], ["final", 25]]) {
    const entry = { candidate: { sport: "football", id: "1", state } };
    assert.equal(selection.gameDurationSeconds(entry, {}, undefined, defaults), expected);
    assert.equal(selection.gameDurationSeconds(entry, { "football:1": 60 }, undefined, defaults), 60);
  }
});

test("Mariners and Padres each contribute an upcoming game in watched-team order", () => {
  const mlbGame = (id, team, state, date) => ({ gamePk: id, gameDate: date, status: { abstractGameState: state }, teams: { away: { team: { id: team } }, home: { team: { id: 119 } } } });
  const games = [
    mlbGame(3, 135, 'Preview', '2026-10-02T20:00:00Z'),
    mlbGame(1, 136, 'Preview', '2026-10-03T20:00:00Z'),
    mlbGame(2, 135, 'Preview', '2026-10-01T20:00:00Z'),
  ];
  const args = { favoriteGames: games, favoriteTeamIds: [136, 135], toCandidate: selection.mlbCandidate, includeSpotlight: false };
  assert.deepEqual(selection.buildRotationQueue(args).map(entry => [entry.candidate.id, entry.featuredTeamId]), [['1', '136'], ['2', '135']]);
  assert.deepEqual(selection.buildRotationQueue({ ...args, favoriteTeamIds: [135, 136] }).map(entry => entry.candidate.id), ['2', '1']);
});

test("a live watched game replaces only its own fallback, retaining other teams' upcoming games", () => {
  const games = [espnGame('sea-next', 'pre', 'SEA', 'SF'), espnGame('was-next', 'pre', 'WAS', 'DAL'), espnGame('was-live', 'in', 'WAS', 'NYG')];
  const queue = selection.buildRotationQueue({ favoriteGames: games, leagueGames: [espnGame('spotlight', 'in', 'KC', 'BUF')], favoriteTeamIds: ['SEA', 'WAS'], toCandidate: candidate });
  assert.deepEqual(queue.map(entry => [entry.candidate.id, entry.kind]), [['sea-next', 'favorite'], ['was-live', 'favorite-live']]);
});

test("shared watched matchups occur once and retain the highest-ranked team's identity", () => {
  const shared = espnGame('shared', 'pre', 'SEA', 'SF');
  const queue = selection.buildRotationQueue({ favoriteGames: [shared, shared], leagueGames: [shared], favoriteTeamIds: ['SF', 'SEA'], toCandidate: candidate });
  assert.deepEqual(queue.map(entry => [entry.candidate.id, entry.featuredTeamId]), [['shared', 'SF']]);
});

test("each team uses its own recent final; missing games do not suppress other teams", () => {
  const args = { favoriteGames: [espnGame('old', 'post', 'SEA', 'SF', { date: '2026-10-01T00:00:00Z' }), espnGame('latest', 'post', 'SEA', 'SF'), espnGame('second', 'post', 'WAS', 'DAL')], favoriteTeamIds: ['MISSING', 'SEA', 'WAS'], fallbackMode: 'recent-final', toCandidate: candidate, includeSpotlight: false };
  assert.deepEqual(selection.buildRotationQueue(args).map(entry => entry.candidate.id), ['latest', 'second']);
  assert.deepEqual(selection.buildRotationQueue({ ...args, fallbackMode: 'hide' }), []);
});

test("top-only mode limits selection to the first included team even if another is live", () => {
  const args = { favoriteGames: [espnGame('first-next', 'pre', 'SEA', 'SF'), espnGame('second-live', 'in', 'WAS', 'DAL')], favoriteTeamIds: ['SEA', 'WAS'], toCandidate: candidate, topFavoriteOnly: true, includeSpotlight: false };
  assert.deepEqual(selection.buildRotationQueue(args).map(entry => entry.candidate.id), ['first-next']);
  assert.deepEqual(selection.buildRotationQueue({ ...args, favoriteTeamIds: ['MISSING', 'WAS'] }), []);
});
