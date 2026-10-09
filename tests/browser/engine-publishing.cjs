// Exercise publishing in a real DOM, with controlled time and no provider calls.
const { chromium } = require('../../scripts/test-browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const source = await fs.readFile(path.resolve(__dirname, '../../core/engine-host.js'), 'utf8');
    async function setup(script) {
      const page = await browser.newPage();
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html',
        body: '<main id="sports-overlay"><span>Unchanged game</span></main>' }));
      await page.goto('http://127.0.0.1:8000/?engine=1');
      await page.clock.install();
      await page.evaluate(() => {
        window.counts = { clones: 0, descriptions: 0, publishes: 0 };
        const clone = Node.prototype.cloneNode;
        Node.prototype.cloneNode = function (...args) { counts.clones++; return clone.apply(this, args); };
        window.metadata = { availableEntries: [], renderedGameKey: 'test:1' };
        window.frames = [];
        window.sportsDesktop = {
          publish(frame) { counts.publishes++; frames.push(frame); },
          onEngineCommand(listener) { window.command = listener; },
        };
        window.SportsOverlay = { engine: {
          setHovered() {},
          describe() { counts.descriptions++; return metadata; },
          next() { document.querySelector('span').textContent = 'Next game'; metadata.renderedGameKey = 'test:2'; },
          refresh() { metadata.discoveryComplete = true; },
          setCompact() { return new Promise(resolve => { window.finishCompact = () => {
            document.querySelector('span').textContent = 'Compact game'; resolve();
          }; }); },
        } };
      });
      await page.addScriptTag({ content: script });
      await page.clock.runFor(1000);
      await page.evaluate(() => { counts = { clones: 0, descriptions: 0, publishes: 0 }; });
      await page.clock.runFor(10000);
      return page;
    }
    if (process.env.ENGINE_HOST_BASELINE) {
      const before = await setup(await fs.readFile(process.env.ENGINE_HOST_BASELINE, 'utf8'));
      console.log('Baseline idle 10 seconds:', await before.evaluate(() => counts));
      await before.close();
    }
    const page = await setup(source);
    const counts = await page.evaluate(() => window.counts);
    console.log('Current idle 10 seconds:', counts);
    assert.equal(counts.clones, 0, 'unchanged DOM must reuse its HTML');
    assert.equal(counts.descriptions, 10, 'metadata checks run once a second');
    assert.equal(counts.publishes, 10, 'OBS heartbeats continue while idle');

    await page.evaluate(() => {
      document.querySelector('span').textContent = 'Updated game';
      document.querySelector('span').setAttribute('title', 'Updated details');
    });
    await page.clock.runFor(50);
    assert.match(await page.evaluate(() => frames.at(-1).html), /title="Updated details">Updated game/);
    assert.equal(await page.evaluate(() => counts.clones), 1, 'batch DOM mutations into one snapshot');

    await page.evaluate(() => { metadata.loadingSports = ['baseball']; });
    await page.clock.runFor(1000);
    assert.deepEqual(await page.evaluate(() => frames.at(-1).metadata.loadingSports), ['baseball']);
    await page.evaluate(() => command({ type: 'next', fast: true }));
    assert.match(await page.evaluate(() => frames.at(-1).html), /Next game/);
    assert.equal(await page.evaluate(() => frames.at(-1).metadata.renderedGameKey), 'test:2');
    await page.evaluate(() => command({ type: 'refresh', requestId: 'manual' }));
    assert.deepEqual(await page.evaluate(() => frames.at(-1).metadata.refreshResult), { requestId: 'manual', error: null });

    const countBeforeCompact = await page.evaluate(() => frames.length);
    await page.evaluate(() => { window.compacting = command({ type: 'compact-rotation', value: true }); });
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(() => frames.length), countBeforeCompact, 'do not publish partially updated compact layouts');
    await page.evaluate(async () => { finishCompact(); await compacting; });
    assert.match(await page.evaluate(() => frames.at(-1).html), /Compact game/);

    await page.evaluate(() => {
      const replacement = document.createElement('main'); replacement.id = 'sports-overlay';
      replacement.textContent = 'Replacement mount';
      document.querySelector('#sports-overlay').replaceWith(replacement);
    });
    await page.clock.runFor(1000);
    assert.match(await page.evaluate(() => frames.at(-1).html), /Replacement mount/);
    console.log('Engine publishing passed: idle reuse, heartbeat, DOM changes, metadata, commands, compact layouts, replacement mount.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
