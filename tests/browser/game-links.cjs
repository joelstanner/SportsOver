const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const paths = { baseball: null, football: 'nfl', 'college-football': 'college-football', basketball: 'nba', 'college-basketball': 'mens-college-basketball', hockey: 'nhl', soccer: 'soccer' };
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 472, height: 180 } });
    const errors = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="white"/></svg>' });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { initialized: false } });
      const file = url.pathname.slice(1) || 'index.html';
      await route.fulfill({ body: await fs.readFile(path.join(root, file)), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] });
    });
    const engine = await context.newPage();
    const display = await context.newPage();
    for (const page of [engine, display]) page.on('pageerror', error => errors.push(error.message));
    await display.addInitScript(() => {
      window.actions = [];
      window.sportsDesktop = {
        action: async (...args) => { window.actions.push(args); },
        status: async () => ({ fullscreen: false }), onFullscreenChange() {}, onFrame() {},
      };
    });
    await display.goto('http://overlay.test/display.html?desktop');
    await display.waitForFunction(() => document.body.classList.contains('desktop-banner'));
    for (const [sport, path] of Object.entries(paths)) {
      await engine.goto(`http://overlay.test/?sport=${sport}&demo=live`);
      await engine.waitForFunction(() => document.querySelector('#sports-overlay').dataset.state === 'live');
      const href = sport === 'baseball' ? 'https://www.mlb.com/gameday/12345'
        : `https://www.espn.com/${path}/${sport === 'soccer' ? 'match' : 'game'}/_/gameId/12345`;
      await engine.evaluate(({ sport, href }) => {
        const api = window.SportsOverlay;
        window.layout = api.registry.getLayout(sport).createLayout();
        window.event = api.registry.getDemo(sport, 'live');
        event.details.gameUrl = href;
        layout.render(event);
      }, { sport, href });
      for (const state of ['live', 'pregame', 'final', 'interrupted']) {
        await engine.evaluate(state => { event.state = state; layout.render(event); }, state);
        const html = await engine.locator('#sports-overlay').evaluate(el => el.outerHTML);
        await display.locator('#sports-overlay').evaluate((el, html) => { el.outerHTML = html; }, html);
        const links = display.locator('a.team-game-link[href]');
        assert.equal(await links.count(), 4, `${sport} ${state}: both names and logos linked`);
        for (let index = 0; index < 4; index++) {
          assert.equal(await links.nth(index).getAttribute('href'), href);
          await display.evaluate(() => { actions.length = 0; });
          await links.nth(index).click();
          assert.deepEqual(await display.evaluate(() => actions.filter(([action]) => ['open-banner-link', 'banner-pointer'].includes(action))), [['open-banner-link', href]], `${sport} ${state}: link click does not browse or drag`);
        }
        await display.evaluate(() => { actions.length = 0; });
        await links.first().focus();
        await display.keyboard.press('Enter');
        assert.deepEqual(await display.evaluate(() => actions.filter(([action]) => action === 'open-banner-link')), [['open-banner-link', href]], `${sport}: keyboard activation`);
        assert.equal(await display.locator('#sports-overlay').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      }
      const score = display.locator('[id$="-score"]').first();
      await display.evaluate(() => { actions.length = 0; });
      await score.click();
      assert.deepEqual(await display.evaluate(() => actions.filter(([action]) => action === 'banner-pointer').map(([, value]) => value.phase)), ['start', 'end'], `${sport}: score still browses`);
      const box = await score.boundingBox();
      await display.evaluate(() => { actions.length = 0; });
      await display.mouse.move(box.x + 2, box.y + 2);
      await display.mouse.down();
      await display.mouse.move(box.x + 32, box.y + 10);
      await display.mouse.up();
      assert.deepEqual(await display.evaluate(() => actions.filter(([action]) => action === 'banner-pointer').map(([, value]) => value.phase)), ['start', 'move', 'end'], `${sport}: dragging works outside links`);
      await engine.evaluate(() => { event.details.gameUrl = event.details.gameUrl.replace('12345', '67890'); layout.render(event); });
      assert.equal(await engine.locator('a.team-game-link').first().getAttribute('href'), href.replace('12345', '67890'));
      for (const value of ['', 'javascript:alert(1)']) {
        await engine.evaluate(value => { event.details.gameUrl = value; layout.render(event); }, value);
        assert.equal(await engine.locator('#sports-overlay a[href]').count(), 0, `${sport}: missing/unsafe URL removes old links`);
      }
      await engine.evaluate(href => { event.details.gameUrl = href; layout.render(event); layout.renderNoEvent(); }, href);
      assert.equal(await engine.locator('#sports-overlay a[href]').count(), 0, `${sport}: empty state removes old links`);
      console.log(`${sport}: links, keyboard, output snapshots, browse/drag, and stale-link cleanup passed`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
