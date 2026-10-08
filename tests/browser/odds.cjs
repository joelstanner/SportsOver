// Offline checks for banners and game cards, evenly matched teams, live markets, and expiry.
const { chromium } = require('../../scripts/test-browser.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const context = await browser.newContext();
    context.setDefaultTimeout(15000);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'lichess.org') return route.fulfill({ json: { active: [] } });
      if (url.hostname === 'www.pdga.com') return route.fulfill({ json: [] });
      if (url.hostname !== 'overlay.test') return route.fulfill({ json: {} });
      let relative = url.pathname.replace(/^\/sports\/(?=admin\/|core\/|sports\/|$|index\.html|display\.html)/, '/').slice(1);
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
      const originalOdds = await page.evaluate(() => testEvent.details.odds);
      await page.evaluate(() => {
        const api = window.SportsOverlay;
        api.config.saveConfig({...api.config.loadConfig(),showBettingInfo:false});
        testLayout.render(testEvent);
      });
      assert.equal(await page.locator('.sports-odds').innerText(),'Betting Info: Hidden');
      assert.equal(await page.locator('.sports-odds [title], .sports-odds-price, .sports-odds-line, .sports-odds-label').count(),0);
      await page.clock.runFor(1001);
      assert.equal(await page.locator('.sports-odds').innerText(),'Betting Info: Hidden',`${sport}: timer cannot restore hidden odds`);
      assert.deepEqual(await page.evaluate(() => testEvent.details.odds),originalOdds);
      if (sport === 'football') await page.locator('#sports-overlay').screenshot({path:'/tmp/sportsover-betting-hidden.png'});
      if (sport === 'football') {
        const setContent = async (mode, extra = {}) => page.evaluate(({mode,extra}) => {
          const api=window.SportsOverlay;
          api.config.saveConfig({...api.config.loadConfig(),showBettingInfo:false,showAlternateContent:true,bettingReplacement:mode,...extra});
          testLayout.render(testEvent);
        },{mode,extra});
        for (const mode of ['hidden','custom','player-stats','game-details','blank','scrolling']) {
          await setContent(mode, {showAlternateContent:false,showBettingInfo:true,bettingReplacementText:'Saved message'});
          assert.match(await page.locator('.sports-odds').innerText(), /\+154/, `alternate Off ignores saved ${mode} choice`);
          await setContent(mode, {showAlternateContent:false,showBettingInfo:false});
          assert.equal(await page.locator('.sports-odds').innerText(), 'Betting Info: Hidden');
          await page.clock.runFor(1001);
          assert.equal(await page.locator('.sports-odds').innerText(), 'Betting Info: Hidden', 'timer cannot restore a saved mix or odds');
        }
        await setContent('hidden', {showBettingInfo:true});
        assert.match(await page.locator('.sports-odds').innerText(), /\+154/, 'hidden-message choice cannot hide odds while betting is On');
        const custom = '<img src=x onerror=alert(1)> Cheer for your team!';
        await setContent('custom',{bettingReplacementText:custom});
        assert.equal(await page.locator('.sports-odds').innerText(),custom);
        assert.equal(await page.locator('.sports-odds img').count(),0,'custom content remains plain text');
        await setContent('custom',{bettingReplacementText:'x'.repeat(160)});
        assert.ok(await page.locator('#sports-overlay').evaluate(el=>el.scrollWidth<=el.clientWidth),'long custom text wraps inside banner');
        await setContent('blank');
        assert.equal(await page.locator('.sports-odds').count(),0);
        await page.clock.runFor(1001);
        assert.equal(await page.locator('.sports-odds').count(),0,'blank stays blank between provider polls');
        await page.evaluate(() => {
          testEvent.details.playerStats=[{key:'one:points',text:'Alex Example · PTS: 12'},{key:'two:rebounds',text:'Casey Example · REB: 7'}];
          testEvent.details.gameDetails=['Venue: Example Arena','Broadcast: ESPN'];
        });
        await setContent('player-stats');
        const first=await page.locator('.sports-odds').innerText();
        await page.clock.runFor(9000);
        assert.equal(await page.locator('.sports-odds').innerText(),first,'player stat stays readable for ten seconds');
        await page.clock.runFor(1001);
        assert.notEqual(await page.locator('.sports-odds').innerText(),first,'next stat avoids immediate repetition');
        await page.evaluate(() => {testEvent.details.odds=null;testLayout.render(testEvent);});
        assert.match(await page.locator('.sports-odds').innerText(),/Example/,'stats work even when odds are absent');
        await page.evaluate(() => {testEvent.details.playerStats=[];testLayout.render(testEvent);});
        assert.equal(await page.locator('.sports-odds').innerText(),'Betting Info: Hidden','missing player stats use the prominent default');
        await setContent('game-details');
        assert.equal(await page.locator('.sports-odds').innerText(),'Venue: Example Arena');
        await page.clock.runFor(10001);
        assert.equal(await page.locator('.sports-odds').innerText(),'Broadcast: ESPN');
        await page.evaluate(odds => {
          testEvent.details.odds=odds;
          testEvent.details.playerStats=[{key:'one:points',text:'Alex Example · PTS: 12'},{key:'two:rebounds',text:'Casey Example · REB: 7'}];
        },originalOdds);
        // Both toggles On add the chosen alternate to available odds.
        for (const hasOdds of [true, false]) {
          await page.evaluate(odds => { testEvent.details.odds = odds; }, hasOdds ? originalOdds : null);
          for (const [mode, expected] of [['custom',custom],['player-stats','Example'],['game-details','Example Arena']]) {
            await setContent(mode, {showBettingInfo:true, bettingReplacementText:custom});
            const visible = await page.locator('.sports-odds').innerText();
            assert.ok(visible.includes(expected), `${mode} remains visible with betting On`);
            assert.equal(await page.locator('.sports-odds-ticker').count(), hasOdds ? 1 : 0);
            if (hasOdds) assert.match(visible, /-185.*\+154/s, 'available odds join the chosen alternate');
            else assert.doesNotMatch(visible, /-185|\+154/);
            if (mode === 'custom') assert.doesNotMatch(visible, /Example|Venue:|Broadcast:/, 'only the chosen alternate is added');
            if (mode === 'player-stats') assert.doesNotMatch(visible, /Venue:|Broadcast:/);
            if (mode === 'game-details') assert.doesNotMatch(visible, /PTS:|REB:/);
            await page.clock.runFor(1001);
            assert.equal(await page.locator('.sports-odds').innerText(), visible, 'timer preserves the combination');
          }
          for (const mode of ['blank','custom','hidden']) {
            await setContent(mode, {showBettingInfo:true, bettingReplacementText:''});
            assert.equal(await page.locator('.sports-odds').count(), hasOdds ? 1 : 0, 'empty alternate does not suppress permitted odds');
            if (hasOdds) assert.match(await page.locator('.sports-odds').innerText(), /\+154/);
          }
        }
        await page.evaluate(odds => { testEvent.details.odds = odds; }, originalOdds);
        await setContent('hidden', {showBettingInfo:true,showAlternateContent:false});
        assert.match(await page.locator('.sports-odds').innerText(), /\+154/, 'default selection restores available odds');
        await setContent('scrolling',{showBettingInfo:true,bettingReplacementText:'Cheer for your team!'});
        assert.match(await page.locator('.sports-odds-ticker strong').first().innerText(),/-185.*Example.*PTS/s);
        assert.match(await page.locator('.sports-odds').innerText(),/Example Arena/);
        await page.evaluate(() => {window.originalTicker=document.querySelector('.sports-odds-ticker');window.originalTickerAnimation=originalTicker.getAnimations()[0];});
        await page.clock.runFor(1001);
        assert.ok(await page.evaluate(() => document.querySelector('.sports-odds-ticker')===originalTicker && originalTicker.getAnimations()[0]===originalTickerAnimation),'timer keeps the looping animation intact');
        await setContent('scrolling',{showBettingInfo:false});
        assert.doesNotMatch(await page.locator('.sports-odds').innerText(),/-185|\+154|SPREAD| ML/,'off excludes all betting content from the mix');
        assert.equal(await page.locator('.sports-odds-price, .sports-odds-line, .sports-odds [title]').count(),0);
        assert.ok(await page.locator('#sports-overlay').evaluate(el=>el.scrollWidth<=el.clientWidth),'scrolling mix stays within the banner');
        await page.locator('#sports-overlay').screenshot({path:'/tmp/sportsover-betting-scrolling.png'});
        await page.emulateMedia({reducedMotion:'reduce'});
        assert.equal(await page.locator('.sports-odds-ticker').evaluate(el=>getComputedStyle(el).animationName),'none');
        await page.emulateMedia({reducedMotion:'no-preference'});
        await setContent('hidden', {showAlternateContent:false});
      }

      await page.evaluate(() => {
        const api = window.SportsOverlay;
        api.config.saveConfig({...api.config.loadConfig(),showBettingInfo:true});
        testLayout.render(testEvent);
      });
      assert.match(await page.locator('.sports-odds').innerText(), /\+154/);
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
      await page.clock.fastForward(300001);
      assert.equal(await page.locator('.sports-odds').count(), 0, `${sport}: automatic expiry without refetch`);
      await page.evaluate(() => {
        testEvent.details.odds.moneyline.live.away = -220;
        testLayout.render(testEvent);
      });
      assert.match(await page.locator('.sports-odds').innerText(), /LIVE ML/);
      assert.doesNotMatch(await page.locator('.sports-odds').innerText(), /PRE /);
      await page.clock.fastForward(300001);
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
        competitions: [{ venue: {fullName:'Example Arena'}, status: { type: { state } }, competitors: [
          { homeAway: 'away', score: '0', team: { id: '99991', displayName: 'Away', abbreviation: 'AWY' }, leaders:[{name:'goals',displayName:'Goals',leaders:[{athlete:{id:'99',displayName:'Example Player'},displayValue:'7'}]}] },
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
    await admin.getByText('Rotation source applied', { exact: true }).waitFor();
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
    const selectionBefore = await admin.evaluate(() => {
      const api = window.SportsOverlay;
      const games = [1,14].map((spread,index) => ({...structuredClone(cardGames[1]),id:`spotlight-${index}`,
        competitions:[{...structuredClone(cardGames[1].competitions[0]),odds:[{spread}]}]}));
      window.visibilityCandidates = games.map(game => api.selection.espnCandidate(game,'football'));
      return {chosen:api.selection.chooseSpotlight(visibilityCandidates).id, scores:visibilityCandidates.map(api.selection.interestScore)};
    });
    assert.equal(selectionBefore.chosen,'spotlight-0');
    await admin.getByRole('button',{name:'Settings',exact:true}).click();
    const bettingToggle = admin.getByRole('switch',{name:'Show betting info'});
    assert.equal(await bettingToggle.isChecked(),true);
    await bettingToggle.uncheck();
    await admin.waitForFunction(() => window.SportsOverlay.config.loadConfig().showBettingInfo === false);
    assert.equal(await admin.locator('#betting-info-state').innerText(),'Off');
    const alternateToggle = admin.getByRole('switch',{name:'Show alternate content'});
    assert.equal(await alternateToggle.isChecked(), false, 'alternate content defaults Off');
    assert.equal(await admin.locator('#alternate-content-options').isVisible(), false);
    await alternateToggle.check();
    await admin.waitForFunction(() => SportsOverlay.config.loadConfig().showAlternateContent === true);
    const contentSelector=admin.locator('#betting-replacement');
    assert.equal(await contentSelector.inputValue(),'hidden');
    assert.equal(await contentSelector.locator('option').first().innerText(),'Betting Info: Hidden (default)','hidden remains the first and default choice');
    await contentSelector.selectOption('custom');
    await admin.locator('#betting-replacement-text').fill('Support your team!');
    await admin.waitForFunction(() => SportsOverlay.config.loadConfig().bettingReplacementText === 'Support your team!');
    await admin.waitForFunction(() => document.querySelector('#rotation-queue .sports-odds')?.textContent === 'Support your team!');
    const cardWithoutOdds = admin.locator('#rotation-queue [data-game-key="soccer:900005"] .sports-odds');
    assert.equal(await cardWithoutOdds.innerText(), 'Support your team!', 'custom text appears on cards without odds');
    await contentSelector.selectOption('blank');
    await admin.waitForFunction(() => !document.querySelector('#rotation-queue .sports-odds'));
    await contentSelector.selectOption('player-stats');
    await admin.waitForFunction(() => document.querySelector('#rotation-queue .sports-odds')?.textContent === 'Betting Info: Hidden');
    assert.equal(await cardWithoutOdds.count(), 0, 'player stats do not add content to game-list cards without odds');
    assert.doesNotMatch(await admin.locator('#rotation-queue, #available-games').allTextContents().then(text => text.join(' ')), /Example Player/);
    await bettingToggle.check();
    await admin.waitForFunction(() => SportsOverlay.config.loadConfig().showBettingInfo === true);
    await admin.waitForFunction(() => document.querySelector('#rotation-queue .sports-odds-price'));
    assert.doesNotMatch(await admin.locator('#rotation-queue, #available-games').allTextContents().then(text => text.join(' ')), /Example Player/);
    await bettingToggle.uncheck();
    await admin.waitForFunction(() => SportsOverlay.config.loadConfig().showBettingInfo === false);
    await contentSelector.selectOption('game-details');
    await admin.waitForFunction(() => document.querySelector('#rotation-queue [data-game-key="soccer:900005"] .sports-odds')?.textContent === 'Venue: Example Arena');
    await contentSelector.selectOption('scrolling');
    await admin.waitForFunction(() => document.querySelector('#rotation-queue .sports-odds-ticker'));
    assert.match(await admin.locator('#betting-mix-betting-description').innerText(), /added automatically/);
    assert.doesNotMatch(await admin.locator('#rotation-queue .sports-odds').first().innerText(),/SPREAD| ML/);
    assert.doesNotMatch(await admin.locator('#rotation-queue, #available-games').allTextContents().then(text => text.join(' ')), /Example Player/, 'game-list scrolling mix excludes player stats');
    await admin.locator('[data-betting-source="game-details"]').uncheck();
    await admin.waitForFunction(() => !SportsOverlay.config.loadConfig().bettingMixSources.includes('game-details'));
    await admin.locator('.settings-grid > .field').first().evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 64));
    await admin.locator('.settings-grid > .field').first().screenshot({path:'/tmp/sportsover-betting-content-settings.png'});
    await contentSelector.selectOption('hidden');
    await admin.waitForFunction(() => SportsOverlay.config.loadConfig().bettingReplacement === 'hidden');

    const cardOdds = await admin.locator('#rotation-queue .sports-odds, #available-games .sports-odds').allTextContents();
    assert.ok(cardOdds.length > 0);
    assert.ok(cardOdds.every(text => text === 'Betting Info: Hidden'));
    assert.equal(await admin.locator('.sports-odds-price, .sports-odds-line, .sports-odds [title]').count(),0);
    const hostedDemo = await context.newPage();
    await hostedDemo.clock.resume();
    hostedDemo.on('pageerror',error => errors.push(error.message));
    await hostedDemo.goto('http://overlay.test/sports/index.html?sport=football&demo=pregame');
    await hostedDemo.waitForFunction(() => window.SportsOverlay.engine && document.querySelector('.football-scorebug'));
    await hostedDemo.evaluate(() => {
      const api = window.SportsOverlay;
      window.demoEvent = api.registry.getDemo('football','pregame');
      demoEvent.details.odds = api.model.espnOdds({odds:[{details:'SEA -3.5',spread:3.5,awayTeamOdds:{moneyLine:-185},homeTeamOdds:{moneyLine:154}}]});
      window.demoLayout = api.registry.getLayout('football').createLayout();
      demoLayout.render(demoEvent);
    });
    assert.equal(await hostedDemo.locator('.sports-odds').innerText(),'Betting Info: Hidden','hosted demo follows shared display preference');
    let outputSequence = 0;
    let outputHtml = await hostedDemo.locator('#sports-overlay').evaluate(el => el.outerHTML);
    await context.route('**/api/output**',async route => {
      outputSequence++;
      await route.fulfill({json:{html:outputHtml,sequence:outputSequence,heartbeatSequence:outputSequence,heartbeatAgeMs:0,
        instance:'betting-visibility',ready:true,gameKey:'football:demo',updatedAt:Date.now()}});
    });
    const obs = await context.newPage();
    await obs.clock.resume();
    obs.on('pageerror',error => errors.push(error.message));
    await obs.goto('http://overlay.test/sports/display.html');
    await obs.waitForFunction(() => document.querySelector('.sports-odds')?.textContent === 'Betting Info: Hidden');
    assert.equal(await obs.locator('.sports-odds-price, .sports-odds-line, .sports-odds [title]').count(),0);
    await alternateToggle.uncheck();
    await admin.waitForFunction(() => SportsOverlay.config.loadConfig().showAlternateContent === false);
    await bettingToggle.check();
    await admin.waitForFunction(() => window.SportsOverlay.config.loadConfig().showBettingInfo === true);
    await hostedDemo.waitForFunction(() => document.querySelector('.sports-odds-price') !== null);
    outputHtml = await hostedDemo.locator('#sports-overlay').evaluate(el => el.outerHTML);
    await obs.waitForFunction(() => document.querySelector('.sports-odds-price') !== null);
    await alternateToggle.check();
    await admin.waitForFunction(() => SportsOverlay.config.loadConfig().showAlternateContent === true);
    await contentSelector.selectOption('custom');
    await admin.waitForFunction(() => SportsOverlay.config.loadConfig().bettingReplacement === 'custom');
    assert.equal(await bettingToggle.isChecked(), true, 'choosing alternate content keeps betting On');
    await admin.waitForFunction(() => document.querySelector('#rotation-queue .sports-odds-ticker')?.textContent.includes('Support your team!'));
    await hostedDemo.waitForFunction(() => document.querySelector('.sports-odds-ticker')?.textContent.includes('Support your team!'));
    outputHtml = await hostedDemo.locator('#sports-overlay').evaluate(el => el.outerHTML);
    await obs.waitForFunction(() => document.querySelector('.sports-odds-ticker')?.textContent.includes('Support your team!'));
    assert.match(await obs.locator('.sports-odds').innerText(), /ML.*-185.*\+154.*Support your team!/s, 'OBS combines odds and the chosen alternate');
    assert.deepEqual(await admin.evaluate(() => ({chosen:SportsOverlay.selection.chooseSpotlight(visibilityCandidates).id,
      scores:visibilityCandidates.map(SportsOverlay.selection.interestScore)})),selectionBefore);
    await bettingToggle.uncheck();
    await admin.waitForFunction(() => window.SportsOverlay.config.loadConfig().showBettingInfo === false);
    await contentSelector.selectOption('scrolling');
    await admin.waitForFunction(() => SportsOverlay.config.loadConfig().bettingReplacement === 'scrolling');
    await hostedDemo.waitForFunction(() => document.querySelector('.sports-odds-ticker'));
    outputHtml = await hostedDemo.locator('#sports-overlay').evaluate(el => el.outerHTML);
    await obs.waitForFunction(() => document.querySelector('.sports-odds-ticker'));
    assert.doesNotMatch(await obs.locator('.sports-odds').innerText(), /SPREAD| ML/, 'OBS mix excludes hidden odds');
    await obs.evaluate(() => {
      window.savedTicker = document.querySelector('.sports-odds-ticker');
      window.savedAnimation = savedTicker.getAnimations()[0];
    });
    const displayedSequence = Number(await obs.locator('body').getAttribute('data-sequence'));
    await obs.waitForFunction(sequence => Number(document.body.dataset.sequence) > sequence, displayedSequence);
    assert.ok(await obs.evaluate(() => document.querySelector('.sports-odds-ticker') === savedTicker
      && savedTicker.getAnimations()[0] === savedAnimation), 'OBS refresh preserves the scrolling loop');
    await alternateToggle.uncheck();
    await admin.waitForFunction(() => SportsOverlay.config.loadConfig().showAlternateContent === false);
    await hostedDemo.waitForFunction(() => document.querySelector('.sports-odds')?.textContent === 'Betting Info: Hidden');
    assert.equal(await contentSelector.inputValue(), 'scrolling', 'turning alternate content Off preserves its choice');
    await alternateToggle.check();
    await admin.waitForFunction(() => SportsOverlay.config.loadConfig().showAlternateContent === true);
    await hostedDemo.waitForFunction(() => document.querySelector('.sports-odds-ticker'));
    const restartedAdmin = await context.newPage();
    await restartedAdmin.clock.resume();
    await restartedAdmin.goto('http://overlay.test/sports/admin/');
    await restartedAdmin.waitForFunction(() => window.SportsOverlay.shared?.connected());
    await restartedAdmin.getByRole('button',{name:'Settings',exact:true}).click();
    assert.equal(await restartedAdmin.getByRole('switch',{name:'Show betting info'}).isChecked(),false,'off persists in reopened Settings');
    assert.equal(await restartedAdmin.getByRole('switch',{name:'Show alternate content'}).isChecked(),true,'alternate toggle persists in reopened Settings');
    assert.equal(await restartedAdmin.locator('#betting-replacement').inputValue(),'scrolling','content selection persists in reopened Settings');
    assert.equal(await restartedAdmin.locator('#betting-replacement-text').inputValue(),'Support your team!','custom text persists');
    assert.equal(await restartedAdmin.locator('[data-betting-source="game-details"]').isChecked(),false,'loop sources persist');
    await restartedAdmin.locator('#betting-replacement').selectOption('hidden');
    await restartedAdmin.waitForFunction(() => SportsOverlay.config.loadConfig().bettingReplacement === 'hidden');

    await restartedAdmin.locator('#settings-panel .settings-grid').screenshot({path:'/tmp/sportsover-betting-toggle.png'});
    await restartedAdmin.getByRole('switch',{name:'Show alternate content'}).uncheck();
    await restartedAdmin.waitForFunction(() => SportsOverlay.config.loadConfig().showAlternateContent === false);
    await restartedAdmin.getByRole('switch',{name:'Show betting info'}).check();
    await admin.waitForFunction(() => window.SportsOverlay.config.loadConfig().showBettingInfo === true);
    await restartedAdmin.close();
    await admin.getByRole('button',{name:'Live control',exact:true}).click();
    await obs.close();
    await hostedDemo.close();
    await context.unroute('**/api/output**');
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
    await admin.clock.fastForward(300001);
    assert.match(await admin.locator('#available-games [data-game-key="hockey:900001"] .sports-odds').innerText(), /^LIVE ML\s+AWY \+120$/);
    // Exercise the real card layouts with short and long rotating content.
    for (const width of [1280, 390]) {
      await admin.setViewportSize({width, height:844});
      await admin.evaluate(() => {
        const api = SportsOverlay;
        window.listDetailLong = `Venue: ${'A long venue name with additional location information '.repeat(5)}`;
        window.listDetailEvents = [...document.querySelectorAll('.game-copy')].map((mount, index) => {
          const event = {id:`layout-${index}`,sport:'football',state:'pregame',teams:{away:{},home:{}},
            details:{gameDetails:['Broadcast: ABC',listDetailLong]}};
          api.odds.render(mount,event,()=>[],()=>({showBettingInfo:false,showAlternateContent:true,bettingReplacement:'game-details'}));
          return {mount,event};
        });
        for (const list of document.querySelectorAll('.game-list')) list.scrollTop = 100;
      });
      const geometry = () => admin.locator('#rotation-queue, #available-games').evaluateAll(lists => lists.map(list => ({
        scrollTop:list.scrollTop, scrollHeight:list.scrollHeight, width:list.clientWidth,
        cards:[...list.querySelectorAll('.game-card')].map(card => ({
          height:card.getBoundingClientRect().height,
          top:card.getBoundingClientRect().top-list.getBoundingClientRect().top,
        })),
      })));
      const before = await geometry();
      await admin.clock.runFor(10001);
      assert.ok(await admin.locator('.game-copy .sports-odds > strong').evaluateAll(rows => rows.every(row => row.textContent.startsWith('Venue:'))), 'details actually rotate to long text');
      assert.deepEqual(await geometry(), before, `both game lists remain stationary at ${width}px`);
      assert.equal(await admin.locator('.game-copy .sports-odds > strong').first().getAttribute('title'), await admin.evaluate(() => listDetailLong));
      await admin.evaluate(() => {
        for (const {mount,event} of listDetailEvents) SportsOverlay.odds.render(mount,event,()=>[],()=>({
          showBettingInfo:false,showAlternateContent:true,bettingReplacement:'scrolling',bettingMixSources:['game-details']}));
      });
      assert.deepEqual(await geometry(), before, `long scrolling mix also stays in the same row at ${width}px`);
      assert.ok(await admin.locator('#rotation-queue, #available-games').evaluateAll(lists => lists.every(list => list.scrollWidth <= list.clientWidth)), 'mix cannot widen game lists');
      await admin.emulateMedia({reducedMotion:'reduce'});
      assert.deepEqual(await geometry(), before, 'reduced-motion mix preserves card geometry');
      assert.ok(await admin.locator('.game-copy .sports-odds-scrolling').first().evaluate(el => {
        el.scrollLeft = 100;
        return getComputedStyle(el).overflowX === 'auto' && el.scrollLeft > 0;
      }), 'reduced-motion text remains manually scrollable');
      await admin.emulateMedia({reducedMotion:'no-preference'});
    }
    await admin.close();
    assert.deepEqual(errors, []);
    console.log('Odds browser checks passed: all six ESPN sports, balanced moneylines, close point spreads, neutral spread payouts, game cards, replacement choices, safe custom text, rotating stats, mixed scrolling, saved preferences, unchanged selection, demo/OBS output, narrow layouts, live markets, and expiry.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
