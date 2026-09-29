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
  assert.deepEqual(queue.map(entry => [entry.candidate.id, entry.featuredTeamId]), [["top-live", "NEB"]]);
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
