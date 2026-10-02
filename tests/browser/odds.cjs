// Offline checks for banners and game cards, evenly matched teams, live markets, and expiry.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test') return route.fulfill({ json: {} });
      let relative = url.pathname.replace(/^\/sports\/(?=admin\/|core\/|sports\/|$|index\.html)/, '/').slice(1);
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      try { await route.fulfill({ body: await fs.readFile(path.join(root, relative)), contentType: types[path.extname(relative)] }); }
      catch (_) { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.goto('http://overlay.test/?sport=football&demo=pregame');
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    for (const sport of ['football', 'college-football', 'basketball', 'college-basketball', 'hockey', 'soccer']) {
      await page.evaluate(sport => {
        const api = window.SportsOverlay;
        window.testLayout = api.registry.getLayout(sport).createLayout();
        window.testEvent = structuredClone(api.registry.getDemo(sport, 'pregame'));
        testEvent.startTime = new Date().toISOString();
        testEvent.details.odds = api.model.espnOdds({ odds: [{ pointSpread: { away: { close: { line: '-3.5' } }, home: { close: { line: '+3.5' } } }, moneyline: { away: { close: { odds: '-185' } }, home: { close: { odds: '+154' } }, draw: { close: { odds: sport === 'soccer' ? '+320' : null } } } }] });
        testLayout.render(testEvent);
      }, sport);
      assert.equal(await page.locator('.sports-odds').count(), 1);
      assert.match(await page.locator('.sports-odds').innerText(), /\+154/);
      assert.equal(await page.locator('.sports-odds-price.is-near-even').count(), 0);
      if (sport === 'soccer') assert.match(await page.locator('.sports-odds').innerText(), /DRAW \+320/);
      if (sport === 'hockey') assert.match(await page.locator('.sports-odds').innerText(), /PUCK LINE/);
      assert.ok(await page.locator('#sports-overlay').evaluate(el => el.scrollWidth <= el.clientWidth));
      await page.evaluate(() => {
        testEvent.details.odds.spread.prices = { pregame: { away: -120, home: -121 }, live: {} };
        testEvent.details.odds.moneyline.pregame.away = -100;
        testEvent.details.odds.moneyline.pregame.home = 120;
        testLayout.render(testEvent);
      });
      assert.deepEqual(await page.locator('.sports-odds-price.is-near-even').allTextContents(), ['-100', '+120']);
      assert.match(await page.locator('.sports-odds').innerText(), /-3\.5 \(-120\)/);
      assert.equal(await page.locator('.sports-odds-price.is-near-even').first().evaluate(el => getComputedStyle(el).color), 'rgb(113, 239, 179)');
      await page.evaluate(() => {
        const limit = window.SportsOverlay.odds.CLOSE_SPREAD_LIMITS[testEvent.sport];
        testEvent.details.odds.spread.pregame.away = -limit;
        testEvent.details.odds.spread.pregame.home = limit;
        testLayout.render(testEvent);
      });
      assert.equal(await page.locator('.sports-odds-line.is-near-even').count(), 2, `${sport}: close spread point values highlighted`);
      assert.equal(await page.locator('.sports-odds-line.is-near-even').first().evaluate(el => getComputedStyle(el).color), 'rgb(113, 239, 179)');
      assert.equal(await page.locator('.sports-odds-price.is-near-even').count(), 2, 'only moneyline prices highlighted');
      assert.ok(await page.locator('#sports-overlay').evaluate(el => el.scrollWidth <= el.clientWidth), `${sport}: priced spread fits`);
      await page.screenshot({ path: `/tmp/sportsover-odds-${sport}.png` });
      await page.evaluate(() => { testEvent.state = 'live'; testLayout.render(testEvent); });
      assert.match(await page.locator('.sports-odds').innerText(), /PRE /);
      await page.clock.runFor(300001);
      assert.equal(await page.locator('.sports-odds').count(), 0, `${sport}: automatic expiry without refetch`);
      await page.evaluate(() => {
        testEvent.details.odds.moneyline.live.away = -220;
        testLayout.render(testEvent);
      });
      assert.match(await page.locator('.sports-odds').innerText(), /LIVE ML/);
      assert.doesNotMatch(await page.locator('.sports-odds').innerText(), /PRE /);
      await page.clock.runFor(300001);
      assert.match(await page.locator('.sports-odds').innerText(), /-220/);
      await page.evaluate(() => { testEvent.state = 'final'; testLayout.render(testEvent); });
      assert.equal(await page.locator('.sports-odds').count(), 0);
      await page.evaluate(() => { testEvent.state = 'live'; testLayout.render(testEvent); testLayout.renderNoEvent(); });
      await page.clock.runFor(1001);
      assert.equal(await page.locator('.sports-odds').count(), 0);
    }
    await page.evaluate(() => {
      testLayout.render(testEvent);
      const api = window.SportsOverlay;
      const baseball = api.registry.getLayout('baseball').createLayout();
      baseball.render(api.registry.getDemo('baseball', 'live'));
    });
    await page.clock.runFor(2000);
    assert.equal(await page.locator('.sports-odds').count(), 0, 'no old odds after rotation to baseball');
    let sharedState = { initialized: false, config: null, revision: 0, instance: 'odds-test' };
    await context.route('**/api/sports/state**', async route => {
      if (route.request().method() !== 'GET') {
        const body = route.request().postDataJSON();
        sharedState = { ...sharedState, initialized: true, revision: sharedState.revision + 1, config: { ...sharedState.config, ...body.config } };
      }
      await route.fulfill({ json: sharedState });
    });
    const admin = await context.newPage();
    await admin.clock.resume();
    admin.on('pageerror', error => errors.push(error.message));
    await admin.goto('http://overlay.test/sports/admin/');
    await admin.getByRole('button', { name: 'Start with defaults' }).click();
    await admin.getByText('Shared settings initialized.', { exact: true }).waitFor();
    await admin.evaluate(() => {
      window.cardGames = ['pre', 'in', 'post', 'pre', 'pre', 'pre'].map((state, index) => ({
        id: String(900001 + index), date: new Date(Date.now() - (state === 'in' ? 600000 : 0)).toISOString(),
        competitions: [{ status: { type: { state } }, competitors: [
          { homeAway: 'away', score: '0', team: { id: '99991', displayName: 'Away', abbreviation: 'AWY' } },
          { homeAway: 'home', score: '0', team: { id: '99992', displayName: 'Home', abbreviation: 'HME' } },
        ], ...(index === 3 ? {} : index === 4 ? { odds: [null] } : { odds: [{
          pointSpread: { away: { close: { line: index === 5 ? '-2.5' : '-3.5', odds: '-120' } }, home: { close: { line: index === 5 ? '+2.5' : '+3.5', odds: '-121' } } },
          moneyline: { away: { close: { odds: index === 5 ? '+120' : '+100' }, live: { odds: '+120' } }, home: { close: { odds: index === 5 ? '-142' : '-120' } }, draw: { close: { odds: '+320' } } },
        }] }) }],
      }));
      window.SportsOverlay.providerDiscovery.discover = async () => ({ favoriteGames: [], leagueGames: cardGames, failures: 0 });
    });
    await admin.getByRole('button', { name: 'Live control', exact: true }).click();
    await admin.getByText('Games refreshed', { exact: true }).waitFor();
    await admin.locator('#rotation-mode').selectOption('curated');
    await admin.getByText('Queue mode applied', { exact: true }).waitFor();
    for (const sport of ['football', 'college-football', 'basketball', 'college-basketball', 'hockey', 'soccer']) {
      const card = admin.locator(`#available-games [data-game-key="${sport}:900001"]`);
      assert.match(await card.locator('.sports-odds').innerText(), /AWY -3\.5 \(-120\).*HME \+3\.5 \(-121\)/s);
      assert.deepEqual(await card.locator('.is-near-even').allTextContents(), ['+100', '-120']);
      assert.equal(await card.locator('.is-near-even').first().getAttribute('title'), 'Evenly matched teams: both moneylines within ±120');
      const closeSpread = admin.locator(`#available-games [data-game-key="${sport}:900006"]`);
      assert.equal(await closeSpread.locator('.sports-odds-price.is-near-even').count(), 0, 'a +120 underdog against a -142 favorite does not qualify');
      assert.equal(await closeSpread.locator('.sports-odds-line.is-near-even').count(), ['hockey', 'soccer'].includes(sport) ? 0 : 2);
      if (sport === 'hockey') assert.match(await card.locator('.sports-odds').innerText(), /PUCK LINE/);
      if (sport === 'soccer') assert.match(await card.locator('.sports-odds').innerText(), /DRAW \+320/);
      const live = admin.locator(`#available-games [data-game-key="${sport}:900002"]`);
      assert.match(await live.locator('.sports-odds').innerText(), /^LIVE ML\s+AWY \+120$/);
      assert.equal(await live.locator('.is-near-even').count(), 0, 'a single moneyline cannot establish team parity');
      for (const id of ['900003', '900004', '900005']) assert.equal(await admin.locator(`#available-games [data-game-key="${sport}:${id}"] .sports-odds`).count(), 0);
    }
    await admin.locator('#available-games [data-game-key="hockey:900001"]').screenshot({ path: '/tmp/sportsover-available-odds.png' });
    // Moving a card to rotation retains the same odds presentation.
    await admin.locator('#available-games [data-game-key="football:900001"] .add-game').click();
    await admin.locator('#rotation-queue [data-game-key="football:900001"] .sports-odds').waitFor();
    assert.deepEqual(await admin.locator('#rotation-queue [data-game-key="football:900001"] .is-near-even').allTextContents(), ['+100', '-120']);
    await admin.locator('#available-games [data-game-key="soccer:900005"] .add-game').click();
    await admin.locator('#rotation-queue [data-game-key="soccer:900005"]').waitFor();
    assert.equal(await admin.locator('#rotation-queue [data-game-key="soccer:900005"] .sports-odds').count(), 0);
    assert.ok(await admin.locator('#available-games .game-card').count() > 0, 'empty odds in a queued game do not blank Available Games');
    await admin.setViewportSize({ width: 390, height: 844 });
    assert.ok(await admin.locator('#available-games').evaluate(el => el.scrollWidth <= el.clientWidth), 'odds cards fit a narrow settings window');
    await admin.locator('#available-games [data-game-key="hockey:900001"]').screenshot({ path: '/tmp/sportsover-available-odds-narrow.png' });
    // Observe kickoff in the cards, then retire pregame markets without a provider request.
    await admin.clock.install();
    await admin.evaluate(() => {
      for (const game of cardGames) if (game.id === '900001') game.competitions[0].status.type.state = 'in';
    });
    await admin.locator('#refresh-games').click();
    await admin.getByText('Games refreshed', { exact: true }).waitFor();
    assert.match(await admin.locator('#available-games [data-game-key="hockey:900001"] .sports-odds').innerText(), /PRE PUCK LINE/);
    await admin.clock.runFor(300001);
    assert.match(await admin.locator('#available-games [data-game-key="hockey:900001"] .sports-odds').innerText(), /^LIVE ML\s+AWY \+120$/);
    await admin.close();
    assert.deepEqual(errors, []);
    console.log('Odds browser checks passed: all six ESPN sports, balanced moneylines, close point spreads, neutral spread payouts, game cards, narrow layouts, live markets, and expiry.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
