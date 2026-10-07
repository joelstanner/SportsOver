'use strict';
// Different cards can share identical rows and CSS while needing fresh animations.
const { chromium } = require('../../scripts/test-browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 472, height: 120 }, reducedMotion: 'no-preference' });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/output') return route.fulfill({ json: { instance: 'vertical-rotation', sequence: 0,
        ready: true, gameKey: null, html: '<main id="sports-overlay"></main>' } });
      if (url.hostname !== 'overlay.test') return route.fulfill({ body: '' });
      return route.fulfill({ body: await fs.readFile(path.join(root, url.pathname.slice(1))),
        contentType: { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(url.pathname)] });
    });
    const engine = await context.newPage();
    await engine.setContent('<main id="sports-overlay" data-rotation-active="true"></main>');
    for (const file of ['sports/chess/style.css', 'sports/disc-golf/style.css', 'core/scrolling.css']) {
      await engine.addStyleTag({ path: path.join(root, file) });
    }
    for (const file of ['core/registry.js', 'core/scrolling.js', 'sports/chess/layout.js', 'sports/disc-golf/layout.js']) {
      await engine.addScriptTag({ path: path.join(root, file) });
    }
    const frames = await engine.evaluate(() => {
      const frames = [];
      for (const sport of ['chess', 'disc-golf']) {
        const layout = SportsOverlay.registry.getLayout(sport).createLayout();
        for (const id of ['first', 'second']) {
          layout.render({ sport, id, state: 'final', detailedState: 'Final',
            competitors: Array.from({ length: 10 }, (_, i) => ({ name: `Player ${i + 1}`, shortName: `Player ${i + 1}`,
              pdgaNumber: 100 + i, place: i + 1, total: i - 10, roundToPar: -1, completed: true })),
            details: { name: `${id} tournament`, view: sport === 'chess' ? 'overview' : 'leaderboard',
              division: 'MPO', round: 1, roundId: 'Round001', roundName: 'Round 1', tournamentId: '12345', leaderboardSize: 10,
              games: [], standings: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Player ${i + 1}`,
                rank: i + 1, score: 10 - i, played: 10 })) } });
          const mount = document.querySelector('#sports-overlay');
          const track = mount.querySelector('.scorebug-vertical-track');
          // Both freshly rendered cards start with zero elapsed time, even
          // when render/measurement takes a fraction of a millisecond.
          track.style.setProperty('--vertical-delay', '0s');
          frames.push({ sport, id, html: mount.outerHTML, track: track.outerHTML });
        }
        layout.dispose();
      }
      return frames;
    });
    const output = await context.newPage();
    await output.addInitScript(() => {
      window.sportsDesktop = { onFrame: listener => { window.deliverFrame = listener; },
        action: async () => ({}), status: async () => ({ fullscreen: false }), onFullscreenChange() {} };
    });
    await output.goto('http://overlay.test/display.html?desktop');
    await output.waitForFunction(() => document.body.dataset.sequence === '0');
    let sequence = 0;
    async function deliver(frame, transition) {
      await output.evaluate(frame => window.deliverFrame(frame), { instance: 'vertical-rotation', sequence: ++sequence,
        ready: true, gameKey: `${frame.sport}:${frame.id}`, transition, html: frame.html });
      await output.waitForFunction(sequence => document.body.dataset.sequence === String(sequence), sequence);
    }
    const position = () => output.locator('.scorebug-vertical-viewport').evaluate(el =>
      el.scrollTop - new DOMMatrixReadOnly(getComputedStyle(el.firstElementChild).transform).m42);
    for (const sport of ['chess', 'disc-golf']) {
      const first = frames.find(frame => frame.sport === sport && frame.id === 'first');
      const second = frames.find(frame => frame.sport === sport && frame.id === 'second');
      assert.equal(first.track, second.track, `${sport}: regression uses identical tracks across different cards`);
      for (const transition of ['normal', 'quick']) for (const elapsed of [11000, 22000]) {
        await deliver(first, 'quick');
        await output.locator('.scorebug-vertical-track').evaluate((el, elapsed) => {
          window.previousTrack = el;
          window.previousAnimation = el.getAnimations()[0];
          window.previousAnimation.currentTime = elapsed;
        }, elapsed);
        const scrolled = await position();
        assert.ok(scrolled > 50, `${sport}: outgoing card is scrolled`);
        await deliver({ ...first, html: first.html.replace('first tournament', 'Updated first tournament') }, 'quick');
        assert.equal(await output.evaluate(() => document.querySelector('.scorebug-vertical-track') === previousTrack), true,
          'same-card score updates keep the track');
        assert.ok(await position() >= scrolled - 1, 'same-card updates keep the scroll progress');
        await output.evaluate(() => {
          window.cardAnimations = [];
          window.transitionController?.abort();
          window.transitionController = new AbortController();
          document.querySelector('#sports-overlay').addEventListener('animationstart', event => {
            if (event.animationName.startsWith('sports-rotate-')) window.cardAnimations.push(event.animationName);
          }, { signal: window.transitionController.signal });
        });
        await deliver(second, transition);
        assert.equal(await position(), 0, `${sport}: ${transition} rotation from ${elapsed}ms starts at the first row`);
        assert.equal(await output.evaluate(() => document.querySelector('.scorebug-vertical-track').getAnimations()[0] === previousAnimation), false,
          'a different card gets a fresh animation');
        assert.ok((await output.evaluate(() => window.cardAnimations)).includes(transition === 'quick' ? 'sports-rotate-quick' : 'sports-rotate-in'),
          'rotation keeps the mount connected so its transition events remain observable');
        await deliver(first, 'quick');
        assert.equal(await position(), 0, `${sport}: returning to an earlier card starts at the first row`);
      }
    }
    assert.deepEqual(errors, []);
    console.log('Vertical rotation passed: chess and PDGA, partial/bottom offsets, automatic and quick transitions, revisits, and same-card refresh preservation.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
