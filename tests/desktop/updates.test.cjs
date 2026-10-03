const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateChecker, compareVersions, RELEASES_URL, RELEASE_API } = require('../../desktop/updates.cjs');

function fixture({ current = '0.13.1', tag = 'v0.14.0', choice = 1, fetchImpl, ...launchOptions } = {}) {
  const dialogs = [], links = [], states = [], requests = [];
  const checker = createUpdateChecker({
    app: { getVersion: () => current },
    dialog: { showMessageBox: async value => { dialogs.push(value); return { response: choice }; } },
    shell: { openExternal: async url => links.push(url) },
    fetchImpl: fetchImpl || (async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ tag_name: tag, draft: false, prerelease: false, html_url: 'https://untrusted.example' }));
    }),
    onStateChange: () => states.push(checker.menuItem()),
    ...launchOptions,
  });
  return { checker, dialogs, links, states, requests };
}

test('version ordering handles numeric components, prereleases, and build metadata', () => {
  for (const [left, right, expected] of [
    ['v0.14.0', '0.13.1', 1], ['0.9.0', '0.10.0', -1], ['1.0.0', '1.0.0-beta.2', 1],
    ['1.0.0-beta.2', '1.0.0-beta.10', -1], ['1.0.0-beta', '1.0.0-beta.1', -1],
    ['1.0.0+local', 'v1.0.0', 0], ['1.0.0-2', '1.0.0-beta', -1],
  ]) assert.equal(compareVersions(left, right), expected);
  for (const invalid of ['latest', '1.2', '01.2.3', '1.2.3-01', '1.2.3<script>']) assert.throws(() => compareVersions(invalid, '1.2.3'));
});

test('available update opens only the fixed official page after an explicit button choice', async () => {
  const f = fixture({ choice: 0 });
  await f.checker.menuItem().click();
  assert.match(f.dialogs[0].message, /0.14.0/);
  assert.match(f.dialogs[0].detail, /0.13.1/);
  assert.deepEqual(f.dialogs[0].buttons, ['Open download page', 'Later']);
  assert.deepEqual(f.links, [RELEASES_URL]);
  assert.equal(f.requests[0].url, RELEASE_API);
  assert.equal(f.requests[0].options.signal instanceof AbortSignal, true);
  assert.equal(f.states[0].enabled, false);
  assert.equal(f.states.at(-1).enabled, true);
});

test('Later cancels, and equal or newer installed versions never prompt a downgrade', async () => {
  const later = fixture(); await later.checker.check(); assert.deepEqual(later.links, []);
  for (const current of ['0.14.0', '0.15.0']) {
    const f = fixture({ current, choice: 0 }); await f.checker.check();
    assert.match(f.dialogs[0].message, /up to date/);
    assert.deepEqual(f.links, []);
  }
});

test('offline, rate limits, malformed versions, and unexpected releases restore the menu', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => { throw new DOMException('Timed out', 'TimeoutError'); },
    async () => new Response('', { status: 403 }),
    async () => new Response('invalid JSON'),
    async () => new Response(JSON.stringify({ draft: false, prerelease: false, tag_name: 'latest' })),
    async () => new Response(JSON.stringify({ draft: false, prerelease: true, tag_name: 'v1.0.0' })),
  ]) {
    const f = fixture({ fetchImpl }); await f.checker.check();
    assert.match(f.dialogs[0].message, /Could not check/);
    assert.equal(f.checker.menuItem().enabled, true);
    assert.deepEqual(f.links, []);
  }
});

test('no published release has its own result', async () => {
  const f = fixture({ fetchImpl: async () => new Response('', { status: 404 }) });
  await f.checker.check();
  assert.match(f.dialogs[0].message, /No published release/);
  assert.deepEqual(f.links, []);
});

