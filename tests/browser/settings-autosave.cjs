const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    let state = { initialized: false, config: null, revision: 0, instance: 'autosave-test', catalogRevision: 0 };
    let hold = false, release, failed = false, conflict = false;
    const requests = [], errors = [];
    const context = await browser.newContext();
    context.setDefaultTimeout(15000);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.fulfill({ json: { events: [], dates: [] } });
      if (url.pathname.startsWith('/api/sports/state')) {
        if (route.request().method() !== 'GET') {
          const body = route.request().postDataJSON();
          requests.push(body);
          if (hold) { hold = false; await new Promise(resolve => { release = resolve; }); }
          if (failed) { failed = false; return route.fulfill({ status: 503, json: { detail: 'Connection failed.' } }); }
          if (conflict) {
            conflict = false;
            state = { ...state, revision: state.revision + 1, config: { ...state.config, timeZone: 'UTC' } };
          }
          if (body.expectedRevision !== state.revision) return route.fulfill({ status: 409, json: { detail: state } });
          state = { ...state, initialized: true, revision: state.revision + 1, config: { ...state.config, ...body.config } };
        }
        return route.fulfill({ json: state });
      }
      let relative = url.pathname.replace(/^\/sports\/(?=admin\/|core\/|sports\/|$|index\.html)/, '/').slice(1);
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      try { await route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: types[path.extname(relative)] }); }
      catch (_) { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8000/sports/admin/');
    await page.getByRole('button', { name: 'Start with defaults' }).click();
    await page.getByText('Shared settings initialized.', { exact: true }).waitFor();
    assert.equal(await page.locator('#save-settings').isVisible(), false);
    async function saved() { await page.getByText('Saved automatically. Banner updated.', { exact: true }).waitFor(); }
    await page.locator('[data-sport="hockey"] .sport-enabled').uncheck();
    await saved();
    assert.equal(state.config.sports.find(group => group.sport === 'hockey').enabled, false);
    await page.locator('[data-sport="hockey"] .sport-enabled').check();
    await saved();
    await page.locator('[data-sport="football"] .team-enabled').first().uncheck();
    await saved();
    assert.equal(state.config.sports.find(group => group.sport === 'football').favorites[0].enabled, false);
    await page.locator('[data-sport="football"] .move-sport-up').click();
    await saved();
    assert.equal(state.config.sports[0].sport, 'football');
    await page.locator('#team-sport-picker').selectOption('college-basketball');
    await page.locator('#team-picker').selectOption('ncaam:150');
    await page.locator('#add-team').click();
    await saved();
    assert.equal(state.config.sports.find(group => group.sport === 'college-basketball').favorites.at(-1).teamKey, 'ncaam:150');
    await page.locator('[data-team-key="ncaam:150"] .remove-team').click();
    await saved();
    assert.deepEqual(state.config.sports.find(group => group.sport === 'college-basketball').favorites.map(team => team.teamKey), ['ncaam:158', 'ncaam:264', 'ncaam:2547']);
    // A slow save must not overwrite a later edit, including changes to the same field.
    hold = true;
    await page.locator('#display-mode').selectOption('top-favorite');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saving…');
    while (!release) await new Promise(resolve => setTimeout(resolve, 10));
    await page.locator('#display-mode').selectOption('rotate');
    await page.locator('#fallback-mode').selectOption('hide');
    release(); release = undefined;
    await saved();
    assert.equal(state.config.displayMode, 'rotate');
    assert.equal(state.config.fallbackMode, 'hide');
    assert.equal(await page.locator('#display-mode').inputValue(), 'rotate');
    // Number fields are only committed when complete and valid.
    const interval = page.locator('#provider-refresh-fields input[data-sport="baseball"][data-state="live"]');
    const previous = state.config.providerRefreshSeconds.baseball.live;
    await interval.fill('');
    await interval.pressSequentially('4');
    await page.locator('#time-zone').selectOption('America/New_York');
    await saved();
    assert.equal(state.config.providerRefreshSeconds.baseball.live, previous);
    await interval.fill('30');
    await interval.press('Enter');
    await saved();
    assert.equal(state.config.providerRefreshSeconds.baseball.live, 30);
    // External refreshes keep an actively edited number field mounted and focused.
    await interval.fill('');
    await interval.pressSequentially('2');
    state = { ...state, revision: state.revision + 1, config: { ...state.config, timeZone: 'America/Chicago' } };
    await page.waitForFunction(() => document.querySelector('#time-zone').value === 'America/Chicago');
    assert.equal(await interval.inputValue(), '2');
    assert.equal(await interval.evaluate(input => input === document.activeElement), true);
    await interval.pressSequentially('5');
    await interval.press('Tab');
    await saved();
    assert.equal(state.config.providerRefreshSeconds.baseball.live, 25);
    // Failed saves retain edits and expose a manual retry only when necessary.
    failed = true;
    await page.locator('#fallback-mode').selectOption('recent-final');
    await page.getByRole('button', { name: 'Retry save' }).waitFor();
    assert.match(await page.locator('#save-status').innerText(), /preserved/);
    assert.equal(state.config.fallbackMode, 'hide');
    await page.getByRole('button', { name: 'Retry save' }).click();
    await saved();
    assert.equal(state.config.fallbackMode, 'recent-final');
    assert.equal(await page.locator('#save-settings').isVisible(), false);
    // Conflicts preserve both the user's pending change and unrelated remote edits.
    conflict = true;
    await page.locator('#display-mode').selectOption('automatic');
    await page.getByRole('button', { name: 'Retry save' }).waitFor();
    assert.equal(await page.locator('#display-mode').inputValue(), 'automatic');
    await page.getByRole('button', { name: 'Retry save' }).click();
    await saved();
    assert.equal(state.config.displayMode, 'automatic');
    assert.equal(state.config.timeZone, 'UTC');
    assert.deepEqual(errors, []);
    assert.ok(requests.slice(1).every(request => Object.keys(request.config).length < Object.keys(state.config).length), 'autosaves only send changed fields');
    // Restoring defaults and a new edit must survive an older in-flight save.
    hold = true;
    await page.locator('#display-mode').selectOption('rotate');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saving…');
    while (!release) await new Promise(resolve => setTimeout(resolve, 10));
    await page.locator('#reset-settings').click();
    await page.locator('#fallback-mode').selectOption('hide');
    release(); release = undefined;
    await saved();
    assert.equal(state.config.displayMode, 'automatic');
    assert.equal(state.config.fallbackMode, 'hide');
    assert.equal(state.config.timeZone, 'local');
    const local = await context.newPage();
    local.on('pageerror', error => errors.push(error.message));
    await local.goto('http://127.0.0.1:8000/admin/');
    await local.waitForFunction(() => document.querySelector('#sports-list').children.length > 0);
    await local.locator('#display-mode').selectOption('top-favorite');
    await local.getByText('Saved automatically locally (preview only).', { exact: true }).waitFor();
    await local.reload();
    await local.waitForFunction(() => document.querySelector('#display-mode').value === 'top-favorite');
    assert.deepEqual(errors, []);
    console.log('Settings autosave passed: selections, sports/teams, rapid edits, numbers, remote refresh, failure/retry, conflict.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
