'use strict';
const { chromium } = require('../../scripts/test-browser.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { fixture } = require('../sports/formula-1/fixtures.js');
require('../../core/config.js');
const config = global.SportsOverlay.config.normalizeConfig();
config.sports.forEach(group => { group.enabled = group.sport === 'formula-1'; });
const data = fixture(), root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1120, height: 900 } }), errors = [], requests = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'a.espncdn.com') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><path fill="#1c418a" d="M0 0h30v20H0z"/><path stroke="white" stroke-width="6" d="M0 10h30M15 0v20"/><path stroke="#db3447" stroke-width="3" d="M0 10h30M15 0v20"/></svg>' });
      if (url.hostname === 'site.api.espn.com' && url.pathname.includes('/racing/f1/scoreboard')) { requests.push(url.href); return route.fulfill({ json: data.scoreboard }); }
      if (url.pathname.startsWith('/api/formula-1/results/')) { requests.push(url.href); return route.fulfill({ json: data.content }); }
      if (url.hostname !== 'overlay.test') return route.fulfill({ json: { events: [], dates: [], active: [] } });
      const file = path.join(root, url.pathname === '/admin/' ? 'admin/index.html' : url.pathname);
      try { return route.fulfill({ body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] }); }
      catch (_) { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://overlay.test/admin/');
    await page.evaluate(c => localStorage.setItem('sports-overlay.config.v1', JSON.stringify(c)), config); await page.reload();
    const section = page.locator('.sport-card[data-sport="formula-1"]');
    await section.locator('.f1-load-drivers').click();
    await page.waitForFunction(() => document.querySelector('.f1-driver').options.length === 23);
    await section.locator('.f1-driver').selectOption('1000'); await section.locator('.f1-add-driver').click();
    await section.locator('.f1-add-board').click();
    await section.locator('.f1-size').nth(1).selectOption('all');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('sports-overlay.config.v1')).sports.find(group => group.sport === 'formula-1').events[1]?.leaderboardSize === 'all');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sports-overlay.config.v1')));
    const watches = saved.sports.find(group => group.sport === 'formula-1').events;
    assert.equal(watches[0].playerId, '1000');
    await page.reload();
    assert.equal(await section.locator('.f1-size').nth(1).inputValue(), 'all');
    await page.getByRole('button', { name: 'Live control', exact: true }).click();
    const key = `formula-1:${global.SportsOverlay.config.watchId(watches[0])}`;
    const card = page.locator(`#rotation-queue [data-game-key="${key}"]`);
    await card.waitFor(); assert.equal(await card.locator('.game-name').innerText(), 'Driver · Driver 1');
    assert.equal(await card.locator('.game-logos img').count(), 1);
    await card.locator('.remove-game').click();
    const available = page.locator(`#available-games [data-game-key="${key}"]`);
    await available.waitFor(); assert.equal(await available.locator('.game-name').innerText(), 'Driver · Driver 1');
    // Real engine discovery/rendering follows the same saved selections.
    await page.goto('http://overlay.test/index.html?sport=formula-1');
    await page.locator('.f1-scorebug[data-state="live"]').waitFor();
    assert.ok((await page.locator('.f1-event').innerText()).includes('Coastal'));
    // Static demos exercise both compact views, every leaderboard size and all states.
    await page.goto('http://overlay.test/index.html?sport=formula-1&demo=live');
    await page.locator('.f1-entry').first().waitFor();
    for (const [size, expected] of [[3, 3], [10, 10], ['all', 22]]) {
      await page.evaluate(size => {
        const api = window.SportsOverlay, event = api.registry.getDemo('formula-1', 'live');
        event.details.leaderboardSize = size;
        api.registry.getLayout('formula-1').createLayout().render(event);
      }, size);
      assert.equal(await page.locator('.f1-entry').count(), expected);
      assert.equal(await page.locator('.is-scrolling-vertically').count(), expected > 3 ? 1 : 0);
      assert.equal(await page.locator('#sports-overlay').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    }
    await page.locator('#sports-overlay').screenshot({ path: '/tmp/sportsover-f1-leaderboard.png' });
    await page.goto('http://overlay.test/index.html?sport=formula-1&demo=player');
    await page.locator('.f1-focus').waitFor();
    assert.equal(await page.locator('.f1-focus .f1-name').innerText(), 'Lando Norris');
    assert.equal(await page.locator('.f1-focus .f1-flag').count(), 1);
    await page.locator('#sports-overlay').screenshot({ path: '/tmp/sportsover-f1-driver.png' });
    for (const state of ['pregame', 'interrupted', 'final']) {
      await page.goto(`http://overlay.test/index.html?sport=formula-1&demo=${state}`);
      await page.locator(`.f1-scorebug[data-state="${state}"]`).waitFor();
      if (state === 'interrupted') assert.match(await page.locator('.f1-footer').innerText(), /Next: Qualifying/);
    }
    assert.deepEqual(errors, []);
    console.log('F1 browser checks passed: Settings persistence, both game lists, flags, live engine, all leaderboard sizes, driver view and session states.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
