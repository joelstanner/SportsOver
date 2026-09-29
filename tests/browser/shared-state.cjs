// Mocked browser integration: no Twitchbot process or provider connections.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    let state = { initialized: false, config: null, revision: 0, instance: 'test', catalogRevision: 0 };
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const errors = [];
    for (const context of contexts) {
      context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') return route.fulfill({ json: { dates: [], events: [] } });
        if (url.pathname.startsWith('/api/sports/state')) {
          if (route.request().method() !== 'GET') {
            const body = route.request().postDataJSON();
            if (body.expectedRevision !== state.revision) return route.fulfill({ status: 409, json: { detail: state } });
            state = { ...state, initialized: true, revision: state.revision + 1, config: { ...state.config, ...body.config } };
          }
          return route.fulfill({ json: state });
        }
        let relative = url.pathname.replace(/^\/sports\//, '');
        if (!relative || relative.endsWith('/')) relative += 'index.html';
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
        try { await route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: types[path.extname(relative)] }); }
        catch (_) { await route.fulfill({ status: 404, body: '' }); }
      });
    }
    const chrome = await contexts[0].newPage();
    const obs = await contexts[1].newPage();
    await chrome.goto('http://127.0.0.1:8000/sports/admin/');
    await chrome.getByRole('button', { name: 'Start with defaults' }).click();
    await chrome.getByText('Shared settings initialized.', { exact: true }).waitFor();
    await obs.goto('http://127.0.0.1:8000/sports/');
    await obs.waitForFunction(() => window.SportsOverlay.shared?.snapshot()?.initialized);
    const marker = await obs.evaluate(() => { window.testMarker = 'same-document'; return window.testMarker; });
    const initialRevision = state.revision;
    await chrome.locator('#display-mode').selectOption('top-favorite');
    await chrome.locator('#save-settings').click();
    await obs.waitForFunction(() => window.SportsOverlay.config.loadConfig().displayMode === 'top-favorite');
    assert.equal(await obs.evaluate(() => window.testMarker), marker);
    assert.equal(state.revision, initialRevision + 1);
    // A second control room gets current state in an independent storage profile.
    const other = await contexts[1].newPage();
    await other.goto('http://127.0.0.1:8000/sports/admin/');
    await other.waitForFunction(() => document.querySelector('#display-mode').value === 'top-favorite');
    await chrome.locator('#fallback-mode').selectOption('hide'); // Keep this unsaved.
    await other.locator('#display-mode').selectOption('rotate');
    await other.locator('#save-settings').click();
    await chrome.getByText('Settings changed elsewhere. Your unsaved draft is preserved.', { exact: true }).waitFor();
    assert.equal(await chrome.locator('#fallback-mode').inputValue(), 'hide');
    await chrome.locator('#save-settings').click();
    await chrome.getByText('Settings changed elsewhere. Your draft is preserved. Review it, then save again to apply.', { exact: true }).waitFor();
    await chrome.locator('#save-settings').click();
    await obs.waitForFunction(() => window.SportsOverlay.config.loadConfig().fallbackMode === 'hide');
    assert.equal(state.config.displayMode, 'rotate'); // Unrelated change survives.
    await chrome.locator('#time-zone').selectOption('America/Los_Angeles');
    await chrome.locator('#save-settings').click();
    await obs.waitForFunction(() => window.SportsOverlay.config.loadConfig().timeZone === 'America/Los_Angeles');
    assert.equal(await obs.evaluate(() => window.SportsOverlay.model.formatGameTime('2026-07-01T19:00:00Z')), '12:00 PM PDT');
    assert.equal(await obs.evaluate(() => window.SportsOverlay.model.formatGameTime('2026-12-01T20:00:00Z')), '12:00 PM PST');
    assert.equal(await obs.evaluate(() => window.testMarker), marker);
    assert.deepEqual(errors, []);
    console.log('Browser integration passed: isolated profiles, no reload, draft preservation, conflict/reapply.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
