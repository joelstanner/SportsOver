'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
require('../../core/config.js');
const root = path.resolve(__dirname, '../..');
const config = global.SportsOverlay.config.normalizeConfig();
config.sports.forEach(group => { group.enabled = group.sport === 'chess'; if ('autoFollow' in group) group.autoFollow = false; if ('discoverSecondTier' in group) group.discoverSecondTier = false; });
config.sports.find(group => group.sport === 'chess').events = ['Tour1234', 'Tour2345'].map(tournamentId => ({ tournamentId, enabled: true, view: 'overview', roundId: '', playerId: '' }));
const entries = ['Tour1234', 'Tour2345'].map((id, index) => ({ kind: 'watched-event', candidate: {
  id: `${id}:auto`, sport: 'chess', competitionType: 'individual', state: 'pregame', startTime: new Date(Date.now() + 3600000).toISOString(),
  raw: { name: `Tournament ${index + 1}`, roundName: 'Round 2', bannerLabel: 'Top 10 players' },
}}));
const empty = { ready: true, discoveryComplete: false, discoveryPending: true, availableEntries: [], automaticEntries: [], queue: [], liveMode: { active: false, canActivate: false } };
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    let engineState = structuredClone(empty);
    const context = await browser.newContext(), errors = [];
    await context.exposeFunction('readTestEngine', () => engineState);
    await context.addInitScript(config => {
      localStorage.setItem('sports-overlay.config.v1', JSON.stringify(config));
      window.sportsDesktop = { engine: () => window.readTestEngine(), status: async () => ({ scale: 1 }), action: async () => ({ engine: await window.readTestEngine() }) };
    }, config);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/output') return route.fulfill({ json: { ready: false } });
      if (url.hostname !== 'overlay.test') return route.fulfill({ json: { events: [], active: [] } });
      const relative = url.pathname === '/admin/' ? 'admin/index.html' : url.pathname.slice(1);
      try { return route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(relative)] }); }
      catch { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://overlay.test/admin/');
    await page.getByRole('button', { name: 'Live control', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#rotation-status').textContent.includes('Waiting for score feeds'));
    assert.match(await page.locator('#rotation-queue').innerText(), /Loading games/);
    assert.equal(await page.locator('#rotation-count').innerText(), 'Loading…');
    assert.match(await page.locator('#available-games').innerText(), /Loading games/);
    assert.equal(await page.locator('#available-games').getAttribute('aria-busy'), 'true');
    const healthy = { ...empty, discoveryComplete: true, discoveryPending: false, availableEntries: entries, automaticEntries: [entries[0]], queue: [entries[0]] };
    engineState = healthy;
    await page.locator('#rotation-queue .game-card').waitFor();
    await page.locator('#available-games .game-card').waitFor();
    engineState = { ...healthy, discoveryPending: true };
    await page.waitForFunction(() => document.querySelector('#rotation-status').textContent.includes('Loading game updates'));
    assert.match(await page.locator('#rotation-count').innerText(), /1 game · loading/);
    assert.equal(await page.locator('#rotation-queue .game-card').count(), 1);
    // An engine restart publishes empty lists before discovery finishes.
    engineState = { ...empty, ready: false };
    await page.waitForFunction(() => document.querySelector('#live-mode').disabled && document.querySelector('#rotation-status').textContent.includes('Showing last received games'));
    assert.equal(await page.locator('#rotation-queue .game-card').count(), 1);
    assert.equal(await page.locator('#available-games .game-card').count(), 1);
    engineState = { ...empty, discoveryComplete: true, discoveryPending: false };
    await page.waitForFunction(() => document.querySelector('#rotation-status').textContent === 'Shared engine games');
    assert.equal(await page.locator('#rotation-queue .game-card').count(), 0);
    assert.equal(await page.locator('#available-games').getAttribute('aria-busy'), 'false');
    assert.deepEqual(errors, []);
    console.log('Discovery recovery passed: loading indicators, refreshes retaining games, engine restart retention, and confirmed empty results.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
