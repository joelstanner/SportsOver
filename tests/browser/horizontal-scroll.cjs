// Engine snapshots must never expose the uninitialized, left-aligned marquee.
const { chromium } = require('../../scripts/test-browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const sports = ['baseball', 'football', 'basketball', 'hockey', 'soccer'];

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 472, height: 100 }, reducedMotion: 'no-preference' });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test') return route.fulfill({ body: '' });
      if (url.pathname === '/api/output') return route.fulfill({ json: { instance: 'scroll-test', sequence: 0, ready: true,
        gameKey: null, html: '<main id="sports-overlay"></main>' } });
      return route.fulfill({ body: await fs.readFile(path.join(root, url.pathname.slice(1))),
        contentType: url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.html') ? 'text/html' : 'text/javascript' });
    });
    const engine = await context.newPage();
    await engine.setContent('<main id="sports-overlay"></main>');
    for (const file of [...sports.map(sport => `sports/${sport}/style.css`), 'core/scrolling.css', 'core/team-names.css']) {
      await engine.addStyleTag({ path: path.join(root, file) });
    }
    for (const file of ['core/event-model.js', 'core/registry.js', 'core/team-theme.js', 'core/team-names.js', 'core/timeouts.js',
      'core/scrolling.js', 'sports/baseball/providers/mlb.js',
      ...sports.flatMap(sport => [`sports/${sport}/layout.js`, `sports/${sport}/demo-data.js`])]) {
      await engine.addScriptTag({ path: path.join(root, file) });
    }
    const frames = await engine.evaluate(sports => {
      const api = window.SportsOverlay, frames = [];
      for (const sport of sports) {
        const layout = api.registry.getLayout(sport).createLayout();
        const event = api.registry.getDemo(sport, 'live');
        const field = sport === 'soccer' ? 'lastEvent' : 'lastPlay';
        const selector = sport === 'baseball' ? '#last-play-text' : `#${sport}-${sport === 'soccer' ? 'last-event' : 'last-play'}-text`;
        for (const [index, value] of ['Long play description entering from the right. '.repeat(5), 'Short play',
          'Another long description after rapidly switching cards. '.repeat(5), ''].entries()) {
          event.details[field] = value;
          layout.render(event);
          // Capture in the same turn as render, as engine-host does after an
          // arrow command. A deferred overflow check is too late for this HTML.
          const text = document.querySelector(selector);
          const style = getComputedStyle(text);
          if (index === 2) {
            const animation = text.getAnimations()[0];
            layout.render(event);
            if (text.getAnimations()[0] !== animation) throw Error(`${sport}: unchanged refresh restarted scrolling`);
          }
          frames.push({ sport, selector, index, value, padding: parseFloat(style.paddingLeft),
            animation: style.animationName, hidden: text.getBoundingClientRect().width === 0,
            html: document.querySelector('#sports-overlay').outerHTML });
        }
        layout.dispose?.();
      }
      return frames;
    }, sports);
    for (const frame of frames) {
      if (frame.index === 0 || frame.index === 2) {
        assert.ok(frame.padding > 100, `${frame.sport}: long text starts offscreen in the first snapshot`);
        assert.notEqual(frame.animation, 'none', `${frame.sport}: scroll is ready synchronously`);
      } else if (frame.value) {
        assert.equal(frame.animation, 'none', `${frame.sport}: short text does not scroll`);
      } else assert.equal(frame.hidden, true, `${frame.sport}: empty text is hidden`);
    }
    const output = await context.newPage();
    await output.addInitScript(() => {
      window.sportsDesktop = { onFrame: listener => { window.deliverFrame = listener; },
        action: async () => ({}), status: async () => ({ fullscreen: false }), onFullscreenChange() {} };
      window.firstPaints = [];
      new MutationObserver(() => {
        const text = document.querySelector('#last-play-text, [id$="-last-play-text"], #soccer-last-event-text');
        if ((!text?.textContent.startsWith('Long') && !text?.textContent.startsWith('Another'))
          || !text.getBoundingClientRect().width || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const style = getComputedStyle(text);
        window.firstPaints.push({ padding: parseFloat(style.paddingLeft), animation: style.animationName });
      }).observe(document, { childList: true, subtree: true, attributes: true });
    });
    await output.goto('http://overlay.test/display.html?desktop');
    await output.waitForFunction(() => document.body.dataset.sequence === '0');
    let sequence = 0;
    for (const frame of frames) {
      await output.evaluate(frame => window.deliverFrame(frame), { instance: 'scroll-test', sequence: ++sequence,
        ready: true, gameKey: `${frame.sport}:${frame.index}`, transition: 'quick', html: frame.html });
      // Switch again before the 100 ms entrance finishes.
      await output.waitForTimeout(20);
    }
    await output.waitForFunction(sequence => document.body.dataset.sequence === String(sequence), sequence);
    const firstPaints = await output.evaluate(() => window.firstPaints);
    assert.ok(firstPaints.length > 0);
    for (const paint of firstPaints) {
      assert.ok(paint.padding > 100, 'desktop/OBS never paints long text flush left');
      assert.notEqual(paint.animation, 'none');
    }
    const baseballFrame = frames.find(frame => frame.sport === 'baseball' && frame.index === 0);
    const refreshFrame = { instance: 'scroll-test', sequence: ++sequence, ready: true,
      gameKey: 'baseball:refresh', transition: 'quick', html: baseballFrame.html };
    await output.evaluate(frame => window.deliverFrame(frame), refreshFrame);
    await output.waitForFunction(sequence => document.body.dataset.sequence === String(sequence), sequence);
    await output.evaluate(() => {
      window.originalText = document.querySelector('#last-play-text');
      window.originalAnimation = window.originalText.getAnimations()[0];
      window.originalAnimation.pause();
      window.originalAnimation.currentTime = 5000;
    });
    await output.evaluate(frame => window.deliverFrame(frame), { ...refreshFrame, sequence: ++sequence,
      html: baseballFrame.html.replace('<main ', '<main data-refresh="1" ') });
    await output.waitForFunction(sequence => document.body.dataset.sequence === String(sequence), sequence);
    assert.equal(await output.evaluate(() => {
      const text = document.querySelector('#last-play-text');
      return text === window.originalText && text.getAnimations()[0] === window.originalAnimation
        && window.originalAnimation.currentTime === 5000;
    }), true, 'an unrelated desktop snapshot update preserves the active scroll');
    await output.emulateMedia({ reducedMotion: 'reduce' });
    const longFrame = frames.find(frame => frame.sport === 'football' && frame.index === 0);
    await output.evaluate(frame => window.deliverFrame(frame), { instance: 'scroll-test', sequence: ++sequence,
      ready: true, gameKey: 'football:reduced', transition: 'quick', html: longFrame.html });
    await output.waitForFunction(sequence => document.body.dataset.sequence === String(sequence), sequence);
    assert.deepEqual(await output.locator(longFrame.selector).evaluate(text => {
      const style = getComputedStyle(text);
      return { animation: style.animationName, padding: parseFloat(style.paddingLeft) };
    }), { animation: 'none', padding: 0 });
    assert.deepEqual(errors, []);
    console.log('Horizontal scrolling passed: immediate snapshots, rapid quick transitions, long/short/empty text across five sports, and reduced motion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