test('repeated clicks coalesce while a check is pending', async () => {
  let finish, calls = 0;
  const f = fixture({ fetchImpl: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const pending = f.checker.check();
  await f.checker.check();
  assert.equal(calls, 1);
  finish(new Response(JSON.stringify({ tag_name: 'v0.14.0', draft: false, prerelease: false })));
  await pending;
  assert.equal(f.dialogs.length, 1);
  assert.equal(f.checker.menuItem().enabled, true);
});

test('normal launch announces a new version and saves the daily attempt', async () => {
  let saved;
  const f = fixture({ now: () => 100000000, saveLastCheck: value => { saved = value; }, choice: 0 });
  await f.checker.checkOnLaunch();
  assert.equal(saved, 100000000);
  assert.match(f.dialogs[0].message, /0.14.0/);
  assert.deepEqual(f.links, [RELEASES_URL]);
});

test('daily limit survives restarts and manual checks bypass it', async () => {
  let clock = 100000000, saved;
  const options = { now: () => clock, readLastCheck: () => saved, saveLastCheck: value => { saved = value; } };
  const first = fixture(options);
  await first.checker.checkOnLaunch();
  await first.checker.checkOnLaunch();
  assert.equal(first.requests.length, 1);
  const restarted = fixture(options);
  clock += 24 * 60 * 60 * 1000 - 1;
  await restarted.checker.checkOnLaunch();
  assert.equal(restarted.requests.length, 0);
  await restarted.checker.menuItem().click();
  assert.equal(restarted.requests.length, 1);
  clock++;
  await restarted.checker.checkOnLaunch();
  assert.equal(restarted.requests.length, 2);
  assert.equal(saved, clock);
});

test('automatic checks remain silent for current versions, missing releases, and failures', async () => {
  for (const options of [
    { tag: 'v0.13.1' }, { tag: 'v0.12.0' },
    { fetchImpl: async () => new Response('', { status: 404 }) },
    { fetchImpl: async () => new Response('', { status: 403 }) },
    { fetchImpl: async () => { throw Error('offline'); } },
    { fetchImpl: async () => new Response('malformed') },
  ]) {
    let saved;
    const f = fixture({ ...options, saveLastCheck: value => { saved = value; } });
    await f.checker.checkOnLaunch();
    assert.ok(Number.isFinite(saved));
    assert.deepEqual(f.dialogs, []);
    assert.deepEqual(f.links, []);
    assert.equal(f.checker.menuItem().enabled, true);
  }
});

test('background launches check silently even when an update exists', async () => {
  const f = fixture({ choice: 0 });
  await f.checker.checkOnLaunch({ background: true });
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.dialogs, []);
  assert.deepEqual(f.links, []);
  await f.checker.check();
  assert.equal(f.dialogs.length, 1);
});

test('invalid or future timestamps and unavailable preferences do not block checking', async () => {
  for (const previous of [undefined, null, 'yesterday', Infinity, 200000000]) {
    const f = fixture({ now: () => 100000000, readLastCheck: () => previous });
    await f.checker.checkOnLaunch({ background: true });
    assert.equal(f.requests.length, 1);
  }
  const f = fixture({ readLastCheck: () => { throw Error('read failed'); }, saveLastCheck: () => { throw Error('write failed'); } });
  await f.checker.checkOnLaunch({ background: true });
  await f.checker.checkOnLaunch({ background: true });
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.dialogs, []);
});

test('GitHub cooldown respects Retry-After and reset headers across manual checks and restarts', async () => {
  const epoch = Date.parse('2026-10-03T00:00:00Z');
  for (const status of [403, 429]) {
    for (const retry of ['120', new Date(epoch + 120000).toUTCString()]) {
      let time = epoch, saved, calls = 0;
      const options = { now: () => time, readRateLimit: () => saved, saveRateLimit: value => { saved = value; },
        fetchImpl: async () => {
          calls++;
          return new Response('', { status, headers: { 'Retry-After': retry, 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(epoch / 1000 + 180) } });
        } };
      const first = fixture(options);
      await first.checker.check();
      assert.equal(saved.until, epoch + 180000);
      assert.match(first.dialogs[0].message, /temporarily paused/);
      time += 179999;
      await first.checker.check();
      const restarted = fixture(options);
      await restarted.checker.checkOnLaunch({ background: true });
      await restarted.checker.check();
      assert.equal(calls, 1);
      assert.equal(restarted.dialogs.length, 1);
      time++;
      await restarted.checker.check();
      assert.equal(calls, 2);
    }
  }
});

