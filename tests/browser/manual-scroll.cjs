'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startServer } = require('../../desktop/server.cjs');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  let server;
  try {
    const context = await browser.newContext({ viewport: { width: 944, height: 400 }, hasTouch: true });
    const page = await context.newPage(), errors = [];
    context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://overlay.test/', route => route.fulfill({ contentType: 'text/html', body: '<main id="sports-overlay"></main>' }));
    await page.goto('http://overlay.test/');
    for (const file of ['sports/baseball/style.css', 'sports/chess/style.css', 'sports/disc-golf/style.css', 'core/scrolling.css']) await page.addStyleTag({ path: path.join(root, file) });
    for (const file of ['core/registry.js', 'core/scrolling.js', 'sports/chess/layout.js', 'sports/disc-golf/layout.js']) await page.addScriptTag({ path: path.join(root, file) });
    await page.evaluate(() => {
      window.setup = kind => {
        window.layout?.dispose();
        const chess = kind !== 'pdga';
        window.eventData = { sport: chess ? 'chess' : 'disc-golf', id: kind, state: kind === 'matchups' ? 'live' : 'final', competitors: Array.from({ length: 10 }, (_, i) => ({ name: `Player ${i + 1}`, pdgaNumber: 100 + i, place: i + 1, total: i - 10, roundToPar: -1, completed: true })),
          details: { name: 'Test tournament', view: chess ? 'overview' : 'leaderboard', division: 'MPO', round: 1, roundId: 'Round001', tournamentId: '12345', leaderboardSize: 10, dateRange: 'October 3',
            standings: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Player ${i + 1}`, rank: i + 1, score: 10 - i, played: 10 })),
            games: kind === 'matchups' ? Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, board: i + 1, state: 'live', players: [{ id: `p${i}`, name: `White ${i}`, color: 'white' }, { id: `b${i}`, name: `Black ${i}`, color: 'black' }] })) : [] } };
        window.layout = SportsOverlay.registry.getLayout(eventData.sport).createLayout();
        window.draw = () => layout.render(eventData);
        draw();
      };
    });
    const viewport = page.locator('.scorebug-vertical-viewport');
    const position = p => p.locator('.scorebug-vertical-viewport').evaluate(el => {
      const transform = getComputedStyle(el.firstElementChild).transform;
      return el.scrollTop - (transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42);
    });
    for (const kind of ['pdga', 'standings', 'matchups']) {
      await page.mouse.move(800, 300);
      await page.evaluate(kind => setup(kind), kind);
      await viewport.hover();
      const eased = await viewport.evaluate(el => {
        const animation = el.firstElementChild.getAnimations()[0];
        const at = time => {
          animation.currentTime = time;
          return -new DOMMatrixReadOnly(getComputedStyle(el.firstElementChild).transform).m42;
        };
        return [at(5500), at(11000), at(16500)];
      });
      assert.ok(eased[0] > 0 && eased[0] < 1, 'automatic scroll eases into motion');
      assert.ok(Math.abs(eased[1] - 52.5) < .1, 'automatic scroll reaches the midpoint on time');
      assert.ok(eased[2] > 104 && eased[2] < 105, 'automatic scroll eases to a stop');
      await viewport.evaluate(el => { el.firstElementChild.getAnimations()[0].currentTime = 10000; });
      const before = await position(page);
      assert.ok(before > 20 && before < 70);
      await page.mouse.wheel(0, 15);
      await page.waitForFunction(before => document.querySelector('.scorebug-vertical-viewport').scrollTop > before + 10, before);
      const down = await position(page);
      assert.ok(Math.abs(down - before - 15) < 2, 'first wheel continues from visible rows');
      await page.mouse.wheel(0, -15);
      await page.waitForFunction(down => document.querySelector('.scorebug-vertical-viewport').scrollTop < down - 10, down);
      await viewport.focus();
      await page.keyboard.press('End');
      assert.equal(await position(page), 105);
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(100);
      assert.equal(await position(page), 105, 'bottom boundary');
      await page.keyboard.press('Home');
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(100);
      assert.equal(await position(page), 0, 'top boundary');
      await page.keyboard.press('PageDown');
      assert.equal(await position(page), 45);
      await page.keyboard.press('ArrowDown');
      assert.equal(await position(page), 60);
      await page.evaluate(() => { eventData.details.name = 'Updated tournament'; draw(); });
      assert.equal(await position(page), 60, 'live refresh preserves position');
      assert.equal(await viewport.evaluate(el => el === document.activeElement), true, 'refresh preserves keyboard focus');
      await page.keyboard.press('ArrowUp');
      assert.equal(await position(page), 45, 'refresh does not duplicate handlers');
      await page.mouse.move(800, 300);
      await viewport.evaluate(el => el.blur());
      await page.waitForFunction(() => !document.querySelector('.is-manual-scrolling'));
      const resumed = await position(page);
      assert.ok(resumed >= 44 && resumed < 55, 'resume has no jump');
      await page.waitForTimeout(100);
      assert.ok(await position(page) > resumed, 'automatic motion resumes');
      await viewport.focus();
      await page.keyboard.press('End');
      await page.evaluate(() => { eventData.competitors.length = 5; eventData.details.standings.length = 5; if (eventData.details.games.length) eventData.details.games.length = 5; draw(); });
      assert.equal(await position(page), 30, 'shrinking rows clamps position');
      await page.evaluate(() => { eventData.details.round++; eventData.details.roundId = 'Round002'; draw(); });
      assert.equal(await position(page), 0, 'new round starts at top');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await viewport.hover();
      await page.mouse.wheel(0, 15);
      await page.waitForFunction(() => document.querySelector('.scorebug-vertical-viewport').scrollTop > 0);
      const reduced = await position(page);
      await page.mouse.move(800, 300);
      await viewport.evaluate(el => el.blur());
      await page.waitForTimeout(250);
      assert.equal(await position(page), reduced, 'reduced motion remains manual');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
    // The real output server must serve and initialize controls on serialized HTML.
    await page.evaluate(() => setup('pdga'));
    let frame = { instance: 'test', sequence: 1, gameKey: 'pdga', ready: true, html: await page.locator('#sports-overlay').evaluate(el => el.outerHTML) };
    const running = await startServer({ root, engine: { output: () => frame }, token: 'test', port: 0 });
    server = running.server;
    const mirror = await context.newPage();
    await mirror.addInitScript(() => {
      window.actions = [];
      window.sportsDesktop = { action: async (...args) => { if (args[0] !== 'banner-hover') actions.push(args); },
        status: async () => ({ fullscreen: false }), onFullscreenChange() {}, onFrame() {} };
    });
    await mirror.goto(running.url.replace('/output', '/sports/display.html?desktop=1'));
    await mirror.waitForFunction(() => document.body.dataset.sequence === '1');
    const mirrored = mirror.locator('.scorebug-vertical-viewport');
    await mirrored.hover();
    await mirror.mouse.wheel(0, 60);
    await mirror.waitForFunction(() => document.querySelector('.scorebug-vertical-viewport').scrollTop > 0);
    const chosen = await position(mirror);
    frame = { ...frame, sequence: 2, html: frame.html.replace('Player 1', 'Updated player').replace('--vertical-delay: 0s', '--vertical-delay: -6s') };
    await mirror.waitForFunction(() => document.body.dataset.sequence === '2');
    assert.equal(await position(mirror), chosen, 'mirrored refresh keeps local manual offset');
    assert.deepEqual(await mirror.evaluate(() => actions), [], 'wheel does not move window or navigate games');
    await mirrored.focus();
    await mirror.keyboard.press('End');
    await mirrored.evaluate(el => el.blur());
    await mirror.mouse.move(900, 390);
    await mirror.waitForFunction(() => !document.querySelector('.is-manual-scrolling'));
    // Rapid mirror updates must not continually restart the bottom dwell.
    for (let i = 0; i < 18; i++) {
      frame = { ...frame, sequence: frame.sequence + 1 };
      await mirror.waitForFunction(sequence => Number(document.body.dataset.sequence) === sequence, frame.sequence);
    }
    assert.ok(await position(mirror) < 20, 'automatic scroll wraps after bottom dwell despite refreshes');
    // Rotation holds the last rows even when loading/polling delays the handoff.
    frame = { ...frame, sequence: frame.sequence + 1, gameKey: 'rotating-pdga', transition: 'quick',
      html: frame.html.replace('id="sports-overlay"', 'id="sports-overlay" data-rotation-active="true"')
        .replace(/--vertical-delay: [^;"]+/, '--vertical-delay: -21s') };
    await mirror.waitForFunction(sequence => Number(document.body.dataset.sequence) === sequence, frame.sequence);
    assert.equal(await position(mirror), 105, 'completed rotating scroll holds at bottom');
    await mirrored.focus();
    for (let i = 0; i < 3; i++) {
      frame = { ...frame, sequence: frame.sequence + 1, html: frame.html.replace(/--vertical-delay: [^;"]+/, `--vertical-delay: -${22 + i}s`) };
      await mirror.waitForFunction(sequence => Number(document.body.dataset.sequence) === sequence, frame.sequence);
      assert.equal(await position(mirror), 105, 'refresh preserves completed phase instead of wrapping to top');
    }
    await mirrored.evaluate(el => el.blur());
    frame = { ...frame, sequence: frame.sequence + 1, gameKey: 'next-pdga', transition: 'quick',
      html: frame.html.replace('data-rotation-active="true"', 'data-rotation-active="false"')
        .replace(/--vertical-delay: [^;"]+/, '--vertical-delay: 0s') };
    await mirror.waitForFunction(sequence => Number(document.body.dataset.sequence) === sequence, frame.sequence);
    assert.equal(await position(mirror), 0, 'quick rotation starts the next banner at the top');
    // Touch gestures on the desktop list scroll content without starting a window drag.
    await mirrored.focus();
    await mirror.keyboard.press('Home');
    await mirrored.evaluate(el => el.blur());
    const bounds = await mirrored.boundingBox(), cdp = await context.newCDPSession(mirror);
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height - 5;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 10 }] });
      await mirror.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(await position(mirror) > 0, 'touch swipe scrolls');
    assert.deepEqual(await mirror.evaluate(() => actions), [], 'touch swipe does not drag or browse');
    // A list that fits remains still and leaves keyboard navigation alone.
    await page.evaluate(() => { eventData.competitors.length = 3; draw(); });
    await viewport.hover();
    await page.mouse.wheel(0, 100);
    assert.equal(await position(page), 0);
    assert.equal(await viewport.evaluate(el => el.classList.contains('is-manual-scrolling')), false);
    assert.deepEqual(errors, []);
    console.log('Manual scrolling passed: PDGA, chess standings/matchups, wheel, keyboard, refresh, clamp/reset, eased resume/wrap, rotation bottom hold and quick handoff, reduced motion, desktop mirror at 200%, touch and desktop gesture isolation.');
  } finally {
    await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
