"use strict";
require('../../scripts/offline-network.cjs');

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

test('betting visibility defaults on for existing settings and persists explicit off', () => {
  for (const value of [undefined, null, 'false', 0, true]) {
    assert.equal(configApi.normalizeConfig({showBettingInfo:value}).showBettingInfo,true);
  }
  const storage = memoryStorage();
  configApi.saveConfig({showBettingInfo:false},storage);
  assert.equal(configApi.loadConfig(storage).showBettingInfo,false);
  configApi.saveConfig({...configApi.loadConfig(storage),showBettingInfo:true},storage);
  assert.equal(configApi.loadConfig(storage).showBettingInfo,true);
  assert.equal(configApi.resetConfig(storage).showBettingInfo,true);
});

test('banner sport filters persist only supported, enabled sports and default off', () => {
  assert.equal(configApi.normalizeConfig().bannerSportFilter, '');
  assert.equal(configApi.normalizeConfig({ bannerSportFilter: 'chess' }).bannerSportFilter, 'chess');
  for (const bannerSportFilter of ['missing', null, true, {}]) {
    assert.equal(configApi.normalizeConfig({ bannerSportFilter }).bannerSportFilter, '');
  }
  assert.equal(configApi.normalizeConfig({ bannerSportFilter: 'chess', sports: [{ sport: 'chess', enabled: false }] }).bannerSportFilter, '');
  const storage = memoryStorage();
  configApi.saveConfig({ bannerSportFilter: 'baseball' }, storage);
  assert.equal(configApi.loadConfig(storage).bannerSportFilter, 'baseball');
});

test('Live mode retention defaults to 20 minutes, validates limits, and never persists activation', () => {
  assert.equal(configApi.normalizeConfig().liveModeFinalMinutes, 20);
  for (const [value, expected] of [[0, 0], [5, 5], [30.5, 31], [-2, 0], [2000, 1440], [null, 20], ['10', 20], [NaN, 20]]) {
    const normalized = configApi.normalizeConfig({ liveModeFinalMinutes: value, liveMode: true });
    assert.equal(normalized.liveModeFinalMinutes, expected);
    assert.equal(Object.hasOwn(normalized, 'liveMode'), false);
  }
  const storage = memoryStorage();
  configApi.saveConfig({ ...configApi.normalizeConfig(), liveModeFinalMinutes: 7 }, storage);
  assert.equal(configApi.loadConfig(storage).liveModeFinalMinutes, 7);
});

test("sport visibility persists without losing favorites and older configs default to enabled", () => {
  const storage = memoryStorage();
  const config = configApi.normalizeConfig();
  assert.ok(config.sports.every(group => group.enabled));
  const hockey = config.sports.find(group => group.sport === 'hockey');
  const favorites = structuredClone(hockey.favorites);
  hockey.enabled = false;
  configApi.saveConfig(config, storage);
  const restored = configApi.loadConfig(storage);
  assert.equal(restored.sports.find(group => group.sport === 'hockey').enabled, false);
  assert.deepEqual(restored.sports.find(group => group.sport === 'hockey').favorites, favorites);
  assert.ok(configApi.enabledTeams(restored).every(team => team.sport !== 'hockey'));
  restored.sports.find(group => group.sport === 'hockey').enabled = true;
  assert.ok(configApi.enabledTeams(restored).some(team => team.sport === 'hockey'));
  restored.sports.forEach(group => { group.enabled = false; });
  assert.deepEqual(configApi.enabledTeams(restored), []);
});

