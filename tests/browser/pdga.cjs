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
(async () => {
  const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
  try {
    const context = await browser.newContext({viewport:{width:1120,height:850}});
    let offline = false;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'www.pdga.com') return route.fulfill({status:offline ? 503 : 200,json:{data:url.pathname.endsWith('fetch_event') ? metadata : scores}});
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
    await page.locator('#rotation-queue .lock-game').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).lockedGameKeys.includes('disc-golf:86076:MPO'));
    const banner = await context.newPage(); banner.on('pageerror',e=>errors.push(e.message));
    await banner.goto('http://overlay.test/index.html?sport=disc-golf');
    await banner.locator('.pdga-focus').waitFor();
    assert.match(await banner.locator('.pdga-focus').innerText(),/Kevin Jones/);
    assert.match(await banner.locator('.pdga-state').innerText(),/R3.*FINAL/);
    const box = await banner.locator('#sports-overlay').boundingBox();
    assert.equal(box.width,460); assert.equal(box.height,88); assert.ok(box.y+box.height<=100);
    await banner.evaluate(()=>document.body.style.zoom='2');
    assert.equal((await banner.locator('#sports-overlay').boundingBox()).width,920);
    await banner.screenshot({path:'/tmp/sportsover-pdga-integrated.png'});
    // Failure must retain scores, with an explicit stale label.
    offline = true;
    await banner.waitForFunction(()=>document.querySelector('#sports-overlay')?.dataset.stale==='true',{},{timeout:15000});
    assert.match(await banner.locator('.pdga-focus').innerText(),/Kevin Jones/);
    assert.match(await banner.locator('.pdga-footer').innerText(),/STALE/);
    offline = false;
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
    console.log('PDGA browser flow passed: watch, select player, save/reload, queue lock, 200%, stale data, team layout, disable.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
