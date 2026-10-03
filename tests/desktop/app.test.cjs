const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../../desktop/store.cjs');
const { fitBounds, fullscreenBounds } = require('../../desktop/bounds.cjs');
const { createHandler } = require('../../desktop/protocol.cjs');
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sportsover-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
test('clean desktop startup seeds Nebraska and Seattle watched teams, then preserves saved choices', t => {
  const directory = temp(t), store = new Store(directory);
  const initial = store.snapshot();
  assert.equal(initial.initialized, true);
  assert.deepEqual(initial.config.sports.flatMap(group => group.favorites.map(team => team.teamKey)),
    ['mlb:136', 'nfl:sea', 'ncaaf:158', 'ncaaf:264', 'nhl:sea', 'mls:9726', 'nba:det', 'ncaam:158', 'ncaam:264', 'ncaam:2547']);
  assert.ok(initial.config.sports.every(group => group.enabled && group.favorites.every(team => team.enabled)));
  assert.equal(store.warning, '');
  // Persisting desktop preferences on first launch also persists the defaults.
  store.desktop({ visible: true });
  const restarted = new Store(directory);
  assert.deepEqual(restarted.snapshot().config, initial.config);
  const sports = [{ sport: 'basketball', favorites: [{ teamKey: 'nba:det', enabled: false }] },
    { sport: 'college-basketball', favorites: [] }, { sport: 'college-football', enabled: false, favorites: [] }];
  assert.equal(restarted.patch({ instance: restarted.instance, expectedRevision: 0, config: { sports } }).status, 200);
  assert.deepEqual(new Store(directory).snapshot().config, restarted.snapshot().config);
});
test('settings persist, reject stale writes, recover corruption, and preserve healthy backup', t => {
  const dir = temp(t), store = new Store(dir);
  const patch = config => store.patch({ instance: store.instance, expectedRevision: store.revision, config });
  assert.equal(patch({ rotationSeconds: 25 }).status, 200);
  assert.equal(store.patch({ instance: store.instance, expectedRevision: 0, config: { rotationSeconds: 30 } }).status, 409);
  assert.equal(new Store(dir).snapshot().config.rotationSeconds, 25);
  patch({ rotationSeconds: 40 });
  fs.writeFileSync(store.file, 'broken');
  const recovered = new Store(dir);
  assert.equal(recovered.snapshot().config.rotationSeconds, 25);
  assert.match(recovered.warning, /backup/);
  recovered.desktop({ locked: true });
  assert.equal(new Store(dir).value.desktop.locked, true);
  assert.ok(fs.readdirSync(dir).some(name => name.includes('.recovered-')));
});
test('failed disk write does not publish configuration or revision', t => {
  const store = new Store(temp(t));
  const snapshot = store.snapshot();
  store.file = path.join(store.file, 'missing', 'settings.json');
  assert.throws(() => store.patch({ instance: store.instance, expectedRevision: 0, config: { rotationSeconds: 90 } }));
  assert.deepEqual(store.snapshot(), snapshot);
});
test('bounds recover disconnected monitors, allow negative origins and clamp oversized windows', () => {
  const displays = [{ workArea: { x: 0, y: 30, width: 1440, height: 870 } }, { workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }];
  assert.equal(fitBounds({ x: -1800, y: 100, width: 944 }, displays).x, -1800);
  const off = fitBounds({ x: 5000, y: 5000, width: 944 }, displays);
  assert.ok(off.x + off.width <= 1440 && off.y + off.height <= 900);
  const bad = fitBounds({ x: NaN, y: Infinity, width: -2 }, displays);
  assert.equal(bad.width, 236);
  assert.equal(bad.height, 50);
});
test('fullscreen covers the entire monitor, including negative origins and portrait displays', () => {
  const display = { bounds: { x: -2560, y: -200, width: 2560, height: 1440 } };
  assert.deepEqual(fullscreenBounds(display), display.bounds);
  const portrait = { bounds: { x: 1920, y: 0, width: 1080, height: 1920 } };
  assert.deepEqual(fullscreenBounds(portrait), portrait.bounds);
});
test('private protocol serves renderer assets and state but rejects arbitrary files and foreign callers', async t => {
  const dataRoot = temp(t), store = new Store(dataRoot);
  const handler = createHandler({ root: path.resolve(__dirname, '../..'), dataRoot, store, refresh: async () => [] });
  const request = (url, options) => handler(new Request(`sportsover://app${url}`, options));
  assert.equal((await request('/sports/index.html')).status, 200);
  assert.equal((await request('/sports/desktop/main.cjs')).status, 404);
  assert.equal((await request('/sports/.git/config')).status, 404);
  assert.equal((await request('/sports/core/%2e%2e%2fdesktop/main.cjs')).status, 404);
  assert.equal((await handler({ url: 'sportsover://app/api/sports/state', initiatorOrigin: 'https://evil.example', method: 'GET' })).status, 403);
  const state = await (await request('/api/sports/state')).json();
  const response = await request('/api/sports/state', { method: 'PATCH', body: JSON.stringify({ instance: state.instance, expectedRevision: state.revision, config: { rotationSeconds: 30 } }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).config.rotationSeconds, 30);
  assert.equal((await request('/sports/api/team-catalog/refresh', { method: 'POST', body: '{"sport":"all"}' })).status, 200);
  assert.equal(store.catalogRevision, 1);
});
test('catalog refresh writes only app data and retains a previous catalog on empty upstream data', async t => {
  const directory = temp(t);
  const { updateCatalogs } = await import('../../scripts/team-catalog.mjs');
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  const bundledFile = path.resolve(__dirname, '../../sports/basketball/teams.json');
  const bundled = fs.readFileSync(bundledFile, 'utf8');
  global.fetch = async () => Response.json({ sports: [{ leagues: [{ teams: [{ team: { id: '8', abbreviation: 'DET', displayName: 'Detroit Test', color: '111111', alternateColor: 'eeeeee' } }] }] }] });
  const result = await updateCatalogs('basketball', directory);
  assert.equal(result[0].count, 1);
  const output = path.join(directory, 'sports/basketball/teams.json');
  const updated = fs.readFileSync(output, 'utf8');
  assert.equal(JSON.parse(updated).teams[0].name, 'Detroit Test');
  assert.equal(fs.readFileSync(bundledFile, 'utf8'), bundled);
  global.fetch = async () => Response.json({});
  await assert.rejects(updateCatalogs('basketball', directory), /Empty team directory/);
  assert.equal(fs.readFileSync(output, 'utf8'), updated);
});

test('desktop standings bridge permits only public tournament players and preserves upstream errors', async () => {
  const calls = [];
  let status = 200;
  const players = [{ name: 'Leader', score: 1, rank: 1, played: 1 }];
  const handler = createHandler({ root: path.resolve(__dirname, '../..'), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return Response.json(status === 200 ? players : { error: 'Try later' }, { status, headers: status === 429 ? { 'Retry-After': '120' } : {} });
  }});
  const url = 'sportsover://app/api/chess/broadcast/Tour1234/players';
  const response = await handler(new Request(url));
  assert.deepEqual(await response.json(), players);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls[0].url, 'https://lichess.org/broadcast/Tour1234/players');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal((await handler(new Request(url, { method: 'POST' }))).status, 405);
  assert.equal((await handler({ url, method: 'GET', initiatorOrigin: 'https://evil.example' })).status, 403);
  assert.equal((await handler(new Request(url.replace('Tour1234', 'invalid')))).status, 404);
  assert.equal((await handler(new Request(url.replace('/players', '/teams')))).status, 404);
  assert.equal(calls.length, 1);
  for (status of [429, 503]) {
    const failure = await handler(new Request(url));
    assert.equal(failure.status, status);
    assert.equal(failure.headers.get('Retry-After'), status === 429 ? '120' : null);
  }
});

