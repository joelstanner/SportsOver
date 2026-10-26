// Exercise real layouts and snapshot outputs without contacting providers.
const { chromium } = require('../../scripts/test-browser.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 472, height: 100 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="white"/></svg>' });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { initialized: false } });
      if (url.pathname === '/core/output.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
      const relative = url.pathname.slice(1) || 'index.html';
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      try { return route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: types[path.extname(relative)] }); }
      catch (_) { return route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const output = await context.newPage();
    for (const sport of ['baseball', 'football', 'college-football', 'basketball', 'college-basketball', 'hockey', 'soccer']) {
      await page.goto(`http://overlay.test/index.html?sport=${sport}&demo=live`);
      await page.waitForFunction(() => window.SportsOverlay?.teamNames && document.querySelector('#sports-overlay').dataset.state === 'live');
      await page.evaluate(sport => {
        const api = window.SportsOverlay;
        window.testLayout = api.registry.getLayout(sport).createLayout();
        window.testEvent = api.registry.getDemo(sport, 'live');
        // Keep Nebraska ahead without matching it against another Seattle team.
        if (sport === 'college-basketball') Object.assign(window.testEvent.teams.home, {
          id: '130', name: 'Michigan Wolverines', abbreviation: 'MICH', logoUrl: '',
        });
        window.testEvent.details.freeBroadcasts = [{ name: 'NBC', access: 'Antenna' }, { name: 'Tubi', access: 'Free stream' }];
        api.config.loadConfig = () => ({ showBettingInfo: false, showAlternateContent: false });
        window.testLayout.render(window.testEvent);
      }, sport);
      assert.equal(await page.locator('.sports-broadcast').innerText(), 'NBC · Antenna / Tubi · Free stream');
      for (const [state, betting, alternate] of [['pregame', false, false], ['live', false, false], ['interrupted', false, false],
        ['live', true, false], ['pregame', true, true]]) {
        await page.evaluate(({ state, betting, alternate }) => {
          window.testEvent.state = state;
          window.testEvent.detailedState = state === 'interrupted' ? 'Halftime' : state;
          window.testEvent.details.odds = { moneyline: { pregame: { away: 110, home: -120 }, live: { away: 115, home: -125 } } };
          window.SportsOverlay.config.loadConfig = () => ({ showBettingInfo: betting, showAlternateContent: alternate,
            bettingReplacement: 'custom', bettingReplacementText: 'Alternate content', bettingMixSources: [] });
          window.testLayout.render(window.testEvent);
        }, { state, betting, alternate });
        const html = await page.locator('#sports-overlay').evaluate(el => el.outerHTML);
        for (const [mode, width, height] of [['desktop', 472, 100], ['desktop', 230, 100], ['obs', 647, 137], ['obs', 320, 100], ['obs', 1920, 280]]) {
          await output.setViewportSize({ width, height });
          await output.goto('http://overlay.test/display.html');
          await output.evaluate(({ html, mode }) => {
            document.querySelector('#sports-overlay').outerHTML = html;
            document.body.classList.toggle('desktop-banner', mode === 'desktop');
          }, { html, mode });
          const fit = await output.locator('.sports-broadcast').evaluate(el => {
            const label = el.getBoundingClientRect(), mount = el.parentElement.getBoundingClientRect();
            return { visible: !!el.getClientRects().length, top: label.top, bottom: label.bottom, mountTop: mount.top, mountBottom: mount.bottom,
              rows: [...el.parentElement.children].filter(row => row.getClientRects().length).map(row => [row.className, row.getBoundingClientRect().height]) };
          });
          assert(fit.visible && fit.top >= fit.mountTop && fit.bottom <= fit.mountBottom + 1, `${sport} ${state} ${mode} ${width}: label fits ${JSON.stringify(fit)}`);
          if (width >= 472) {
            const overflow = await output.locator('#sports-overlay').evaluate(mount => {
              const bounds = mount.getBoundingClientRect();
              return [...mount.querySelectorAll('.team__score,.football-score,.basketball-score,.hockey-score,.soccer-score')]
                .filter(el => el.getClientRects().length && el.textContent).flatMap(el => {
                  const box = el.getBoundingClientRect();
                  const row = el.closest('.game-view,.football-main,.basketball-main,.hockey-main,.soccer-main').getBoundingClientRect();
                  return box.top < row.top - 1 || box.bottom > row.bottom + 1 || box.left < bounds.left || box.right > bounds.right
                    ? [{ score: box.toJSON(), row: row.toJSON() }] : [];
                });
            });
            assert.deepEqual(overflow, [], `${sport} ${state} ${mode} betting=${betting}: scores fit their row`);
          }
          if (process.env.SCREENSHOT_DIR && state === 'live' && width === 472) await output.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${sport}-broadcast${betting ? '-odds' : ''}.png`) });
        }
      }
      await page.evaluate(() => { window.testEvent.state = 'final'; window.testLayout.render(window.testEvent); });
      assert.equal(await page.locator('.sports-broadcast').count(), 0, `${sport}: final`);
      await page.evaluate(() => { window.testEvent.state = 'live'; window.testEvent.details.freeBroadcasts = []; window.testLayout.render(window.testEvent); });
      assert.equal(await page.locator('.sports-broadcast').count(), 0, `${sport}: missing coverage`);
      await page.evaluate(() => { window.testEvent.details.freeBroadcasts = [{ name: 'NBC', access: 'Antenna' }]; window.testLayout.render(window.testEvent); window.testLayout.renderNoEvent(); });
      assert.equal(await page.locator('.sports-broadcast').count(), 0, `${sport}: no event`);
    }
    assert.deepEqual(errors, []);
    require('../../core/config.js');
    let config = globalThis.SportsOverlay.config.normalizeConfig({
      sports: [{ sport: 'football', enabled: true, favorites: [] }], rotationMode: 'curated',
      includedGames: ['football:1'], rotationOrder: ['football:1'], showBettingInfo: false, showAlternateContent: false,
    });
    const entries = ['1', '2', '3', '4'].map(id => ({ context: { sport: 'football' }, candidate: {
      sport: 'football', id, state: id === '4' ? 'final' : 'live', teamKeys: [], startTime: new Date().toISOString(),
      raw: { id, competitions: [{ geoBroadcasts: [{ region: 'us', type: { shortName: 'TV' }, media: { shortName: id === '3' ? 'ESPN' : 'NBC' } }],
        competitors: [{ homeAway: 'away', team: { id: '8', displayName: 'Detroit Lions', abbreviation: 'DET' } },
          { homeAway: 'home', team: { id: '1', displayName: 'Atlanta Falcons', abbreviation: 'ATL' } }] }] },
    } }));
    const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await adminContext.addInitScript(({ entries, config }) => {
      window.testEngine = { ready: true, discoveryComplete: true, availableEntries: entries, automaticEntries: [],
        normalQueue: [entries[0]], liveQueue: [entries[0]], queue: [entries[0]], liveMode: { active: false, canActivate: true },
        rotationSelection: Object.fromEntries(['rotationMode', 'includedGames', 'excludedGames', 'rotationOrder'].map(key => [key, config[key]])) };
      window.sportsDesktop = { onFrame() {}, engine: async () => structuredClone(window.testEngine),
        status: async () => ({ version: 'test', visible: true, locked: false, scale: 1 }) };
    }, { entries, config });
    await adminContext.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/output') return route.fulfill({ json: { ready: true, gameKey: 'football:1' } });
      if (url.pathname === '/api/sports/state') {
        if (route.request().method() !== 'GET') config = { ...config, ...route.request().postDataJSON().config };
        return route.fulfill({ json: { initialized: true, config, revision: 1, instance: 'broadcast-test', catalogRevision: 0 } });
      }
      if (url.hostname !== '127.0.0.1') return route.fulfill({ json: { events: [] } });
      const relative = url.pathname.replace(/^\/sports\//, '').replace(/\/$/, '/index.html');
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      try { return route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: types[path.extname(relative)] }); }
      catch (_) { return route.fulfill({ status: 404, body: '' }); }
    });
    const admin = await adminContext.newPage();
    admin.on('pageerror', error => errors.push(error.message));
    await admin.goto('http://127.0.0.1:8000/sports/admin/');
    await admin.locator('[data-tab="live"]').click();
    for (const [list, id] of [['rotation-queue', '1'], ['available-games', '2']]) {
      assert.equal(await admin.locator(`#${list} [data-game-key="football:${id}"] .sports-broadcast`).innerText(), 'NBC · Antenna');
    }
    for (const id of ['3', '4']) assert.equal(await admin.locator(`#available-games [data-game-key="football:${id}"] .sports-broadcast`).count(), 0);
    await admin.evaluate(() => {
      const entry = window.testEngine.availableEntries[0];
      entry.candidate.raw.competitions[0].geoBroadcasts[0].media.shortName = 'ESPN';
    });
    await admin.waitForFunction(() => !document.querySelector('#rotation-queue .sports-broadcast'));
    assert.deepEqual(errors, []);
    if (process.env.SCREENSHOT_DIR) await admin.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'broadcast-cards.png') });
    console.log('Broadcast labels: seven team sports, lifecycle, betting/alternate independence, desktop/OBS sizes, both game lists and broadcast changes passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
