const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../../desktop/store.cjs');
const { EngineState } = require('../../desktop/engine-state.cjs');
const { gameLockMenuItem } = require('../../desktop/banner-game-lock.cjs');

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sportsover-game-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory), engine = new EngineState(), errors = [];
  const entries = ['1', '2'].map(id => ({ candidate: { sport: 'baseball', id } }));
  const publish = metadata => engine.publish({ html: '<main>Game</main>', metadata: {
    renderedGameKey: 'baseball:1', currentGameKey: 'baseball:2',
    normalQueue: entries, liveQueue: entries, ...metadata,
  } });
  const patch = config => store.patch({ instance: store.instance, expectedRevision: store.revision, config });
  const menu = () => gameLockMenuItem({ engine, store, onError: error => errors.push(error.message) });
  publish();
  return { store, engine, errors, publish, patch, menu, directory };
}

test('banner lock targets the rendered game and shares persisted Live Control locks', t => {
  const { store, menu, errors, directory } = setup(t);
  assert.equal(menu().enabled, true);
  assert.equal(menu().checked, false);
  menu().click({ checked: true });
  assert.deepEqual(store.snapshot().config.lockedGameKeys, ['baseball:1']);
  assert.deepEqual(new Store(directory).snapshot().config.lockedGameKeys, ['baseball:1']);
  assert.equal(menu().checked, true);
  menu().click({ checked: false });
  assert.deepEqual(store.snapshot().config.lockedGameKeys, []);
  assert.deepEqual(errors, []);
});

test('an open menu keeps its game and preserves other locks and newer settings', t => {
  const { store, menu, patch, publish, errors } = setup(t);
  const item = menu();
  patch({ lockedGameKeys: ['baseball:2'], rotationSeconds: 45 });
  publish({ renderedGameKey: 'baseball:2' });
  item.click({ checked: true });
  item.click({ checked: true });
  assert.deepEqual(store.snapshot().config.lockedGameKeys, ['baseball:2', 'baseball:1']);
  assert.equal(store.snapshot().config.rotationSeconds, 45);
  item.click({ checked: false });
  assert.deepEqual(store.snapshot().config.lockedGameKeys, ['baseball:2']);
  assert.deepEqual(errors, []);
});

test('empty, stale, and ineligible Live mode or override frames cannot be locked', t => {
  const { engine, menu, publish, store, errors } = setup(t);
  publish({ renderedGameKey: null });
  assert.equal(menu().enabled, false);
  publish({ liveMode: { active: true }, liveQueue: [] });
  assert.equal(menu().enabled, false);
  publish({ renderedGameKey: 'baseball:99', overrideGameKey: 'baseball:99' });
  assert.equal(menu().enabled, false);
  publish();
  engine.lastSeen = 0;
  assert.equal(menu().enabled, false);
  publish();
  const item = menu();
  publish({ normalQueue: [] });
  item.click({ checked: true });
  assert.deepEqual(store.snapshot().config.lockedGameKeys, []);
  assert.match(errors[0], /no longer/);
});

test('failed persistence reports an error without changing locks', t => {
  const { store, menu, errors } = setup(t);
  store.file = path.join(store.file, 'missing', 'settings.json');
  menu().click({ checked: true });
  assert.deepEqual(store.snapshot().config.lockedGameKeys, []);
  assert.equal(errors.length, 1);
});
