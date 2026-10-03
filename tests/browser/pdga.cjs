// Settings -> persistence -> individual field -> existing rotation -> stale output.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
require('../../core/config.js');
const config = global.SportsOverlay.config.normalizeConfig();
config.sports.forEach(group => { group.enabled = group.sport === 'disc-golf'; });
config.providerRefreshSeconds['disc-golf'] = {live:5,pregame:5,idle:5,final:5};
const root = path.resolve(__dirname,'../..');
const metadata = require('../sports/disc-golf/event.json');
const scores = require('../sports/disc-golf/round.json');
const directory = [{tournId:86076,officialName:'Disc Golf Championship with a very long tournament name and presenting sponsor at the regional championship course',startDate:'2026-10-02'}];
(async () => {
  const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
  try {
    const context = await browser.newContext({viewport:{width:1120,height:850}});
    let offline = false, upcoming = false;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'www.pdga.com' && url.pathname.includes('current-events')) return route.fulfill({json:directory});
      if (url.hostname === 'www.pdga.com') return route.fulfill({status:offline ? 503 : 200,json:{data:url.pathname.endsWith('fetch_event')
        ? upcoming ? {...metadata,LatestRound:1,HighestCompletedRound:0,Divisions:[{Division:'MPO',LatestRound:1}]} : metadata
        : upcoming ? {scores:[{Name:'Kevin Jones',PDGANum:41760,Round:1,TeeTime:'09:00'}]} : scores}});
      if (url.hostname !== 'overlay.test') return route.fulfill({json:{events:[],dates:[]}});
      const file = url.pathname === '/admin/' ? 'admin/index.html' : url.pathname.slice(1);
      try { return route.fulfill({body:await fs.readFile(path.join(root,file)),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]}); }
      catch { return route.fulfill({status:404,body:''}); }
    });
    const page = await context.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://overlay.test/admin/');
    await page.evaluate(config=>localStorage.setItem('sports-overlay.config.v1',JSON.stringify(config)),config);
    await page.reload();
    const sport = page.locator('.sport-card[data-sport="disc-golf"]');
    await sport.getByRole('button',{name:'Browse current events',exact:true}).click();
    await sport.locator('.pdga-current').waitFor({state:'visible'});
    for (const width of [1120,760,480,320]) {
      await page.setViewportSize({width,height:850});
      const overflow = await sport.evaluate(card => [card, ...card.querySelectorAll('.sport-favorites, .pdga-watch-card, .pdga-watch-builder, .field')]
        .filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1)
        .map(el => ({className:el.className,width:el.clientWidth,scrollWidth:el.scrollWidth})));
      assert.deepEqual(overflow,[],`Disc golf settings overflow at ${width}px`);
    }
    await page.setViewportSize({width:1120,height:850});
    await sport.locator('.pdga-current').selectOption('86076');
    await sport.locator('.pdga-division').waitFor({state:'visible'});
    assert.equal(await sport.locator('.pdga-tournament-input').inputValue(),'86076');
    await sport.locator('.pdga-tournament-input').fill('https://www.pdga.com/tour/event/86076');
    await sport.getByRole('button',{name:'Load tournament',exact:true}).click();
    await sport.locator('.pdga-division').selectOption('MPO');
    await sport.getByRole('button',{name:'Watch division',exact:true}).click();
    await sport.locator('.pdga-view').selectOption('player');
    await sport.locator('.pdga-player').selectOption('41760');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).sports.find(s=>s.sport==='disc-golf').events[0]?.playerId==='41760');
    await page.reload();
    assert.equal(await sport.locator('.pdga-view').inputValue(),'player');
    assert.equal(await sport.locator('.pdga-player').inputValue(),'41760');
    await page.getByRole('button',{name:'Live control'}).click();
    await page.locator('#rotation-queue [data-game-key="disc-golf:86076:MPO"]').waitFor();
    const rotationName = page.locator('#rotation-queue [data-game-key="disc-golf:86076:MPO"] .game-name');
    await rotationName.evaluate(el=>el.style.width='150px');
    await rotationName.hover();
    assert.equal(await rotationName.getAttribute('title'), metadata.Name);
    await page.mouse.move(0,0);
    await rotationName.evaluate(el=>el.style.width='max-content');
    await rotationName.hover();
    assert.equal(await rotationName.getAttribute('title'), null);
    await rotationName.evaluate(el=>el.style.removeProperty('width'));
    await page.locator('#rotation-queue .lock-game').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).lockedGameKeys.includes('disc-golf:86076:MPO'));
    const banner = await context.newPage(); banner.on('pageerror',e=>errors.push(e.message));
    await banner.goto('http://overlay.test/index.html?sport=disc-golf');
    await banner.locator('.pdga-focus').waitFor();
    assert.match(await banner.locator('.pdga-focus').innerText(),/Kevin Jones/);
    assert.match(await banner.locator('.pdga-state').innerText(),/R3.*FINAL/);
    assert.equal(await banner.locator('.pdga-event').getAttribute('title'), metadata.SimpleName);
    const box = await banner.locator('#sports-overlay').boundingBox();
    assert.equal(box.width,460); assert.equal(box.height,88); assert.ok(box.y+box.height<=100);
    await banner.evaluate(()=>document.body.style.zoom='2');
    assert.equal((await banner.locator('#sports-overlay').boundingBox()).width,920);
    await banner.screenshot({path:'/tmp/sportsover-pdga-integrated.png'});
    // Failure must retain scores, with an explicit stale label.
    offline = true;
    await banner.waitForFunction(()=>document.querySelector('#sports-overlay')?.dataset.stale==='true',{},{timeout:15000});
    assert.match(await banner.locator('.pdga-focus').innerText(),/Kevin Jones/);
    assert.match(await banner.locator('.pdga-footer').innerText(),/Last received scores/);
    assert.doesNotMatch(await banner.locator('.pdga-footer').innerText(),/retrying/);
    offline = false;
    upcoming = true;
    await banner.reload();
    await banner.locator('.pdga-scorebug[data-state="pregame"]').waitFor();
    offline = true;
    // Wait for a scheduled refresh failure, then check the actual error
    // rendering path too: neither should turn an upcoming field stale.
    await banner.waitForResponse(response=>response.url().includes('www.pdga.com') && response.status()===503);
    await banner.waitForFunction(()=>document.querySelector('#sports-overlay')?.dataset.stale==='false');
    await banner.evaluate(metadata=>{
      const api = window.SportsOverlay;
      const layout = api.registry.getLayout('disc-golf').createLayout(document);
      layout.render(api.pdga.normalizeEvent(metadata,{scores:[],roundNumber:1},
        {tournamentId:'86076',division:'MPO',view:'leaderboard'}));
      layout.handleError('Simulated upcoming failure',new Error('offline'));
    },metadata);
    assert.equal(await banner.locator('#sports-overlay').getAttribute('data-stale'),'false');
    assert.match(await banner.locator('.pdga-state').innerText(),/UPCOMING/);
    assert.doesNotMatch(await banner.locator('.pdga-footer').innerText(),/STALE|retrying/);
    assert.doesNotMatch(await banner.locator('#sports-overlay').getAttribute('aria-label'),/stale/);
    offline = false;
    // A pregame leaderboard shows the best-rated entrants, without inventing
    // tournament positions.
    await banner.evaluate(metadata=>{
      const api = window.SportsOverlay;
      const event = api.pdga.normalizeEvent(metadata,{roundNumber:1,scores:[
        {Name:'Alphabetical first',Rating:1000,Round:1},
        {Name:'Unrated entrant',Round:1},
        {Name:'Top rated entrant',Rating:1050,Round:1},
      ]},{tournamentId:'86076',division:'MPO',view:'leaderboard'});
      api.registry.getLayout('disc-golf').createLayout().render(event);
    },metadata);
    assert.deepEqual(await banner.locator('.pdga-entry .pdga-name').allTextContents(), ['Top rated entrant','Alphabetical first','Unrated entrant']);
    assert.deepEqual(await banner.locator('.pdga-entry .pdga-total').allTextContents(), ['1050','1000','—']);
    assert.deepEqual(await banner.locator('.pdga-entry .pdga-place').allTextContents(), ['—','—','—']);
    assert.match(await banner.locator('.pdga-labels').innerText(), /RATING/);
    assert.match(await banner.locator('.pdga-footer').innerText(), /By PDGA rating/);
    await banner.screenshot({path:'/tmp/sportsover-pdga-ratings.png'});
    // A next-round DNF must not make waiting players live, and its footer
    // must not incorrectly claim that the unplayed round is complete.
    await banner.evaluate(metadata=>{
      const api = window.SportsOverlay;
      const event = api.pdga.normalizeEvent(metadata,{roundNumber:2,scores:[
        {Name:'Waiting player',PDGANum:41760,Round:2,RoundStarted:0,HasRoundScore:0,Played:null,Completed:0,ToPar:-10,RunningPlace:1,TeeTime:'15:00:00'},
        {Name:'DNF player',Round:2,RoundStarted:0,HasRoundScore:0,Played:18,Completed:1,RoundScore:'999'},
      ]},{tournamentId:'86076',division:'MPO',view:'player',playerId:'41760'});
      api.registry.getLayout('disc-golf').createLayout().render(event);
    },metadata);
    assert.match(await banner.locator('.pdga-state').innerText(),/R2.*BREAK/);
    assert.match(await banner.locator('.pdga-footer').innerText(),/Awaiting round 2/);
    assert.doesNotMatch(await banner.locator('.pdga-footer').innerText(),/complete/);
    // Existing layouts still activate after an individual event.
    await banner.goto('http://overlay.test/index.html?sport=basketball&demo=live');
    await banner.locator('.basketball-scorebug[data-state="live"]').waitFor();
    await banner.evaluate(() => {
      const config = JSON.parse(localStorage.getItem('sports-overlay.config.v1'));
      config.sports.forEach(group => { group.enabled = ['basketball','disc-golf'].includes(group.sport); });
      localStorage.setItem('sports-overlay.config.v1',JSON.stringify(config));
    });
    await banner.goto('http://overlay.test/index.html?scenario=rotation');
    await banner.locator('.basketball-scorebug[data-state="live"]').waitFor();
    await banner.locator('.pdga-scorebug[data-state="live"]').waitFor();
    await banner.locator('.basketball-scorebug[data-state="live"]').waitFor();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await sport.locator('.sport-enabled').uncheck();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).sports.find(s=>s.sport==='disc-golf').enabled===false);
    const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).sports.find(s=>s.sport==='disc-golf'));
    assert.equal(saved.events[0].playerId,'41760');
    assert.deepEqual(errors,[]);
    console.log('PDGA browser flow passed: browse events, responsive settings, watch, select player, save/reload, queue lock, 200%, stale data, team layout, disable.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