test('desktop provider bridge shares throttles across windows and catalogs and rejects unsafe targets', async () => {
  const { create } = require('../../core/provider-network.js');
  let time = 0, calls = 0;
  const fetchProvider = create({ now: () => time, sleep: async ms => { time += ms; }, fetchImpl: async () => {
    calls++;
    return new Response('', { status: 429, headers: { 'Retry-After': '120', 'Set-Cookie': 'private=1' } });
  } });
  const handler = createHandler({ fetchProvider });
  const nba = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
  const nhl = 'https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/1/competitions/1/situation';
  const request = url => new Request(`sportsover://app/api/provider?${new URLSearchParams({ url })}`);
  for (const url of [nba, nhl]) {
    const response = await handler(request(url));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '120');
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
  const { updateCatalogs } = await import('../../scripts/team-catalog.mjs');
  await assert.rejects(updateCatalogs('basketball', '/unused', fetchProvider), /429/);
  assert.equal(calls, 1);
  assert.equal((await handler(request('https://127.0.0.1/private'))).status, 400);
  assert.equal((await handler(new Request(request(nba).url, { method: 'POST' }))).status, 405);
  assert.equal((await handler({ url: request(nba).url, method: 'GET', initiatorOrigin: 'https://evil.example' })).status, 403);
  assert.equal(calls, 1);
});

test('desktop bridge forwards display priority and promotes queued requests without fetching', async () => {
  const calls = [], promoted = [];
  const fetchProvider = async (url, options) => { calls.push({ url, options }); return Response.json({}); };
  fetchProvider.prioritize = url => promoted.push(url);
  const handler = createHandler({ fetchProvider });
  const target = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=123';
  const query = new URLSearchParams({ url: target, priority: 'display', timeout: '8000' });
  await handler(new Request(`sportsover://app/api/provider?${query}`));
  assert.equal(calls[0].options.priority, 'display');
  const promotion = `sportsover://app/api/provider/priority?${query}`;
  assert.equal((await handler(new Request(promotion, { method: 'POST' }))).status, 200);
  assert.deepEqual(promoted, [target]);
  assert.equal(calls.length, 1);
  assert.equal((await handler(new Request(promotion))).status, 405);
  assert.equal((await handler({ url: promotion, method: 'POST', initiatorOrigin: 'https://evil.example' })).status, 403);
  assert.equal(promoted.length, 1);
});
