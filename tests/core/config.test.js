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

test("defaults include NFL and separate college-football favorites", () => {
  const config = configApi.loadConfig(memoryStorage());
  assert.deepEqual(config.favorites.map(favorite => favorite.teamKey), ["mlb:136", "nfl:sea", "ncaaf:158", "ncaaf:264", "nhl:sea", "mls:9726", "nba:det"]);
  assert.deepEqual(configApi.enabledTeams(config).map(team => team.name), ["Seattle Mariners", "Seattle Seahawks", "Nebraska Cornhuskers", "Washington Huskies", "Seattle Kraken", "Seattle Sounders FC", "Detroit Pistons"]);
});

test("normalizes favorite order and behavior settings", () => {
  const config = configApi.normalizeConfig({
    favorites: [
      { teamKey: "NFL:SEA", enabled: true },
      { teamKey: "mlb:136", enabled: false },
      { teamKey: "nfl:sea", enabled: true },
      { teamKey: "missing", enabled: true },
    ],
    rotationSeconds: 999,
    fallbackMode: "hide",
    displayMode: "rotate",
  });
  assert.deepEqual(config.favorites, [
    { teamKey: "nfl:sea", enabled: true },
    { teamKey: "mlb:136", enabled: false },
  ]);
  assert.equal(config.rotationSeconds, 300);
  assert.equal(config.fallbackMode, "hide");
  assert.equal(config.displayMode, "rotate");
});

test("migrates older saved settings to include new default teams", () => {
  const storage = memoryStorage();
  storage.setItem(configApi.STORAGE_KEY, JSON.stringify({ version: 1, favorites: [{ teamKey: "nfl:sea", enabled: true }] }));
  assert.deepEqual(configApi.loadConfig(storage).favorites.map(favorite => favorite.teamKey), ["nfl:sea", "ncaaf:158", "ncaaf:264", "nhl:sea", "mls:9726", "nba:det"]);
});

test("adds Pistons and college-football favorites when migrating version two settings", () => {
  const storage = memoryStorage();
  storage.setItem(configApi.STORAGE_KEY, JSON.stringify({ version: 2, favorites: [{ teamKey: "mls:9726", enabled: true }] }));
  assert.deepEqual(configApi.loadConfig(storage).favorites.map(favorite => favorite.teamKey), ["mls:9726", "ncaaf:158", "ncaaf:264", "nba:det"]);
});

test("migrates version three settings to include both college-football favorites", () => {
  const storage = memoryStorage();
  storage.setItem(configApi.STORAGE_KEY, JSON.stringify({ version: 3, favorites: [{ teamKey: "nfl:sea", enabled: true }] }));
  assert.deepEqual(configApi.loadConfig(storage).favorites.map(favorite => favorite.teamKey), ["nfl:sea", "ncaaf:158", "ncaaf:264"]);
});

test("saves, loads, and resets configuration", () => {
  const storage = memoryStorage();
  configApi.saveConfig({ favorites: [{ teamKey: "nfl:sea", enabled: true }], rotationSeconds: 45 }, storage);
  assert.deepEqual(configApi.loadConfig(storage).favorites, [{ teamKey: "nfl:sea", enabled: true }]);
  assert.equal(configApi.loadConfig(storage).rotationSeconds, 45);
  assert.deepEqual(configApi.resetConfig(storage).favorites.map(favorite => favorite.teamKey), ["mlb:136", "nfl:sea", "ncaaf:158", "ncaaf:264", "nhl:sea", "mls:9726", "nba:det"]);
});
