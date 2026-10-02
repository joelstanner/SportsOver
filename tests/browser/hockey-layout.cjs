// NHL's optional rows must fit the same 472x100 frame as desktop and OBS output.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
  try {
    const context = await browser.newContext({viewport:{width:472,height:100}});
    const errors = [];
    let frame = null;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="27" height="27"><circle cx="13" cy="13" r="12" fill="white"/></svg>'});
      if (url.pathname === '/api/output') return route.fulfill({json:frame});
      const file = url.pathname.slice(1) || 'index.html';
      try { await route.fulfill({body:await fs.readFile(path.join(root,file)),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]}); }
      catch (_) { await route.fulfill({status:404,body:''}); }
    });
    const engine = await context.newPage();
    engine.on('pageerror', error => errors.push(error.message));
    await engine.clock.install();
    await engine.goto('http://overlay.test/index.html?sport=hockey&demo=live');
    await engine.clock.pauseAt(new Date(Date.now()+1000));
    await engine.waitForFunction(()=>window.SportsOverlay?.hockeyLayout);
    async function assertFits(page, label, scale = 1) {
      const geometry = await page.locator('#sports-overlay').evaluate(mount => {
        const rect = mount.getBoundingClientRect();
        return {bottom:rect.bottom,height:rect.height,width:rect.width,viewportHeight:innerHeight,
          rows:[...mount.children].filter(row=>!row.hidden).map(row=>({name:row.className,bottom:row.getBoundingClientRect().bottom,right:row.getBoundingClientRect().right,scrollWidth:row.scrollWidth,clientWidth:row.clientWidth})),
          right:rect.right};
      });
      assert.ok(geometry.height <= 88*scale+0.5, `${label}: banner height ${geometry.height} exceeds ${88*scale}; ${JSON.stringify(geometry)}`);
      assert.ok(geometry.bottom <= geometry.viewportHeight-6*scale+0.5, `${label}: footer clipped by viewport`);
      assert.ok(Math.abs(geometry.width-460*scale)<0.5, `${label}: banner width`);
      for (const row of geometry.rows) {
        assert.ok(row.bottom<=geometry.bottom+0.5, `${label}: ${row.name} outside banner`);
        if (!row.name.includes('last-play')) assert.ok(row.scrollWidth<=row.clientWidth+1,`${label}: ${row.name} overflows horizontally`);
      }
    }
    // Put the reported power-play + live-odds state first to reproduce the bug.
    for (const preseason of [false,true]) for (const powerPlay of [true,false]) for (const lastPlay of [false,true]) for (const odds of ['live','mixed','none']) {
      const label = JSON.stringify({preseason,powerPlay,lastPlay,odds});
      await engine.evaluate(({preseason,powerPlay,lastPlay,odds})=>{
        const api=window.SportsOverlay;
        window.testLayout=api.hockeyLayout.createLayout();
        window.testEvent=api.registry.getDemo('hockey','live');
        testEvent.startTime=new Date().toISOString();
        Object.assign(testEvent.details,{preseason,powerPlayActive:powerPlay,lastPlay:lastPlay ? 'A long play description that should scroll while keeping the complete odds footer visible.' : ''});
        if(odds!=='none') testEvent.details.odds={
          spread:{pregame:odds==='mixed'?{away:-1.5,home:1.5}:{},live:odds==='mixed'?{away:-2.5}:{away:-1.5,home:1.5},prices:{pregame:{away:-120,home:121},live:{away:120,home:-121}}},
          moneyline:{pregame:odds==='mixed'?{away:-185,home:154}:{},live:odds==='mixed'?{home:220}:{away:-120,home:-110}},
        };
        testLayout.render(testEvent);
      },{preseason,powerPlay,lastPlay,odds});
      await engine.clock.runFor(20);
      await assertFits(engine,label);
      if(odds!=='none') assert.equal(await engine.locator('.sports-odds').count(),1);
      assert.equal(await engine.locator('#hockey-advantage').isVisible(),powerPlay);
      if (preseason) {
        const marker = await engine.locator(powerPlay ? '#hockey-advantage' : '#sports-overlay')
          .evaluate(el=>({content:getComputedStyle(el,'::before').content,display:getComputedStyle(el,'::before').display}));
        assert.match(marker.content,/PRESEASON/);
        assert.notEqual(marker.display,'none',`${label}: preseason marker remains visible`);
        assert.match(await engine.locator('#sports-overlay').getAttribute('aria-label'),/preseason/);
      }
    }
    // The passive display must fit too; it receives only the engine's HTML.
    frame={instance:'hockey-layout',sequence:1,ready:true,gameKey:'hockey:test',html:await engine.locator('#sports-overlay').evaluate(mount=>{
      window.testEvent.details.preseason=true;
      window.testEvent.details.powerPlayActive=true;
      window.testEvent.details.odds={spread:{live:{away:-1.5,home:1.5}},moneyline:{live:{away:-120,home:-110}}};
      window.testLayout.render(window.testEvent);
      return mount.outerHTML;
    })};
    const display=await context.newPage();
    // The desktop preload exposes this API; enable the real resize/zoom path
    // without launching another sports engine in this passive browser fixture.
    await display.addInitScript(()=>{window.sportsDesktop={action:async()=>({})};});
    display.on('pageerror',error=>errors.push(error.message));
    for (const scale of [0.5,1,2,3]) {
      await display.setViewportSize({width:472*scale,height:100*scale});
      await display.goto('http://overlay.test/display.html?desktop');
      await display.locator('.hockey-scorebug .sports-odds').waitFor();
      await assertFits(display,`passive display ${scale}x`,scale);
      assert.match(await display.locator('.sports-odds').innerText(),/LIVE PUCK LINE.*LIVE ML/s);
      if(scale===2) await display.screenshot({path:'/private/tmp/sportsover-hockey-fixed-200.png'});
    }
    for (const state of ['pregame','interrupted','final']) {
      await engine.evaluate(state=>{testEvent.state=state;testLayout.render(testEvent)},state);
      await assertFits(engine,state);
      assert.equal(await engine.locator('#hockey-advantage').isHidden(),true);
    }
    assert.deepEqual(errors,[]);
    console.log('NHL frame checks passed: power plays, last plays, live/mixed odds, preseason, state changes, and passive output at 50–300%.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
