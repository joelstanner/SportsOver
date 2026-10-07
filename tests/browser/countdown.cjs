'use strict';
const { chromium } = require('../../scripts/test-browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const now = new Date('2026-10-03T19:00:00Z');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 350 }, timezoneId: 'UTC' });
    const errors = [];
    let frame;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/output') return route.fulfill({ json: frame });
      if (url.hostname !== 'overlay.test') return route.fulfill({ json: { events: [], dates: [] } });
      const file = url.pathname === '/admin/' ? 'admin/index.html' : url.pathname.slice(1);
      try {
        return route.fulfill({ body: await fs.readFile(path.join(root, file)),
          contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)] });
      } catch (_) { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    await page.goto('http://overlay.test/index.html?sport=football&demo=pregame');
    await page.waitForFunction(() => window.SportsOverlay.engine);
    for (const sport of ['baseball', 'football', 'college-football', 'hockey', 'soccer', 'basketball', 'college-basketball', 'chess']) {
      await page.evaluate(sport => {
        const api = window.SportsOverlay;
        const event = api.registry.getDemo(sport, 'pregame');
        window.countdownLayout?.dispose?.();
        window.countdownLayout = api.registry.getLayout(sport).createLayout();
        window.countdownEvent = { ...event, startTime: new Date(Date.now() + 65_000).toISOString() };
        window.countdownLayout.render(window.countdownEvent);
      }, sport);
      const timer = page.locator('[data-pregame-start]');
      assert.match(await timer.innerText(), /Starts in 1:05/i);
      await page.clock.fastForward(1000);
      assert.match(await timer.innerText(), /Starts in 1:04/i);
      if (sport === 'football') {
        await page.evaluate(() => document.body.style.zoom = '2');
        await page.screenshot({ path: '/tmp/sportsover-countdown.png' });
        await page.evaluate(() => document.body.style.zoom = '1');
        frame = { instance: 'test', sequence: 1, ready: true, gameKey: 'football:pregame',
          html: await page.locator('#sports-overlay').evaluate(node => node.outerHTML) };
      }
      await page.clock.fastForward(64_000);
      assert.match(await timer.innerText(), /Starting soon/i);
      await page.evaluate(() => window.countdownLayout.render({ ...window.countdownEvent, state: 'final' }));
      assert.equal(await timer.count(), 0);
      await page.clock.fastForward(1000);
      assert.equal(await timer.count(), 0);
      await page.evaluate(() => {
        window.countdownLayout.render(window.countdownEvent);
        window.countdownLayout.renderNoEvent('No selected game', false);
      });
      assert.equal(await timer.count(), 0);
    }
    // Desktop/OBS must correct stale frame text and continue ticking locally.
    const output = await context.newPage();
    output.on('pageerror', error => errors.push(error.message));
    const start = /data-pregame-start="([^"]+)"/.exec(frame.html)[1];
    await output.clock.install({ time: new Date(Date.parse(start) - 30_000) });
    await output.clock.pauseAt(new Date(Date.parse(start) - 30_000));
    await output.goto('http://overlay.test/display.html');
    const timer = output.locator('[data-pregame-start]');
    await timer.waitFor();
    assert.match(await timer.innerText(), /Starts in 0:30/i);
    await output.clock.fastForward(1000);
    assert.match(await timer.innerText(), /Starts in 0:29/i);
    // Countdown cards keep metadata, and the final-hour boundary updates without a new feed.
    const admin = await context.newPage();
    admin.on('pageerror', error => errors.push(error.message));
    await admin.clock.install({ time: now });
    await admin.clock.pauseAt(now);
    await admin.goto('http://overlay.test/admin/');
    await admin.waitForFunction(() => window.SportsOverlay.countdown);
    await admin.evaluate(() => {
      const meta = document.createElement('span');
      meta.id = 'countdown-card'; meta.className = 'game-meta';
      const start = new Date(Date.now() + 3_600_000).toISOString();
      meta.textContent = `Upcoming · ${window.SportsOverlay.model.formatPregameStart(start, new Date(), 'America/Los_Angeles')} · Favorite`;
      document.body.append(meta);
      window.SportsOverlay.countdown.replace(meta, start, 'America/Los_Angeles');
    });
    assert.match(await admin.locator('#countdown-card').innerText(), /1:00 PM PDT/);
    await admin.clock.fastForward(1000);
    assert.equal(await admin.locator('#countdown-card').innerText(), 'Upcoming · Starts in 59:59 · Favorite');
    assert.deepEqual(errors, []);
    console.log('Countdown browser checks passed: eight sports, per-second ticks, kickoff, final/no-game cleanup, stale OBS frames, and card metadata.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
