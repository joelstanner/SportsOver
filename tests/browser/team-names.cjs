// Offline layout coverage with real font measurements and engine HTML snapshots.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 472, height: 180 } });
    const errors = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="white"/></svg>' });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { initialized: false } });
      const relative = url.pathname.slice(1) || 'index.html';
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      try { await route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: types[path.extname(relative)] }); }
      catch (_) { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const sport of ['baseball', 'basketball', 'football', 'college-football', 'hockey', 'soccer', 'college-basketball']) {
      await page.goto(`http://overlay.test/?sport=${sport}&demo=pregame`);
      await page.waitForFunction(() => window.SportsOverlay?.teamNames && document.querySelector('#sports-overlay').dataset.state === 'pregame');
      const layoutSport = sport === 'college-football' ? 'football' : sport === 'college-basketball' ? 'basketball' : sport;
      const ids = ['away', 'home'].map(side => `#${sport === 'baseball' ? '' : `${layoutSport}-`}${side}-abbr`);
      await page.evaluate(sport => {
        const api = window.SportsOverlay;
        window.testLayout = api.registry.getLayout(sport).createLayout();
        window.testEvent = api.registry.getDemo(sport, 'pregame');
        window.setNameTestTeams = () => {
          Object.assign(window.testEvent.teams.away, { id: 'layout-away', name: 'Detroit Lions', abbreviation: 'DET', logoUrl: '', score: sport === 'baseball' ? 2 : 117 });
          Object.assign(window.testEvent.teams.home, { id: 'layout-home', name: 'Seattle Kraken', abbreviation: 'SEA', logoUrl: '', score: sport === 'baseball' ? 3 : 123 });
        };
        window.setNameTestTeams();
      }, sport);
      for (const state of ['pregame', 'final', 'live', 'interrupted', 'pregame']) {
        await page.evaluate(({ state, sport }) => {
          window.testEvent.state = state;
          window.testLayout.render(window.testEvent);
        }, { state, sport });
        assert.equal(await page.evaluate(() => window.testEvent.teams.home.score > window.testEvent.teams.away.score), true, 'Seattle always leads');
        const expanded = ['pregame', 'final'].includes(state);
        for (const [index, side] of ['away', 'home'].entries()) {
          const expected = await page.evaluate(({ side, expanded }) => window.testEvent.teams[side][expanded ? 'name' : 'abbreviation'], { side, expanded });
          assert.equal(await page.locator(ids[index]).innerText(), expected, `${sport} ${state} ${side}`);
          assert.equal(await page.locator(ids[index]).evaluate(el => el.scrollWidth <= el.clientWidth), true, `${sport} ${state} name fits`);
        }
        assert.equal(await page.locator('#sports-overlay').evaluate(el => el.scrollWidth <= el.clientWidth), true, `${sport} ${state} fits banner`);
      }
      for (const state of ['pregame', 'final']) {
        if (sport === 'football') {
          for (const chargersSide of ['away', 'home']) {
            await page.evaluate(({ state, chargersSide }) => {
              window.testEvent.state = state;
              for (const side of ['away', 'home']) {
                const team = window.testEvent.teams[side];
                team.name = side === chargersSide ? 'Los Angeles Chargers' : 'Tampa Bay Buccaneers';
                team.abbreviation = side === chargersSide ? 'LAC' : 'TB';
                team.id = team.abbreviation;
                team.score = side === 'away' ? 27 : 24;
              }
              window.testLayout.render(window.testEvent);
            }, { state, chargersSide });
            for (const [index, side] of ['away', 'home'].entries()) {
              const label = page.locator(ids[index]);
              assert.equal(await label.innerText(), side === chargersSide ? 'Los Angeles Chargers' : 'Tampa Bay Buccaneers', `${state} longer ${side} name expands`);
              assert.equal(await label.evaluate(el => el.scrollWidth <= el.clientWidth), true, `${state} longer ${side} name fits`);
            }
          }
          // Adjustments travel with the engine snapshot used by desktop and OBS.
          const html = await page.locator('#sports-overlay').evaluate(el => el.outerHTML);
          const output = await context.newPage();
          await output.goto('http://overlay.test/display.html');
          await output.locator('#sports-overlay').evaluate((el, html) => { el.outerHTML = html; }, html);
          for (const [index, name] of ['Tampa Bay Buccaneers', 'Los Angeles Chargers'].entries()) {
            assert.equal(await output.locator(ids[index]).innerText(), name);
            assert.equal(await output.locator(ids[index]).evaluate(el => el.scrollWidth <= el.clientWidth), true, `${state} longer output name fits`);
          }
          await output.close();
          await page.screenshot({ path: `/tmp/sportsover-chargers-${state}.png` });
        }
        await page.evaluate(state => {
          window.testEvent.state = state;
          window.testEvent.teams.away.name = 'An Extremely Long City and Team Name That Cannot Fit';
          window.testEvent.teams.home.name = 'Another Extremely Long City and Team Name That Cannot Fit';
          window.testLayout.render(window.testEvent);
        }, state);
        for (const [index, side] of ['away', 'home'].entries()) {
          assert.equal(await page.locator(ids[index]).innerText(), await page.evaluate(side => window.testEvent.teams[side].abbreviation, side), `${sport} long ${side} falls back`);
          assert.equal(await page.locator(ids[index]).evaluate(el => el.style.fontSize + el.style.letterSpacing), '', `${sport} fallback restores typography`);
        }
      }
      // A new matchup must remeasure names; outputs consume the chosen label verbatim.
      await page.evaluate(() => {
        window.setNameTestTeams();
        window.testLayout.render(window.testEvent);
      });
      for (const id of ids) {
        assert.equal(await page.locator(id).evaluate(el => el.style.fontSize + el.style.letterSpacing), '', `${sport} shorter matchup restores typography`);
      }
      const html = await page.locator('#sports-overlay').evaluate(el => el.outerHTML);
      const output = await context.newPage();
      output.on('pageerror', error => errors.push(error.message));
      await output.goto('http://overlay.test/display.html');
      await output.locator('#sports-overlay').evaluate((el, html) => { el.outerHTML = html; }, html);
      for (const [index, name] of ['Detroit Lions', 'Seattle Kraken'].entries()) {
        assert.equal(await output.locator(ids[index]).innerText(), name, `${sport} output preserves name`);
        assert.equal(await output.locator(ids[index]).evaluate(el => el.scrollWidth <= el.clientWidth), true, `${sport} output name fits`);
      }
      await output.close();
      if (sport === 'baseball') {
        for (const state of ['pregame', 'final']) {
          await page.evaluate(state => {
            window.testEvent.state = state;
            window.testLayout.render(window.testEvent);
            window.testLayout.renderNoEvent();
          }, state);
          assert.equal(await page.locator('#game-view').isHidden(), true, `${state} clears teams for empty state`);
          assert.equal(await page.locator('#no-game').isVisible(), true);
        }
      }
      // Capture the real demo teams to inspect the mix of full names and abbreviations.
      await page.evaluate(({ sport, state }) => {
        window.testEvent = window.SportsOverlay.registry.getDemo(sport, state);
        window.testLayout.render(window.testEvent);
      }, { sport, state: 'pregame' });
      await page.screenshot({ path: `/tmp/sportsover-team-names-${sport}.png` });
      console.log(`${sport}: full names, fallback, state transitions, and output fit passed`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
