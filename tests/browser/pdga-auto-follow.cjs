// Run with Chrome, or SPORTSOVER_TEST_EXECUTABLE for the packaged desktop engine.
const { chromium, _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
require('../../core/config.js');
const root = path.resolve(__dirname,'../..');
const config = global.SportsOverlay.config.normalizeConfig();
config.sports.forEach(group=>{group.enabled=group.sport==='disc-golf';});
config.providerRefreshSeconds['disc-golf']={live:5,pregame:5,idle:5,final:5};
const day = new Date().toISOString().slice(0,10);
const directory=[{tournId:96419,tier:'ES',eventType:'E',officialName:'Pro Tour Test',startDate:day,endDate:day}];
const metadata={Name:'Pro Tour Test',ScoringFormat:'S',FinalRound:3,LatestRound:1,Divisions:[{Division:'MPO',LatestRound:1},{Division:'FPO',LatestRound:1}]};
const finalsTest=process.env.PDGA_FINALS_TEST==='1';
const round={scores:[{Name:'Tour Player',PDGANum:123,Round:1,RoundStarted:1,Played:5,Completed:0,RunningPlace:1,ToPar:-3}]};
if(finalsTest){
  metadata.Divisions.forEach(division=>{division.LatestRound=3;});
  Object.assign(round.scores[0],{Round:3,Played:18,Completed:1});
}
(async()=>{
  let metadataOffline=false;
  let application,browser,page,banner,engine,counts={directory:0};
  const errors=[];
  const desktop=Boolean(process.env.SPORTSOVER_TEST_EXECUTABLE);
  try {
    if(desktop){
      const data=await fs.mkdtemp(path.join(os.tmpdir(),'sportsover-auto-tour-'));
      await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,config,desktop:{visible:false}}));
      application=await electron.launch({executablePath:process.env.SPORTSOVER_TEST_EXECUTABLE,args:[],env:{...process.env,SPORTSOVER_TEST_DATA:data}});
      await application.firstWindow();
      for(let i=0;i<100;i++){
        page=application.windows().find(p=>p.url().includes('/admin/'));
        banner=application.windows().find(p=>p.url().includes('display.html?desktop'));
        engine=application.windows().find(p=>p.url().includes('engine=1'));
        if(page&&banner&&engine)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      await application.evaluate(async({session},{directory,metadata,round})=>{
        global.pdgaDirectoryCalls=0;global.pdgaMetadataOffline=false;
        await session.defaultSession.protocol.handle('https',request=>{
          const isDirectory=request.url.includes('current-events');
          if(global.pdgaMetadataOffline && request.url.includes('fetch_event'))return new Response('{}',{status:503});
          if(isDirectory)global.pdgaDirectoryCalls++;
          return new Response(JSON.stringify(isDirectory?directory:{data:request.url.includes('fetch_event')?metadata:round}),{headers:{'Content-Type':'application/json'}});
        });
      },{directory,metadata,round});
    } else {
      browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
      const context=await browser.newContext({viewport:{width:1120,height:850}});
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.hostname==='www.pdga.com'){
          if(metadataOffline && url.pathname.endsWith('fetch_event'))return route.fulfill({status:503,json:{}});
          const isDirectory=url.pathname.includes('current-events');if(isDirectory && !route.request().frame().parentFrame())counts.directory++;
          return route.fulfill({json:isDirectory?directory:{data:url.pathname.endsWith('fetch_event')?metadata:round}});
        }
        if(url.hostname!=='overlay.test')return route.fulfill({json:{events:[],dates:[]}});
        const file=url.pathname==='/admin/'?'admin/index.html':url.pathname.slice(1);
        try{return route.fulfill({body:await fs.readFile(path.join(root,file)),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]});}
        catch{return route.fulfill({status:404,body:''});}
      });
      page=await context.newPage();await page.goto('http://overlay.test/admin/');
      await page.evaluate(config=>localStorage.setItem('sports-overlay.config.v1',JSON.stringify(config)),config);await page.reload();
    }
    page.on('pageerror',error=>errors.push(error.message));
    if(banner)banner.on('pageerror',error=>errors.push(error.message));
    const sport=page.locator('[data-sport="disc-golf"]');
    assert.equal(await sport.locator('.pdga-auto-follow').isChecked(),false);
    assert.equal(await sport.locator('.pdga-auto-division:checked').count(),2);
    await sport.locator('.pdga-auto-follow').check();
    await page.waitForFunction(()=>window.SportsOverlay.config.loadConfig().sports.find(s=>s.sport==='disc-golf').autoFollow);
    await page.getByRole('button',{name:'Live control',exact:true}).click();
    if(finalsTest){
      await page.locator('#available-sport-filter').selectOption('disc-golf');
      const available=page.locator('#available-games [data-game-key^="disc-golf:"]');
      await page.waitForFunction(()=>document.querySelectorAll('#available-games [data-game-key^="disc-golf:"]').length===2);
      assert.equal(await page.locator('#rotation-queue [data-game-key^="disc-golf:"]').count(),0);
      if(desktop)await application.evaluate(()=>{global.pdgaMetadataOffline=true;});
      else metadataOffline=true;
      await new Promise(resolve=>setTimeout(resolve,5100));
      await page.locator('#refresh-games').click();
      await page.waitForFunction(()=>[...document.querySelectorAll('#available-games .game-meta')].filter(item=>item.textContent.includes('Last received')).length===2);
      for(let i=0;i<3;i++){
        await new Promise(resolve=>setTimeout(resolve,2100));
        assert.equal(await available.count(),2,'finished divisions remain offered throughout failed refreshes');
      }
      if(desktop){
        assert.match(await page.locator('#rotation-status').innerText(),/unavailable/);
        await application.evaluate(()=>{global.pdgaMetadataOffline=false;});
      }else metadataOffline=false;
      await new Promise(resolve=>setTimeout(resolve,5100));
      await page.locator('#refresh-games').click();
      await page.waitForFunction(()=>document.querySelectorAll('#available-games .game-meta').length===2
        && [...document.querySelectorAll('#available-games .game-meta')].every(item=>!item.textContent.includes('Last received')));
      assert.equal(await available.count(),2);
      assert.deepEqual(errors,[]);
      console.log(`PDGA available finals ${desktop?'packaged desktop':'browser'} regression passed: stable entries through metadata outage and recovery.`);
      return;
    }
    await page.waitForFunction(()=>document.querySelectorAll('#rotation-queue [data-game-key^="disc-golf:"]').length===2);
    assert.match(await page.locator('#rotation-queue').innerText(),/Automatic/);
    await page.locator('#rotation-queue').screenshot({path:desktop?'/tmp/sportsover-auto-queue-desktop.png':'/tmp/sportsover-auto-queue-browser.png'});
    if(desktop){
      await banner.locator('.pdga-entry').first().waitFor();
      const status=await page.evaluate(()=>window.sportsDesktop.status());
      const frame=await(await fetch(status.obsUrl.replace('/output','/api/output'))).json();
      assert.match(frame.html,/Tour Player/);
      assert.match(frame.gameKey,/disc-golf:96419:/);
    }
    const fpo=page.locator('#rotation-queue [data-game-key="disc-golf:96419:FPO"]');
    await fpo.getByRole('button',{name:'Exclude',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#rotation-queue [data-game-key="disc-golf:96419:FPO"]'));
    await page.locator('#available-games [data-game-key="disc-golf:96419:FPO"] .add-game').click();
    await fpo.waitFor();
    await page.locator('#live-mode').click();
    await page.waitForFunction(()=>document.querySelector('#live-mode').getAttribute('aria-pressed')==='true');
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await sport.locator('.pdga-auto-division[value="FPO"]').uncheck();
    await page.waitForFunction(()=>!document.querySelector('#rotation-queue [data-game-key="disc-golf:96419:FPO"]'));
    await page.getByRole('button',{name:'Live control',exact:true}).click();
    await page.locator('#rotation-queue .pdga-watch-automatic').click();
    await page.waitForFunction(()=>window.SportsOverlay.config.loadConfig().sports.find(s=>s.sport==='disc-golf').events.length===1);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await sport.locator('.pdga-view').selectOption('player');
    await sport.locator('.pdga-player').selectOption('123');
    await page.waitForFunction(()=>window.SportsOverlay.config.loadConfig().sports.find(s=>s.sport==='disc-golf').events[0].playerId==='123');
    await sport.locator('.pdga-auto-follow').uncheck();
    await page.waitForFunction(()=>!window.SportsOverlay.config.loadConfig().sports.find(s=>s.sport==='disc-golf').autoFollow);
    await page.getByRole('button',{name:'Live control',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#rotation-queue [data-game-key^="disc-golf:"]').length===1);
    if(desktop){
      await banner.locator('.pdga-focus').waitFor();
      assert.equal(await application.evaluate(()=>global.pdgaDirectoryCalls),1,'Settings and OBS do not poll the directory');
    }else assert.equal(counts.directory,1);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await sport.locator('.pdga-remove').click();
    await page.waitForFunction(()=>document.querySelectorAll('#rotation-queue [data-game-key^="disc-golf:"]').length===0);
    if(desktop)await banner.waitForFunction(()=>!document.querySelector('.pdga-entry,.pdga-focus'));
    await page.screenshot({path:desktop?'/tmp/sportsover-auto-desktop.png':'/tmp/sportsover-auto-browser.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(`PDGA automatic ${desktop?'packaged desktop + OBS':'browser'} flow passed: enable, MPO/FPO, exclude/restore, Live mode, manual player preference, disable, shared directory cadence.`);
  } finally {if(application)await application.close();if(browser)await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
