'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
require('../../core/config.js');

const root = path.resolve(__dirname, '../..');
const config = global.SportsOverlay.config.normalizeConfig();
config.sports.forEach(group => { group.enabled = group.sport === 'football'; });
config.rotationMode = 'curated';
config.includedGames = Array.from({ length: 16 }, (_, index) => `football:${1000 + index}`);
const events = Array.from({ length: 32 }, (_, index) => ({
  id: String(1000 + index), date: new Date().toISOString(),
  status: { type: { state: 'in', completed: false, description: 'In Progress' } },
  competitions: [{ odds: [{ awayTeamOdds: { moneyLine: -110 }, homeTeamOdds: { moneyLine: -110 } }], competitors: [
    { homeAway: 'away', team: { id: '1', displayName: `Away ${index}`, abbreviation: 'AWY' }, score: '7' },
    { homeAway: 'home', team: { id: '2', displayName: `Home ${index}`, abbreviation: 'HME' }, score: '14' },
  ] }],
}));

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addInitScript(config => {
      if (!localStorage.getItem('sports-overlay.config.v1')) localStorage.setItem('sports-overlay.config.v1', JSON.stringify(config));
    }, config);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test') return route.fulfill({ json: { events, dates: [] } });
      const relative = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
      try {
        await route.fulfill({ body: await fs.readFile(path.join(root, relative)),
          contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(relative)] });
      } catch (_) { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://overlay.test/admin/');
    await page.getByRole('button', { name: 'Live control', exact: true }).click();
    await page.getByText('Games refreshed', { exact: true }).waitFor();
    assert.equal(await page.locator('#rotation-queue .game-card').count(), 16);
    assert.equal(await page.locator('#available-games .game-card').count(), 16);
    await page.locator('#rotation-queue').scrollIntoViewIfNeeded();
    const positions = () => page.evaluate(() => ['rotation-queue', 'available-games'].map(id => document.getElementById(id).scrollTop));
    const key = await page.evaluate(() => {
      const queue = document.querySelector('#rotation-queue');
      queue.scrollTop = queue.scrollHeight;
      const available = document.querySelector('#available-games');
      available.scrollTop = available.scrollHeight;
      const bounds = queue.getBoundingClientRect();
      return [...queue.children].find(card => {
        const rect = card.getBoundingClientRect();
        return rect.top > bounds.top + 30 && rect.bottom < bounds.bottom - 30;
      }).dataset.gameKey;
    });
    const before = await positions();
    assert.ok(before.every(position => position > 0), 'both lists are scrolled');
    const card = page.locator(`#rotation-queue [data-game-key="${key}"]`);
    const initial = Number((await card.locator('.game-time').innerText()).replace('s', ''));
    for (const [button, seconds] of [['.game-time-up', initial + 5], ['.game-time-down', initial]]) {
      await card.locator(button).click();
      await page.waitForFunction(({ key, seconds }) => {
        const card = document.querySelector(`#rotation-queue [data-game-key="${key}"]`);
        return card.querySelector('.game-time').textContent === `${seconds}s`;
      }, { key, seconds });
      // Allow layout and scroll anchoring to settle after the save rebuilds the cards.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(await positions(), before, `${button} preserves both list scroll positions`);
      const durations = await page.evaluate(() => window.SportsOverlay.config.loadConfig().gameDurations);
      assert.equal(durations[key] ?? initial, seconds, 'timing change is saved');
    }
    await page.locator('#refresh-games').click();
    await page.getByText('Games refreshed', { exact: true }).waitFor();
    assert.deepEqual(await positions(), before, 'discovery refresh preserves both list scroll positions');
    assert.deepEqual(errors, []);
    console.log('Rotation scroll passed: increment, decrement, saved timing, and discovery refresh.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
