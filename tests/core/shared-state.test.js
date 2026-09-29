const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../core/shared-state.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
function server() {
  let state = { instance: 'one', initialized: true, revision: 1, catalogRevision: 0, config: { timing: 10, teams: ['a'] } };
  return {
    get state() { return state; },
    set state(value) { state = value; },
    offline: false,
    async fetch(url, options) {
      if (this.offline) throw new Error('offline');
      if (options.method) {
        const body = JSON.parse(options.body);
        if (body.expectedRevision !== state.revision || body.instance !== state.instance) return { ok: false, status: 409, json: async () => ({ detail: copy(state) }) };
        state = { ...state, revision: state.revision + 1, initialized: true, config: { ...state.config, ...body.config } };
      }
      const value = copy(state);
      return { ok: true, json: async () => value };
    },
  };
}
function client(api, options = {}) {
  const timers = [];
  const storage = new Map(options.cache ? [['sports-overlay.shared-cache.v1', JSON.stringify(options.cache)]] : []);
  const local = { ready: Promise.resolve(), normalizeConfig: copy, loadConfig: () => ({ timing: 10, teams: ['a'] }), DEFAULT_CONFIG: { timing: 10, teams: ['a'] } };
  const window = {
    location: { pathname: options.path || '/sports/index.html', search: options.search || '' },
    SportsOverlay: { config: local },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout: (fn, delay) => timers.push({ fn, delay }),
  };
  vm.runInNewContext(source, { window, URLSearchParams, AbortSignal, console, fetch: api.fetch.bind(api) });
  return { window, timers, storage, config: window.SportsOverlay.config, shared: window.SportsOverlay.shared,
    async tick() { await timers.shift().fn(); await Promise.resolve(); } };
}

test('independent browser storage receives committed state on next poll', async () => {
  const api = server(); const chrome = client(api); const obs = client(api);
  await Promise.all([chrome.config.ready, obs.config.ready]);
  assert.notEqual(chrome.storage, obs.storage);
  await chrome.config.saveConfig({ timing: 25, teams: ['a'] });
  assert.equal(obs.config.loadConfig().timing, 10);
  await obs.tick();
  assert.equal(obs.config.loadConfig().timing, 25);
  assert.equal(obs.timers[0].delay, 1000);
});

test('conflicting write fails and does not destroy the supplied draft', async () => {
  const api = server(); const one = client(api); const two = client(api);
  await Promise.all([one.config.ready, two.config.ready]);
  await one.config.saveConfig({ timing: 20, teams: ['a'] });
  const draft = { timing: 30, teams: ['b'] };
  await assert.rejects(two.config.saveConfig(draft), /changed elsewhere/);
  assert.equal(draft.timing, 30);
  assert.equal(api.state.config.timing, 20);
  await two.config.saveConfig(draft);
  assert.equal(api.state.config.timing, 30);
});

test('offline display uses cached state, blocks writes and recovers lower revisions', async () => {
  const api = server(); const page = client(api);
  await page.config.ready;
  await page.config.saveConfig({ timing: 35, teams: ['a'] });
  api.offline = true;
  await page.tick();
  assert.equal(page.config.loadConfig().timing, 35);
  assert.equal(page.timers[0].delay, 2000);
  await assert.rejects(page.config.saveConfig({}), /Disconnected/);
  api.offline = false;
  api.state = { ...api.state, instance: 'restored', revision: 1, config: { timing: 5, teams: [] } };
  await page.tick();
  assert.equal(page.config.loadConfig().timing, 5);
  assert.equal(page.timers[0].delay, 1000);
});

test('initialization is explicit and demo/local pages do not poll', async () => {
  const api = server(); api.state = { ...api.state, initialized: false, config: null, revision: 0 };
  const page = client(api); await page.config.ready;
  await assert.rejects(page.config.saveConfig({ timing: 10 }), /choose defaults/);
  await page.config.saveConfig({ timing: 10, teams: [] }, { initialize: true });
  assert.equal(api.state.initialized, true);
  assert.equal(client(api, { search: '?demo=live' }).shared, undefined);
  assert.equal(client(api, { path: '/index.html' }).shared, undefined);
});

test('a GET started before a save cannot undo that save', async () => {
  const api = server(); const page = client(api); await page.config.ready;
  const originalFetch = api.fetch.bind(api);
  let release;
  api.fetch = async (...args) => originalFetch(...args);
  // A dedicated client fetch hook allows a delayed GET snapshot.
  let slow = false;
  const wrapper = { fetch: async (url, options) => {
    const result = await originalFetch(url, options);
    if (slow && !options.method) await new Promise(resolve => { release = resolve; });
    return result;
  } };
  const second = client(wrapper); await second.config.ready;
  slow = true;
  const poll = second.tick();
  await new Promise(resolve => setImmediate(resolve));
  await second.config.saveConfig({ timing: 50, teams: ['a'] });
  release(); await poll;
  assert.equal(second.config.loadConfig().timing, 50);
});
