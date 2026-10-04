// Shared-engine checks using real, hidden Electron renderers. The original
// desktop suite remains the authority for native window behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({ pages, directory, launch, application }) => {
  let { admin, banner, engine } = pages;
  const assertHidden = async () => {
    const state = await application().evaluate(({ app, BrowserWindow }) => ({
      windows: BrowserWindow.getAllWindows().map(win => ({ visible: win.isVisible(), focused: win.isFocused() })),
      dock: process.platform === 'darwin' ? app.dock.isVisible() : false,
    }));
    assert.ok(state.windows.length >= 3);
    assert.ok(state.windows.every(win => !win.visible && !win.focused), 'all test windows stay hidden and unfocused');
    assert.equal(state.dock, false, 'quiet tests do not appear in the Dock');
  };
  await assertHidden();
  assert.deepEqual(await banner.evaluate(() => Object.keys(window.SportsOverlay)), ['scrolling', 'model', 'countdown']);
  await admin.locator('#display-mode').selectOption('top-favorite');
  await engine.waitForFunction(() => window.SportsOverlay.config.loadConfig().displayMode === 'top-favorite');
  await admin.locator('#live-mode-final-minutes').fill('7');
  await admin.locator('#live-mode-final-minutes').press('Enter');
  await engine.waitForFunction(() => window.SportsOverlay.config.loadConfig().liveModeFinalMinutes === 7);
  await admin.locator('#desktop-size').selectOption('1.25');
  await banner.waitForFunction(() => innerWidth === 590);
  await admin.locator('[data-desktop="toggle-lock"]').click();
  assert.equal(await admin.evaluate(async () => (await window.sportsDesktop.status()).locked), true);
  // Exercise requests that normally reveal the app, without pretending the
  // hidden window verifies actual visibility or focus behavior.
  for (const action of ['show', 'settings', 'recover']) {
    await admin.evaluate(action => window.sportsDesktop.action(action), action);
    await assertHidden();
  }
  await assert.rejects(admin.evaluate(() => window.sportsDesktop.action('toggle-fullscreen')), /visible test run/);
  await admin.getByRole('button', { name: 'Live control', exact: true }).click();
  await admin.locator('#live-mode').click();
  await engine.waitForFunction(() => window.SportsOverlay.engine.describe().liveMode.active);
  await admin.locator('#available-games [data-game-key="baseball:2"] .add-game').click();
  await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 2);
  await require('./settings-arrows-smoke.cjs')({ admin, engine });
  await admin.locator('#rotation-queue [data-game-key="baseball:2"] .remove-game').click();
  await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 1);
  await admin.locator('#live-mode').click();
  await engine.waitForFunction(() => !window.SportsOverlay.engine.describe().liveMode.active);

  const { obsUrl } = await admin.evaluate(() => window.sportsDesktop.status());
  const base = new URL(obsUrl).origin;
  const { token } = JSON.parse(await fs.readFile(path.join(directory, 'integration.json'), 'utf8'));
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/api/v1/state`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/state`, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  const obsPromise = application().waitForEvent('window');
  await application().evaluate(({ BrowserWindow }, url) => {
    globalThis.obsTest = new BrowserWindow({ width: 472, height: 100, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    globalThis.obsTest.loadURL(url);
  }, obsUrl);
  const obs = await obsPromise;
  await obs.locator('.scorebug').waitFor();
  assert.deepEqual(await obs.evaluate(() => Object.keys(window.SportsOverlay)), ['scrolling', 'model', 'countdown']);
  const before = await (await fetch(`${base}/api/v1/state`, { headers })).json();
  const command = { requestId: 'quiet-override', type: 'show-game', gameKey: 'baseball:2', durationSeconds: 5 };
  const response = await fetch(`${base}/api/v1/commands`, { method: 'POST', headers, body: JSON.stringify(command) });
  assert.equal(response.status, 200);
  const accepted = await response.json();
  const duplicate = await (await fetch(`${base}/api/v1/commands`, { method: 'POST', headers, body: JSON.stringify(command) })).json();
  assert.deepEqual(duplicate, accepted, 'retry does not extend the override');
  await engine.waitForFunction(() => window.SportsOverlay.engine.describe().overrideGameKey === 'baseball:2');
  await obs.waitForFunction(() => document.querySelector('#home-score')?.textContent === '3');
  await engine.waitForFunction(key => window.SportsOverlay.engine.describe().overrideGameKey === null
    && window.SportsOverlay.engine.describe().currentGameKey === key, before.currentGameKey, { timeout: 10000 });
  await obs.waitForFunction(() => document.querySelector('#home-score')?.textContent === '2');
  const frame = await (await fetch(`${base}/api/output`)).json();
  await banner.waitForFunction(sequence => Number(document.body.dataset.sequence) >= sequence, frame.sequence);
  await obs.waitForFunction(sequence => Number(document.body.dataset.sequence) >= sequence, frame.sequence);
  assert.equal(await banner.locator('#sports-overlay').innerText(), await obs.locator('#sports-overlay').innerText());
  const native = await application().evaluate(({ BrowserWindow }) => ({
    engines: BrowserWindow.getAllWindows().filter(win => win.webContents.getURL().includes('engine=1')).length,
    preferences: BrowserWindow.getAllWindows().map(win => win.webContents.getLastWebPreferences()),
    requests: globalThis.sportsTestRequests,
  }));
  assert.equal(native.engines, 1);
  assert.ok(native.preferences.every(prefs => prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration));
  assert.ok(native.requests.length > 0);
  assert.ok(native.requests.every(request => !request.id || request.id === -1), 'only the desktop coordinator requests provider feeds');
  await admin.getByRole('button', { name: 'Settings', exact: true }).click();
  await admin.locator('#desktop-size').selectOption('1.25');
  await admin.evaluate(async () => { await window.sportsDesktop.action('lock'); await window.sportsDesktop.action('hide'); });
  await admin.evaluate(() => window.sportsDesktop.action('live-mode', true));
  await engine.waitForFunction(() => window.SportsOverlay.engine.describe().liveMode.active);
  await banner.screenshot({ path: path.join(directory, 'quiet-banner.png'), omitBackground: true });
  await admin.screenshot({ path: path.join(directory, 'quiet-settings.png') });
  await assertHidden();
  await application().close();
  ({ admin, banner, engine } = await launch());
  await assertHidden();
  const restored = await admin.evaluate(() => window.sportsDesktop.status());
  assert.equal(restored.scale, 1.25);
  assert.equal(restored.locked, true);
  assert.equal(restored.visible, false);
  assert.equal(restored.override, null);
  assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().liveMode.active), false);
  assert.equal(await admin.locator('#display-mode').inputValue(), 'top-favorite');
  assert.equal(await admin.locator('#live-mode-final-minutes').inputValue(), '7');
};
