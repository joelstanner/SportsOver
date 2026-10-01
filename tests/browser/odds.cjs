// Offline checks for banner layout, live markets, expiry, and sport rotation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test') return route.fulfill({ json: {} });
      const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      try { await route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: types[path.extname(relative)] }); }
      catch (_) { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.goto('http://overlay.test/?sport=football&demo=pregame');
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    for (const sport of ['football', 'college-football', 'basketball', 'college-basketball', 'hockey', 'soccer']) {
      await page.evaluate(sport => {
        const api = window.SportsOverlay;
        window.testLayout = api.registry.getLayout(sport).createLayout();
        window.testEvent = structuredClone(api.registry.getDemo(sport, 'pregame'));
        testEvent.startTime = new Date().toISOString();
        testEvent.details.odds = api.model.espnOdds({ odds: [{ pointSpread: { away: { close: { line: '-3.5' } }, home: { close: { line: '+3.5' } } }, moneyline: { away: { close: { odds: '-185' } }, home: { close: { odds: '+154' } }, draw: { close: { odds: sport === 'soccer' ? '+320' : null } } } }] });
        testLayout.render(testEvent);
      }, sport);
      assert.equal(await page.locator('.sports-odds').count(), 1);
      assert.match(await page.locator('.sports-odds').innerText(), /\+154/);
      if (sport === 'soccer') assert.match(await page.locator('.sports-odds').innerText(), /DRAW \+320/);
      if (sport === 'hockey') assert.match(await page.locator('.sports-odds').innerText(), /PUCK LINE/);
      assert.ok(await page.locator('#sports-overlay').evaluate(el => el.scrollWidth <= el.clientWidth));
      await page.screenshot({ path: `/tmp/sportsover-odds-${sport}.png` });
      await page.evaluate(() => { testEvent.state = 'live'; testLayout.render(testEvent); });
      assert.match(await page.locator('.sports-odds').innerText(), /PRE /);
      await page.clock.runFor(300001);
      assert.equal(await page.locator('.sports-odds').count(), 0, `${sport}: automatic expiry without refetch`);
      await page.evaluate(() => {
        testEvent.details.odds.moneyline.live.away = -220;
        testLayout.render(testEvent);
      });
      assert.match(await page.locator('.sports-odds').innerText(), /LIVE ML/);
      assert.doesNotMatch(await page.locator('.sports-odds').innerText(), /PRE /);
      await page.clock.runFor(300001);
      assert.match(await page.locator('.sports-odds').innerText(), /-220/);
      await page.evaluate(() => { testEvent.state = 'final'; testLayout.render(testEvent); });
      assert.equal(await page.locator('.sports-odds').count(), 0);
      await page.evaluate(() => { testEvent.state = 'live'; testLayout.render(testEvent); testLayout.renderNoEvent(); });
      await page.clock.runFor(1001);
      assert.equal(await page.locator('.sports-odds').count(), 0);
    }
    await page.evaluate(() => {
      testLayout.render(testEvent);
      const api = window.SportsOverlay;
      const baseball = api.registry.getLayout('baseball').createLayout();
      baseball.render(api.registry.getDemo('baseball', 'live'));
    });
    await page.clock.runFor(2000);
    assert.equal(await page.locator('.sports-odds').count(), 0, 'no old odds after rotation to baseball');
    assert.deepEqual(errors, []);
    console.log('Odds browser checks passed for all six ESPN sports.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
