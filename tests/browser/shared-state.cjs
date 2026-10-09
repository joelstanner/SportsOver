// Mocked browser integration: no Twitchbot process or provider connections.
const { chromium } = require('../../scripts/test-browser.cjs');
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
    const adminSchedules = new Set();
    for (const context of contexts) {
      context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') {
          if (route.request().frame().url().endsWith('/sports/admin/')) adminSchedules.add(url.pathname);
          if (url.hostname === 'lichess.org' && url.pathname === '/api/broadcast/top') return route.fulfill({ json: { active: [] } });
          if (url.hostname === 'www.pdga.com') return route.fulfill({ json: [] });
          return route.fulfill({ json: { dates: [], events: [] } });
        }
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
    const teamPicker = chrome.locator('#team-picker');
    assert.equal(await teamPicker.isDisabled(), true);
    for (const sport of ['baseball', 'football', 'college-football', 'hockey', 'soccer', 'basketball', 'college-basketball']) {
      await chrome.locator('#team-sport-picker').selectOption(sport);
      assert.equal(await teamPicker.inputValue(), '', 'changing sports clears the prior team');
      assert.equal(await chrome.locator('#add-team').isDisabled(), true);
      const available = await chrome.evaluate(sport => {
        const api = window.SportsOverlay.config;
        const watched = new Set(api.loadConfig().sports.flatMap(group => group.favorites.map(team => team.teamKey)));
        return api.TEAM_CATALOG.filter(team => team.sport === sport && !watched.has(team.key)).map(team => team.key);
      }, sport);
      assert.deepEqual(await teamPicker.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean)), available);
      await teamPicker.selectOption(available[0]);
      assert.equal(await chrome.locator('#add-team').isDisabled(), false);
    }
    await teamPicker.selectOption('ncaam:150');
    await chrome.locator('#add-team').click();
    await chrome.locator('[data-sport="college-basketball"] .favorite-card[data-team-key="ncaam:150"]').waitFor();
    assert.equal(await chrome.locator('#team-sport-picker').inputValue(), 'college-basketball');
    assert.equal(await teamPicker.locator('option[value="ncaam:150"]').count(), 0);
    await chrome.getByText('Saved automatically. Banner updated.', { exact: true }).waitFor();
    await obs.goto('http://127.0.0.1:8000/sports/');
    await obs.waitForFunction(() => window.SportsOverlay.shared?.snapshot()?.initialized);
    assert.deepEqual(await obs.evaluate(() => window.SportsOverlay.config.loadConfig().sports.find(group => group.sport === 'college-basketball').favorites), ['ncaam:158', 'ncaam:264', 'ncaam:2547', 'ncaam:150'].map(teamKey => ({ teamKey, enabled: true })));
    const marker = await obs.evaluate(() => { window.testMarker = 'same-document'; return window.testMarker; });
    const initialRevision = state.revision;
    await chrome.locator('#display-mode').selectOption('top-favorite');
    await obs.waitForFunction(() => window.SportsOverlay.config.loadConfig().displayMode === 'top-favorite');
    assert.equal(await obs.evaluate(() => window.testMarker), marker);
    assert.equal(state.revision, initialRevision + 1);
    // A second control room gets current state in an independent storage profile.
    const other = await contexts[1].newPage();
    await other.goto('http://127.0.0.1:8000/sports/admin/');
    await other.waitForFunction(() => document.querySelector('#display-mode').value === 'top-favorite');
    await other.locator('#display-mode').selectOption('automatic');
    await chrome.waitForFunction(() => document.querySelector('#display-mode').value === 'automatic');
    await chrome.locator('#fallback-mode').selectOption('hide');
    await obs.waitForFunction(() => window.SportsOverlay.config.loadConfig().fallbackMode === 'hide');
    assert.equal(state.config.displayMode, 'automatic'); // Unrelated change survives.
    await chrome.locator('#time-zone').selectOption('America/Los_Angeles');
    await obs.waitForFunction(() => window.SportsOverlay.config.loadConfig().timeZone === 'America/Los_Angeles');
    assert.equal(await obs.evaluate(() => window.SportsOverlay.model.formatGameTime('2026-07-01T19:00:00Z')), '12:00 PM PDT');
    assert.equal(await obs.evaluate(() => window.SportsOverlay.model.formatGameTime('2026-12-01T20:00:00Z')), '12:00 PM PST');
    assert.equal(await obs.evaluate(() => window.testMarker), marker);
    const intervalInput = chrome.locator('#provider-refresh-fields input[data-state="live"]');
    await intervalInput.fill('4');
    const beforeInvalid = state.revision;
    await intervalInput.press('Tab');
    assert.equal(state.revision, beforeInvalid);
    await intervalInput.fill('25');
    await intervalInput.press('Enter');
    await obs.waitForFunction(() => window.SportsOverlay.config.loadConfig().providerRefreshSeconds.baseball.live === 25);
    assert.equal(await obs.evaluate(() => window.testMarker), marker);
    await chrome.getByRole('button', { name: 'Live control', exact: true }).click();
    await chrome.getByText('Games refreshed', { exact: true }).waitFor();
    assert.ok([...adminSchedules].some(path => path.includes('/teams/158/schedule')));
    assert.ok([...adminSchedules].some(path => path.includes('/teams/264/schedule')));
    const defaultLive = chrome.locator('[data-default-duration="live"]');
    await defaultLive.fill('');
    // Refreshing the rotation UI (also done by desktop polling) preserves edits.
    await chrome.evaluate(() => document.querySelector('#game-search').dispatchEvent(new Event('input')));
    assert.equal(await defaultLive.inputValue(), '');
    await defaultLive.pressSequentially('4');
    await chrome.evaluate(() => document.querySelector('#game-search').dispatchEvent(new Event('input')));
    assert.equal(await defaultLive.inputValue(), '4');
    await defaultLive.pressSequentially('0');
    await defaultLive.press('Enter');
    await obs.waitForFunction(() => window.SportsOverlay.config.loadConfig().defaultGameDurations.live === 40);
    assert.equal(await obs.evaluate(() => window.testMarker), marker);
    await chrome.locator('#undo-live-change').click();
    await obs.waitForFunction(() => window.SportsOverlay.config.loadConfig().defaultGameDurations.live === 20);
    await defaultLive.fill('8');
    await defaultLive.press('Tab');
    assert.equal(state.config.defaultGameDurations.live, 20);
    for (const invalid of ['4', '305']) {
      await defaultLive.fill(invalid);
      await defaultLive.press('Enter');
      assert.equal(await defaultLive.evaluate(input => input.checkValidity()), false);
      assert.equal(state.config.defaultGameDurations.live, 20);
    }
    await defaultLive.fill('20');
    await defaultLive.press('Tab');
    const postseason = await contexts[1].newPage();
    // The hourly cadence applies when automatic tournament discovery is off.
    await chrome.getByRole('button', { name: 'Settings', exact: true }).click();
    await chrome.locator('.chess-auto-follow').uncheck();
    await chrome.waitForFunction(() => window.SportsOverlay.config.loadConfig().sports.find(group => group.sport === 'chess').autoFollow === false);
    for (const selector of ['.chess-second-tier', '.pdga-second-tier']) {
      await chrome.locator(selector).uncheck();
      await chrome.getByText('Saved automatically. Banner updated.', { exact: true }).waitFor();
    }
    const hourlyAdmin = await contexts[0].newPage();
    await hourlyAdmin.clock.install();
    await hourlyAdmin.goto('http://127.0.0.1:8000/sports/admin/');
    await hourlyAdmin.evaluate(() => {
      window.discoveryCalls = 0;
      window.SportsOverlay.providerDiscovery.discover = async () => {
        window.discoveryCalls += 1;
        return { favoriteGames: [], leagueGames: [], failures: 0 };
      };
    });
    await hourlyAdmin.getByRole('button', { name: 'Live control', exact: true }).click();
    await hourlyAdmin.getByText('Games refreshed', { exact: true }).waitFor();
    const firstDiscoveryCalls = await hourlyAdmin.evaluate(() => window.discoveryCalls);
    assert.ok(firstDiscoveryCalls > 0);
    await hourlyAdmin.clock.fastForward(59 * 60 * 1000);
    assert.equal(await hourlyAdmin.evaluate(() => window.discoveryCalls), firstDiscoveryCalls);
    await hourlyAdmin.clock.fastForward(60 * 1000);
    await hourlyAdmin.waitForFunction(count => window.discoveryCalls > count, firstDiscoveryCalls);
    await hourlyAdmin.close();
    await postseason.clock.install();
    await postseason.goto('http://127.0.0.1:8000/sports/?sport=baseball&demo=live');
    await postseason.locator('#sports-overlay[data-state="live"]').waitFor();
    await postseason.evaluate(() => {
      const api = window.SportsOverlay;
      const event = api.registry.getDemo('baseball', 'live');
      window.postseasonEvent = api.mlb.withSchedule(event, {
        gamePk: event.id, gameType: 'F', seriesGameNumber: 2, gamesInSeries: 3,
        seriesDescription: 'AL Wild Card Series', status: { abstractGameState: 'Live' },
        seriesStatus: { wins: 1, losses: 0, result: 'SEA leads 1-0' },
      });
      window.postseasonLayout = api.baseballLayout.createLayout();
      window.postseasonEvent.details.lastPlay = 'A long last play description that must keep scrolling while the postseason information rotates below it.';
      window.postseasonLayout.render(window.postseasonEvent);
    });
    assert.match(await postseason.locator('#series-text').innerText(), /AL WILD CARD · GAME 2 · BEST OF 3/);
    const box = await postseason.locator('#sports-overlay').boundingBox();
    assert.ok(box.width <= 460 && box.height <= 88, JSON.stringify(box));
    await postseason.screenshot({ path: '/tmp/sports-postseason-footer.png' });
    // Desktop and OBS consume HTML snapshots from the engine. An unrelated
    // footer or score change must preserve the actual CSS animation instance.
    const output = await contexts[1].newPage();
    let outputFrame = { instance: 'scroll-test', sequence: 0, ready: true, gameKey: 'baseball:1', html: '' };
    await output.route('**/api/output', route => route.fulfill({ json: outputFrame }));
    async function publishOutput() {
      outputFrame = { ...outputFrame, sequence: outputFrame.sequence + 1,
        html: await postseason.locator('#sports-overlay').evaluate(node => node.outerHTML) };
      await output.waitForFunction(sequence => document.body.dataset.sequence === String(sequence), outputFrame.sequence);
    }
    outputFrame.html = await postseason.locator('#sports-overlay').evaluate(node => node.outerHTML);
    await output.goto('http://127.0.0.1:8000/sports/display.html');
    await output.waitForFunction(() => document.querySelector('#last-play-text')?.getAnimations().length === 1);
    await output.evaluate(() => {
      window.transitions = [];
      document.addEventListener('animationstart', event => {
        if (event.animationName.startsWith('sports-rotate-')) window.transitions.push(event.animationName);
      });
      window.originalPlay = document.querySelector('#last-play-text');
      window.originalScroll = window.originalPlay.getAnimations()[0];
      window.originalScroll.pause();
      window.originalScroll.currentTime = 5000;
    });
    async function assertScrollContinues() {
      assert.equal(await output.evaluate(() => {
        const text = document.querySelector('#last-play-text');
        return text === window.originalPlay && text.getAnimations()[0] === window.originalScroll
          && window.originalScroll.currentTime === 5000;
      }), true, 'unchanged last play retains its scroll position and animation');
    }
    await postseason.clock.runFor(8000);
    assert.equal(await postseason.locator('#series-text').innerText(), 'SEA LEADS 1-0');
    await publishOutput();
    assert.equal(await output.locator('#series-text').innerText(), 'SEA LEADS 1-0');
    await assertScrollContinues();
    await postseason.evaluate(() => window.postseasonLayout.render(window.postseasonEvent));
    await postseason.clock.runFor(8000);
    assert.equal(await postseason.locator('#player-details').isVisible(), true);
    assert.equal(await postseason.locator('#series-details').isVisible(), false);
    await publishOutput();
    assert.equal(await output.locator('#player-details').isVisible(), true);
    assert.equal(await output.locator('#series-details').isVisible(), false);
    await assertScrollContinues();
    await postseason.evaluate(() => {
      window.postseasonEvent.teams.away.score = 7;
      window.postseasonLayout.render(window.postseasonEvent);
    });
    await publishOutput();
    assert.equal(await output.locator('#away-score').innerText(), '7');
    await assertScrollContinues();
    await postseason.evaluate(() => {
      window.postseasonEvent.details.lastPlay = 'A different long play description should start a new scroll so the next play can be read from the beginning.';
      window.postseasonLayout.render(window.postseasonEvent);
    });
    await postseason.clock.runFor(32);
    await publishOutput();
    assert.equal(await output.locator('#last-play-text').evaluate(node =>
      node !== window.originalPlay && node.getAnimations().length === 1
      && node.getAnimations()[0] !== window.originalScroll), true);
    assert.deepEqual(await output.evaluate(() => window.transitions), [], 'footer, score, and play updates do not transition the game');
    outputFrame.gameKey = 'baseball:2';
    await publishOutput();
    assert.deepEqual(await output.evaluate(() => window.transitions), ['sports-rotate-out', 'sports-rotate-in']);
    assert.equal(await output.locator('#sports-overlay').evaluate(node =>
      node.classList.contains('is-rotating-in') || node.classList.contains('is-rotating-out')), false);
    await output.emulateMedia({ reducedMotion: 'reduce' });
    outputFrame.gameKey = 'baseball:3';
    await publishOutput();
    assert.deepEqual(await output.evaluate(() => window.transitions), ['sports-rotate-out', 'sports-rotate-in'], 'reduced motion skips transitions');
    await output.emulateMedia({ reducedMotion: 'no-preference' });
    outputFrame.instance = 'restarted-engine';
    outputFrame.gameKey = 'baseball:4';
    await publishOutput();
    assert.deepEqual(await output.evaluate(() => window.transitions), ['sports-rotate-out', 'sports-rotate-in'], 'engine reconnection does not animate stale content');
    await postseason.evaluate(() => window.postseasonLayout.renderNoEvent());
    outputFrame.gameKey = null;
    await publishOutput();
    assert.equal(await output.locator('#game-view').isVisible(), false);
    assert.equal(await output.locator('#no-game').isVisible(), true);
    await output.close();
    await postseason.close();
    assert.deepEqual(errors, []);
    console.log('Browser integration passed: isolated profiles, no reload, automatic saves and cross-window updates.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
