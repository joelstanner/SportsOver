const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
require('../../core/config.js');
const { sportFor } = require('../../core/provider-network.js');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const config = global.SportsOverlay.config.normalizeConfig();
    config.sports.forEach(group => { group.enabled = false; });
    config.sports.find(group => group.sport === 'disc-golf').events = [
      { tournamentId: '12345', division: 'MPO', name: 'Saved tournament', enabled: true, view: 'player', playerId: '123' },
    ];
    config.sports.find(group => group.sport === 'chess').events = [
      { tournamentId: 'Tour1234', roundId: '', name: 'Saved broadcast', enabled: true, view: 'player', playerId: 'fide:123' },
    ];
    let state = { initialized: true, config, revision: 0, instance: 'disclosure-test', catalogRevision: 0 };
    const calls = [], errors = [], saves = [];
    let holdMetadata = false, releaseMetadata;
    const metadata = { tour: { id: 'Tour1234', name: 'Saved broadcast' },
      rounds: [{ id: 'Round001', name: 'Round 1', ongoing: true }], defaultRoundId: 'Round001' };
    const round = { tour: metadata.tour, round: metadata.rounds[0], games: [{ id: 'Game0001', status: '*', lastMove: 'e2e4',
      players: [{ name: 'Player One', fideId: 123, rating: 2700 }, { name: 'Player Two', fideId: 456, rating: 2600 }] }] };
    const context = await browser.newContext({ viewport: { width: 1120, height: 850 } });
    const page = await context.newPage();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), sport = sportFor(url.href);
      if (sport) {
        calls.push({ sport, url: url.href });
        if (holdMetadata && url.pathname === '/api/broadcast/Tour1234' && route.request().frame().page() === page) {
          holdMetadata = false;
          await new Promise(resolve => { releaseMetadata = resolve; });
        }
        return route.fulfill({ json: sport === 'chess'
          ? url.pathname.endsWith('/top') ? { active: [] }
          : url.pathname.includes('/-/-/') ? round
          : url.pathname.endsWith('/players') ? [] : metadata
          : { events: [], dates: [] } });
      }
      if (url.hostname !== 'overlay.test') return route.fulfill({ body: '' });
      if (url.pathname.startsWith('/api/sports/state')) {
        if (route.request().method() !== 'GET') {
          const body = route.request().postDataJSON();
          saves.push(body);
          state = { ...state, revision: state.revision + 1, config: { ...state.config, ...body.config } };
        }
        return route.fulfill({ json: state });
      }
      if (url.pathname === '/api/output') return route.fulfill({ json: {} });
      let relative = url.pathname.replace(/^\/sports\/(?=admin\/|core\/|sports\/|index\.html)/, '/').slice(1);
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      try { return route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: types[path.extname(relative)] }); }
      catch (_) { return route.fulfill({ status: 404, body: '' }); }
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://overlay.test/sports/admin/');
    await page.locator('.sport-card').last().waitFor();
    const banner = await context.newPage();
    banner.on('pageerror', error => errors.push(error.message));
    await banner.goto('http://overlay.test/sports/index.html');
    await banner.getByText('No sports enabled', { exact: true }).waitFor();
    assert.deepEqual(calls, [], 'saved disabled player banners and automatic discovery make no upstream calls');
    assert.equal(await page.locator('.pdga-player, .chess-player').count(), 0);
    assert.equal(await page.locator('#refresh-team-catalog').isDisabled(), true);

    const baseball = page.locator('.sport-card[data-sport="baseball"]');
    const disclosure = baseball.locator('.sport-disclosure');
    await disclosure.focus(); await disclosure.press('Enter');
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
    assert.equal(await baseball.locator('.sport-details').isVisible(), false);
    assert.equal(await baseball.locator('.sport-enabled').isVisible(), true);
    assert.equal(saves.length, 0, 'a disclosure change does not alter sport preferences');
    await baseball.locator('.move-sport-down').click();
    await page.locator('#save-status.is-saved').waitFor();
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'false', 'reordering retains collapse state');
    await page.reload();
    await disclosure.waitFor();
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'false', 'reopening retains collapse state');
    await disclosure.focus(); await disclosure.press('Space');
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
    await page.getByRole('button', { name: 'Live control', exact: true }).click();
    await page.locator('#refresh-games').click();
    await page.locator('#refresh-games-status.is-saved').waitFor();
    await banner.evaluate(() => window.SportsOverlay.engine.refresh());
    assert.deepEqual(calls, [], 'manual refresh also skips disabled sports');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();

    // Hold a player-list metadata request, then switch its sport off before
    // it can launch the next round request.
    const chess = page.locator('.sport-card[data-sport="chess"]');
    holdMetadata = true;
    await chess.locator('.sport-enabled').check();
    await page.waitForFunction(() => document.querySelector('.chess-row-status')?.textContent === 'Loading players…');
    while (!releaseMetadata) await new Promise(resolve => setTimeout(resolve, 10));
    await chess.locator('.sport-enabled').uncheck();
    await page.locator('#save-status.is-saved').waitFor();
    await banner.getByText('No sports enabled', { exact: true }).waitFor();
    const atDisable = calls.length;
    releaseMetadata();
    await banner.evaluate(() => window.SportsOverlay.engine.refresh());
    // Flush response continuations and renderer callbacks from the held request.
    await page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame); });
    assert.equal(calls.length, atDisable, 'an old player loader cannot issue a round request after disabling');
    assert.ok(calls.every(call => call.sport === 'chess'), 'other disabled sports stay silent');

    await chess.locator('.sport-enabled').check();
    await page.waitForFunction(() => [...document.querySelectorAll('.chess-player option')].some(option => option.textContent.includes('Player One')));
    assert.equal(await chess.locator('.chess-player').inputValue(), 'fide:123', 'saved followed player is restored');
    await chess.locator('.sport-disclosure').click();
    assert.equal(await chess.locator('.sport-details').isVisible(), false);
    assert.equal(await chess.locator('.sport-enabled').isChecked(), true, 'collapsing leaves the sport enabled');
    await page.screenshot({ path: '/private/tmp/sportsover-sport-disclosure.png', fullPage: true });
    await page.setViewportSize({ width: 620, height: 850 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'narrow Settings has no horizontal overflow');
    assert.deepEqual(errors, []);
    console.log('Settings twirldowns, persistence, disabled API calls, in-flight player loading, and re-enable passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
