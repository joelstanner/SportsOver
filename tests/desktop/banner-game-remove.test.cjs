const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../../desktop/store.cjs');
const { EngineState } = require('../../desktop/engine-state.cjs');
const { gameRemoveMenuItem } = require('../../desktop/banner-game-remove.cjs');

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sportsover-game-remove-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory), engine = new EngineState(), errors = [];
  const entries = ['1', '2'].map(id => ({ candidate: { sport: 'baseball', id } }));
  const publish = metadata => engine.publish({ html: '<main>Game</main>', metadata: {
    renderedGameKey: 'baseball:1', currentGameKey: 'baseball:2',
    normalQueue: entries, liveQueue: entries, automaticEntries: [entries[0]], ...metadata,
  } });
  const patch = config => store.patch({ instance: store.instance, expectedRevision: store.revision, config });
  const menu = () => gameRemoveMenuItem({ engine, store, onError: error => errors.push(error.message) });
  publish();
  return { directory, store, engine, errors, publish, patch, menu };
}

test('removing the rendered automatic game persists exclusion and clears only its selection and pin', t => {
  const { directory, store, patch, menu, errors } = setup(t);
  patch({ includedGames: ['baseball:1', 'baseball:2'], excludedGames: ['baseball:3'],
    rotationOrder: ['baseball:1', 'baseball:2'], lockedGameKeys: ['baseball:1', 'baseball:2'] });
  assert.equal(menu().enabled, true);
  menu().click();
  const config = store.snapshot().config;
  assert.deepEqual(config.includedGames, ['baseball:2']);
  assert.deepEqual(config.excludedGames, ['baseball:3', 'baseball:1']);
  assert.deepEqual(config.rotationOrder, ['baseball:2']);
  assert.deepEqual(config.lockedGameKeys, ['baseball:2']);
  assert.deepEqual(new Store(directory).snapshot().config, config);
  assert.deepEqual(errors, []);
});

test('manual removal matches Live Control hybrid reset and keeps curated mode', t => {
  const { store, patch, publish, menu } = setup(t);
  publish({ automaticEntries: [] });
  patch({ rotationMode: 'hybrid', includedGames: ['baseball:1'], excludedGames: [], lockedGameKeys: ['baseball:1'] });
  menu().click();
  assert.equal(store.snapshot().config.rotationMode, 'automatic');
  assert.deepEqual(store.snapshot().config.includedGames, []);
  assert.deepEqual(store.snapshot().config.excludedGames, []);
  assert.deepEqual(store.snapshot().config.lockedGameKeys, []);
  patch({ rotationMode: 'curated', includedGames: ['baseball:1'] });
  menu().click();
  assert.equal(store.snapshot().config.rotationMode, 'curated');
});

test('Live mode explicitly excludes even a manually selected game', t => {
  const { store, publish, patch, menu } = setup(t);
  publish({ automaticEntries: [], liveMode: { active: true } });
  patch({ includedGames: ['baseball:1'] });
  menu().click();
  assert.deepEqual(store.snapshot().config.excludedGames, ['baseball:1']);
});

test('an open menu removes its original game while preserving newer settings and pins', t => {
  const { store, patch, publish, menu, errors } = setup(t);
  const item = menu();
  patch({ includedGames: ['baseball:1', 'baseball:2'], lockedGameKeys: ['baseball:2'], rotationSeconds: 45 });
  publish({ renderedGameKey: 'baseball:2' });
  item.click();
  item.click();
  assert.deepEqual(store.snapshot().config.includedGames, ['baseball:2']);
  assert.deepEqual(store.snapshot().config.excludedGames, ['baseball:1']);
  assert.deepEqual(store.snapshot().config.lockedGameKeys, ['baseball:2']);
  assert.equal(store.snapshot().config.rotationSeconds, 45);
  assert.deepEqual(errors, []);
});

test('empty, stale, and ineligible frames cannot remove games; removed games are rechecked', t => {
  const { store, engine, publish, menu, errors } = setup(t);
  publish({ renderedGameKey: null });
  assert.equal(menu().enabled, false);
  publish({ liveMode: { active: true }, liveQueue: [] });
  assert.equal(menu().enabled, false);
  publish({ renderedGameKey: 'baseball:99' });
  assert.equal(menu().enabled, false);
  publish();
  engine.lastSeen = 0;
  assert.equal(menu().enabled, false);
  publish();
  const item = menu();
  publish({ normalQueue: [] });
  item.click();
  assert.deepEqual(store.snapshot().config.excludedGames, []);
  assert.match(errors[0], /no longer/);
});

test('failed removal writes leave saved settings intact and report the error', t => {
  const { store, menu, errors } = setup(t);
  const before = store.snapshot();
  store.file = path.join(store.file, 'missing', 'settings.json');
  menu().click();
  assert.deepEqual(store.snapshot(), before);
  assert.equal(errors.length, 1);
});
