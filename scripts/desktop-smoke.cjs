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
  async function launch(background = false) {
    application = await electron.launch({ ...(process.env.SPORTSOVER_TEST_EXECUTABLE ? { executablePath: process.env.SPORTSOVER_TEST_EXECUTABLE, args: background ? ['--background'] : [] } : { args: [path.resolve(__dirname, '..'), ...(background ? ['--background'] : [])] }), env: { ...process.env, SPORTSOVER_TEST_DATA: directory } });
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
        if (url.pathname.includes('/schedule') && url.host === 'statsapi.mlb.com') body = { dates: [{ games: (url.searchParams.get('teamId') === '135' ? [3] : [1, 2]).map(id => ({
          gamePk: id, gameDate: new Date(Date.now() + (id === 3 ? 3600000 : 0)).toISOString(), gameType: 'R', status: { abstractGameState: id === 3 ? 'Preview' : 'Live', detailedState: id === 3 ? 'Scheduled' : 'In Progress' },
          teams: { away: { team: { id: id === 3 ? 135 : 136, name: id === 3 ? 'San Diego Padres' : 'Seattle Mariners' } }, home: { team: { id: 133, name: 'Athletics' } } },
        })) }] };
        if (url.pathname.includes('/feed/live')) {
          body = structuredClone(fixture);
          if (url.pathname.includes('/game/2/')) body.liveData.linescore.teams.home.runs = 9;
        }
        return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      });
    }, feed);
    if (background) {
      const first = await application.firstWindow();
      await first.waitForFunction(async () => {
        try { return (await window.sportsDesktop.status()).engineReady; } catch { return false; }
      });
      let startupReady = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        startupReady = await application.evaluate(({ BrowserWindow, Menu }) =>
          !!Menu.getApplicationMenu()?.getMenuItemById('toggle-banner') &&
          BrowserWindow.getAllWindows().every(win => !!win.webContents.getURL() && !win.webContents.isLoading()));
        if (startupReady) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(startupReady, 'background startup finished');
      const before = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ id: win.id, visible: win.isVisible(), url: win.webContents.getURL() })));
      assert.equal(before.length, 2, 'background launch creates only engine and passive banner');
      assert.ok(before.every(win => !win.visible), 'background launch shows no windows');
      const backgroundStatus = await first.evaluate(() => window.sportsDesktop.status());
      assert.equal(backgroundStatus.trayAvailable, true);
      let hiddenFrame;
      for (let attempt = 0; attempt < 100; attempt++) {
        hiddenFrame = await (await fetch(backgroundStatus.obsUrl.replace('/output', '/api/output'))).json();
        if (hiddenFrame.ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(hiddenFrame.ready, 'OBS output runs while hidden');
      assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).desktop.visible, true, 'background launch preserves saved visibility');
      await application.evaluate(({ app }) => {
        app.emit('second-instance', {}, ['SportsOver', '--background']);
        app.emit('activate');
      });
      const after = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ id: win.id, visible: win.isVisible(), url: win.webContents.getURL() })));
      assert.deepEqual(after, before, 'repeated background launch and initial activation leave windows alone');
      await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('settings').click());
    }
    if (!application.windows().some(page => page.url().includes('/admin/'))) {
      await application.waitForEvent('window', { predicate: page => page.url().includes('/admin/') });
    }
    const pages = application.windows();
    const admin = pages.find(page => page.url().includes('/admin/'));
    const banner = pages.find(page => page.url().includes('display.html?desktop'));
    const engine = pages.find(page => page.url().includes('engine=1'));
    assert.ok(admin && banner && engine, 'settings, passive banner, and sole engine exist');
    // Packaged apps can start fetching before Playwright installs the fixtures.
    // Restart the engine after interception so assertions never use live data.
    await engine.reload();
    await admin.waitForFunction(async () => (await window.sportsDesktop.engine()).availableEntries.length >= 2);
    await banner.waitForFunction(() => /SEA|Mariners/i.test(document.body.innerText));
    return { admin, banner, engine };
  }
  try {
    let { admin, banner, engine } = await launch();
    const desktopStatus = await admin.evaluate(() => window.sportsDesktop.status());
    assert.deepEqual(await admin.evaluate(() => window.SportsOverlay.config.loadConfig().sports.flatMap(group => group.favorites.map(team => team.teamKey))),
      ['mlb:136', 'nfl:sea', 'ncaaf:158', 'ncaaf:264', 'nhl:sea', 'mls:9726', 'nba:det', 'ncaam:158', 'ncaam:264', 'ncaam:2547'], 'clean app startup uses Nebraska and Seattle favorites, plus the Pistons');
    for (const teamKey of ['ncaam:158', 'ncaam:264', 'ncaam:2547']) {
      assert.equal(await admin.locator(`.favorite-card[data-team-key="${teamKey}"]`).count(), 1, 'default college basketball teams appear in Settings');
    }
    const configBeforeReset = await admin.evaluate(() => window.SportsOverlay.config.loadConfig());
    await admin.locator('#reset-settings').click();
    assert.equal(await admin.locator('#reset-settings-dialog').isVisible(), true);
    assert.equal(await admin.locator('#cancel-reset-settings').evaluate(button => button === document.activeElement), true);
    await admin.screenshot({ path: path.join(directory, 'restore-defaults.png') });
    await admin.keyboard.press('Escape');
    assert.equal(await admin.locator('#reset-settings-dialog').isVisible(), false);
    assert.deepEqual(await admin.evaluate(() => window.SportsOverlay.config.loadConfig()), configBeforeReset, 'desktop cancellation keeps settings');
    const lockToggle = admin.locator('[data-desktop="toggle-lock"]');
    const visibilityToggle = admin.locator('[data-desktop="toggle-visibility"]');
    assert.equal(await lockToggle.innerText(), 'Lock');
    assert.equal(await visibilityToggle.innerText(), 'Hide');
    assert.equal(await admin.locator('[data-desktop="lock"], [data-desktop="unlock"], [data-desktop="show"], [data-desktop="hide"]').count(), 0, 'only two stateful banner controls remain');
    assert.equal(desktopStatus.trayAvailable, true, 'native status item was created');
    assert.equal(desktopStatus.appIconAvailable, true, 'custom application artwork loaded');
    assert.ok(desktopStatus.trayBounds.width > 0 && desktopStatus.trayBounds.height > 0);
    const menuState = await application.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      menu.getMenuItemById('toggle-banner').click();
      return { labels: menu.items.map(item => item.label), settingsShortcut: menu.getMenuItemById('settings').accelerator };
    });
    assert.ok(menuState.labels.includes('Banner'));
    assert.equal(menuState.settingsShortcut, 'CommandOrControl+,');
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).visible), false);
    await admin.waitForFunction(() => document.querySelector('[data-desktop="toggle-visibility"]').textContent === 'Show');
    await lockToggle.click();
    assert.equal(await lockToggle.innerText(), 'Unlock');
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).locked), true);
    await lockToggle.click();
    assert.equal(await lockToggle.innerText(), 'Lock');
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).visible), false, 'unlocking a hidden banner keeps it hidden');
    await visibilityToggle.click();
    assert.equal(await visibilityToggle.innerText(), 'Hide');
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).visible), true);
    await visibilityToggle.click();
    assert.equal(await visibilityToggle.innerText(), 'Show');
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('toggle-banner').click());
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).visible), true);
    await admin.waitForFunction(() => document.querySelector('[data-desktop="toggle-visibility"]').textContent === 'Hide');
    await application.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu().getMenuItemById('lock-banner');
      item.click({ checked: true });
    });
    await admin.waitForFunction(() => document.querySelector('[data-desktop="toggle-lock"]').textContent === 'Unlock');
    await lockToggle.click();
    assert.equal(await lockToggle.innerText(), 'Lock');
    await banner.locator('.scorebug').waitFor();
    assert.match(await banner.locator('body').innerText(), /SEA|Mariners/i);
    assert.equal(await banner.evaluate(() => typeof window.SportsOverlay), 'undefined', 'desktop loads no provider or rotation engine');
    // Adding a secondary watched team automatically discovers and selects its game.
    await admin.locator('#team-sport-picker').selectOption('baseball');
    await admin.locator('#team-picker').selectOption('mlb:135');
    await admin.locator('#add-team').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.some(entry => entry.candidate.sport === 'baseball' && entry.candidate.id === '3'));
    await admin.getByRole('button', { name: 'Live control', exact: true }).click();
    await admin.locator('#rotation-queue [data-game-key="baseball:3"]').waitFor();
    await admin.getByRole('button', { name: 'Settings', exact: true }).click();
    await admin.locator('[data-team-key="mlb:135"] .remove-team').click();
    await engine.waitForFunction(() => !window.SportsOverlay.engine.describe().queue.some(entry => entry.candidate.sport === 'baseball' && entry.candidate.id === '3'));
    await admin.getByRole('button', { name: 'Live control', exact: true }).click();
    await admin.locator('#available-games [data-game-key="baseball:2"] .add-game').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 2);
    const initialGame = await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey);
    await banner.locator('.scorebug').click();
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey !== key, initialGame);
    const skippedGame = await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey);
    await banner.locator('.scorebug').click({ position: { x: 15, y: 20 } });
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, initialGame);
    await banner.locator('.scorebug').click();
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, skippedGame);

    const doubleClickBanner = async direction => {
      const box = await banner.locator('.scorebug').boundingBox();
      await banner.locator('.scorebug').dblclick({ position: { x: box.width * (direction > 0 ? 0.75 : 0.25), y: box.height / 2 } });
      // Let any incorrectly retained single-click timer fire before checking.
      await banner.waitForTimeout(450);
    };
    await doubleClickBanner(1);
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).scale), 1.25, 'right-half double-click enlarges');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'enlarging does not navigate');
    await admin.waitForFunction(() => document.querySelector('#desktop-size').value === '1.25');
    await doubleClickBanner(-1);
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).scale), 1, 'left-half double-click shrinks');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'shrinking does not navigate');
    for (const [scale, direction] of [[0.5, -1], [3, 1]]) {
      await admin.evaluate(scale => window.sportsDesktop.action('size', scale), scale);
      await doubleClickBanner(direction);
      assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).scale), scale, 'size limit is respected');
      assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'double-click at size limit does not navigate');
    }
    await admin.evaluate(() => window.sportsDesktop.action('size', 1));

    assert.equal(await banner.locator('.banner-controls').count(), 0, 'no hover controls cover scores');
    const bannerBounds = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().includes('display.html?desktop')).getBounds());
    const beforeDrag = await bannerBounds();
    const box = await banner.locator('.scorebug').boundingBox();
    await banner.mouse.move(box.x + 40, box.y + 20);
    await banner.mouse.down();
    await banner.mouse.move(box.x + 70, box.y + 40);
    await banner.mouse.up();
    const afterDrag = await bannerBounds();
    assert.ok(afterDrag.x !== beforeDrag.x || afterDrag.y !== beforeDrag.y, 'dragging moves the native window');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'drag release does not skip');
    await banner.evaluate(async origin => {
      const send = value => window.sportsDesktop.action('banner-pointer', value);
      await send({ phase: 'start', x: 0, y: 0 });
      await send({ phase: 'move', x: -origin.x - 0.2, y: -origin.y - 0.2 });
      await send({ phase: 'end', x: -origin.x - 0.2, y: -origin.y - 0.2 });
    }, afterDrag);
    const fractionalBounds = await bannerBounds();
    assert.equal(fractionalBounds.x, 0, 'fractional drag reaches x=0 without a native conversion error');
    // macOS may constrain y=0 below its menu bar.
    await banner.evaluate(async () => {
      const send = value => window.sportsDesktop.action('banner-pointer', value);
      for (const point of [{ x: Number.MAX_VALUE, y: 0 }, { x: 0, y: Number.MAX_VALUE }]) {
        await send({ phase: 'start', x: 0, y: 0 });
        await send({ phase: 'move', ...point });
        await send({ phase: 'end', x: 0, y: 0 });
      }
    });
    const safeBounds = await bannerBounds();
    assert.deepEqual(safeBounds, fractionalBounds, 'invalid coordinates do not move the native window');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'invalid gestures never skip');
    const dragScale = await admin.evaluate(async () => (await window.sportsDesktop.status()).scale);
    await banner.evaluate(async () => {
      const send = (phase, x, y) => window.sportsDesktop.action('banner-pointer', { phase, x, y });
      const x = window.screenX + window.innerWidth * 0.75, y = window.screenY + 20;
      await send('start', x, y); await send('end', x, y);
      await send('start', x, y); await send('move', x + 20, y); await send('end', x, y);
    });
    await banner.waitForTimeout(450);
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).scale), dragScale, 'second-press dragging does not resize');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'second-press dragging cancels pending navigation');
    await application.evaluate(({ Menu, BrowserWindow }) => {
      const build = Menu.buildFromTemplate;
      Menu.buildFromTemplate = function(template) {
        const menu = build.call(this, template);
        if (template.length === 1 && template[0].label === 'Settings…') globalThis.bannerTestMenu = menu;
        return menu;
      };
      BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/admin/')).hide();
    });
    await banner.locator('.scorebug').click({ button: 'right' });
    await application.evaluate(async () => {
      for (let i = 0; i < 50 && !globalThis.bannerTestMenu; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (!globalThis.bannerTestMenu) throw Error('Banner context menu did not open');
      globalThis.bannerTestMenu.closePopup();
      globalThis.bannerTestMenu.items[0].click();
    });
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().includes('/admin/')).isVisible()), true);
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'right-click Settings does not skip');
    await admin.locator('#rotation-queue [data-game-key="baseball:2"] .remove-game').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 1);
    await admin.locator('[data-tab="settings"]').click();
    await banner.screenshot({ path: path.join(directory, 'banner.png'), omitBackground: true });
    await admin.screenshot({ path: path.join(directory, 'settings.png') });
    await lockToggle.click();
    assert.equal(await lockToggle.innerText(), 'Unlock');
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).locked), true);
    const lockedGame = await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey);
    const lockedScale = await admin.evaluate(async () => (await window.sportsDesktop.status()).scale);
    await banner.evaluate(async () => {
      for (let i = 0; i < 2; i++) {
        await window.sportsDesktop.action('banner-pointer', { phase: 'start', x: window.screenX + 15, y: window.screenY + 20 });
        await window.sportsDesktop.action('banner-pointer', { phase: 'end', x: window.screenX + 15, y: window.screenY + 20 });
      }
    });
    await banner.waitForTimeout(450);
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).scale), lockedScale, 'locked banner ignores double-click resizing');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), lockedGame, 'locked banner ignores backwards navigation');

    await lockToggle.click();
    assert.equal(await lockToggle.innerText(), 'Lock');
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).locked), false);
    await admin.locator('#desktop-size').selectOption('1.5');
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).scale), 1.5);
    await admin.locator('#display-mode').selectOption('top-favorite');
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
    await obs.emulateMedia({ reducedMotion: 'no-preference' });
    await obs.evaluate(() => {
      window.gameTransitions = [];
      document.addEventListener('animationstart', event => {
        if (event.animationName.startsWith('sports-rotate-')) window.gameTransitions.push(event.animationName);
      });
    });
    assert.equal(await obs.evaluate(() => typeof window.SportsOverlay), 'undefined', 'OBS loads no providers or rotation engine');
    const before = await (await fetch(`${base}/api/v1/state`, { headers })).json();
    const overrideKey = before.currentGameKey === 'baseball:1' ? 'baseball:2' : 'baseball:1';
    await visibilityToggle.click();
    assert.equal(await visibilityToggle.innerText(), 'Show');
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
    assert.deepEqual(await obs.evaluate(() => window.gameTransitions), [
      'sports-rotate-out', 'sports-rotate-in', 'sports-rotate-out', 'sports-rotate-in',
    ], 'Electron output animates both the override and return to the automatic game');
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
    await admin.evaluate(() => window.sportsDesktop.action('size', 1));
    await doubleClickBanner(1);
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).scale), 1.25);
    await admin.evaluate(async () => { await window.sportsDesktop.action('lock'); await window.sportsDesktop.action('hide'); });
    await application.close();
    ({ admin, banner, engine } = await launch());
    assert.equal(await admin.evaluate(() => window.SportsOverlay.config.loadConfig().displayMode), 'top-favorite');
    const restored = await admin.evaluate(() => window.sportsDesktop.status());
    assert.equal(restored.scale, 1.25); assert.equal(restored.locked, true); assert.equal(restored.visible, false);
    assert.equal(await admin.locator('[data-desktop="toggle-lock"]').innerText(), 'Unlock');
    assert.equal(await admin.locator('[data-desktop="toggle-visibility"]').innerText(), 'Show');
    assert.equal(restored.override, null);
    await admin.locator('[data-desktop="recover"]').click();
    await application.close();
    ({ admin, banner, engine } = await launch(true));
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).visible), false);
    await application.evaluate(({ app }) => app.emit('second-instance', {}, ['SportsOver']));
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).visible), true, 'normal second launch still recovers banner');
    assert.deepEqual(errors, []);
    console.log(`Desktop/shared-engine smoke passed. Screenshots and isolated data: ${directory}`);
  } finally { if (application) await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
