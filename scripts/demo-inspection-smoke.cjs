const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async ({ application, admin, banner, engine, directory }) => {
  const before = await admin.evaluate(() => window.SportsOverlay.config.loadConfig());
  const obsUrl = (await admin.evaluate(() => window.sportsDesktop.status())).obsUrl;
  const output = () => fetch(new URL('/api/output', obsUrl)).then(response => response.json());
  const state = () => admin.evaluate(async () => (await window.sportsDesktop.status()).inspection);
  const waitState = mode => admin.waitForFunction(async mode => {
    const value = (await window.sportsDesktop.status()).inspection;
    return value?.ready && value.mode === mode;
  }, mode);
  let obs;
  try {
    await admin.getByRole('button', { name: 'Demo lab', exact: true }).click();
    await admin.locator('#start-inspection').click();
    await waitState('live');
    await banner.locator('[data-demo-inspection="true"][data-fixture-state="live"] .demo-mark').waitFor();
    assert.equal((await state()).count, 9, 'all sports are available for inspection');
    assert.equal((await state()).playing, false);
    await application.evaluate(async ({ BrowserWindow }, url) => {
      const win = new BrowserWindow({ width: 472, height: 100, show: false, webPreferences: { backgroundThrottling: false } });
      await win.loadURL(url);
    }, obsUrl);
    obs = application.windows().find(page => page.url().startsWith(new URL(obsUrl).origin));
    assert.ok(obs, 'separate HTTP output renderer');
    await obs.locator('.demo-mark').waitFor();
    const paused = (await output()).gameKey;
    await banner.waitForTimeout(500);
    assert.equal((await output()).gameKey, paused, 'starts paused for inspection');
    await admin.locator('#inspection-next').click();
    await banner.locator('[data-sport="football"][data-demo-inspection="true"]').waitFor();
    await obs.locator('[data-sport="football"][data-demo-inspection="true"]').waitFor();
    assert.equal(await banner.locator('.demo-mark').innerText(), 'DEMO');
    await admin.locator('#inspection-previous').click();
    await banner.locator('[data-sport="baseball"][data-demo-inspection="true"]').waitFor();
    for (const mode of ['pregame', 'final', 'interrupted', 'no-event', 'offline', 'error']) {
      await admin.locator('#inspection-state').selectOption(mode);
      await waitState(mode);
      await banner.locator(`[data-fixture-state="${mode}"] .demo-mark`).waitFor();
      await obs.locator(`[data-fixture-state="${mode}"] .demo-mark`).waitFor();
      assert.match((await output()).html, /DEMO/);
    }
    await admin.locator('#inspection-state').selectOption('mixed');
    await waitState('mixed');
    assert.equal((await state()).count, 36);
    await admin.locator('#inspection-sport').selectOption('chess');
    await admin.waitForFunction(async () => (await window.sportsDesktop.status()).inspection?.count === 4);
    await banner.locator('[data-sport="chess"] .demo-mark').waitFor();
    await admin.locator('#inspection-play').click();
    await admin.waitForFunction(async () => (await window.sportsDesktop.status()).inspection?.playing);
    const playingKey = (await output()).gameKey;
    await banner.waitForFunction(async key => (await (await fetch('/api/output')).json()).gameKey !== key, playingKey);
    await admin.locator('#inspection-play').click();
    await admin.waitForFunction(async () => !(await window.sportsDesktop.status()).inspection?.playing);
    const heldKey = (await output()).gameKey;
    await banner.waitForTimeout(4300);
    assert.equal((await output()).gameKey, heldKey, 'pause keeps the selected fixture');
    const demoId = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().includes('scenario=inspection')).webContents.id);
    const demoRequests = await application.evaluate((_electron, id) => globalThis.sportsTestRequests.filter(request => request.id === id), demoId);
    assert.deepEqual(demoRequests, [], 'fixture renderer makes no score-provider requests');
    assert.ok(!(await engine.evaluate(() => window.SportsOverlay.engine.describe())).inspection, 'live engine continues separately');
    await assert.rejects(banner.evaluate(() => window.sportsDesktop.action('demo-inspection', null)), /Settings access required/);
    await assert.rejects(admin.evaluate(() => window.sportsDesktop.action('demo-inspection', { mode: 'bogus', sport: 'all' })), /valid demo/);
    await admin.locator('#inspection-state').selectOption('live');
    await waitState('live');
    await admin.locator('#inspection-sport').selectOption('football');
    await banner.locator('[data-sport="football"][data-fixture-state="live"] .demo-mark').waitFor();
    await obs.locator('[data-sport="football"][data-fixture-state="live"] .demo-mark').waitFor();
    await admin.waitForFunction(() => document.querySelector('#inspection-play').disabled);
    for (const page of [banner, obs]) await page.waitForFunction(() => {
      const mount = document.querySelector('#sports-overlay');
      return !mount.getAnimations().some(animation => animation.animationName?.startsWith('sports-rotate-'))
        && getComputedStyle(mount).filter === 'none';
    });
    await banner.screenshot({ path: path.join(directory, 'demo-banner.png') });
    await obs.screenshot({ path: path.join(directory, 'demo-obs.png') });
    await admin.screenshot({ path: path.join(directory, 'demo-lab.png'), fullPage: true });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/admin/')).setSize(720, 820));
    assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Demo Lab fits a narrow Settings window');
    await admin.screenshot({ path: path.join(directory, 'demo-lab-narrow.png'), fullPage: true });
    await admin.evaluate(async () => {
      await Promise.all(['live', 'pregame', 'final'].map(mode => window.sportsDesktop.action('demo-inspection', { mode, sport: 'all' })));
    });
    await waitState('final');
    await banner.locator('[data-fixture-state="final"] .demo-mark').waitFor();
    await obs.locator('[data-fixture-state="final"] .demo-mark').waitFor();
    await admin.locator('#stop-inspection').click();
    await banner.locator('.demo-mark').waitFor({ state: 'detached' });
    await obs.locator('.demo-mark').waitFor({ state: 'detached' });
    assert.equal(await state(), null);
    assert.doesNotMatch((await output()).html, /data-demo-inspection/);
    assert.deepEqual(await admin.evaluate(() => window.SportsOverlay.config.loadConfig()), before, 'inspection preserves saved preferences');
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => win.webContents.getURL().includes('scenario=inspection'))), false);
  } finally {
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/admin/')).setSize(1120, 820));
    await admin.evaluate(() => window.sportsDesktop.action('demo-inspection', null));
    if (obs) await application.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.destroy(), obs.url());
    await admin.getByRole('button', { name: 'Settings', exact: true }).click();
  }
  console.log(`Demo inspection passed: shared desktop/OBS fixtures, DEMO mark, states, stepping, pause, and live restoration. Screenshots: ${directory}`);
};
