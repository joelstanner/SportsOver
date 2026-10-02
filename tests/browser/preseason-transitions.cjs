const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
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
        await route.fulfill({ body: await fs.readFile(path.join(root, file)), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] });
      } catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://overlay.test/?sport=basketball&demo=live');
    await page.locator('.basketball-scorebug[data-state="live"]').waitFor();
    for (const sport of ['chess', 'disc-golf']) {
      for (const state of ['pregame', 'live', 'interrupted', 'final', 'empty']) {
        await page.evaluate(() => {
          const api = window.SportsOverlay;
          const nba = api.registry.getDemo('basketball', 'live');
          nba.details.preseason = true;
          api.registry.getLayout('basketball').createLayout().render(nba);
        });
        assert.equal(await page.locator('#sports-overlay').evaluate(el => getComputedStyle(el, '::before').content), '"PRESEASON"');
        await page.evaluate(({ sport, state }) => {
          const api = window.SportsOverlay;
          const layout = api.registry.getLayout(sport).createLayout();
          if (state === 'empty') layout.renderNoEvent();
          else layout.render(api.registry.getDemo(sport, state));
        }, { sport, state });
        assert.equal(await page.locator('#sports-overlay').getAttribute('data-preseason'), null, `NBA preseason → ${sport} ${state} clears the marker`);
        assert.equal(await page.locator('#sports-overlay').evaluate(el => getComputedStyle(el, '::before').content), 'none');
        assert.doesNotMatch(await page.locator('#sports-overlay').getAttribute('aria-label'), /preseason/i);
      }
    }
    assert.deepEqual(errors, []);
    console.log('Preseason transitions passed: NBA preseason → chess and PDGA in all states, including empty banners.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
