"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../core/config.js");

const configApi = global.SportsOverlay.config;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

function sportKeys(config) {
  return config.sports.map(group => group.sport);
}

function favoriteKeys(config, sport) {
  return config.sports.find(group => group.sport === sport).favorites.map(favorite => favorite.teamKey);
}

test("defaults rank sports first and favorites within each sport", () => {
  const config = configApi.loadConfig(memoryStorage());
  assert.deepEqual(sportKeys(config), ["baseball", "football", "college-football", "hockey", "soccer", "basketball", "college-basketball"]);
  assert.deepEqual(favoriteKeys(config, "college-football"), ["ncaaf:158", "ncaaf:264"]);
  assert.equal(config.rotationSeconds, 10);
  configApi.TEAM_CATALOG.forEach(team => assert.match(team.logoUrl, /^https:\/\//));
  assert.ok(configApi.TEAM_CATALOG.filter(team => team.sport === "college-basketball").length > 350);
  assert.deepEqual(favoriteKeys(config, "college-basketball"), []);
  assert.equal(configApi.findTeam("ncaam:264").name, "Washington Huskies");
  assert.equal(configApi.TEAM_CATALOG.filter(team => team.sport === "college-football").length, 762);
  assert.equal(configApi.findTeam("nba:lal").name, "Los Angeles Lakers");
  assert.deepEqual(configApi.enabledTeams(config).map(team => team.name), ["Seattle Mariners", "Seattle Seahawks", "Nebraska Cornhuskers", "Washington Huskies", "Seattle Kraken", "Seattle Sounders FC", "Detroit Pistons"]);
});

test("normalizes independent sport and favorite rankings", () => {
  const config = configApi.normalizeConfig({
    sports: [
      { sport: "COLLEGE-FOOTBALL", favorites: [
        { teamKey: "NCAAF:264", enabled: true },
        { teamKey: "ncaaf:158", enabled: false },
        { teamKey: "ncaaf:264", enabled: true },
        { teamKey: "nfl:sea", enabled: true },
      ] },
      { sport: "football", favorites: [{ teamKey: "nfl:sea", enabled: true }] },
      { sport: "college-football", favorites: [] },
      { sport: "missing", favorites: [] },
    ],
    rotationSeconds: 999,
    rotationMode: "hybrid",
    includedGames: ["football:401", "missing:2", "football:401"],
    excludedGames: ["baseball:777"],
    rotationOrder: ["baseball:777", "football:401"],
    gameDurations: { "football:401": 23, "baseball:777": 302, "missing:2": 15, "football:": 10 },
    lockedGameKeys: ["football:401", "baseball:777", "football:401"],
    fallbackMode: "hide",
    displayMode: "rotate",
  });
  assert.deepEqual(sportKeys(config), ["college-football", "football", "baseball", "hockey", "soccer", "basketball", "college-basketball"]);
  assert.deepEqual(config.sports[0].favorites, [
    { teamKey: "ncaaf:264", enabled: true },
    { teamKey: "ncaaf:158", enabled: false },
  ]);
  assert.equal(config.rotationSeconds, 300);
  assert.equal(config.rotationMode, "hybrid");
  assert.deepEqual(config.includedGames, ["football:401"]);
  assert.deepEqual(config.excludedGames, ["baseball:777"]);
  assert.deepEqual(config.rotationOrder, ["baseball:777", "football:401"]);
  assert.deepEqual(config.gameDurations, { "football:401": 25, "baseball:777": 300 });
  assert.deepEqual(config.lockedGameKeys, ["football:401", "baseball:777"]);
  assert.equal(config.fallbackMode, "hide");
  assert.equal(config.displayMode, "rotate");
});

test("migrates flat version four favorites into ranked sport groups", () => {
  const storage = memoryStorage();
  storage.setItem(configApi.STORAGE_KEY, JSON.stringify({
    version: 4,
    favorites: [
      { teamKey: "ncaaf:264", enabled: true },
      { teamKey: "ncaaf:158", enabled: true },
      { teamKey: "nfl:sea", enabled: true },
      { teamKey: "mlb:136", enabled: false },
    ],
  }));
  const config = configApi.loadConfig(storage);
  assert.deepEqual(sportKeys(config), ["college-football", "football", "baseball", "hockey", "soccer", "basketball", "college-basketball"]);
  assert.deepEqual(favoriteKeys(config, "college-football"), ["ncaaf:264", "ncaaf:158"]);
  assert.equal(config.sports.find(group => group.sport === "baseball").favorites[0].enabled, false);
});

test("older settings gain later default teams before grouped migration", () => {
  const storage = memoryStorage();
  storage.setItem(configApi.STORAGE_KEY, JSON.stringify({ version: 2, favorites: [{ teamKey: "mls:9726", enabled: true }] }));
  const config = configApi.loadConfig(storage);
  assert.deepEqual(sportKeys(config), ["soccer", "college-football", "basketball", "baseball", "football", "hockey", "college-basketball"]);
  assert.deepEqual(favoriteKeys(config, "college-football"), ["ncaaf:158", "ncaaf:264"]);
  assert.deepEqual(favoriteKeys(config, "basketball"), ["nba:det"]);
});

test("saves, loads, and resets nested configuration", () => {
  const storage = memoryStorage();
  const sports = [
    { sport: "football", favorites: [{ teamKey: "nfl:sea", enabled: true }] },
    { sport: "baseball", favorites: [] },
  ];
  configApi.saveConfig({ sports, rotationSeconds: 45 }, storage);
  assert.deepEqual(sportKeys(configApi.loadConfig(storage)).slice(0, 2), ["football", "baseball"]);
  assert.deepEqual(favoriteKeys(configApi.loadConfig(storage), "football"), ["nfl:sea"]);
  assert.equal(configApi.loadConfig(storage).rotationSeconds, 45);
  assert.deepEqual(sportKeys(configApi.resetConfig(storage)), ["baseball", "football", "college-football", "hockey", "soccer", "basketball", "college-basketball"]);
});

test("rotation timing allows five seconds and invalid queue controls fall back safely", () => {
  const config = configApi.normalizeConfig({
    rotationSeconds: 1,
    rotationMode: "surprise",
    includedGames: ["football:", ":401", "football:401"],
  });
  assert.equal(config.rotationSeconds, 5);
  assert.equal(config.rotationMode, "automatic");
  assert.deepEqual(config.includedGames, ["football:401"]);
  assert.deepEqual(config.gameDurations, {});
  assert.deepEqual(config.lockedGameKeys, []);
});

test("migrates the legacy single-game lock into the multi-lock list", () => {
  const config = configApi.normalizeConfig({ lockedGameKey: "football:401" });
  assert.deepEqual(config.lockedGameKeys, ["football:401"]);
});

test("catalog reload retains the hosted script base after currentScript clears", async () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const path = require("node:path");
  for (const prefix of ["/sports", ""]) {
    const requests = [];
    const document = { currentScript: { src: `http://localhost:8000${prefix}/core/config.js?v=13` } };
    const window = { location: { origin: "http://localhost:8000" } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../core/config.js"), "utf8"), {
      window, document, URL, console,
      fetch: async url => {
        requests.push(url.pathname);
        return { ok: true, json: async () => ({ teams: [] }) };
      },
    });
    await window.SportsOverlay.config.ready;
    const initialRequests = [...requests];
    requests.length = 0;
    document.currentScript = null;
    await window.SportsOverlay.config.reloadTeamCatalog();
    assert.equal(requests.length, 7);
    assert.deepEqual(requests, initialRequests);
    assert.ok(requests.every(url => url.startsWith(`${prefix}/sports/`)));
  }
});

test("default game durations migrate and normalize", () => {
  assert.deepEqual(configApi.normalizeConfig({}).defaultGameDurations, { live: 20, pregame: 5, final: 10 });
  assert.deepEqual(configApi.normalizeConfig({ defaultGameDurations: { live: 33, pregame: 0, final: 999 } }).defaultGameDurations,
    { live: 35, pregame: 5, final: 300 });
  assert.deepEqual(configApi.normalizeConfig({ defaultGameDurations: { live: null, pregame: "bad" } }).defaultGameDurations,
    { live: 20, pregame: 5, final: 10 });
});
