// Shared recurring discovery and saved automatic watch list, using fixture feeds.
const { chromium }=require('playwright');
const { electron } = require('../../scripts/test-mode.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
require('../../core/config.js');
const root=path.resolve(__dirname,'../..'),config=global.SportsOverlay.config.normalizeConfig();
config.sports.forEach(g=>g.enabled=['chess','disc-golf'].includes(g.sport));config.sports.find(g=>g.sport==='disc-golf').autoFollow=true;
for(const sport of ['chess','disc-golf'])config.providerRefreshSeconds[sport]={live:5,pregame:5,idle:5,final:5};
const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
const tours=[{id:'Best0001',name:'Elite Masters',tier:5,dates:[now-1000,now+86400000]},{id:'Norm0001',name:'Local Open',tier:3,dates:[now-1000,now+86400000]}];
const metadata={tour:tours[0],rounds:[{id:'Round001',name:'Round 1',ongoing:true,startsAt:now-1000}],defaultRoundId:'Round001'};
const round={tour:tours[0],round:metadata.rounds[0],games:[{id:'Game0001',players:[{name:'Elite Player',fideId:123,clock:123000},{name:'Opponent',clock:145000}],lastMove:'e2e4',fen:'8/8/8/8/8/8/8/8 b - - 0 12',status:'*'}]};
const pdgaDirectory=[{tournId:96419,tier:'ES',eventType:'S',officialName:'Pro Tour Test',startDate:day,endDate:day},{tournId:12345,tier:'A',eventType:'S',officialName:'Amateur Test',startDate:day,endDate:day}];
const pdgaMetadata={Name:'Pro Tour Test',ScoringFormat:'S',FinalRound:3,Divisions:[{Division:'MPO',LatestRound:1},{Division:'FPO',LatestRound:1}]};
const pdgaRound={scores:[{Name:'Tour Player',PDGANum:123,Round:1,RoundStarted:1,Played:5,Completed:0,RunningPlace:1,ToPar:-3}]};
(async()=>{
 let browser,application,page,engine,banner;const desktop=process.env.ELITE_DESKTOP==='1',errors=[];
 try{
  if(desktop){
   const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sportsover-elite-'));
   await fs.writeFile(path.join(directory,'settings.json'),JSON.stringify({version:1,config,desktop:{visible:false}}));
   application=await electron.launch({args:[root],env:{...process.env,SPORTSOVER_TEST_DATA:directory}});await application.firstWindow();
   await application.evaluate(async({session},fixtures)=>{
    globalThis.eliteFixtures=fixtures;globalThis.eliteCounts={chess:0,pdga:0};
    await session.defaultSession.protocol.handle('https',request=>{
     const url=new URL(request.url),f=globalThis.eliteFixtures;let value={events:[],dates:[]};
     if(url.hostname==='lichess.org'){if(url.pathname.endsWith('/top')){globalThis.eliteCounts.chess++;value={active:f.tours.map(tour=>({tour}))};}else value=url.pathname.includes('/-/-/')?f.round:f.metadata;}
     if(url.hostname==='www.pdga.com'){if(url.pathname.includes('current-events')){globalThis.eliteCounts.pdga++;value=f.pdgaDirectory;}else value={data:url.pathname.endsWith('fetch_event')?f.pdgaMetadata:f.pdgaRound};}
     return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
    });
   },{tours,metadata,round,pdgaDirectory,pdgaMetadata,pdgaRound});
   for(let i=0;i<100;i++){page=application.windows().find(p=>p.url().includes('/admin/'));engine=application.windows().find(p=>p.url().includes('engine=1'));banner=application.windows().find(p=>p.url().includes('display.html?desktop'));if(page&&engine&&banner)break;await new Promise(resolve=>setTimeout(resolve,100));}
   await engine.reload();
  }else{
   browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});const context=await browser.newContext({viewport:{width:1200,height:900}});
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='lichess.org')return route.fulfill({json:url.pathname.endsWith('/top')?{active:tours.map(tour=>({tour}))}:url.pathname.includes('/-/-/')?round:metadata});
    if(url.hostname==='www.pdga.com')return route.fulfill({json:url.pathname.includes('current-events')?pdgaDirectory:{data:url.pathname.endsWith('fetch_event')?pdgaMetadata:pdgaRound}});
    if(url.hostname!=='overlay.test')return route.fulfill({json:{events:[],dates:[]}});
    const file=url.pathname==='/admin/'?'admin/index.html':url.pathname.slice(1);
    try{return route.fulfill({body:await fs.readFile(path.join(root,file)),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]});}catch{return route.fulfill({status:404,body:''});}
   });
   page=await context.newPage();await page.goto('http://overlay.test/admin/');await page.evaluate(config=>localStorage.setItem('sports-overlay.config.v1',JSON.stringify(config)),config);await page.reload();
   await page.getByRole('button',{name:'Live control',exact:true}).click();await page.locator('#rotation-queue [data-game-key="chess:Best0001:auto"]').waitFor();await page.getByRole('button',{name:'Settings',exact:true}).click();
  }
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>window.SportsOverlay.config.loadConfig().automaticWatchLists.chess.length===1&&window.SportsOverlay.config.loadConfig().automaticWatchLists['disc-golf'].length===2);
  if(desktop)await engine.waitForFunction(()=>document.querySelector('#sports-overlay')?.dataset.sport);
  const initialCounts=desktop?await application.evaluate(()=>({...globalThis.eliteCounts})):null;
  const chess=page.locator('.sport-card[data-sport="chess"]'),pdga=page.locator('.sport-card[data-sport="disc-golf"]');
  assert.equal(await chess.locator('.automatic-watch-card').count(),1);assert.equal(await pdga.locator('.automatic-watch-card').count(),2);
  assert.match(await chess.locator('.automatic-watch-name').innerText(),/Elite Masters/);assert.doesNotMatch(await chess.innerText(),/Local Open/);
  // Refresh the saved-list UI immediately, even when cached discovery does not
  // change any watches and therefore sends no configuration notification.
  for(const [sport,toggle] of [[chess,'.chess-auto-follow'],[pdga,'.pdga-auto-follow']]){
   await sport.locator(toggle).uncheck();
   assert.match(await sport.locator('.automatic-watch-list').innerText(),/Automatic discovery is off/);
   assert.equal(await sport.locator('.automatic-watch-enabled').first().isDisabled(),true);
   await sport.locator(toggle).check();
   assert.doesNotMatch(await sport.locator('.automatic-watch-list').innerText(),/Automatic discovery is off/);
   assert.match(await sport.locator('.automatic-watch-list').innerText(),/every 15 minutes/);
   assert.equal(await sport.locator('.automatic-watch-enabled').first().isDisabled(),false);
   assert.equal(await sport.locator('.automatic-watch-list').count(),1);
  }
  await chess.locator('.automatic-watch-enabled').uncheck();
  await page.waitForFunction(()=>window.SportsOverlay.config.loadConfig().excludedGames.includes('chess:Best0001:auto'));
  await chess.locator('.keep-automatic-watch').click();
  await chess.locator('.chess-view').selectOption('player');await chess.locator('.chess-player').selectOption('fide:123');
  await page.waitForFunction(()=>window.SportsOverlay.config.loadConfig().sports.find(g=>g.sport==='chess').events[0]?.playerId==='fide:123');
  await page.reload();assert.equal(await chess.locator('.chess-player').inputValue(),'fide:123');
  assert.equal(await chess.locator('.automatic-watch-card').count(),0,'manual watch supersedes automatic watch');
  await pdga.locator('.automatic-watch-card').first().locator('.keep-automatic-watch').click();await pdga.locator('.pdga-view').selectOption('player');await pdga.locator('.pdga-player').selectOption('123');
  await page.waitForFunction(()=>window.SportsOverlay.config.loadConfig().sports.find(g=>g.sport==='disc-golf').events[0]?.playerId==='123');
  await chess.locator('.chess-auto-follow').uncheck();await pdga.locator('.pdga-auto-follow').uncheck();
  await page.waitForFunction(()=>window.SportsOverlay.config.loadConfig().sports.filter(g=>['chess','disc-golf'].includes(g.sport)).every(g=>g.autoFollow===false));
  await page.getByRole('button',{name:'Live control',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#rotation-queue [data-game-key]').length===2);
  const state=await page.evaluate(()=>window.SportsOverlay.config.loadConfig());
  assert.equal(state.sports.find(g=>g.sport==='chess').events[0].playerId,'fide:123');assert.equal(state.sports.find(g=>g.sport==='disc-golf').events[0].playerId,'123');
  if(desktop){const status=await page.evaluate(()=>window.sportsDesktop.status());const frame=await(await fetch(status.obsUrl.replace('/output','/api/output'))).json();assert.ok(frame.ready);const counts=await application.evaluate(()=>globalThis.eliteCounts);assert.ok(initialCounts.chess>=1&&initialCounts.pdga>=1);assert.deepEqual(counts,initialCounts,'Settings and OBS reuse the engine searches without additional directory calls');}
  assert.deepEqual(errors,[]);console.log(`Elite discovery ${desktop?'native/OBS':'browser'} check passed: chess tier filtering, PDGA divisions, persisted automatic lists, exclusion, keep/player preferences, reload, and pausing discovery.`);
 }finally{if(application)await application.close();if(browser)await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
