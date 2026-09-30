// Real native windows, one live engine, mocked upstream feeds and isolated app data.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
globalThis.window = globalThis;
require('../core/event-model.js');
require('../core/registry.js');
require('../sports/baseball/providers/mlb.js');
require('../sports/baseball/demo-data.js');
const feed = globalThis.MARINERS_DEMO_FEEDS.live;
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sportsover-smoke-'));
  let application;
  const errors = [];
  async function launch() {
    application = await electron.launch({ args: [path.resolve(__dirname, '..')], env: { ...process.env, SPORTSOVER_TEST_DATA: directory } });
    application.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    await application.evaluate(async ({ session }, fixture) => {
      globalThis.sportsTestRequests = [];
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (details, callback) => {
        if (/statsapi\.mlb|site\.api\.espn/.test(details.url)) globalThis.sportsTestRequests.push({ id: details.webContentsId, url: details.url });
        callback({});
      });
      await session.defaultSession.protocol.handle('https', request => {
        const url = new URL(request.url);
        let body = { dates: [], events: [], sports: [] };
        if (url.pathname.includes('/schedule') && url.host === 'statsapi.mlb.com') body = { dates: [{ games: [1, 2].map(id => ({
          gamePk: id, gameDate: new Date().toISOString(), gameType: 'R', status: { abstractGameState: 'Live', detailedState: 'In Progress' },
          teams: { away: { team: { id: 136, name: 'Seattle Mariners' } }, home: { team: { id: 133, name: 'Athletics' } } },
        })) }] };
        if (url.pathname.includes('/feed/live')) {
          body = structuredClone(fixture);
          if (url.pathname.includes('/game/2/')) body.liveData.linescore.teams.home.runs = 9;
        }
        return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      });
    }, feed);
    await application.waitForEvent('window', { predicate: page => page.url().includes('/admin/') });
    const pages = application.windows();
    const admin = pages.find(page => page.url().includes('/admin/'));
    const banner = pages.find(page => page.url().includes('display.html?desktop'));
    const engine = pages.find(page => page.url().includes('engine=1'));
    assert.ok(admin && banner && engine, 'settings, passive banner, and sole engine exist');
    await admin.waitForFunction(async () => (await window.sportsDesktop.engine()).availableEntries.length >= 2);
    return { admin, banner, engine };
  }
  try {
    let { admin, banner, engine } = await launch();
    await banner.locator('.scorebug').waitFor();
    assert.match(await banner.locator('body').innerText(), /SEA|Mariners/i);
    assert.equal(await banner.evaluate(() => typeof window.SportsOverlay), 'undefined', 'desktop loads no provider or rotation engine');
    await banner.screenshot({ path: path.join(directory, 'banner.png'), omitBackground: true });
    await admin.screenshot({ path: path.join(directory, 'settings.png') });
    await admin.locator('[data-desktop="lock"]').click();
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).locked), true);
    await admin.locator('[data-desktop="unlock"]').click();
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).locked), false);
    await admin.locator('#desktop-size').selectOption('1.5');
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).scale), 1.5);
    await admin.locator('#display-mode').selectOption('top-favorite');
    await admin.locator('#save-settings').click();
    await engine.waitForFunction(() => window.SportsOverlay.config.loadConfig().displayMode === 'top-favorite');
    const { obsUrl } = await admin.evaluate(() => window.sportsDesktop.status());
    const base = new URL(obsUrl).origin;
    const { token } = JSON.parse(await fs.readFile(path.join(directory, 'integration.json'), 'utf8'));
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${base}/api/v1/state`)).status, 401);
    assert.equal((await fetch(`${base}/api/v1/state`, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
    const obsPromise = application.waitForEvent('window');
    await application.evaluate(({ BrowserWindow }, url) => {
      globalThis.obsTest = new BrowserWindow({ width: 472, height: 100, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      globalThis.obsTest.loadURL(url);
    }, obsUrl);
    const obs = await obsPromise;
    await obs.locator('.scorebug').waitFor();
    assert.equal(await obs.evaluate(() => typeof window.SportsOverlay), 'undefined', 'OBS loads no providers or rotation engine');
    const before = await (await fetch(`${base}/api/v1/state`, { headers })).json();
    const overrideKey = before.currentGameKey === 'baseball:1' ? 'baseball:2' : 'baseball:1';
    await admin.locator('[data-desktop="hide"]').click();
    const command = { requestId: 'smoke-override', type: 'show-game', gameKey: overrideKey, durationSeconds: 5 };
    const response = await fetch(`${base}/api/v1/commands`, { method: 'POST', headers, body: JSON.stringify(command) });
    assert.equal(response.status, 200);
    const accepted = await response.json();
    const duplicate = await (await fetch(`${base}/api/v1/commands`, { method: 'POST', headers, body: JSON.stringify(command) })).json();
    assert.deepEqual(duplicate, accepted, 'retry does not extend override');
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().overrideGameKey === key, overrideKey);
    await obs.waitForFunction(score => document.querySelector('#home-score')?.textContent === score, overrideKey === 'baseball:2' ? '9' : '2');
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).visible), false, 'OBS continues while desktop hidden');
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().overrideGameKey === null && window.SportsOverlay.engine.describe().currentGameKey === key, before.currentGameKey, { timeout: 10000 });
    await obs.waitForFunction(score => document.querySelector('#home-score')?.textContent === score, before.currentGameKey === 'baseball:2' ? '9' : '2');
    await admin.locator('[data-desktop="recover"]').click();
    const sharedFrame = await (await fetch(`${base}/api/output`)).json();
    await banner.waitForFunction(sequence => Number(document.body.dataset.sequence) >= sequence, sharedFrame.sequence);
    await obs.waitForFunction(sequence => Number(document.body.dataset.sequence) >= sequence, sharedFrame.sequence);
    assert.equal(await banner.locator('#sports-overlay').innerText(), await obs.locator('#sports-overlay').innerText());
    const native = await application.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      const win = windows.find(w => w.webContents.getURL().includes('display.html?desktop'));
      const engine = windows.find(w => w.webContents.getURL().includes('engine=1'));
      return { top: win.isAlwaysOnTop(), preferences: win.webContents.getLastWebPreferences(), engineCount: windows.filter(w => w.webContents.getURL().includes('engine=1')).length, engineId: engine.webContents.id, requests: globalThis.sportsTestRequests };
    });
    assert.equal(native.engineCount, 1);
    assert.ok(native.requests.length > 0);
    assert.ok(native.requests.every(request => request.id === native.engineId), 'only engine makes provider requests');
    assert.equal(native.top, true);
    assert.equal(native.preferences.sandbox, true);
    assert.equal(native.preferences.contextIsolation, true);
    await admin.evaluate(async () => { await window.sportsDesktop.action('size', 1.25); await window.sportsDesktop.action('lock'); await window.sportsDesktop.action('hide'); });
    await application.close();
    ({ admin, banner, engine } = await launch());
    assert.equal(await admin.evaluate(() => window.SportsOverlay.config.loadConfig().displayMode), 'top-favorite');
    const restored = await admin.evaluate(() => window.sportsDesktop.status());
    assert.equal(restored.scale, 1.25); assert.equal(restored.locked, true); assert.equal(restored.visible, false);
    assert.equal(restored.override, null);
    await admin.locator('[data-desktop="recover"]').click();
    assert.deepEqual(errors, []);
    console.log(`Desktop/shared-engine smoke passed. Screenshots and isolated data: ${directory}`);
  } finally { if (application) await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
