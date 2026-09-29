"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.SportsOverlay = {};
require("../../core/provider-discovery.js");
const { discover } = globalThis.SportsOverlay.providerDiscovery;
const toCandidate = game => game;

test("merges every team schedule, deduplicates shared games, and requests one scoreboard", async () => {
  const requested = [];
  let scoreboards = 0;
  const result = await discover({ teams: [{ teamId: "a" }, { teamId: "b" }], toCandidate,
    provider: { findLeagueGames: async () => { scoreboards++; return [{ id: "league" }]; } },
    createClient: team => ({ findGames: async () => {
      requested.push(team.teamId);
      return [{ id: "shared" }, { id: team.teamId }];
    } }),
  });
  assert.deepEqual(requested, ["a", "b"]);
  assert.equal(scoreboards, 1);
  assert.deepEqual(result.favoriteGames.map(game => game.id), ["shared", "a", "b"]);
  assert.equal(result.failures, 0);
});

test("a failing team preserves other schedules and the league scoreboard", async () => {
  const result = await discover({ teams: [{ teamId: "bad" }, { teamId: "good" }], toCandidate,
    provider: { findLeagueGames: async () => [{ id: "league" }] },
    createClient: team => ({ findGames: async () => {
      if (team.teamId === "bad") throw new Error("offline");
      return [{ id: "good" }];
    } }),
  });
  assert.equal(result.failures, 1);
  assert.deepEqual(result.favoriteGames, [{ id: "good" }]);
  assert.deepEqual(result.leagueGames, [{ id: "league" }]);
});

test("no included teams requests only the league scoreboard", async () => {
  const result = await discover({ teams: [], toCandidate,
    provider: { findLeagueGames: async () => [{ id: "league" }] },
    createClient: () => { throw new Error("unexpected team schedule"); },
  });
  assert.deepEqual(result.favoriteGames, []);
  assert.equal(result.leagueGames.length, 1);
});

test("large team lists have at most four concurrent discovery operations", async () => {
  let active = 0, peak = 0, count = 0;
  async function request() {
    peak = Math.max(peak, ++active); count++;
    await new Promise(resolve => setImmediate(resolve));
    active--; return [];
  }
  await discover({ teams: Array.from({ length: 30 }, (_, teamId) => ({ teamId })), toCandidate,
    provider: { findLeagueGames: request }, createClient: () => ({ findGames: request }),
  });
  assert.equal(count, 31);
  assert.equal(peak, 4);
});

test("complete discovery failure remains an error", async () => {
  const fail = async () => { throw new Error("offline"); };
  await assert.rejects(discover({ teams: [{}], toCandidate,
    provider: { findLeagueGames: fail }, createClient: () => ({ findGames: fail }),
  }), /offline/);
});
