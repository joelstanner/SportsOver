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
  assert.deepEqual(sportKeys(config), ["baseball", "football", "college-football", "hockey", "soccer", "basketball"]);
  assert.deepEqual(favoriteKeys(config, "college-football"), ["ncaaf:158", "ncaaf:264"]);
  assert.equal(config.rotationSeconds, 10);
  configApi.TEAM_CATALOG.forEach(team => assert.match(team.logoUrl, /^https:\/\//));
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
    fallbackMode: "hide",
    displayMode: "rotate",
  });
  assert.deepEqual(sportKeys(config), ["college-football", "football", "baseball", "hockey", "soccer", "basketball"]);
  assert.deepEqual(config.sports[0].favorites, [
    { teamKey: "ncaaf:264", enabled: true },
    { teamKey: "ncaaf:158", enabled: false },
  ]);
  assert.equal(config.rotationSeconds, 300);
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
  assert.deepEqual(sportKeys(config), ["college-football", "football", "baseball", "hockey", "soccer", "basketball"]);
  assert.deepEqual(favoriteKeys(config, "college-football"), ["ncaaf:264", "ncaaf:158"]);
  assert.equal(config.sports.find(group => group.sport === "baseball").favorites[0].enabled, false);
});

test("older settings gain later default teams before grouped migration", () => {
  const storage = memoryStorage();
  storage.setItem(configApi.STORAGE_KEY, JSON.stringify({ version: 2, favorites: [{ teamKey: "mls:9726", enabled: true }] }));
  const config = configApi.loadConfig(storage);
  assert.deepEqual(sportKeys(config), ["soccer", "college-football", "basketball", "baseball", "football", "hockey"]);
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
  assert.deepEqual(sportKeys(configApi.resetConfig(storage)), ["baseball", "football", "college-football", "hockey", "soccer", "basketball"]);
});
