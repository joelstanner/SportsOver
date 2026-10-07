const { chromium } = require('../../scripts/test-browser.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
require('../../core/config.js');
const root = path.resolve(__dirname, '../..');
const selection = config => Object.fromEntries(['rotationMode', 'includedGames', 'excludedGames', 'rotationOrder']
  .map(key => [key, config[key]]));

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    let config = globalThis.SportsOverlay.config.normalizeConfig({
      sports: [{ sport: 'baseball', enabled: true, favorites: [] }],
      rotationMode: 'curated', includedGames: ['baseball:1'], rotationOrder: ['baseball:1'],
    });
    let state = { initialized: true, config, revision: 1, instance: 'live-add-test', catalogRevision: 0 };
    let failSave = false;
    const entries = ['1', '2', '3'].map(id => ({ context: { sport: 'baseball' },
      candidate: { sport: 'baseball', id, state: 'live', teamKeys: [], startTime: new Date().toISOString() } }));
    const context = await browser.newContext();
    await context.addInitScript(({ entries, selection }) => {
      window.testEngine = { ready: true, discoveryComplete: true, availableEntries: entries,
        automaticEntries: [], normalQueue: [entries[0]], liveQueue: [entries[0]], queue: [entries[0]],
        liveMode: { active: true, canActivate: true }, rotationSelection: selection };
      window.engineReads = 0;
      window.sportsDesktop = {
        onFrame() {},
        engine: async () => {
          window.engineReads++;
          const snapshot = structuredClone(window.testEngine);
          if (window.holdNextEngine) {
            window.holdNextEngine = false;
            await new Promise(resolve => { window.releaseEngine = resolve; });
          }
          return snapshot;
        },
        action: async () => ({ engine: structuredClone(window.testEngine) }),
        status: async () => ({ version: 'test', visible: true, locked: false, scale: 1 }),
      };
    }, { entries, selection: selection(config) });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.fulfill({ json: { events: [] } });
      if (url.pathname === '/api/output') return route.fulfill({ json: { ready: true, gameKey: 'baseball:1' } });
      if (url.pathname === '/api/sports/state') {
        if (route.request().method() !== 'GET') {
          if (failSave) { failSave = false; return route.fulfill({ status: 503, json: { detail: 'Save failed' } }); }
          const body = route.request().postDataJSON();
          config = { ...config, ...body.config };
          state = { ...state, config, revision: state.revision + 1 };
        }
        return route.fulfill({ json: state });
      }
      const relative = url.pathname.replace(/^\/sports\//, '').replace(/\/$/, '/index.html');
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      try { return route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: types[path.extname(relative)] }); }
      catch (_) { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8000/sports/admin/');
    await page.locator('[data-tab="live"]').click();
    const addedCard = page.locator('#rotation-queue [data-game-key="baseball:2"]');
    await page.locator('#available-games [data-game-key="baseball:2"] .add-game').click();
    await addedCard.waitFor();
    // Observe every DOM update, including transient removals between polls.
    await page.evaluate(() => {
      window.cardDisappearances = 0;
      new MutationObserver(() => {
        if (!document.querySelector('#rotation-queue [data-game-key="baseball:2"]')) window.cardDisappearances++;
      }).observe(document.querySelector('#rotation-queue'), { childList: true, subtree: true });
    });
    const before = await page.evaluate(() => window.engineReads);
    await page.waitForFunction(before => window.engineReads >= before + 3, before);
    assert.equal(await addedCard.count(), 1, 'added live game survives stale engine polls');
    assert.equal(await page.evaluate(() => window.cardDisappearances), 0);
    await page.evaluate(({ selection }) => {
      const engine = window.testEngine;
      engine.rotationSelection = selection;
      engine.liveQueue = engine.queue = engine.normalQueue = engine.availableEntries.slice(0, 2);
    }, { selection: selection(config) });
    const acknowledged = await page.evaluate(() => window.engineReads);
    await page.waitForFunction(before => window.engineReads > before, acknowledged);
    assert.equal(await page.evaluate(() => window.cardDisappearances), 0, 'acknowledgment never removes the added card');
    // An earlier poll may finish after a newer request has acknowledged Add.
    await page.evaluate(({ selection }) => {
      window.freshEngine = structuredClone(window.testEngine);
      window.testEngine.rotationSelection = selection;
      window.testEngine.liveQueue = window.testEngine.queue = [window.testEngine.availableEntries[0]];
      window.holdNextEngine = true;
    }, { selection: selection({ ...config, includedGames: ['baseball:1'], rotationOrder: ['baseball:1'] }) });
    await page.waitForFunction(() => typeof window.releaseEngine === 'function');
    await page.evaluate(() => { window.testEngine = window.freshEngine; });
    const held = await page.evaluate(() => window.engineReads);
    await page.locator('[data-tab="live"]').click();
    await page.waitForFunction(before => window.engineReads > before, held);
    await page.evaluate(() => window.releaseEngine());
    await page.waitForFunction(before => window.engineReads > before + 1, held);
    assert.equal(await page.evaluate(() => window.cardDisappearances), 0, 'late stale responses cannot replace the fresh queue');
    // Once acknowledged, the engine remains authoritative for final expiry.
    await page.evaluate(() => { window.testEngine.liveQueue = window.testEngine.queue = [window.testEngine.availableEntries[0]]; });
    await addedCard.waitFor({ state: 'detached' });
    failSave = true;
    await page.locator('#available-games [data-game-key="baseball:3"] .add-game').click();
    await page.waitForFunction(() => document.querySelector('#rotation-status').textContent === 'Save failed');
    assert.equal(await page.locator('#rotation-queue [data-game-key="baseball:3"]').count(), 0, 'failed saves roll back pending cards');
    assert.deepEqual(errors, []);
    console.log('Live-mode add passed: stale snapshots, continuous card visibility, engine acknowledgment, expiry, and save rollback.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
