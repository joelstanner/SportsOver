'use strict';
const { chromium } = require('../../scripts/test-browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
require('../../core/config.js');
const root = path.resolve(__dirname, '../..');
const config = global.SportsOverlay.config.normalizeConfig();
config.sports.forEach(group => { group.enabled = group.sport === 'football'; });
const entry = { kind: 'manual', candidate: {
  id: 'halftime-test', sport: 'football', state: 'interrupted', teamKeys: ['IND', 'WSH'],
  startTime: new Date().toISOString(), detailedState: 'Halftime',
  raw: { competitions: [{ status: { type: { state: 'in', description: 'In Progress' } }, competitors: [
    { homeAway: 'away', team: { id: '11', displayName: 'Indianapolis Colts', abbreviation: 'IND' }, score: '10' },
    { homeAway: 'home', team: { id: '28', displayName: 'Washington Commanders', abbreviation: 'WSH' }, score: '6' },
  ] }] },
} };
config.rotationMode = 'curated';
config.includedGames = ['football:halftime-test'];

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ config, entry }) => {
      localStorage.setItem('sports-overlay.config.v1', JSON.stringify(config));
      window.testEntry = entry;
      window.sportsDesktop = { onFrame() {}, engine: async () => ({ ready: true, discoveryComplete: true,
        automaticEntries: [], availableEntries: [window.testEntry, { ...window.testEntry,
          candidate: { ...window.testEntry.candidate, id: 'available-test' } }], queue: [window.testEntry],
        normalQueue: [window.testEntry], liveMode: { active: false, canActivate: true } }) };
    }, { config, entry });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test' || url.pathname.startsWith('/api/')) return route.fulfill({ json: { initialized: false } });
      const relative = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
      try { await route.fulfill({ body: await fs.readFile(path.join(root, relative)),
        contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(relative)] }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://overlay.test/admin/');
    await page.getByRole('button', { name: 'Live control', exact: true }).click();
    async function check(expected) {
      await page.waitForFunction(expected => document.querySelector('#rotation-queue .game-meta')?.textContent === expected, expected);
      for (const list of ['rotation-queue', 'available-games']) {
        assert.equal(await page.locator(`#${list} .game-meta`).innerText(), expected);
        assert.equal(await page.locator(`#${list} [data-pregame-start]`).count(), 0);
      }
    }
    await check('Halftime · IND 10 – WSH 6');
    // The schedule status is the fallback when no summary description exists.
    await page.evaluate(() => { delete testEntry.candidate.detailedState;
      testEntry.candidate.raw.competitions[0].status.type.description = 'Weather Delay'; });
    await check('Weather Delay · IND 10 – WSH 6');
    await page.evaluate(() => { delete testEntry.candidate.raw.competitions[0].status.type.description; });
    await check('Interrupted · IND 10 – WSH 6');
    await page.evaluate(() => { testEntry.candidate.state = 'live'; });
    await check('Live · IND 10 – WSH 6');
    await page.evaluate(() => { testEntry.candidate.state = 'interrupted'; testEntry.candidate.detailedState = 'Halftime';
      testEntry.candidate.raw.competitions[0].competitors[0].score = ''; });
    await check('Halftime');
    assert.deepEqual(errors, []);
    console.log('Interrupted game status passed: halftime, summary precedence, schedule fallback, scores, missing scores, and resumed play in both lists.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
