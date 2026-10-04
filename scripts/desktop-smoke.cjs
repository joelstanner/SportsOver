// Real native windows, one live engine, mocked upstream feeds and isolated app data.
const { electron, testMode } = require('./test-mode.cjs');
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
const quiet = testMode() === 'quiet';
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
          if (url.pathname.includes('/game/2/')) body.liveData.linescore.teams.home.runs = 3;
          if (body.liveData.linescore.teams.away.runs <= body.liveData.linescore.teams.home.runs) throw Error('Mariners fixtures must always lead');
          if (url.pathname.includes('/game/3/')) {
            body.gameData.status = { abstractGameState: 'Preview', detailedState: 'Scheduled' };
            body.gameData.teams.away = { id: 135, name: 'San Diego Padres', abbreviation: 'SD' };
          }
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
    if (!quiet && process.platform === 'darwin') {
      assert.equal(await application.evaluate(({ app }) => app.dock.isVisible()), true,
        'SportsOver stays in the Dock and Cmd-Tab after banner startup');
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
        .find(win => win.webContents.getURL().includes('display.html?desktop')).isVisibleOnAllWorkspaces()), true,
      'banner still follows macOS workspaces');
    }
    // Packaged apps can start fetching before Playwright installs the fixtures.
    // Restart the engine after interception so assertions never use live data.
    await engine.reload();
    await admin.waitForFunction(async () => (await window.sportsDesktop.engine()).availableEntries.length >= 2);
    await banner.waitForFunction(() => /SEA|Mariners/i.test(document.body.innerText));
    return { admin, banner, engine };
  }
  try {
    let { admin, banner, engine } = await launch();
    if (quiet) {
      await require('./desktop-quiet-smoke.cjs')({
        pages: { admin, banner, engine }, directory, launch, application: () => application,
      });
      assert.deepEqual(errors, []);
      console.log(`Quiet desktop smoke passed. Native window checks skipped. Screenshots and isolated data: ${directory}`);
      return;
    }
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
    assert.deepEqual(await banner.evaluate(() => Object.keys(window.SportsOverlay)), ['scrolling', 'model', 'countdown'], 'desktop loads only display helpers, no provider or rotation engine');
    // Adding a secondary watched team automatically discovers and selects its game.
    await admin.locator('#team-sport-picker').selectOption('baseball');
    await admin.locator('#team-picker').selectOption('mlb:135');
    await admin.locator('#add-team').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.some(entry => entry.candidate.sport === 'baseball' && entry.candidate.id === '3'));
    await admin.getByRole('button', { name: 'Live control', exact: true }).click();
    await admin.locator('#rotation-queue [data-game-key="baseball:3"]').waitFor();
    // Manual refresh acknowledges engine completion, not an intermediate frame.
    await engine.evaluate(() => {
      const api = window.SportsOverlay.engine;
      window.realRefresh = api.refresh;
      window.realDescribe = api.describe;
      // Other sports intentionally have no fixtures in this desktop scenario.
      api.describe = () => ({ ...window.realDescribe(), discoveryFailures: 0 });
      api.refresh = () => new Promise(resolve => { window.finishTestRefresh = resolve; });
    });
    const refreshButton = admin.locator('#refresh-games');
    const refreshStatus = admin.locator('#refresh-games-status');
    await refreshButton.click();
    await engine.waitForFunction(() => !!window.finishTestRefresh);
    assert.equal(await refreshButton.isDisabled(), true);
    assert.equal(await refreshButton.innerText(), 'Refreshing…');
    assert.equal(await refreshStatus.innerText(), 'Checking for game updates…');
    await engine.evaluate(() => window.finishTestRefresh());
    await admin.waitForFunction(() => !document.querySelector('#refresh-games').disabled);
    assert.equal(await refreshStatus.innerText(), 'No updates available. Game lists are already up to date.');
    await admin.waitForTimeout(2200);
    assert.equal(await refreshStatus.innerText(), 'No updates available. Game lists are already up to date.', 'background polling preserves refresh feedback');
    await engine.evaluate(() => { window.SportsOverlay.engine.refresh = async () => { throw Error('Test refresh failure'); }; });
    await refreshButton.click();
    await admin.waitForFunction(() => !document.querySelector('#refresh-games').disabled);
    assert.equal(await refreshStatus.innerText(), 'Could not refresh games. Test refresh failure');
    assert.equal(await refreshButton.isEnabled(), true);
    await engine.evaluate(() => { window.SportsOverlay.engine.refresh = window.realRefresh; window.SportsOverlay.engine.describe = window.realDescribe; });
    // Live mode is session-only and applies locks after filtering live eligibility.
    const liveModeButton = admin.locator('#live-mode');
    assert.equal(await liveModeButton.getAttribute('aria-pressed'), 'false');
    await admin.locator('#rotation-queue [data-game-key="baseball:3"] .lock-game').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().currentGameKey === 'baseball:3');
    await liveModeButton.click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().liveMode.active
      && window.SportsOverlay.engine.describe().queue.length === 1
      && window.SportsOverlay.engine.describe().currentGameKey === 'baseball:1');
    assert.equal(await liveModeButton.getAttribute('aria-pressed'), 'true');
    assert.equal(await admin.locator('#rotation-mode').isDisabled(), true);
    assert.equal(await admin.locator('#rotation-queue .lock-game').first().isDisabled(), false);
    await admin.locator('#rotation-queue [data-game-key="baseball:1"]').waitFor();
    assert.equal(await admin.locator('#rotation-queue [data-game-key="baseball:3"]').count(), 0);
    assert.deepEqual(await engine.evaluate(() => window.SportsOverlay.config.loadConfig().lockedGameKeys), ['baseball:3']);
    assert.equal(await admin.locator('#available-games [data-game-key="baseball:3"]').count(), 0, 'filtered upcoming games remain selected, not available to add again');
    await admin.locator('#available-games [data-game-key="baseball:2"] .add-game').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 2);
    const liveCard = id => admin.locator(`#rotation-queue [data-game-key="baseball:${id}"]`);
    await liveCard(2).locator('.lock-game').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 1
      && window.SportsOverlay.engine.describe().currentGameKey === 'baseball:2');
    await liveCard(1).waitFor();
    assert.equal(await liveCard(1).locator('.lock-game').isEnabled(), true, 'other live games remain available to lock');
    await liveCard(1).locator('.lock-game').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 2);
    await liveCard(2).locator('.lock-game').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 1
      && window.SportsOverlay.engine.describe().currentGameKey === 'baseball:1');
    await liveCard(1).locator('.lock-game').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 2);
    await liveCard(2).locator('.remove-game').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 1);
    assert.deepEqual(await engine.evaluate(() => window.SportsOverlay.config.loadConfig().lockedGameKeys), ['baseball:3']);
    await admin.screenshot({ path: path.join(directory, 'live-mode.png') });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().includes('/admin/')).setSize(700, 500));
    assert.equal(await admin.evaluate(() => document.body.scrollWidth <= innerWidth), true, 'Live mode fits the minimum settings window width');
    await admin.screenshot({ path: path.join(directory, 'live-mode-small.png') });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().includes('/admin/')).setSize(1120, 820));
    await liveModeButton.click();
    await engine.waitForFunction(() => !window.SportsOverlay.engine.describe().liveMode.active
      && window.SportsOverlay.engine.describe().currentGameKey === 'baseball:3');
    await admin.locator('#rotation-mode').selectOption('curated');
    await engine.waitForFunction(() => !window.SportsOverlay.engine.describe().liveMode.canActivate);
    await admin.waitForFunction(() => document.querySelector('#live-mode').disabled);
    assert.equal(await liveModeButton.getAttribute('aria-pressed'), 'false');
    await assert.rejects(admin.evaluate(() => window.sportsDesktop.action('live-mode', true)), /No live games in rotation/);
    await admin.locator('#rotation-mode').selectOption('automatic');
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().currentGameKey === 'baseball:3');
    await admin.locator('#rotation-queue [data-game-key="baseball:3"] .lock-game').click();
    await admin.getByRole('button', { name: 'Settings', exact: true }).click();
    await admin.locator('#live-mode-final-minutes').fill('7');
    await admin.locator('#live-mode-final-minutes').press('Enter');
    await engine.waitForFunction(() => window.SportsOverlay.config.loadConfig().liveModeFinalMinutes === 7);
    await admin.locator('[data-team-key="mlb:135"] .remove-team').click();
    await engine.waitForFunction(() => !window.SportsOverlay.engine.describe().queue.some(entry => entry.candidate.sport === 'baseball' && entry.candidate.id === '3'));
    await admin.getByRole('button', { name: 'Live control', exact: true }).click();
    await admin.locator('#available-games [data-game-key="baseball:2"] .add-game').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 2);
    const initialGame = await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey);
    // Names and logos open game links. Browse and resize on the unlinked top
    // padding, using proportions so the target stays valid at every zoom.
    const browseBanner = async direction => {
      const box = await banner.locator('.scorebug').boundingBox();
      await banner.locator('.scorebug').click({ position: {
        x: box.width * (direction < 0 ? 0.05 : 0.75), y: box.height * 0.05,
      } });
    };
    await browseBanner(1);
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey !== key, initialGame);
    const skippedGame = await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey);
    await browseBanner(-1);
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, initialGame);
    await browseBanner(1);
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, skippedGame);

    const nativeKey = async (page, keyCode, modifiers = []) => {
      const url = page.url();
      await application.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows()
        .find(win => win.webContents.getURL() === url).focus(), url);
      await page.waitForFunction(() => document.hasFocus());
      // Use native input because CDP keyboard events bypass before-input-event.
      await application.evaluate(({ BrowserWindow }, { url, keyCode, modifiers }) => {
        const contents = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url).webContents;
        contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      }, { url, keyCode, modifiers });
    };
    await banner.waitForFunction(async key => {
      const frame = await (await fetch('/api/output')).json();
      return frame.gameKey === key && Number(document.body.dataset.sequence) >= frame.sequence;
    }, skippedGame);
    await banner.evaluate(() => {
      window.arrowTransitions = [];
      // The completion event retains timing after output.js removes the CSS
      // class. Reading computed style in a delayed start event can report 0s.
      document.addEventListener('animationend', event => {
        if (event.animationName === 'sports-rotate-quick') window.arrowTransitions.push(event.elapsedTime);
      });
    });
    await nativeKey(banner, 'Right');
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, initialGame);
    await banner.waitForFunction(() => window.arrowTransitions.length >= 1);
    await nativeKey(banner, 'Left');
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, skippedGame);
    await banner.waitForFunction(() => window.arrowTransitions.length >= 2);
    assert.deepEqual(await banner.evaluate(() => window.arrowTransitions.slice(0, 2)), [0.1, 0.1], 'arrows use a 100 ms transition');
    await nativeKey(banner, 'Right', ['control']);
    await admin.evaluate(() => document.activeElement.blur());
    await nativeKey(admin, 'Right');
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, initialGame);
    await nativeKey(admin, 'Left');
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, skippedGame);
    await admin.getByRole('button', { name: 'Settings', exact: true }).click();
    await admin.locator('#live-mode-final-minutes').focus();
    await nativeKey(admin, 'Right');
    await admin.waitForTimeout(250);
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame,
      'modified arrows and Settings field arrows do not navigate the banner');
    await admin.getByRole('button', { name: 'Live control', exact: true }).click();
    await require('./settings-arrows-smoke.cjs')({ admin, engine });

    const doubleClickBanner = async direction => {
      const width = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
        .find(win => win.webContents.getURL().includes('display.html?desktop')).getContentBounds().width);
      // Native resizing completes before the renderer necessarily receives it.
      // Measure click coordinates only after its viewport and CSS zoom catch up.
      await banner.waitForFunction(width => window.innerWidth === width
        && Math.abs(Number(document.body.style.zoom) - width / 472) < 0.001, width);
      const box = await banner.locator('.scorebug').boundingBox();
      await banner.locator('.scorebug').dblclick({ position: { x: box.width * (direction > 0 ? 0.75 : 0.25), y: box.height * 0.05 } });
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
      const area = await application.evaluate(({ BrowserWindow, screen }) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
        return screen.getDisplayMatching(win.getBounds()).workArea;
      });
      // Small CI displays cap the largest banner below the 300% setting.
      const expectedScale = Math.round(Math.min(472 * scale, area.width, area.height * 472 / 100)) / 472;
      await doubleClickBanner(direction);
      assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).scale), expectedScale, 'size and display limits are respected');
      assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'double-click at size limit does not navigate');
    }
    await admin.evaluate(() => window.sportsDesktop.action('size', 1));

    assert.equal(await banner.locator('.banner-controls').count(), 0, 'no hover controls cover scores');
    const bannerBounds = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().includes('display.html?desktop')).getBounds());
    const waitBannerBounds = expected => application.evaluate(async ({ BrowserWindow }, expected) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
      for (let i = 0; i < 100; i++) {
        const actual = win.getBounds();
        if (Object.entries(expected).every(([key, value]) => actual[key] === value)) return actual;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return win.getBounds();
    }, expected);
    const beforeDrag = await bannerBounds();
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
      globalThis.bannerFullscreenEntered = false;
      win.once('enter-full-screen', () => { globalThis.bannerFullscreenEntered = true; });
    });
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('fullscreen-banner').click());
    const fullBounds = await bannerBounds();
    const fullDisplay = await application.evaluate(({ screen }, bounds) => screen.getDisplayMatching(bounds).bounds, beforeDrag);
    assert.deepEqual(fullBounds, fullDisplay, 'fullscreen covers the entire current monitor');
    // Fullscreen IPC can arrive before Chromium handles the native resize.
    // Wait for the viewport and resize-driven scale before measuring centering.
    await banner.waitForFunction(({ width, height }) => {
      const zoom = width / 472;
      return document.body.classList.contains('desktop-fullscreen')
        && innerWidth === width && innerHeight === height
        && Math.abs(Number(document.body.style.zoom) - zoom) < 0.001
        && Math.abs(parseFloat(document.body.style.height) * zoom - height) < 1;
    }, fullBounds);
    const presentation = await banner.evaluate(() => {
      const box = document.querySelector('.scorebug').getBoundingClientRect();
      return { background: getComputedStyle(document.body).backgroundColor,
        centerX: box.x + box.width / 2, centerY: box.y + box.height / 2, width: innerWidth, height: innerHeight };
    });
    assert.equal(presentation.background, 'rgb(0, 0, 0)');
    assert.equal(await banner.locator('body').getAttribute('title'), null, 'fullscreen has no banner instruction tooltip');
    await banner.mouse.move(10, 10);
    assert.notEqual(await banner.evaluate(() => getComputedStyle(document.body).cursor), 'none');
    await banner.waitForFunction(() => getComputedStyle(document.body).cursor === 'none', null, { timeout: 5000 });
    assert.equal(await banner.locator('.scorebug').evaluate(el => getComputedStyle(el).cursor), 'none', 'idle cursor hides over the banner too');
    await banner.mouse.move(20, 10);
    assert.notEqual(await banner.evaluate(() => getComputedStyle(document.body).cursor), 'none', 'moving reveals the cursor');
    assert.ok(Math.abs(presentation.centerX - presentation.width / 2) < 2, `banner centered horizontally: ${JSON.stringify(presentation)}`);
    assert.ok(Math.abs(presentation.centerY - presentation.height / 2) < 2, `banner centered vertically: ${JSON.stringify(presentation)}`);
    const nativeFullscreen = await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
      // Electron 44's transparent Windows path emits enter-full-screen and
      // covers the monitor, but does not set the widget's isFullScreen flag.
      // The monitor bounds and opaque background are checked above.
      if (process.platform === 'win32') return { entered: globalThis.bannerFullscreenEntered, covering: win.isAlwaysOnTop() };
      const entered = process.platform === 'darwin' ? win.isSimpleFullScreen() : win.isFullScreen();
      return { entered, covering: entered };
    });
    assert.deepEqual(nativeFullscreen, { entered: true, covering: true }, 'platform fullscreen entered with the banner covering desktop chrome');
    await admin.waitForFunction(() => document.querySelector('#desktop-size').disabled);
    await doubleClickBanner(1);
    assert.deepEqual(await bannerBounds(), fullBounds, 'fullscreen ignores double-click resizing');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame);
    await banner.screenshot({ path: path.join(directory, 'fullscreen-banner.png'), omitBackground: true });
    // Exercise the same pointer IPC as dragging without relying on OS edge hit testing.
    const fullDrag = { x: fullBounds.x + 100, y: fullBounds.y + 50 };
    await banner.evaluate(async point => {
      await window.sportsDesktop.action('banner-pointer', { phase: 'start', ...point });
      await window.sportsDesktop.action('banner-pointer', { phase: 'end', x: point.x + 60, y: point.y + 30 });
    }, fullDrag);
    assert.deepEqual(await bannerBounds(), fullBounds, 'fullscreen stays fixed on the display');
    await banner.waitForTimeout(300);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).desktop.bounds, beforeDrag, 'fullscreen dragging preserves saved normal bounds');
    await browseBanner(-1);
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, initialGame);
    await browseBanner(1);
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, skippedGame);
    // CDP keyboard events bypass Electron's before-input-event handler.
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
      win.focus();
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    });
    assert.deepEqual(await waitBannerBounds(beforeDrag), beforeDrag, 'Escape restores normal size and position');
    assert.equal(await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop')).isAlwaysOnTop()), true,
    'leaving fullscreen preserves always-on-top');
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).fullscreen), false);
    await banner.waitForFunction(() => !document.body.classList.contains('desktop-fullscreen'));
    assert.equal(await banner.locator('body').getAttribute('title'), 'Click: browse · Drag: move · Double-click: resize · Right-click: menu');
    assert.notEqual(await banner.evaluate(() => getComputedStyle(document.body).cursor), 'none', 'exiting fullscreen restores the cursor');
    assert.equal(await banner.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)', 'normal banner restores transparency');
    await admin.getByRole('button', { name: 'Settings', exact: true }).click();
    await admin.locator('[data-desktop="toggle-fullscreen"]').click();
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).fullscreen), true);
    await admin.locator('[data-desktop="toggle-fullscreen"]').click();
    assert.deepEqual(await waitBannerBounds(beforeDrag), beforeDrag, 'Settings exits fullscreen');
    await admin.getByRole('button', { name: 'Live control', exact: true }).click();
    const box = await banner.locator('.scorebug').boundingBox();
    await banner.mouse.move(box.x + 40, box.y + 5);
    await banner.mouse.down();
    await banner.mouse.move(box.x + 70, box.y + 25);
    await banner.mouse.up();
    // Flush pointer IPC, then wait for native movement to settle before using
    // these coordinates as the next gesture's origin.
    await banner.evaluate(() => window.sportsDesktop.action('banner-pointer', { phase: 'cancel' }));
    const afterDrag = await application.evaluate(async ({ BrowserWindow }, origin) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
      const deadline = Date.now() + 5000;
      let bounds = win.getBounds(), stableSince = Date.now();
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
        const next = win.getBounds();
        if (next.x !== bounds.x || next.y !== bounds.y) stableSince = Date.now();
        bounds = next;
        if ((bounds.x !== origin.x || bounds.y !== origin.y) && Date.now() - stableSince >= 200) break;
      }
      return bounds;
    }, beforeDrag);
    assert.ok(afterDrag.x !== beforeDrag.x || afterDrag.y !== beforeDrag.y, 'dragging moves the native window');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'drag release does not skip');
    await banner.evaluate(async origin => {
      const send = value => window.sportsDesktop.action('banner-pointer', value);
      await send({ phase: 'start', x: 0, y: 0 });
      await send({ phase: 'move', x: -origin.x - 0.2, y: -origin.y - 0.2 });
      await send({ phase: 'end', x: -origin.x - 0.2, y: -origin.y - 0.2 });
    }, afterDrag);
    // Native movement can complete after the pointer IPC resolves on CI.
    const fractionalBounds = await waitBannerBounds({ x: 0 });
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
        if (template[0]?.label === 'Settings…' && template.some(item => item.id === 'hide-banner')) globalThis.bannerTestMenu = menu;
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
    await application.evaluate(() => { globalThis.bannerTestMenu = null; });
    await banner.locator('.scorebug').click({ button: 'right' });
    const contextSizes = await application.evaluate(async () => {
      for (let i = 0; i < 50 && !globalThis.bannerTestMenu; i++) await new Promise(resolve => setTimeout(resolve, 20));
      const size = globalThis.bannerTestMenu.getMenuItemById('banner-size');
      if (!size?.enabled) throw Error('Banner size submenu is unavailable');
      const labels = size.submenu.items.map(item => item.label);
      globalThis.bannerTestMenu.closePopup();
      size.submenu.getMenuItemById('banner-size-1.25').click();
      return labels;
    });
    assert.deepEqual(contextSizes, ['50%', '75%', '100%', '125%', '150%', '200%', '300%']);
    await admin.waitForFunction(() => document.querySelector('#desktop-size').value === '1.25');
    assert.equal((await bannerBounds()).width, 590, 'context size changes the native banner');
    assert.equal(await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('banner-size-1.25').checked), true, 'size checkmark stays synchronized');
    // Bounds persistence is debounced independently of the Settings UI poll.
    let savedWidth;
    for (let i = 0; i < 100; i++) {
      savedWidth = JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).desktop.bounds.width;
      if (savedWidth === 590) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(savedWidth, 590, 'context size persists');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'context size does not browse games');
    const toggleContextLock = async expectedLocked => {
      await application.evaluate(() => { globalThis.bannerTestMenu = null; });
      await banner.locator('.scorebug').click({ button: 'right' });
      await application.evaluate(async ({ Menu }, expectedLocked) => {
        for (let i = 0; i < 50 && !globalThis.bannerTestMenu; i++) await new Promise(resolve => setTimeout(resolve, 20));
        if (!globalThis.bannerTestMenu) throw Error('Banner context menu did not open');
        const item = globalThis.bannerTestMenu.getMenuItemById('lock-banner');
        if (!item || item.type !== 'checkbox' || item.checked !== !expectedLocked) throw Error('Context lock checkbox has incorrect state');
        globalThis.bannerTestMenu.closePopup();
        item.click();
        if (Menu.getApplicationMenu().getMenuItemById('lock-banner').checked !== expectedLocked) throw Error('Application menu lock state did not update');
      }, expectedLocked);
      assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).locked), expectedLocked, 'right-click menu changes lock state');
      assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).desktop.locked, expectedLocked, 'right-click lock state persists');
      assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'right-click lock does not navigate');
    };
    await toggleContextLock(true);
    const fixedBounds = await bannerBounds();
    await browseBanner(-1);
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, initialGame);
    await browseBanner(1);
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, skippedGame);
    const lockedBox = await banner.locator('.scorebug').boundingBox();
    await banner.mouse.move(lockedBox.x + 40, lockedBox.y + 5);
    await banner.mouse.down();
    await banner.mouse.move(lockedBox.x + 80, lockedBox.y + 25);
    await banner.mouse.up();
    await banner.waitForTimeout(450);
    assert.deepEqual(await bannerBounds(), fixedBounds, 'locked dragging leaves the native window in place');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'locked dragging does not navigate');
    await doubleClickBanner(1);
    await doubleClickBanner(-1);
    assert.deepEqual(await bannerBounds(), fixedBounds, 'locked double-clicks leave size and position unchanged');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'locked double-clicks do not navigate');
    await admin.evaluate(() => window.sportsDesktop.action('toggle-fullscreen'));
    const lockedFullBounds = await bannerBounds();
    await banner.evaluate(async () => {
      await window.sportsDesktop.action('banner-pointer', { phase: 'start', x: 100, y: 100 });
      await window.sportsDesktop.action('banner-pointer', { phase: 'end', x: 160, y: 130 });
    });
    assert.deepEqual(await bannerBounds(), lockedFullBounds, 'position lock also prevents fullscreen dragging');
    await application.evaluate(() => { globalThis.bannerTestMenu = null; });
    await banner.locator('.scorebug').click({ button: 'right' });
    await application.evaluate(async () => {
      for (let i = 0; i < 50 && !globalThis.bannerTestMenu; i++) await new Promise(resolve => setTimeout(resolve, 20));
      const item = globalThis.bannerTestMenu.getMenuItemById('fullscreen-banner');
      if (item.label !== 'Exit fullscreen') throw Error('Missing fullscreen exit');
      if (globalThis.bannerTestMenu.getMenuItemById('banner-size').enabled) throw Error('Size menu must be disabled in fullscreen');
      globalThis.bannerTestMenu.closePopup();
      item.click();
    });
    assert.deepEqual(await waitBannerBounds(fixedBounds), fixedBounds, 'right-click menu exits fullscreen while locked');
    await application.evaluate(() => { globalThis.bannerTestMenu = null; });
    await banner.locator('.scorebug').click({ button: 'right' });
    await application.evaluate(async () => {
      for (let i = 0; i < 50 && !globalThis.bannerTestMenu; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (!globalThis.bannerTestMenu) throw Error('Banner context menu did not open');
      globalThis.bannerTestMenu.closePopup();
      globalThis.bannerTestMenu.getMenuItemById('hide-banner').click();
    });
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).visible), false, 'right-click Hide hides the banner');
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).desktop.visible, false, 'right-click Hide persists visibility');
    assert.equal(await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('toggle-banner').label), 'Show banner');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), skippedGame, 'right-click Hide does not skip');
    await admin.evaluate(() => window.sportsDesktop.action('show'));
    await toggleContextLock(false);
    await liveModeButton.click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().liveMode.active);
    await admin.locator('#rotation-queue [data-game-key="baseball:2"] .remove-game').click();
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 1);
    await liveModeButton.click();
    await engine.waitForFunction(() => !window.SportsOverlay.engine.describe().liveMode.active
      && window.SportsOverlay.engine.describe().queue.length === 1);
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
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), lockedGame, 'locked double-click does not navigate');

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
    assert.deepEqual(await obs.evaluate(() => Object.keys(window.SportsOverlay)), ['scrolling', 'model', 'countdown'], 'OBS loads only display helpers, no providers or rotation engine');
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
    await obs.waitForFunction(score => document.querySelector('#home-score')?.textContent === score, overrideKey === 'baseball:2' ? '3' : '2');
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).visible), false, 'OBS continues while desktop hidden');
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().overrideGameKey === null && window.SportsOverlay.engine.describe().currentGameKey === key, before.currentGameKey, { timeout: 10000 });
    await obs.waitForFunction(score => document.querySelector('#home-score')?.textContent === score, before.currentGameKey === 'baseball:2' ? '3' : '2');
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
    assert.ok(native.requests.every(request => !request.id || request.id === -1), `only the desktop coordinator makes upstream provider requests: ${JSON.stringify(native.requests)}`);
    assert.equal(native.top, true);
    assert.equal(native.preferences.sandbox, true);
    assert.equal(native.preferences.contextIsolation, true);
    await admin.evaluate(() => window.sportsDesktop.action('size', 1));
    await doubleClickBanner(1);
    assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).scale), 1.25);
    await admin.evaluate(() => window.sportsDesktop.action('toggle-fullscreen'));
    await admin.evaluate(async () => { await window.sportsDesktop.action('lock'); await window.sportsDesktop.action('hide'); });
    await admin.evaluate(() => window.sportsDesktop.action('live-mode', true));
    await engine.waitForFunction(() => window.SportsOverlay.engine.describe().liveMode.active);
    if (process.platform === 'darwin') {
      const settingsClosed = admin.waitForEvent('close');
      await application.evaluate(({ app, BrowserWindow }) => {
        BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/admin/')).close();
        if (!app.dock.isVisible()) throw Error('Closing Settings hid SportsOver from the Dock');
      });
      await settingsClosed;
      const reopenedWindow = application.waitForEvent('window');
      await application.evaluate(({ app }) => app.emit('activate'));
      const reopened = await reopenedWindow;
      await reopened.waitForFunction(async () => (await window.sportsDesktop.status()).locked);
      assert.equal(await reopened.evaluate(async () => (await window.sportsDesktop.status()).visible), false,
        'Dock activation reopens Settings without changing saved banner visibility');
    }
    await application.close();
    ({ admin, banner, engine } = await launch());
    assert.equal(await admin.evaluate(() => window.SportsOverlay.config.loadConfig().displayMode), 'top-favorite');
    const restored = await admin.evaluate(() => window.sportsDesktop.status());
    assert.equal(restored.fullscreen, false, 'restart leaves fullscreen and restores normal bounds');
    assert.equal(restored.scale, 1.25); assert.equal(restored.locked, true); assert.equal(restored.visible, false);
    assert.equal(await admin.locator('[data-desktop="toggle-lock"]').innerText(), 'Unlock');
    assert.equal(await admin.locator('[data-desktop="toggle-visibility"]').innerText(), 'Show');
    assert.equal(restored.override, null);
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().liveMode.active), false, 'Live mode does not survive app restart');
    assert.equal(await admin.locator('#live-mode-final-minutes').inputValue(), '7', 'final retention setting survives app restart');
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
