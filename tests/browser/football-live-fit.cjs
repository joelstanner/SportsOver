'use strict';
const { chromium } = require('../../scripts/test-browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 472, height: 100 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      try {
        await route.fulfill({ body: await fs.readFile(path.join(root, file)),
          contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)] });
      } catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    await page.goto('http://overlay.test/?sport=football&demo=live');
    await page.locator('.football-scorebug[data-state="live"]').waitFor();
    await page.addStyleTag({ path: path.join(root, 'core/desktop.css') });
    const cases = await page.evaluate(() => {
      document.body.classList.add('desktop-banner');
      const cases = [];
      for (const sport of ['football', 'college-football']) {
        const layout = window.SportsOverlay.registry.getLayout(sport).createLayout();
        for (const lastPlay of [false, true]) for (const detail of [false, true]) {
          const event = window.SportsOverlay.registry.getDemo(sport, 'live');
          event.details.lastPlay = lastPlay ? 'A 15-yard gain on the live play.' : '';
          event.details.down = detail ? 3 : null;
          event.details.distance = detail ? 5 : null;
          event.details.yardLine = detail ? '45' : '';
          layout.render(event);
          const mount = document.querySelector('#sports-overlay');
          const frame = mount.getBoundingClientRect();
          cases.push({ sport, lastPlay, detail, frameHeight: frame.height, frameBottom: frame.bottom,
            viewportHeight: innerHeight, rows: [...mount.children].filter(row => !row.hidden)
              .map(row => ({ name: row.className, bottom: row.getBoundingClientRect().bottom })) });
        }
      }
      return cases;
    });
    for (const item of cases) {
      const label = `${item.sport}: detail=${item.detail}, lastPlay=${item.lastPlay}`;
      assert.equal(item.frameHeight, 88, `${label}: stable desktop frame`);
      assert.ok(item.frameBottom <= item.viewportHeight - 6, `${label}: frame inside viewport`);
      assert.equal(item.rows.some(row => row.name.startsWith('football-live-detail')), item.detail, `${label}: DOWN and FIELD shown when available`);
      assert.equal(item.rows.some(row => row.name === 'football-last-play'), item.lastPlay, `${label}: last play shown when available`);
      for (const row of item.rows) assert.ok(row.bottom <= item.frameBottom - 1, `${label}: ${row.name} clipped at ${row.bottom} > ${item.frameBottom - 1}`);
    }
    console.log('Live NFL and college football rows fit the desktop banner in all detail combinations.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