test("defaults rank sports first and favorites within each sport", () => {
  const config = configApi.loadConfig(memoryStorage());
  assert.deepEqual(configApi.normalizeConfig(), config);
  assert.deepEqual(sportKeys(config), ["baseball", "football", "college-football", "hockey", "soccer", "basketball", "college-basketball", "disc-golf", "chess"]);
  assert.deepEqual(favoriteKeys(config, "college-football"), ["ncaaf:158", "ncaaf:264"]);
  assert.equal(config.rotationSeconds, 10);
  assert.deepEqual(config.providerRefreshSeconds.chess, { live: 30, pregame: 60, idle: 300, final: 900 });
  assert.equal(configApi.normalizeConfig({ providerRefreshSeconds: { chess: { final: 300 } } }).providerRefreshSeconds.chess.final, 300,
    'saved chess timings remain explicit preferences');
  configApi.TEAM_CATALOG.forEach(team => assert.match(team.logoUrl, /^https:\/\//));
  assert.ok(configApi.TEAM_CATALOG.filter(team => team.sport === "college-basketball").length > 350);
  assert.deepEqual(favoriteKeys(config, "college-basketball"), ["ncaam:158", "ncaam:264", "ncaam:2547"]);
  assert.deepEqual(favoriteKeys(config, "basketball"), ["nba:det"]);
  assert.equal(configApi.findTeam("ncaam:264").name, "Washington Huskies");
  assert.equal(configApi.TEAM_CATALOG.filter(team => team.sport === "college-football").length, 762);
  assert.equal(configApi.findTeam("nba:lal").name, "Los Angeles Lakers");
  assert.deepEqual(configApi.enabledTeams(config).map(team => team.name), ["Seattle Mariners", "Seattle Seahawks", "Nebraska Cornhuskers", "Washington Huskies", "Seattle Kraken", "Seattle Sounders FC", "Detroit Pistons", "Nebraska Cornhuskers", "Washington Huskies", "Seattle U Redhawks"]);
});

test("saved watched teams and intentionally empty sports do not gain first-run defaults", () => {
  const storage = memoryStorage();
  const saved = configApi.normalizeConfig({ sports: [
    { sport: "basketball", favorites: [{ teamKey: "nba:det", enabled: true }] },
    { sport: "college-basketball", enabled: false, favorites: [] },
    { sport: "college-football", favorites: [] },
  ] });
  configApi.saveConfig(saved, storage);
  assert.deepEqual(configApi.loadConfig(storage), saved);
  const reset = configApi.resetConfig(storage);
  assert.deepEqual(favoriteKeys(reset, "college-basketball"), ["ncaam:158", "ncaam:264", "ncaam:2547"]);
  assert.deepEqual(favoriteKeys(reset, "basketball"), ["nba:det"]);
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
  assert.deepEqual(sportKeys(config), ["college-football", "football", "baseball", "hockey", "soccer", "basketball", "college-basketball", "disc-golf", "chess"]);
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
  assert.equal(config.displayMode, "automatic", "legacy rotate maps to the equivalent automatic selection");
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
  assert.deepEqual(sportKeys(config), ["college-football", "football", "baseball", "hockey", "soccer", "basketball", "college-basketball", "disc-golf", "chess"]);
  assert.deepEqual(favoriteKeys(config, "college-football"), ["ncaaf:264", "ncaaf:158"]);
  assert.equal(config.sports.find(group => group.sport === "baseball").favorites[0].enabled, false);
});

test("older settings gain later default teams before grouped migration", () => {
  const storage = memoryStorage();
  storage.setItem(configApi.STORAGE_KEY, JSON.stringify({ version: 2, favorites: [{ teamKey: "mls:9726", enabled: true }] }));
  const config = configApi.loadConfig(storage);
  assert.deepEqual(sportKeys(config), ["soccer", "college-football", "basketball", "baseball", "football", "hockey", "college-basketball", "disc-golf", "chess"]);
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
  assert.deepEqual(sportKeys(configApi.resetConfig(storage)), ["baseball", "football", "college-football", "hockey", "soccer", "basketball", "college-basketball", "disc-golf", "chess"]);
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

test('second-tier discovery defaults on, persists an explicit off choice, and controls candidate eligibility independently',()=>{
 const api=global.SportsOverlay.config;
 for(const sport of ['chess','disc-golf']){
  const config=api.normalizeConfig({sports:[{sport,autoFollow:false}]});const group=config.sports[0];
  assert.equal(group.discoverSecondTier,true);
  const candidate={sport,id:sport==='chess'?'Tour1234:auto':'12345:MPO',raw:{automatic:true,discoveryTier:'second',division:'MPO'}};
  assert.equal(api.isCandidateEnabled(config,candidate),true);
  group.discoverSecondTier=false;assert.equal(api.isCandidateEnabled(config,candidate),false);
  assert.equal(api.normalizeConfig(config).sports[0].discoverSecondTier,false);
 }
});

test('explicit tournament additions survive discovery changes without overriding disabled watches', () => {
  const config = configApi.normalizeConfig({ includedGames: ['chess:vwZHETCy:auto', 'chess:Disabled:auto', 'disc-golf:12345:MPO', 'chess:bad:auto', 'chess:vwZHETCy:auto:banner:missing'],
    sports: [{sport:'chess',autoFollow:false,discoverSecondTier:false,events:[{tournamentId:'Disabled',enabled:false}]}] });
  const watches = configApi.eventWatches(config,'chess');
  assert.deepEqual(watches.map(configApi.watchId), ['Disabled:auto','vwZHETCy:auto']);
  assert.equal(watches[0].enabled,false);
  assert.equal(configApi.isCandidateEnabled(config,{sport:'chess',id:'vwZHETCy:auto'}),true);
  assert.equal(configApi.isCandidateEnabled(config,{sport:'chess',id:'Disabled:auto'}),false);
  assert.equal(configApi.eventWatches(config,'disc-golf')[0].division,'MPO');
  config.includedGames=[];
  assert.equal(configApi.isCandidateEnabled(config,{sport:'chess',id:'vwZHETCy:auto'}),false);
  assert.equal(configApi.eventWatches(config,'chess').length,1);
});
