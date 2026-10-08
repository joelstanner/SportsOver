// OBS must distinguish a healthy unchanged score from a replayed or frozen frame.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../../scripts/test-browser.cjs');
const { EngineState } = require('../../desktop/engine-state.cjs');
const root = path.resolve(__dirname, '../..');
const html = '<main id="sports-overlay" class="hockey-scorebug"><div class="hockey-main"><strong class="hockey-score">2</strong><div class="hockey-center">08:42</div><strong class="hockey-score">3</strong></div><div class="hockey-last-play">Latest play</div></main>';
const publish = engine => engine.publish({ html, metadata: { renderedGameKey: 'hockey:1' } });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 647, height: 137 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let engine = new EngineState(), mode = 'startup', replay = null;
    await page.clock.install();
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/output') {
        if (mode === 'down') return route.abort();
        if (mode === 'live') publish(engine);
        return route.fulfill({ json: mode === 'replay' ? replay : engine.output() });
      }
      const file = url.pathname.slice(1);
      return route.fulfill({ body: await fs.readFile(path.join(root, file)), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript' });
    });
    const offline = () => page.locator('.output-offline').waitFor();
    const live = () => page.waitForFunction(() => !document.body.classList.contains('sports-output-offline') && document.querySelector('.hockey-score')?.textContent === '2');
    const poll = () => page.clock.runFor(1000);
    await page.goto('http://overlay.test/display.html');
    await offline();
    mode = 'live'; await poll(); await live();
    const sequence = await page.locator('body').getAttribute('data-sequence');
    // A stopped engine must expire even if its HTTP server keeps responding.
    engine.stop(); mode = 'stopped'; await poll(); await offline();
    assert.equal(await page.locator('.hockey-score').count(), 0);
    assert.equal(await page.locator('.hockey-center').count(), 0);
    assert.equal(await page.locator('.hockey-last-play').count(), 0);
    mode = 'live'; await poll(); await live();
    assert.equal(await page.locator('body').getAttribute('data-sequence'), sequence, 'same content sequence recovers');
    // Normal repeated scores stay live when the heartbeat keeps advancing.
    for (let i = 0; i < 12; i++) { await poll(); await live(); }
    replay = engine.output(); mode = 'replay';
    await page.clock.fastForward(10500); await offline();
    await poll(); await offline();
    assert.equal(await page.locator('.hockey-score').count(), 0, 'cached ready=true cannot restore stale scores');
    assert.match(await page.locator('.output-offline').innerText(), /DATA OFFLINE.*SPORTSOVER DISCONNECTED/s);
    const appearance = await page.locator('#sports-overlay').evaluate(el => ({ filter: getComputedStyle(el).filter, opacity: getComputedStyle(el).opacity, box: el.getBoundingClientRect().toJSON() }));
    assert.match(appearance.filter, /grayscale/); assert.equal(appearance.opacity, '0.78');
    assert(Math.abs(appearance.box.width - 647) < 1 && Math.abs(appearance.box.height - 137) < 1, 'offline footprint retained');
    for (const [width, height] of [[360, 76], [2304, 280], [647, 137]]) {
      await page.setViewportSize({ width, height });
      const box = await page.locator('#sports-overlay').boundingBox();
      assert(Math.abs(box.width - width) < 1 && Math.abs(box.height - height) < 1, `offline footprint ${width}x${height}`);
    }
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'sportsover-offline.png') });
    mode = 'live'; await poll(); await live();
    mode = 'down'; await page.clock.fastForward(10500); await offline();
    mode = 'live'; engine = new EngineState(); await poll(); await live();
    // Delayed responses from a retired session cannot replace the restarted app.
    mode = 'replay'; await poll(); await live();
    assert.equal(await page.locator('.output-offline').count(), 0);
    mode = 'live'; await poll();
    replay = { ...engine.output(), heartbeatAgeMs: 10000 }; mode = 'replay'; await poll(); await offline();
    mode = 'live'; await poll(); await live();
    replay = { ...engine.output() }; delete replay.heartbeatSequence;
    mode = 'replay'; await poll(); await offline();
    assert.deepEqual(errors, []);
    console.log('OBS freshness: startup, stopped engine, unchanged scores, stale replay, disconnect, restart, retired session, expired/missing heartbeat and recovery passed; feeds mocked.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
