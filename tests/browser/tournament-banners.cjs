'use strict';
const {chromium} = require('../../scripts/test-browser.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
require('../../core/config.js');
const config = global.SportsOverlay.config.normalizeConfig();
config.sports.forEach(g=>{g.enabled=['chess','disc-golf'].includes(g.sport);if(g.autoFollow!==undefined)g.autoFollow=false;});
const metadata = require('../sports/disc-golf/event.json'), scores = require('../sports/disc-golf/round.json');
const chessMeta={tour:{id:'Tour1234',name:'Masters Invitational with a long tournament name and presenting sponsor'},rounds:[{id:'Round001',name:'Round 1',ongoing:true}]};
const chessPlayerName='Leader with a long individual player name';
const chessRound={tour:chessMeta.tour,round:chessMeta.rounds[0],games:[{id:'Game0001',players:[{name:chessPlayerName,fideId:123,clock:6000},{name:'Opponent',fideId:456,clock:12000}],lastMove:''}]};
const standings=Array.from({length:12},(_,i)=>({name:i?'Player '+(i+1):chessPlayerName,fideId:123+i,rank:i+1,score:7-i/2,played:8}));
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
 try {
  const context=await browser.newContext({viewport:{width:1120,height:900}}),errors=[];
  let playersOffline=false;
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(playersOffline && ((url.hostname==='www.pdga.com' && url.pathname.endsWith('fetch_round')) || (url.hostname==='lichess.org' && url.pathname.includes('/-/-/'))))return route.fulfill({status:503,json:{}});
   if(url.hostname==='www.pdga.com')return route.fulfill({json:{data:url.pathname.endsWith('fetch_event')?metadata:scores}});
   if(url.hostname==='lichess.org')return route.fulfill({json:url.pathname.endsWith('/players')?standings:url.pathname.includes('/-/-/')?chessRound:chessMeta});
   if(url.hostname!=='overlay.test')return route.fulfill({json:{events:[],dates:[]}});
   const file=path.resolve(__dirname,'../..',url.pathname==='/admin/'?'admin/index.html':url.pathname.slice(1));
   try{return route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://overlay.test/admin/');await page.evaluate(c=>localStorage.setItem('sports-overlay.config.v1',JSON.stringify(c)),config);await page.reload();
  for(const [sport,prefix,input,id,player] of [['disc-golf','pdga','.pdga-tournament-input','86076','41760'],['chess','chess','.chess-input','Tour1234','fide:123']]){
   const card=page.locator(`.sport-card[data-sport="${sport}"]`);
   await card.locator(input).fill(id);await card.locator(`.${prefix}-load`).click();
   await card.locator(`.${prefix}-watch`).click();
   await card.locator(`.${prefix}-size`).selectOption('3');
   await card.locator(`.${prefix}-add-banner`).click();
   await card.locator(`.${prefix}-pending`).nth(1).waitFor({state:'visible'});
   await page.waitForFunction(sport=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).sports.find(g=>g.sport===sport).events.length===2,sport);
   const pendingKey=await page.evaluate(sport=>{const api=window.SportsOverlay,c=api.config.loadConfig();return `${sport}:${api.config.watchId(c.sports.find(g=>g.sport===sport).events[1])}`;},sport);
   await page.getByRole('button',{name:'Live control',exact:true}).click();
   await page.locator(`#rotation-queue [data-game-key="${sport}:${sport==='chess'?'Tour1234:auto':'86076:MPO'}"]`).waitFor();
   assert.equal(await page.locator(`#rotation-queue [data-game-key="${pendingKey}"]`).count(),0);
   await page.getByRole('button',{name:'Settings',exact:true}).click();
   await card.locator(`.${prefix}-player`).nth(1).selectOption(player);
   await page.waitForFunction(({sport,player})=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).sports.find(g=>g.sport===sport).events[1]?.playerId===player,{sport,player});
   await page.reload();
   assert.equal(await card.locator(`.${prefix}-view`).nth(0).inputValue(),sport==='chess'?'overview':'leaderboard');
   assert.equal(await card.locator(`.${prefix}-player`).nth(1).inputValue(),player);
   assert.equal(await card.locator(`.${prefix}-size`).nth(0).inputValue(),'3');
   // Saved player banners populate their picker without a manual load click.
   await page.waitForFunction(prefix=>document.querySelectorAll(`.${prefix}-player`)[1].options.length>2,prefix);
   assert.equal(await card.locator(`.${prefix}-players`).nth(1).isVisible(),false);
   playersOffline=true;await page.reload();
   await card.locator(`.${prefix}-players`).nth(1).waitFor({state:'visible'});
   assert.equal(await card.locator(`.${prefix}-player`).nth(1).inputValue(),player);
   playersOffline=false;await card.locator(`.${prefix}-players`).nth(1).click();
   await page.waitForFunction(prefix=>document.querySelectorAll(`.${prefix}-player`)[1].options.length>2,prefix);
   assert.equal(await card.locator(`.${prefix}-players`).nth(1).isVisible(),false);
   assert.equal(await card.locator(`.${prefix}-player`).nth(1).inputValue(),player);
   await card.locator(`.${prefix}-size`).nth(0).selectOption('10');
   await page.waitForFunction(sport=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).sports.find(g=>g.sport===sport).events[0].leaderboardSize===10,sport);
  }
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')));
  await page.reload();
  await page.getByRole('button',{name:'Live control',exact:true}).click();
  for(const sport of ['chess','disc-golf']){
   const group=saved.sports.find(g=>g.sport===sport);
   for(const watch of group.events){
    const key=`${sport}:${global.SportsOverlay.config.watchId(watch)}`;
    await page.locator(`#rotation-queue [data-game-key="${key}"]`).waitFor();
   }
  }
  // Player names remain visible in both lists, including narrow windows.
  for(const sport of ['chess','disc-golf']){
   const watch=saved.sports.find(g=>g.sport===sport).events.find(w=>w.view==='player');
   const key=`${sport}:${global.SportsOverlay.config.watchId(watch)}`;
   const expectedName=sport==='chess'?chessPlayerName:'Kevin Jones';
   const expectedTournament=sport==='chess'?`${chessMeta.tour.name} · Round 1`:`${metadata.SimpleName} · MPO`;
   for(const list of ['rotation-queue','available-games']){
    const card=page.locator(`#${list} [data-game-key="${key}"]`);
    await card.waitFor();
    assert.equal(await card.locator('.game-name').innerText(),`Player · ${expectedName}`);
    assert.equal(await card.locator('.game-tournament').innerText(),expectedTournament);
    for(const width of [1120,480,320]){
     await page.setViewportSize({width,height:900});
     assert.equal(await card.locator('.game-name').evaluate(el=>getComputedStyle(el).whiteSpace),'normal');
     assert.equal(await card.locator('.game-name').evaluate(el=>el.scrollWidth<=el.clientWidth+1 && el.scrollHeight<=el.clientHeight+1),true,`${sport} player name must not be clipped in ${list} at ${width}px`);
    }
    await page.setViewportSize({width:1120,height:900});
    if(list==='rotation-queue') await card.locator('.remove-game').click();
    else {
     await page.locator('#game-search').fill(expectedName);
     await card.waitFor();
     await page.locator('#game-search').fill(sport==='chess'?'Masters Invitational':metadata.SimpleName);
     await card.waitFor();
     await page.locator('#game-search').fill('');
     await card.locator('.add-game').click();
     await page.locator(`#rotation-queue [data-game-key="${key}"]`).waitFor();
    }
   }
  }
  // Restore the original automatic selections before testing sport filters.
  await page.evaluate(c=>window.SportsOverlay.config.saveConfig(c),saved);
  await page.reload();
  await page.getByRole('button',{name:'Live control',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#rotation-queue .game-card').length===4);
  // List filters stay independent and never change the saved banner rotation.
  const beforeFilters=await page.evaluate(()=>localStorage.getItem('sports-overlay.config.v1'));
  await page.locator('#available-sport-filter').selectOption('disc-golf');
  await page.locator('#queue-sport-filter').selectOption('chess');
  assert.equal(await page.locator('#rotation-queue .game-card').count(),2);
  assert.equal(await page.locator('#rotation-queue [data-game-key^="chess:"]').count(),2);
  assert.equal(await page.locator('#rotation-count').innerText(),'2 of 4 games');
  assert.equal(await page.locator('#available-sport-filter').inputValue(),'disc-golf');
  await page.locator('#queue-sport-filter').selectOption('disc-golf');
  assert.equal(await page.locator('#rotation-queue [data-game-key^="disc-golf:"]').count(),2);
  await page.locator('#available-sport-filter').selectOption('chess');
  assert.equal(await page.locator('#queue-sport-filter').inputValue(),'disc-golf');
  assert.equal(await page.evaluate(()=>localStorage.getItem('sports-overlay.config.v1')),beforeFilters);
  await page.locator('#queue-sport-filter').selectOption('');
  assert.equal(await page.locator('#rotation-queue .game-card').count(),4);
  assert.equal(await page.locator('#rotation-count').innerText(),'4 games');
  let banner=await context.newPage();banner.on('pageerror',e=>errors.push(e.message));
  // Apply the list's sport choice to the actual engine without changing its saved queue.
  assert.equal(await page.locator('#apply-banner-sport-filter').isDisabled(),true);
  await page.locator('#queue-sport-filter').selectOption('chess');
  await page.locator('#apply-banner-sport-filter').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).bannerSportFilter==='chess');
  await banner.goto('http://overlay.test/index.html');
  await banner.waitForFunction(()=>window.SportsOverlay.engine?.describe().queue.length===2);
  assert.deepEqual(await banner.evaluate(()=>window.SportsOverlay.engine.describe().queue.map(e=>e.candidate.sport)),['chess','chess']);
  assert.equal(await banner.evaluate(()=>window.SportsOverlay.engine.describe().normalQueue.length),4);
  const beforeEmpty=await page.evaluate(()=>window.SportsOverlay.config.loadConfig().excludedGames);
  for(let i=0;i<2;i++) {
   await page.locator('#rotation-queue .remove-game').first().click();
   await page.waitForFunction(count=>document.querySelectorAll('#rotation-queue .game-card').length===count,1-i);
  }
  await banner.waitForFunction(()=>window.SportsOverlay.engine?.describe().queue.length===0
    && window.SportsOverlay.engine.describe().normalQueue.length===2 && window.SportsOverlay.engine.describe().renderedGameKey===null
    && !window.SportsOverlay.engine.describe().discoveryPending);
  assert.equal(await page.locator('#rotation-queue .game-card').count(),0);
  assert.equal(await banner.locator('.chess-empty').innerText(),'No Chess games in rotation');
  assert.equal(await banner.locator('.chess-focus, .chess-entry').count(),0,'the empty filter removes all previous score content');
  await banner.evaluate(()=>window.SportsOverlay.engine.override({gameKey:'disc-golf:86076:MPO'}));
  assert.equal(await banner.evaluate(()=>window.SportsOverlay.engine.describe().overrideGameKey),null);
  assert.equal(await banner.locator('.chess-empty').innerText(),'No Chess games in rotation');
  await page.evaluate(excludedGames=>window.SportsOverlay.config.saveConfig({...window.SportsOverlay.config.loadConfig(),excludedGames}),beforeEmpty);
  await banner.waitForFunction(()=>window.SportsOverlay.engine?.describe().queue.length===2
    && window.SportsOverlay.engine.describe().renderedGameKey?.startsWith('chess:'));
  await page.locator('#queue-sport-filter').selectOption('disc-golf');
  await banner.waitForFunction(()=>window.SportsOverlay.engine?.describe().queue.length===2 && window.SportsOverlay.engine.describe().queue.every(e=>e.candidate.sport==='disc-golf'));
  await page.locator('#undo-live-change').click();
  await banner.waitForFunction(()=>window.SportsOverlay.engine?.describe().queue.length===2 && window.SportsOverlay.engine.describe().queue.every(e=>e.candidate.sport==='chess'));
  assert.equal(await page.locator('#queue-sport-filter').inputValue(),'chess');
  await page.locator('#queue-sport-filter').selectOption('disc-golf');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).bannerSportFilter==='disc-golf');
  await page.reload();
  await page.getByRole('button',{name:'Live control',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#apply-banner-sport-filter').getAttribute('aria-pressed')==='true');
  assert.equal(await page.locator('#queue-sport-filter').inputValue(),'disc-golf');
  await page.locator('#rotation-queue .game-card').nth(1).waitFor();
  await page.locator('.rotation-column').first().screenshot({path:'/tmp/sportsover-banner-sport-filter.png'});
  await page.locator('#apply-banner-sport-filter').click();
  await banner.waitForFunction(()=>window.SportsOverlay.engine?.describe().queue.length===4);
  const afterToggle=await page.evaluate(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')));
  const beforeToggle=JSON.parse(beforeFilters);
  for(const key of ['includedGames','excludedGames','rotationOrder','lockedGameKeys']) assert.deepEqual(afterToggle[key],beforeToggle[key]);
  await page.locator('#queue-sport-filter').selectOption('');
  assert.equal(await page.locator('#rotation-queue .game-card').count(),4);
  // Freeze the engine's selected banner with a saved lock, then inspect the real output.
  for(const sport of ['chess','disc-golf']){
   const group=saved.sports.find(g=>g.sport===sport),prefix=sport==='chess'?'chess':'pdga';
   for(const watch of group.events){
    const key=`${sport}:${global.SportsOverlay.config.watchId(watch)}`;
    await banner.close();
    await page.evaluate(key=>{const c=JSON.parse(localStorage.getItem('sports-overlay.config.v1'));c.lockedGameKeys=[key];localStorage.setItem('sports-overlay.config.v1',JSON.stringify(c));},key);
    banner=await context.newPage();banner.on('pageerror',e=>errors.push(e.message));
    await banner.goto(`http://overlay.test/index.html?sport=${sport}`);
    if(watch.view==='player') {await banner.locator(`.${prefix}-focus`).waitFor();continue;}
    await banner.locator(`.${prefix}-entry`).nth(9).waitFor({state:'attached'});
    assert.equal(await banner.locator(`.${prefix}-entry`).count(),10);
    const box=await banner.locator('#sports-overlay').boundingBox();assert.equal(box.height,88);assert.equal(box.width,460);
    if(sport==='chess'){assert.equal(await banner.locator('.chess-entry').first().innerText(),`1\n${chessPlayerName}\n8\n7`);}
    const track=banner.locator('.scorebug-vertical-track');
    await track.evaluate(el=>{el.getAnimations()[0].currentTime=parseFloat(el.style.getPropertyValue('--vertical-duration'))*900;});
    const transform=await track.evaluate(el=>getComputedStyle(el).transform);assert.notEqual(transform,'none');
    // A same-event score refresh keeps its scroll phase instead of starting over.
    const phase=await track.evaluate(el=>el.style.getPropertyValue('--vertical-delay'));assert.ok(phase);
    await banner.screenshot({path:`/tmp/sportsover-${sport}-top10.png`});
    // Hover and keyboard focus pause the existing animation without resetting it.
    const viewport=banner.locator('.scorebug-vertical-viewport');
    await viewport.hover();
    await track.evaluate(el=>{el.getAnimations()[0].currentTime=parseFloat(el.style.getPropertyValue('--vertical-duration'))*500;});
    const paused=await track.evaluate(el=>({transform:getComputedStyle(el).transform,time:el.getAnimations()[0].currentTime}));
    assert.equal(await track.evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    await banner.waitForTimeout(150);
    assert.deepEqual(await track.evaluate(el=>({transform:getComputedStyle(el).transform,time:el.getAnimations()[0].currentTime})),paused);
    assert.notEqual(paused.transform,'matrix(1, 0, 0, 1, 0, 0)');
    await banner.mouse.move(700,300);
    await banner.waitForFunction(time=>document.querySelector('.scorebug-vertical-track').getAnimations()[0].currentTime>time,paused.time);
    assert.equal(await track.evaluate(el=>getComputedStyle(el).animationPlayState),'running');
    await viewport.focus();
    assert.equal(await track.evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    await viewport.evaluate(el=>el.blur());

    await banner.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await track.evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await banner.locator('.scorebug-vertical-viewport').evaluate(el=>getComputedStyle(el).overflowY),'auto');
    await banner.emulateMedia({reducedMotion:'no-preference'});
   }
  }
  // Desktop/OBS receives fresh serialized tracks. A changed engine offset
  // must restart at that offset, without doubling elapsed animation time.
  const mirror=await context.newPage();mirror.on('pageerror',e=>errors.push(e.message));
  let frame={instance:'test',sequence:1,gameKey:'chess:Tour1234:auto',ready:true,
   html:'<div id="sports-overlay"><div class="scorebug-vertical-viewport"><div class="scorebug-vertical-track is-scrolling-vertically" style="--vertical-distance:-105px;--vertical-duration:20s;--vertical-delay:-5s"><div>Leader</div></div></div></div>'};
  await mirror.route('**/api/output',route=>route.fulfill({json:frame}));
  await mirror.route('**/mirror',route=>route.fulfill({contentType:'text/html',body:'<link rel="stylesheet" href="/core/scrolling.css"><div id="sports-overlay"></div><script src="/core/event-model.js"></script><script src="/core/countdown.js"></script><script src="/core/output.js"></script>'}));
  await mirror.goto('http://overlay.test/mirror');
  await mirror.waitForFunction(()=>document.body.dataset.sequence==='1');
  await mirror.locator('.scorebug-vertical-track').evaluate(el=>{window.oldTrack=el;el.getAnimations()[0].currentTime=5000;});
  frame={...frame,sequence:2,html:frame.html.replace('--vertical-delay:-5s','--vertical-delay:-6s')};
  await mirror.waitForFunction(()=>document.body.dataset.sequence==='2');
  assert.equal(await mirror.locator('.scorebug-vertical-track').evaluate(el=>el===window.oldTrack),false);
  assert.ok(await mirror.locator('.scorebug-vertical-track').evaluate(el=>el.getAnimations()[0].currentTime<2000));
  await mirror.close();
  assert.deepEqual(errors,[]);
  console.log('Tournament banners passed: independent saves and queue entries, player output, top 10 standings, scrolling, fixed size, reduced motion.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
