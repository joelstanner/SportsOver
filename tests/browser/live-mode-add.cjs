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
      sports: [{ sport: 'baseball', enabled: true, favorites: [] },
        { sport: 'formula-1', enabled: true, events: [{ tournamentId: 'season', bannerId: 'board', view: 'leaderboard', enabled: true, name: 'Formula 1 leaderboard' }] }],
      rotationMode: 'curated',
      includedGames: ['baseball:4', 'formula-1:season:auto:banner:board', 'baseball:1', 'baseball:5'],
      rotationOrder: ['baseball:4', 'formula-1:season:auto:banner:board', 'baseball:1', 'baseball:5'],
    });
    let state = { initialized: true, config, revision: 1, instance: 'live-add-test', catalogRevision: 0 };
    let failSave = false;
    const entries = ['1', '2', '3'].map(id => ({ context: { sport: 'baseball' },
      candidate: { sport: 'baseball', id, state: 'live', teamKeys: [], startTime: new Date().toISOString() } }));
    entries.push({ candidate: { sport: 'baseball', id: '4', state: 'pregame', teamKeys: [], startTime: new Date(Date.now() + 3600000).toISOString() } },
      { candidate: { sport: 'baseball', id: '5', state: 'final', teamKeys: [], startTime: new Date().toISOString() } },
      { candidate: { sport: 'formula-1', id: 'season:auto:banner:board', state: 'interrupted', competitionType: 'individual',
        teamKeys: [], raw: { name: 'Singapore Grand Prix', bannerLabel: 'Top 10', sessionActive: false, sessionName: 'Qualifying',
          nextSession: { name: 'Race', date: new Date(Date.now() + 3600000).toISOString() } } } });
    const context = await browser.newContext();
    await context.addInitScript(({ entries, selection }) => {
      window.testEngine = { ready: true, discoveryComplete: true, availableEntries: entries,
        automaticEntries: [], normalQueue: [entries[3], entries[5], entries[0], entries[4]],
        liveQueue: [entries[4], entries[0]], queue: [entries[4], entries[0]],
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
        action: async (type, active) => {
          if (type === 'live-mode') window.testEngine.liveMode.active = active;
          return { engine: structuredClone(window.testEngine) };
        },
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
    const keys = () => page.locator('#rotation-queue .game-card').evaluateAll(cards => cards.map(card => card.dataset.gameKey));
    const f1Key = 'formula-1:season:auto:banner:board';
    const f1Card = page.locator(`#rotation-queue [data-game-key="${f1Key}"]`);
    assert.deepEqual(await keys(), ['baseball:1', 'baseball:5', 'baseball:4', f1Key], 'live, retained finals, then inactive selections');
    assert.equal(await page.locator('#rotation-queue .is-live-mode-inactive').count(), 2);
    assert.equal(await f1Card.locator('.game-live-mode-note').textContent(), 'Outside Live mode');
    assert.equal(await f1Card.locator('.remove-game').isEnabled(), true);
    assert.equal(await page.locator('#rotation-queue [data-game-key="baseball:1"] .game-down').isDisabled(), true, 'cannot reorder across live groups');
    assert.deepEqual(config.rotationOrder, ['baseball:4', f1Key, 'baseball:1', 'baseball:5'], 'display sorting does not save a new order');
    await page.locator('#rotation-queue').screenshot({ path: '/tmp/sportsover-live-mode-rotation.png' });
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
      engine.liveQueue = engine.queue = [engine.availableEntries[4], ...engine.availableEntries.slice(0, 2)];
      engine.normalQueue = [engine.availableEntries[3], engine.availableEntries[5], ...engine.availableEntries.slice(0, 2), engine.availableEntries[4]];
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
    // Expired finals leave the banner but remain visible when still selected.
    await page.evaluate(() => {
      window.testEngine.availableEntries[1].candidate.state = 'final';
      window.testEngine.liveQueue = window.testEngine.queue = [window.testEngine.availableEntries[0], window.testEngine.availableEntries[4]];
    });
    await page.waitForFunction(() => document.querySelector('#rotation-queue [data-game-key="baseball:2"]').classList.contains('is-live-mode-inactive'));
    assert.equal(await page.evaluate(() => window.cardDisappearances), 0, 'expiry dims a selected card without removing it');
    failSave = true;
    await page.locator('#available-games [data-game-key="baseball:3"] .add-game').click();
    await page.waitForFunction(() => document.querySelector('#rotation-status').textContent === 'Save failed');
    assert.equal(await page.locator('#rotation-queue [data-game-key="baseball:3"]').count(), 0, 'failed saves roll back pending cards');
    await f1Card.locator('.game-up').click();
    await page.waitForFunction(() => document.querySelector('#rotation-queue .is-live-mode-inactive').dataset.gameKey === 'formula-1:season:auto:banner:board');
    assert.equal(config.rotationOrder[0], f1Key, 'inactive reorder updates the saved full rotation');
    await f1Card.locator('.lock-game').click();
    await page.waitForFunction(() => document.querySelector('#rotation-queue [data-game-key="formula-1:season:auto:banner:board"] .lock-game').getAttribute('aria-pressed') === 'true');
    assert.ok(config.lockedGameKeys.includes(f1Key), 'inactive games remain pinnable');
    await page.locator('#pinned-only').click();
    assert.deepEqual(await keys(), [f1Key], 'pinned-only includes inactive selections');
    await page.locator('#pinned-only').click();
    await page.locator('#queue-sport-filter').selectOption('formula-1');
    assert.deepEqual(await keys(), [f1Key], 'sport filter includes inactive F1');
    await page.locator('#queue-sport-filter').selectOption('');
    await f1Card.locator('.game-time-up').click();
    await page.waitForFunction(() => document.querySelector('#rotation-queue [data-game-key="formula-1:season:auto:banner:board"] .game-time').textContent === '15s');
    assert.equal(config.gameDurations[f1Key], 15);
    // Session start promotes F1 without altering the user's saved order.
    const savedOrder = [...config.rotationOrder];
    await page.evaluate(() => {
      const f1 = window.testEngine.availableEntries[5];
      f1.candidate.state = 'live'; f1.candidate.raw.sessionActive = true;
      window.testEngine.liveQueue.push(f1);
    });
    await page.waitForFunction(() => !document.querySelector('#rotation-queue [data-game-key="formula-1:season:auto:banner:board"]').classList.contains('is-live-mode-inactive'));
    assert.equal((await keys())[0], f1Key);
    assert.deepEqual(config.rotationOrder, savedOrder, 'session transition preserves saved order');
    await page.locator('#live-mode').click();
    await page.waitForFunction(() => document.querySelector('#live-mode').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.locator('#rotation-queue .is-live-mode-inactive').count(), 0);
    assert.deepEqual(await keys(), config.rotationOrder, 'turning Live mode off restores full saved order');
    await page.locator('#live-mode').click();
    await f1Card.locator('.remove-game').click();
    await f1Card.waitFor({ state: 'detached' });
    assert.equal(await page.locator(`#available-games [data-game-key="${f1Key}"]`).count(), 1, 'removed selection becomes available');
    assert.deepEqual(errors, []);
    console.log('Live-mode lists passed: full rotation, grouping, inactive controls, filters, session transitions, saved order, stale snapshots, expiry, and save rollback.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
