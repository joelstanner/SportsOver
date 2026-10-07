const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    let state = { initialized: false, config: null, revision: 0, instance: 'autosave-test', catalogRevision: 0 };
    let hold = false, release, failed = false, conflict = false, discoveryConflict = false;
    const requests = [], errors = [];
    const catalogRequests = [];
    let catalogReads = 0, releaseCatalog, failCatalog = false;
    const context = await browser.newContext();
    context.setDefaultTimeout(15000);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.fulfill({ json: { events: [], dates: [] } });
      if (url.pathname.endsWith('/api/team-catalog/refresh')) {
        assert.equal(route.request().method(), 'POST');
        const body = route.request().postDataJSON();
        catalogRequests.push(body);
        await new Promise(resolve => { releaseCatalog = resolve; });
        releaseCatalog = undefined;
        if (failCatalog) {
          failCatalog = false;
          return route.fulfill({ status: 503, json: { error: 'Team provider unavailable' } });
        }
        const sports = body.sport === 'all'
          ? ['baseball', 'football', 'college-football', 'hockey', 'soccer', 'basketball', 'college-basketball'] : [body.sport];
        return route.fulfill({ json: { results: sports.map(sport => ({ sport, count: 30 })) } });
      }
      if (url.pathname.endsWith('/teams.json')) catalogReads++;
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
          if (discoveryConflict) {
            discoveryConflict = false;
            state = { ...state, revision: state.revision + 1, config: { ...state.config,
              automaticWatchLists: { ...state.config.automaticWatchLists, chess: [{ tournamentId: 'Elite001', roundId: '', name: 'Elite Masters', enabled: true, view: 'overview', playerId: '' }] } } };
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
    assert.equal(await page.locator('#live-mode-final-minutes').inputValue(), '20');
    await page.locator('#live-mode-final-minutes').fill('7');
    await page.locator('#live-mode-final-minutes').press('Enter');
    await saved();
    assert.equal(state.config.liveModeFinalMinutes, 7);
    await page.locator('#live-mode-final-minutes').fill('1.5');
    await page.locator('#live-mode-final-minutes').press('Enter');
    assert.equal(await page.locator('#live-mode-final-minutes').evaluate(input => input.validity.valid), false);
    assert.equal(state.config.liveModeFinalMinutes, 7, 'fractional minutes do not overwrite the saved setting');
    await page.locator('#live-mode-final-minutes').fill('20');
    await page.locator('#live-mode-final-minutes').press('Enter');
    await saved();
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
    await page.locator('#display-mode').selectOption('automatic');
    await page.locator('#fallback-mode').selectOption('hide');
    release(); release = undefined;
    await saved();
    assert.equal(state.config.displayMode, 'automatic');
    assert.equal(state.config.fallbackMode, 'hide');
    assert.equal(await page.locator('#display-mode').inputValue(), 'automatic');
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
    await page.locator('#display-mode').selectOption('top-favorite');
    await page.getByRole('button', { name: 'Retry save' }).waitFor();
    assert.equal(await page.locator('#display-mode').inputValue(), 'top-favorite');
    await page.getByRole('button', { name: 'Retry save' }).click();
    await saved();
    assert.equal(state.config.displayMode, 'top-favorite');
    assert.equal(state.config.timeZone, 'UTC');
    // A discovery-owned watch list update must not require a manual retry.
    discoveryConflict = true;
    await page.locator('#display-mode').selectOption('automatic');
    await saved();
    assert.equal(state.config.displayMode, 'automatic');
    assert.equal(state.config.automaticWatchLists.chess[0].tournamentId, 'Elite001');
    assert.equal(await page.locator('#save-settings').isVisible(), false);
    assert.deepEqual(errors, []);
    assert.ok(requests.slice(1).every(request => Object.keys(request.config).length < Object.keys(state.config).length), 'autosaves only send changed fields');
    // Directory replacement requires explicit confirmation and preserves settings.
    const beforeCatalog = structuredClone(state.config);
    const beforeCatalogSaves = requests.length;
    const refreshButton = page.locator('#refresh-team-catalog');
    const catalogSport = page.locator('#catalog-refresh-sport');
    const catalogDialog = page.getByRole('dialog', { name: 'Refresh team directory?' });
    const cancelCatalog = page.locator('#cancel-refresh-team-catalog');
    await refreshButton.click();
    assert.equal(await catalogDialog.isVisible(), true);
    assert.match(await catalogDialog.textContent(), /NFL, MLB, NCAAF, NHL, MLS, NBA, NCAAM/);
    assert.equal(await cancelCatalog.evaluate(button => button === document.activeElement), true);
    await cancelCatalog.click();
    assert.equal(await refreshButton.evaluate(button => button === document.activeElement), true);
    await refreshButton.click();
    await page.keyboard.press('Escape');
    assert.equal(await catalogDialog.isVisible(), false);
    await refreshButton.click();
    await page.keyboard.press('Enter');
    assert.equal(await catalogDialog.isVisible(), false, 'Enter on initial focus cancels');
    assert.deepEqual(catalogRequests, [], 'opening, Cancel, Escape, and Enter send no refresh');
    for (const sport of ['football', 'all']) {
      await catalogSport.selectOption(sport);
      await refreshButton.click();
      assert.match(await catalogDialog.textContent(), sport === 'all' ? /NFL, MLB, NCAAF, NHL, MLS, NBA, NCAAM/ : /Football · NFL/);
      const readsBeforeRefresh = catalogReads;
      await page.locator('#confirm-refresh-team-catalog').click();
      await page.waitForFunction(() => document.querySelector('#catalog-refresh-status').textContent.startsWith('Refreshing'));
      assert.equal(await catalogDialog.isVisible(), false);
      assert.equal(await refreshButton.isDisabled(), true);
      assert.equal(await catalogSport.isDisabled(), true);
      await page.waitForFunction(() => document.querySelector('#refresh-team-catalog').disabled);
      while (!releaseCatalog) await new Promise(resolve => setTimeout(resolve, 10));
      assert.deepEqual(catalogRequests.at(-1), { sport, enabledSports: state.config.sports.filter(group => group.enabled !== false).map(group => group.sport) });
      releaseCatalog();
      await page.locator('#catalog-refresh-status.is-saved').waitFor();
      assert.equal(catalogReads - readsBeforeRefresh, 7, 'successful refresh reloads the directories');
      assert.equal(await refreshButton.isEnabled(), true);
      assert.equal(await catalogSport.isEnabled(), true);
      assert.equal(await page.locator('#catalog-refresh-status').textContent(), sport === 'all'
        ? '7 directories refreshed · 210 teams' : '1 directory refreshed · 30 teams');
    }
    failCatalog = true;
    await refreshButton.click();
    await page.locator('#confirm-refresh-team-catalog').click();
    while (!releaseCatalog) await new Promise(resolve => setTimeout(resolve, 10));
    releaseCatalog();
    await page.locator('#catalog-refresh-status.is-error').waitFor();
    assert.match(await page.locator('#catalog-refresh-status').textContent(), /Team provider unavailable/);
    assert.equal(await refreshButton.isEnabled(), true, 'failed refresh can be retried');
    assert.equal(await catalogSport.isEnabled(), true);
    assert.equal(requests.length, beforeCatalogSaves, 'directory refresh sends no settings save');
    assert.deepEqual(state.config, beforeCatalog, 'watched teams, rankings, and settings remain intact');
    assert.deepEqual(errors, []);
    // Opening or dismissing the confirmation must never reset or save settings.
    const beforeReset = structuredClone(state.config);
    const beforeResetRequests = requests.length;
    const resetDialog = page.getByRole('dialog', { name: 'Restore default settings?' });
    const cancelReset = page.locator('#cancel-reset-settings');
    const restoreButton = page.locator('#reset-settings');
    await restoreButton.click();
    assert.equal(await resetDialog.isVisible(), true);
    assert.equal(await cancelReset.evaluate(button => button === document.activeElement), true, 'Cancel receives initial focus');
    assert.deepEqual(state.config, beforeReset);
    assert.equal(requests.length, beforeResetRequests);
    await cancelReset.click();
    assert.equal(await resetDialog.isVisible(), false);
    assert.equal(await restoreButton.evaluate(button => button === document.activeElement), true, 'focus returns to Restore defaults');
    await restoreButton.click();
    await page.keyboard.press('Escape');
    assert.equal(await resetDialog.isVisible(), false);
    await restoreButton.click();
    await page.keyboard.press('Enter');
    assert.equal(await resetDialog.isVisible(), false, 'Enter on the initially focused button cancels');
    assert.deepEqual(state.config, beforeReset);
    assert.equal(requests.length, beforeResetRequests, 'cancellation sends no save');
    // Restoring defaults and a new edit must survive an older in-flight save.
    hold = true;
    await page.locator('#display-mode').selectOption('top-favorite');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saving…');
    while (!release) await new Promise(resolve => setTimeout(resolve, 10));
    await page.locator('#reset-settings').click();
    await page.locator('#confirm-reset-settings').click();
    assert.equal(await resetDialog.isVisible(), false);
    await page.locator('#fallback-mode').selectOption('hide');
    release(); release = undefined;
    await saved();
    assert.equal(state.config.displayMode, 'automatic');
    assert.equal(state.config.fallbackMode, 'hide');
    assert.equal(state.config.timeZone, 'local');
    assert.deepEqual(state.config.sports, await page.evaluate(() => window.SportsOverlay.config.normalizeConfig(window.SportsOverlay.config.DEFAULT_CONFIG).sports));
    const local = await context.newPage();
    local.on('pageerror', error => errors.push(error.message));
    await local.goto('http://127.0.0.1:8000/admin/');
    await local.waitForFunction(() => document.querySelector('#sports-list').children.length > 0);
    // A saved legacy choice still opens with a valid, equivalent selection.
    await local.evaluate(() => {
      const api = window.SportsOverlay.config;
      localStorage.setItem(api.STORAGE_KEY, JSON.stringify({ ...api.loadConfig(), displayMode: 'rotate' }));
    });
    await local.reload();
    await local.waitForFunction(() => document.querySelector('#display-mode').value === 'automatic');
    assert.equal(await local.evaluate(() => window.SportsOverlay.config.loadConfig().displayMode), 'automatic');
    await local.locator('#display-mode').selectOption('top-favorite');
    await local.getByText('Saved automatically locally (preview only).', { exact: true }).waitFor();
    await local.reload();
    await local.waitForFunction(() => document.querySelector('#display-mode').value === 'top-favorite');
    await local.locator('#reset-settings').click();
    await local.locator('#cancel-reset-settings').click();
    assert.equal(await local.locator('#display-mode').inputValue(), 'top-favorite');
    await local.locator('#reset-settings').click();
    await local.locator('#confirm-reset-settings').click();
    await local.getByText('Saved automatically locally (preview only).', { exact: true }).waitFor();
    await local.reload();
    await local.waitForFunction(() => document.querySelector('#display-mode').value === 'automatic');
    assert.deepEqual(errors, []);
    console.log('Settings autosave passed: selections, sports/teams, rapid edits, numbers, remote refresh, failure/retry, conflict, confirmed directory refresh, confirmed restore and safe cancellation.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
