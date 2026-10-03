'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const fixture = require('../sports/college-football/timeouts-summary.json');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test' || url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      try {
        await route.fulfill({ body: await fs.readFile(path.join(root, file)),
          contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)] });
      } catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://overlay.test/?sport=college-football&demo=live');
    await page.locator('.football-scorebug[data-state="live"]').waitFor();
    await page.evaluate(() => {
      window.timeoutLayout = window.SportsOverlay.registry.getLayout('college-football').createLayout();
    });
    async function render(payload) {
      await page.evaluate(payload => window.timeoutLayout.render(window.SportsOverlay.espnNcaaf.normalizeEvent(payload)), payload);
    }
    async function markers(expected, maximum) {
      for (const [index, side] of ['away', 'home'].entries()) {
        const group = page.locator(`#football-${side}-timeouts`);
        assert.equal(await group.isVisible(), expected[index] !== null, `${side} visibility`);
        assert.equal(await group.locator('.timeout-marker').count(), expected[index] === null ? 0 : maximum, `${side} total markers`);
        assert.equal(await group.locator('.is-remaining').count(), expected[index] ?? 0, `${side} remaining markers`);
        if (expected[index] !== null) assert.match(await group.getAttribute('aria-label'), new RegExp(`: ${expected[index]} timeouts? remaining$`));
        else assert.equal(await group.getAttribute('aria-label'), null);
      }
    }
    await render(fixture);
    await markers([2, 3], 3);
    const payload = structuredClone(fixture);
    const competition = payload.header.competitions[0];
    competition.status.period = 2;
    competition.status.type.description = 'Halftime';
    await render(payload);
    await markers([3, 3], 3);
    competition.status.type.description = 'In Progress';
    for (const period of [5, 6, 7, 8]) {
      competition.status.period = period;
      payload.drives.current = { plays: [{ id: `play-${period}`, period: { number: period }, type: { id: '5' } }] };
      if (period === 7) payload.drives.previous.push({ plays: [{ id: 'ot-timeout', period: { number: 7 },
        type: { id: '21' }, teamParticipants: [{ id: '2335', timeout: true }] }] });
      await render(payload);
      await markers(period >= 7 ? [0, 1] : [1, 1], 1);
    }
    delete payload.drives;
    await render(payload);
    await markers([null, null], 1);
    for (const [state, description] of [['pre', 'Scheduled'], ['post', 'Final']]) {
      const hidden = structuredClone(fixture);
      hidden.header.competitions[0].status.type = { state, description, completed: state === 'post' };
      await render(hidden);
      await markers([null, null], 3);
    }
    // The shared football layout must restore the NFL's three markers after OT.
    await page.evaluate(() => window.timeoutLayout.render(window.SportsOverlay.registry.getDemo('football', 'live')));
    await markers([2, 1], 3);
    assert.deepEqual(errors, []);
    console.log('College football timeout banner passed: actual summary, halftime, overtime, unknown data, pregame/final, and NFL transition.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