test('secondary-limit messages use increasing cooldowns while ordinary 403 errors remain ordinary errors', async () => {
  let time = 100000000, calls = 0;
  const f = fixture({ now: () => time, fetchImpl: async () => {
    calls++;
    return Response.json({ message: 'You have exceeded a secondary rate limit.' }, { status: 403 });
  } });
  await f.checker.check();
  time += 60000; await f.checker.check();
  time += 60000; await f.checker.check();
  assert.equal(calls, 2);
  time += 60000; await f.checker.check();
  assert.equal(calls, 3);
  assert.ok(f.dialogs.every(dialog => /temporarily paused/.test(dialog.message)));
  const forbidden = fixture({ fetchImpl: async () => Response.json({ message: 'Forbidden' }, { status: 403 }) });
  await forbidden.checker.check();
  assert.match(forbidden.dialogs[0].message, /Could not check/);
});

test('a successful GitHub response with no remaining quota blocks further checks until reset', async () => {
  let time = 100000000, calls = 0;
  const f = fixture({ now: () => time, fetchImpl: async () => {
    calls++;
    return Response.json({ tag_name: 'v0.14.0', draft: false, prerelease: false }, {
      headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String((time + 120000) / 1000) },
    });
  } });
  await f.checker.check();
  await f.checker.check();
  assert.equal(calls, 1);
  time += 120000; await f.checker.check();
  assert.equal(calls, 2);
});

test('tray and application menus expose the checker and preserve Quit and banner controls', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const updates = require('../../desktop/updates.cjs');
  for (const platform of ['darwin', 'win32']) {
    let trayMenu, appMenu;
    const electron = {
      app: { setName() {}, requestSingleInstanceLock: () => false, quit() {}, on() {} },
      protocol: { registerSchemesAsPrivileged() {} },
      Menu: { buildFromTemplate: value => value, setApplicationMenu: value => { appMenu = value; } },
    };
    const context = vm.createContext({
      __dirname: path.resolve(__dirname, '../../desktop'),
      process: { argv: [], env: {}, platform },
      testTray: { setContextMenu: value => { trayMenu = value; } },
      require: name => {
        if (name === 'electron') return electron;
        if (name === './updates.cjs') return updates;
        if (name === './bounds.cjs') return require('../../desktop/bounds.cjs');
        if (name === './engine-state.cjs') return { EngineState: class {} };
        if (name === './banner-gesture.cjs') return { createBannerGesture: () => () => {} };
        if (name === './protocol.cjs') return { ORIGIN: 'sportsover://app' };
        if (name.startsWith('./')) return {};
        return require(name);
      },
    });
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../desktop/main.cjs'), 'utf8'), context);
    vm.runInContext('tray = testTray; menus();', context);
    assert.equal(trayMenu.find(item => item.id === 'check-updates').label, 'Check for updates…');
    assert.equal(trayMenu.at(-1).label, 'Quit SportsOver');
    const appSection = appMenu.find(item => item.label === (platform === 'darwin' ? 'SportsOver' : 'File'));
    assert.equal(appSection.submenu.find(item => item.id === 'check-updates').enabled, true);
    assert.equal(appSection.submenu.at(-1).label, 'Quit SportsOver');
    const bannerMenu = appMenu.find(item => item.label === 'Banner').submenu;
    for (const id of ['toggle-banner', 'lock-banner', 'fullscreen-banner', 'recover-banner']) {
      assert.ok(bannerMenu.some(item => item.id === id), `Banner menu includes ${id}`);
    }
    const sizes = bannerMenu.find(item => item.id === 'banner-size');
    assert.equal(sizes.label, 'Banner size');
    assert.equal(sizes.submenu.map(item => item.label).join(','), '50%,75%,100%,125%,150%,200%,300%');
  }
});
