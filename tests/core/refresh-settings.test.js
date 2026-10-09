"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../core/config.js');
const api = globalThis.SportsOverlay.config;

test('legacy refresh settings migrate without changing any interval', () => {
  const legacy = structuredClone(api.DEFAULT_CONFIG);
  legacy.providerRefreshSeconds.baseball.live = 3600;
  legacy.providerRefreshSeconds.chess.final = 300;
  for (const sport of api.SPORT_CATALOG.slice(1, 7)) legacy.providerRefreshSeconds[sport.key].live = 45;
  const migrated = api.normalizeConfig(legacy);
  assert.deepEqual(migrated.providerRefreshSeconds, legacy.providerRefreshSeconds);
  assert.equal(migrated.providerRefreshPolicy.shared.live, 45);
  assert.deepEqual(migrated.providerRefreshPolicy.overrides.baseball, ['live']);
  assert.deepEqual(migrated.providerRefreshPolicy.overrides.chess, ['live']);
  assert.deepEqual(api.normalizeConfig(JSON.parse(JSON.stringify(migrated))), migrated);
});

test('fresh defaults have four shared intervals and only the four expected exceptions', () => {
  assert.deepEqual(api.normalizeConfig().providerRefreshPolicy, {
    shared: { live: 12, pregame: 60, final: 300, idle: 300 },
    overrides: { 'disc-golf': ['live'], 'formula-1': ['live'], chess: ['live', 'final'] },
  });
});

test('shared edits preserve exceptions even when values match and survive export/import', () => {
  let config = api.normalizeConfig({ sports: [{ sport: 'football', enabled: false, favorites: [] }] });
  api.setRefreshInterval(config, 'live', 30);
  config = api.normalizeConfig(JSON.parse(JSON.stringify(config)));
  api.setRefreshInterval(config, 'live', 50);
  assert.equal(config.providerRefreshSeconds.baseball.live, 50);
  assert.equal(config.providerRefreshSeconds.football.live, 50, 'disabled sports still inherit');
  assert.equal(config.providerRefreshSeconds.chess.live, 30);
  assert.equal(config.providerRefreshSeconds['disc-golf'].live, 30);
  assert.equal(config.providerRefreshSeconds['formula-1'].live, 30);
  api.setRefreshInterval(config, 'pregame', 120);
  assert.ok(Object.values(config.providerRefreshSeconds).every(value => value.pregame === 120));
  assert.equal(config.providerRefreshSeconds.chess.final, 900);
});

test('explicit custom timings stay independent and using shared restores inheritance per state', () => {
  let config = api.normalizeConfig();
  api.setRefreshInterval(config, 'live', 12, 'baseball');
  api.setRefreshInterval(config, 'final', 3600, 'baseball');
  config = api.normalizeConfig(JSON.parse(JSON.stringify(config)));
  api.setRefreshInterval(config, 'live', 60);
  assert.equal(config.providerRefreshSeconds.baseball.live, 12);
  api.setRefreshInterval(config, 'live', null, 'baseball');
  assert.equal(config.providerRefreshSeconds.baseball.live, 60);
  api.setRefreshInterval(config, 'live', 15);
  assert.equal(config.providerRefreshSeconds.baseball.live, 15);
  assert.equal(config.providerRefreshSeconds.baseball.final, 3600);
  assert.deepEqual(config.providerRefreshPolicy.overrides.baseball, ['final']);
  api.setRefreshInterval(config, 'final', null, 'baseball');
  assert.equal(config.providerRefreshPolicy.overrides.baseball, undefined);
});

test('invalid updates do not mutate settings and malformed policy preserves effective timings', () => {
  const config = api.normalizeConfig(), before = structuredClone(config);
  for (const value of [4, 3601, 1.5, '30', NaN, null]) assert.equal(api.setRefreshInterval(config, 'live', value), false);
  assert.equal(api.setRefreshInterval(config, 'unknown', 30), false);
  assert.equal(api.setRefreshInterval(config, 'live', 30, 'unknown'), false);
  assert.deepEqual(config, before);
  const normalized = api.normalizeConfig({ ...config, providerRefreshPolicy: {
    shared: { live: '30', pregame: 0, final: 3601 }, overrides: { baseball: ['bad'], chess: 'live', unknown: ['live'] },
  } });
  assert.deepEqual(normalized, before);
});

test('migration ties prefer defaults, otherwise stable catalog order', () => {
  const config = structuredClone(api.DEFAULT_CONFIG);
  api.SPORT_CATALOG.forEach(({ key }, index) => { config.providerRefreshSeconds[key].live = index < 5 ? 45 : 12; });
  assert.equal(api.normalizeConfig(config).providerRefreshPolicy.shared.live, 12);
  api.SPORT_CATALOG.forEach(({ key }, index) => { config.providerRefreshSeconds[key].live = index < 5 ? 45 : 60; });
  assert.equal(api.normalizeConfig(config).providerRefreshPolicy.shared.live, 45);
});
