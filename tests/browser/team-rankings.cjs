const { chromium } = require('../../scripts/test-browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require('../../core/config.js');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="white"/></svg>' });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { initialized: false } });
      const file = url.pathname.slice(1) || 'index.html';
      try { await route.fulfill({ body: await fs.readFile(path.join(root, file)), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const obsCSS = await fs.readFile(path.join(root, 'core/obs-layouts.css'), 'utf8');
    for (const sport of ['college-football', 'college-basketball']) {
      for (const [mode, width, height] of [['desktop', 472, 180], ['compact', 220, 100], ['small', 360, 76], ['normal', 647, 137], ['large', 2304, 280]]) {
        await page.setViewportSize({ width, height });
        await page.goto(`http://overlay.test/?sport=${sport}&demo=live`);
        await page.waitForFunction(() => window.SportsOverlay?.teamNames && document.querySelector('#sports-overlay').dataset.state === 'live');
        if (['small', 'normal', 'large'].includes(mode)) await page.addStyleTag({ content: obsCSS });
        else await page.evaluate(() => document.body.classList.add('desktop-banner'));
        await page.evaluate(sport => {
          const api = window.SportsOverlay;
          window.rankLayout = api.registry.getLayout(sport).createLayout();
          window.rankEvent = api.registry.getDemo(sport, 'live');
          Object.assign(window.rankEvent.teams.away, { id: '57', name: 'Florida Gators', abbreviation: 'FLA', logoUrl: 'https://a.espncdn.com/i/teamlogos/ncaa/500/57.png', score: 70, rank: 3 });
          Object.assign(window.rankEvent.teams.home, { id: '248', name: 'Houston Cougars', abbreviation: 'HOU', logoUrl: 'https://a.espncdn.com/i/teamlogos/ncaa/500/248.png', score: 65, rank: 25 });
        }, sport);
        for (const state of ['live', 'pregame', 'interrupted', 'final']) {
          await page.evaluate(state => {
            window.rankEvent.state = state;
            window.rankEvent.detailedState = state === 'interrupted' ? 'Halftime' : state;
            window.rankLayout.render(window.rankEvent);
          }, state);
          const badges = page.locator('.team-rank');
          assert.deepEqual(await badges.allTextContents(), ['3', '25'], `${sport} ${mode} ${state}`);
          for (const badge of await badges.all()) {
            assert(await badge.isVisible(), `${sport} ${mode} ${state}: rank visible`);
            assert(await badge.evaluate(el => {
              const b = el.getBoundingClientRect(), r = document.querySelector('#sports-overlay').getBoundingClientRect();
              return b.top >= r.top && b.left >= r.left && b.bottom <= r.bottom && b.right <= r.right;
            }), `${sport} ${mode} ${state}: badge inside banner`);
          }
        }
        if (mode === 'desktop') await page.screenshot({ path: path.join(root, 'logs', `team-rankings-${sport}.png`) });
        await page.evaluate(() => {
          window.rankEvent.teams.away.rank = null;
          window.rankEvent.teams.home.rank = 99;
          window.rankLayout.render(window.rankEvent);
        });
        assert.equal(await page.locator('.team-rank').count(), 0, 'new unranked matchup clears badges');
      }
    }
    const entries = ['college-football', 'college-basketball'].map((sport, index) => ({
      context: { sport },
      candidate: { sport, id: String(index + 1), state: 'live', teamKeys: [], startTime: new Date().toISOString(),
        raw: { competitions: [{ status: { type: { state: 'in' } }, competitors: [
          { homeAway: 'away', team: { id: '57', shortDisplayName: 'Florida', abbreviation: 'FLA' }, curatedRank: { current: 3 }, score: '70' },
          { homeAway: 'home', team: { id: '248', shortDisplayName: 'Houston', abbreviation: 'HOU' }, curatedRank: { current: 99 }, score: '65' },
        ] }] } },
    }));
    const config = global.SportsOverlay.config.normalizeConfig({ rotationMode: 'curated', includedGames: ['college-football:1'], rotationOrder: ['college-football:1'] });
    const lists = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
    await lists.addInitScript(({ entries, config }) => {
      window.testEngine = { ready: true, discoveryComplete: true, availableEntries: entries,
        automaticEntries: [], normalQueue: [entries[0]], liveQueue: [entries[0]], queue: [entries[0]],
        liveMode: { active: true, canActivate: true }, rotationSelection: Object.fromEntries(['rotationMode', 'includedGames', 'excludedGames', 'rotationOrder'].map(key => [key, config[key]])) };
      window.sportsDesktop = { onFrame() {}, engine: async () => structuredClone(window.testEngine),
        action: async () => ({ engine: structuredClone(window.testEngine) }), status: async () => ({ version: 'test', visible: true, locked: false, scale: 1 }) };
    }, { entries, config });
    await lists.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.fulfill({ json: { events: [] } });
      if (url.pathname === '/api/sports/state') return route.fulfill({ json: { initialized: true, config, revision: 1, instance: 'rank-test', catalogRevision: 0 } });
      if (url.pathname === '/api/output') return route.fulfill({ json: { ready: true, gameKey: 'college-football:1' } });
      const file = url.pathname.replace(/^\/sports\//, '').replace(/\/$/, '/index.html');
      try { await route.fulfill({ body: await fs.readFile(path.join(root, file)), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const admin = await lists.newPage();
    admin.on('pageerror', error => errors.push(error.message));
    await admin.goto('http://127.0.0.1/sports/admin/');
    await admin.getByRole('button', { name: 'Live control', exact: true }).click();
    for (const selector of ['#rotation-queue [data-game-key="college-football:1"]', '#available-games [data-game-key="college-basketball:2"]']) {
      await admin.locator(selector).waitFor();
      assert.equal(await admin.locator(`${selector} .game-name`).innerText(), '#3 Florida at Houston');
    }
    await admin.evaluate(() => {
      for (const entry of window.testEngine.availableEntries) entry.candidate.raw.competitions[0].competitors[0].curatedRank.current = 99;
    });
    await admin.waitForFunction(() => [...document.querySelectorAll('.game-name')].filter(el => el.textContent.includes('Florida')).every(el => !el.textContent.includes('#3')));
    assert.deepEqual(errors, []);
    console.log('College rankings: desktop, compact, all OBS sizes, game lists, game states, and clearing passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
