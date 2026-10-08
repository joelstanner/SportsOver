'use strict';
const { chromium } = require('../../scripts/test-browser.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHandler } = require('../../desktop/protocol.cjs');
const { startServer } = require('../../desktop/server.cjs');
const { EngineState } = require('../../desktop/engine-state.cjs');
const root = path.resolve(__dirname, '../..');
const asset = 'sports/basketball/gary-payton-circle.png';

(async () => {
  const handler = createHandler({ root });
  const response = await handler(new Request(`sportsover://app/sports/${asset}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await fs.readFile(path.join(root, asset)));
  const engine = new EngineState();
  const output = await startServer({ root, engine, token: 'test', port: 0 });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      if (url.hostname !== 'overlay.test') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"/>' });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { initialized: false } });
      const relative = url.pathname.slice(1) || 'index.html';
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
      try { return await route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: types[path.extname(relative)] }); }
      catch (_) { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    await page.goto('http://overlay.test/?sport=basketball&demo=pregame');
    await page.waitForFunction(() => document.querySelector('#sports-overlay').dataset.state === 'pregame');
    await page.evaluate(() => {
      const api = window.SportsOverlay;
      window.logoLayout = api.registry.getLayout('basketball').createLayout();
    });
    for (const side of ['away', 'home']) {
      for (const state of ['pregame', 'live', 'interrupted', 'final']) {
        await page.evaluate(({ side, state }) => {
          const event = window.SportsOverlay.registry.getDemo('basketball', state);
          event.teams[side] = { id: '25', name: 'Oklahoma City Thunder', abbreviation: 'OKC', logoUrl: 'https://fixture.test/okc.png', score: 80 };
          window.logoLayout.render(event);
          window.logoEvent = event;
        }, { side, state });
        const logo = page.locator(`#basketball-${side}-mark img`);
        await page.waitForFunction(side => {
          const img = document.querySelector(`#basketball-${side}-mark img`);
          return img.complete && img.naturalWidth > 0;
        }, side);
        assert.equal(await logo.getAttribute('src'), asset);
        assert.equal(await logo.getAttribute('alt'), 'Gary Payton');
        assert.equal(await logo.isVisible(), true);
        assert.equal(await page.evaluate(side => window.logoEvent.teams[side].logoUrl, side), 'https://fixture.test/okc.png');
      }
    }
    for (const team of [
      { id: 'unknown', abbreviation: 'OKA', name: 'Oklahoma City' },
      { id: '25', abbreviation: 'unknown', name: 'unknown' },
      { id: 'unknown', abbreviation: 'unknown', name: 'Oklahoma City Thunder' },
    ]) {
      await page.evaluate(team => {
        window.logoEvent.teams.home = team;
        window.logoLayout.render(window.logoEvent);
      }, team);
      assert.equal(await page.locator('#basketball-home-mark img').getAttribute('src'), asset);
    }
    const frame = await page.locator('#sports-overlay').evaluate(el => el.outerHTML);
    engine.publish({ html: frame, metadata: { renderedGameKey: 'basketball:logo-test' } });
    const obs = await context.newPage();
    const errors = [];
    obs.on('pageerror', error => errors.push(error.message));
    // The offline route wrapper follows redirects through fetch, so navigate
    // to the redirect destination to retain the browser's correct asset base.
    await obs.goto(new URL('/sports/display.html?obs-layout=normal', output.url).href);
    await obs.waitForFunction(() => {
      const img = document.querySelector('#basketball-home-mark img');
      return img?.complete && img.naturalWidth > 0;
    });
    assert.equal(await obs.locator('#basketball-home-mark img').getAttribute('src'), asset);
    assert.deepEqual(errors, []);
    // The shared college renderer must preserve a college team's original logo.
    await page.evaluate(() => {
      window.logoEvent.sport = 'college-basketball';
      window.logoEvent.teams.home = { id: '25', abbreviation: 'OKC', name: 'College fixture', logoUrl: 'https://fixture.test/college.png' };
      window.logoLayout.render(window.logoEvent);
    });
    assert.equal(await page.locator('#basketball-home-mark img').getAttribute('src'), 'https://fixture.test/college.png');
    await page.evaluate(() => {
      const event = window.SportsOverlay.registry.getDemo('basketball', 'pregame');
      window.logoLayout.render(event);
    });
    assert.match(await page.locator('#basketball-home-mark img').getAttribute('src'), /det\.png$/);
    console.log('NBA Gary Payton logo passed: both sides, all states, identity aliases, college isolation, desktop protocol and OBS image loading.');
  } finally {
    await browser?.close();
    engine.stop();
    await new Promise(resolve => output.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
