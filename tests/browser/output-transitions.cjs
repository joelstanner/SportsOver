// Pushed desktop frames stay responsive even while polling or animating an older frame.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const frame = (sequence, transition = 'normal') => ({ instance: 'output-test', sequence,
  gameKey: `game:${sequence}`, html: `<main id="sports-overlay">Game ${sequence}</main>`, ready: true, transition });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.SportsOverlay = { countdown: { refresh() {} } };
      window.sportsDesktop = { onFrame: listener => { window.deliverFrame = listener; } };
      window.transitions = [];
      window.completedTransitions = [];
      document.addEventListener('animationstart', event => window.transitions.push({ name: event.animationName }));
      document.addEventListener('animationend', event => window.completedTransitions.push({
        name: event.animationName, duration: event.elapsedTime,
      }));
    });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      // Keep returning an old frame to exercise push/poll ordering.
      if (url.pathname === '/api/output') return route.fulfill({ json: frame(1) });
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body:
        '<link rel="stylesheet" href="/core/rotation.css"><main id="sports-overlay"></main><script src="/core/output.js"></script>' });
      return route.fulfill({ body: await fs.readFile(path.join(root, url.pathname)),
        contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' });
    });
    await page.goto('http://127.0.0.1:8000/');
    await page.waitForFunction(() => document.body.dataset.sequence === '1');
    await page.evaluate(value => window.deliverFrame(value), frame(2, 'quick'));
    await page.waitForFunction(() => document.body.dataset.sequence === '2');
    await page.waitForFunction(() => window.completedTransitions.length === 1);
    assert.deepEqual(await page.evaluate(() => window.completedTransitions), [{ name: 'sports-rotate-quick', duration: 0.1 }]);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#sports-overlay').innerText(), 'Game 2', 'stale polling cannot undo arrow navigation');
    await page.evaluate(value => window.deliverFrame(value), frame(3));
    await page.waitForFunction(() => document.querySelector('#sports-overlay').classList.contains('is-rotating-out'));
    await page.evaluate(value => window.deliverFrame(value), { ...frame(4, 'quick'), gameKey: 'game:2' });
    await page.waitForFunction(() => document.body.dataset.sequence === '4');
    assert.equal(await page.locator('#sports-overlay').innerText(), 'Game 4');
    assert.equal(await page.evaluate(() => window.transitions.filter(item => item.name === 'sports-rotate-quick').length), 2,
      'returning to the original game during an outgoing transition still animates quickly');
    assert.equal(await page.evaluate(() => window.transitions.some(item => item.name === 'sports-rotate-in')), false,
      'quick navigation interrupts the slow transition without waiting for its entrance animation');
    await page.evaluate(value => window.deliverFrame(value), frame(5, 'quick'));
    await page.waitForFunction(() => window.transitions.filter(item => item.name === 'sports-rotate-quick').length === 3);
    await page.evaluate(value => window.deliverFrame(value), frame(6, 'quick'));
    await page.waitForFunction(() => document.body.dataset.sequence === '6');
    assert.equal(await page.evaluate(() => window.transitions.filter(item => item.name === 'sports-rotate-quick').length), 4,
      'consecutive quick transitions restart their animation');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const count = await page.evaluate(() => window.transitions.length);
    await page.evaluate(value => window.deliverFrame(value), frame(7, 'quick'));
    await page.waitForFunction(() => document.body.dataset.sequence === '7');
    assert.equal(await page.evaluate(() => window.transitions.length), count, 'reduced motion skips the quick animation');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { window.transitions = []; });
    await page.evaluate(value => window.deliverFrame(value), frame(8));
    await page.waitForFunction(() => window.transitions.some(item => item.name === 'sports-rotate-out'));
    // A refreshed snapshot of the destination arrives while the old game exits.
    await page.evaluate(value => window.deliverFrame(value), { ...frame(9), gameKey: 'game:8' });
    await page.waitForFunction(() => document.body.dataset.sequence === '9');
    assert.equal(await page.locator('#sports-overlay').innerText(), 'Game 9');
    assert.deepEqual(await page.evaluate(() => window.transitions.map(item => item.name)),
      ['sports-rotate-out', 'sports-rotate-in'], 'a newer snapshot must not restart the outgoing fade and flash the old game');
    await page.evaluate(value => window.deliverFrame(value), frame(10));
    await page.waitForFunction(() => document.querySelector('#sports-overlay').classList.contains('is-rotating-out'));
    await page.evaluate(value => window.deliverFrame(value), { ...frame(11), gameKey: null,
      html: '<main id="sports-overlay"><div class="no-game">No Chess games in rotation</div></main>' });
    await page.waitForFunction(() => document.body.dataset.sequence === '11');
    assert.equal(await page.locator('#sports-overlay').innerText(), 'No Chess games in rotation',
      'desktop output replaces the old game with the empty filtered banner during a transition');
    await page.evaluate(value => window.deliverFrame(value), frame(10));
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#sports-overlay').innerText(), 'No Chess games in rotation',
      'stale desktop and OBS polling frames cannot restore the excluded card');
    await page.evaluate(value => window.deliverFrame(value), frame(12));
    await page.waitForFunction(() => document.body.dataset.sequence === '12');
    assert.equal(await page.locator('#sports-overlay').innerText(), 'Game 12', 'eligible games resume after an empty filter');
    assert.deepEqual(errors, []);
    console.log('Output transitions passed: 100 ms arrows, stale polling, interrupted animation, empty filters, and reduced motion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
