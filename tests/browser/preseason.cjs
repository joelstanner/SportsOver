// Offline browser coverage; no live Twitchbot or provider connections.
const { chromium } = require('../../scripts/test-browser.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const context = await browser.newContext();
    const errors = [];
    let sharedState = { initialized: false, config: null, revision: 0, instance: 'preseason-test' };
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'lichess.org') return route.fulfill({ json: { active: [] } });
      if (url.hostname === 'www.pdga.com') return route.fulfill({ json: [] });
      if (url.hostname !== 'overlay.test') return route.fulfill({ json: {} });
      if (url.pathname.startsWith('/api/sports/state')) {
        if (route.request().method() !== 'GET') {
          const body = route.request().postDataJSON();
          sharedState = { ...sharedState, initialized: true, revision: sharedState.revision + 1, config: { ...sharedState.config, ...body.config } };
        }
        return route.fulfill({ json: sharedState });
      }
      let relative = url.pathname.replace(/^\/sports\/(?=admin\/|core\/|sports\/|$|index\.html)/, '/').slice(1);
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      try { await route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: types[path.extname(relative)] }); }
      catch (_) { await route.fulfill({ status: 404, body: '' }); }
    });
    for (const sport of ['baseball', 'basketball', 'football', 'college-football', 'hockey', 'soccer', 'college-basketball']) {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      await page.goto(`http://overlay.test/?sport=${sport}&demo=live`);
      await page.waitForFunction(() => window.SportsOverlay?.registry);
      for (const state of ['pregame', 'live', 'interrupted', 'final']) {
        await page.evaluate(({ sport, state }) => {
          const api = window.SportsOverlay;
          window.testEvent = api.registry.getDemo(sport, state);
          window.testEvent.startTime = new Date().toISOString();
          window.testEvent.details.preseason = true;
          window.testLayout?.dispose?.();
          window.testLayout = api.registry.getLayout(sport === 'college-football' ? 'football' : sport).createLayout();
          window.testLayout.render(window.testEvent);
        }, { sport, state });
        assert.equal(await page.locator('#sports-overlay').getAttribute('data-preseason'), 'true');
        assert.equal(await page.locator('#sports-overlay').evaluate(el => getComputedStyle(el, '::before').content), '"PRESEASON"');
        assert.match(await page.locator('#sports-overlay').getAttribute('aria-label'), /preseason/);
        assert.equal(await page.locator('#sports-overlay').evaluate(el => el.scrollWidth <= el.clientWidth), true);
        if (state === 'final') {
          await page.evaluate(() => {
            const config = window.SportsOverlay.config;
            config.saveConfig({ ...config.loadConfig(), timeZone: 'UTC' });
            window.testEvent.startTime = new Date(Date.now() - 86400000).toISOString();
            window.testLayout.render(window.testEvent);
          });
          const status = page.locator(sport === 'baseball' ? '#status' : `#${sport === 'college-football' ? 'football' : sport === 'college-basketball' ? 'basketball' : sport}-status-text`);
          assert.match(await status.innerText(), / · YESTERDAY$/);
          assert.equal(await page.locator('#sports-overlay').evaluate(el => el.scrollWidth <= el.clientWidth), true, `${sport} yesterday final fits`);
          await page.screenshot({ path: `/tmp/sports-yesterday-${sport}.png` });
        }
        if (state === 'live') await page.screenshot({ path: `/tmp/sports-preseason-${sport}.png` });
        await page.evaluate(() => { window.testEvent.details.preseason = false; window.testLayout.render(window.testEvent); });
        assert.equal(await page.locator('#sports-overlay').evaluate(el => getComputedStyle(el, '::before').content), 'none');
        await page.evaluate(() => { window.testEvent.details.preseason = true; window.testLayout.render(window.testEvent); window.testLayout.renderNoEvent(); });
        assert.equal(await page.locator('#sports-overlay').getAttribute('data-preseason'), null);
      }
      if (sport === 'hockey') {
        for (const [state, active, visible] of [
          ['live', true, true], ['live', false, false], ['live', null, false],
          ['interrupted', true, false], ['final', true, false], ['pregame', true, false],
        ]) {
          await page.evaluate(({ state, active }) => {
            window.testEvent = window.SportsOverlay.registry.getDemo('hockey', 'live');
            window.testEvent.state = state;
            window.testEvent.details.powerPlayActive = active;
            window.testLayout.render(window.testEvent);
          }, { state, active });
          assert.equal(await page.locator('#hockey-advantage').count(), 0);
          assert.equal(await page.locator('#hockey-home-pp').isVisible(), visible);
          assert.equal(await page.locator('#hockey-away-pp').isHidden(), true);
          if (visible) {
            assert.equal(await page.locator('#hockey-home-pp').innerText(), 'PP');
            assert.equal(await page.locator('#hockey-home-pp').getAttribute('aria-label'), 'Seattle Kraken power play');
            assert.equal(await page.locator('#hockey-power-play').innerText(), 'VAN 0/2 · SEA 1/3');
            assert.equal(await page.locator('#sports-overlay').evaluate(el => el.scrollWidth <= el.clientWidth), true);
            await page.screenshot({ path: '/tmp/sportsover-hockey-power-play.png' });
          }
        }
        for (const teamId of ['23', '124292', null, 'unknown']) {
          await page.evaluate(teamId => {
            window.testEvent.state = 'live';
            window.testEvent.details.powerPlayActive = true;
            window.testEvent.details.powerPlayTeamId = teamId;
            window.testLayout.render(window.testEvent);
          }, teamId);
          for (const [side, id, name] of [['away', '23', 'Vancouver Canucks'], ['home', '124292', 'Seattle Kraken']]) {
            const indicator = page.locator(`#hockey-${side}-pp`);
            assert.equal(await indicator.isVisible(), teamId === id);
            assert.equal(await indicator.getAttribute('aria-label'), teamId === id ? `${name} power play` : null);
            assert.equal(await indicator.getAttribute('title'), teamId === id ? `${name} power play` : null);
          }
        }
        await page.evaluate(() => {
          window.testEvent.state = 'live';
          window.testEvent.details.powerPlayTeamId = window.testEvent.teams.home.id;
          window.testLayout.render(window.testEvent);
          window.testLayout.renderNoEvent();
        });
        assert.equal(await page.locator('#hockey-away-pp').isHidden(), true);
        assert.equal(await page.locator('#hockey-home-pp').isHidden(), true);
        assert.equal(await page.locator('#hockey-home-pp').getAttribute('aria-label'), null);
      }
      if (sport === 'college-basketball') {
        await page.evaluate(() => {
          const api = window.SportsOverlay;
          window.testEvent = api.registry.getDemo('college-basketball', 'live');
          window.testLayout.render(window.testEvent);
        });
        assert.equal(await page.locator('#basketball-period').innerText(), '2ND HALF');
        assert.equal(await page.locator('#basketball-away-timeouts').innerText(), '');
        assert.equal(await page.locator('#basketball-away-timeouts .timeout-marker.is-remaining').count(), 2);
        assert.equal(await page.locator('#basketball-home-timeouts .timeout-marker.is-remaining').count(), 1);
        assert.equal(await page.locator('#basketball-home-timeouts').getAttribute('aria-label'), 'Washington Huskies: 1 timeout remaining');
        await page.screenshot({ path: '/tmp/sportsover-ncaam-live.png', omitBackground: true });
        await page.evaluate(() => {
          window.testEvent.details.period = 'OT2';
          window.testEvent.teams.away.timeoutsRemaining = 5;
          window.testEvent.teams.home.timeoutsRemaining = null;
          window.testLayout.render(window.testEvent);
        });
        assert.equal(await page.locator('#basketball-away-timeouts .timeout-marker.is-remaining').count(), 5, 'overtime counts are not capped at the NBA limit');
        assert.equal(await page.locator('#basketball-home-timeouts').isHidden(), true);
        assert.equal(await page.locator('#basketball-home-timeouts .timeout-marker').count(), 0, 'missing counts clear previous markers');
        assert.equal(await page.locator('#basketball-home-timeouts').getAttribute('aria-label'), null);
        await page.evaluate(() => {
          window.testEvent.teams.away.timeoutsRemaining = 0;
          window.testLayout.render(window.testEvent);
        });
        assert.equal(await page.locator('#basketball-away-timeouts').isVisible(), true);
        assert.equal(await page.locator('#basketball-away-timeouts .timeout-marker.is-remaining').count(), 0);
        assert.equal(await page.locator('#basketball-away-timeouts .timeout-marker.is-used').count(), 1);
        assert.equal(await page.locator('#basketball-away-timeouts').getAttribute('aria-label'), 'Nebraska Cornhuskers: 0 timeouts remaining');
        await page.evaluate(() => {
          window.testEvent.state = 'interrupted';
          window.testEvent.detailedState = 'Halftime';
          window.testEvent.teams.away.timeoutsRemaining = 3;
          window.testLayout.render(window.testEvent);
        });
        assert.equal(await page.locator('#basketball-away-timeouts .timeout-marker.is-remaining').count(), 3, 'reported timeouts remain visible during interruptions');
        for (const state of ['pregame', 'final']) {
          await page.evaluate(state => { window.testEvent.state = state; window.testLayout.render(window.testEvent); }, state);
          assert.equal(await page.locator('#basketball-away-timeouts').isHidden(), true);
          assert.equal(await page.locator('#basketball-away-timeouts .timeout-marker').count(), 0);
        }
        await page.evaluate(() => { window.testEvent.state = 'final'; window.testEvent.startTime = new Date().toISOString(); window.testLayout.render(window.testEvent); });
        assert.equal(await page.locator('#basketball-status-text').innerText(), 'FINAL / OT2');
      }
      await page.close();
    }
    const admin = await context.newPage();
    // Autosave needs timers running after the paused banner scenarios.
    await admin.clock.resume();
    admin.on('pageerror', error => errors.push(error.message));
    await admin.goto('http://overlay.test/sports/admin/');
    await admin.getByRole('button', { name: 'Start with defaults' }).click();
    await admin.getByText('Shared settings initialized.', { exact: true }).waitFor();
    await admin.evaluate(() => {
      const games = ['preseason', 'regular-season', 'unknown', 'preseason'].map((slug, index) => ({
        id: String(900001 + index), gamePk: 900001 + index,
        date: new Date().toISOString(), gameDate: new Date().toISOString(),
        ...(slug !== 'unknown' ? { season: { year: 2027, displayName: '2026-27' }, seasonType: { id: slug === 'preseason' ? '1' : '2', name: slug === 'preseason' ? 'Preseason' : 'Regular Season' }, gameType: slug === 'preseason' ? 'S' : 'R' } : {}),
        status: { abstractGameState: index === 3 ? 'Final' : 'Preview' },
        teams: { away: { team: { id: 99991, name: 'Away' } }, home: { team: { id: 99992, name: 'Home' } } },
        competitions: [{ status: { type: { state: index === 3 ? 'post' : 'pre' } }, competitors: [
          { homeAway: 'away', team: { id: '99991', displayName: 'Away' } },
          { homeAway: 'home', team: { id: '99992', displayName: 'Home' } },
        ] }],
      }));
      window.SportsOverlay.providerDiscovery.discover = async () => ({ favoriteGames: [], leagueGames: games, failures: 0 });
    });
    await admin.getByRole('button', { name: 'Live control', exact: true }).click();
    await admin.getByText('Games refreshed', { exact: true }).waitFor();
    await admin.locator('#rotation-mode').selectOption('curated');
    await admin.getByText('Rotation source applied', { exact: true }).waitFor();
    for (const sport of ['baseball', 'basketball', 'football', 'college-football', 'hockey', 'soccer', 'college-basketball']) {
      const available = admin.locator(`#available-games [data-game-key="${sport}:900001"]`);
      assert.match(await available.locator('.game-meta').innerText(), /^PRESEASON · Upcoming/);
      for (const id of ['900002', '900003']) {
        assert.doesNotMatch(await admin.locator(`#available-games [data-game-key="${sport}:${id}"] .game-meta`).innerText(), /PRESEASON|Regular/i);
      }
      const finalCard = admin.locator(`#available-games [data-game-key="${sport}:900004"]`);
      assert.match(await finalCard.locator('.game-meta').innerText(), /^PRESEASON · Final ·/);
      assert.equal(await finalCard.locator('.game-final-label').innerText(), 'Final');
      await available.locator('.add-game').click();
      assert.match(await admin.locator(`#rotation-queue [data-game-key="${sport}:900001"] .game-meta`).innerText(), /^PRESEASON · Upcoming/);
    }
    await admin.screenshot({ path: '/tmp/sports-preseason-dashboard.png' });
    await admin.getByRole('button', { name: 'Settings', exact: true }).click();
    const hockeyCard = admin.locator('.sport-card[data-sport="hockey"]');
    const favoritesBefore = await hockeyCard.locator('.favorite-card').count();
    await hockeyCard.getByRole('checkbox', { name: 'Show Hockey', exact: true }).uncheck();
    assert.equal(await hockeyCard.locator('.sport-favorites').isHidden(), true);
    await admin.getByText('Saved automatically. Banner updated.', { exact: true }).waitFor();
    assert.equal(sharedState.config.sports.find(group => group.sport === 'hockey').enabled, false);
    assert.ok(sharedState.config.includedGames.includes('hockey:900001'), 'manual choices remain saved');
    await admin.getByRole('button', { name: 'Live control', exact: true }).click();
    assert.equal(await admin.locator('#rotation-queue [data-game-key^="hockey:"]').count(), 0);
    assert.equal(await admin.locator('#available-games [data-game-key^="hockey:"]').count(), 0);
    await admin.getByRole('button', { name: 'Settings', exact: true }).click();
    await hockeyCard.scrollIntoViewIfNeeded();
    await admin.screenshot({ path: '/tmp/sportsover-disabled-sport.png' });
    await admin.reload();
    await admin.getByRole('checkbox', { name: 'Show Hockey', exact: true }).waitFor();
    assert.equal(await admin.getByRole('checkbox', { name: 'Show Hockey', exact: true }).isChecked(), false);
    await admin.getByRole('checkbox', { name: 'Show Hockey', exact: true }).check();
    assert.equal(await hockeyCard.locator('.favorite-card').count(), favoritesBefore);
    assert.equal(await hockeyCard.locator('.sport-favorites').isVisible(), true);
    await admin.getByText('Saved automatically. Banner updated.', { exact: true }).waitFor();
    assert.equal(sharedState.config.sports.find(group => group.sport === 'hockey').enabled, true);
    await admin.close();
    assert.deepEqual(errors, []);
    console.log('Preseason browser checks passed: all seven sports, all game states, regular-season and empty-state transitions.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
