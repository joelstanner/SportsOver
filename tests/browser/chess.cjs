const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
require('../../core/config.js');
const config = global.SportsOverlay.config.normalizeConfig();
config.sports.forEach(group => { group.enabled = group.sport === 'chess'; });
config.providerRefreshSeconds.chess = {live:5,pregame:5,idle:5,final:5};
const root = path.resolve(__dirname, '../..');
const metadata = { tour:{id:'Tour1234',name:'Masters Invitational',info:{tc:'90+30'}}, defaultRoundId:'Round001', rounds:[{id:'Round001',name:'Round 1',ongoing:true},{id:'Round002',name:'Round 2'}] };
const game = (id,white,black,status='*') => ({id,players:[{name:white,title:'GM',fideId:id==='Game0001'?123:234,rating:2790,clock:185400},{name:black,title:'GM',rating:2780,clock:164200}],fen:'8/8/8/8/8/8/8/8 b - - 0 32',lastMove:'e2e4',status});
const payload = {tour:metadata.tour,round:metadata.rounds[0],games:[game('Game0001','Gukesh D','Fabiano Caruana'),game('Game0002','Magnus Carlsen','Hikaru Nakamura','½-½'),game('Game0003','Judit Polgar','Viswanathan Anand','0-1')]};
(async()=>{
 const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
 try {
  const context = await browser.newContext({viewport:{width:1120,height:850}});
  let offline=false, roundTwo=false, finished=false;
  await context.route('**/*',async route=>{
   const url = new URL(route.request().url());
   if(url.hostname==='lichess.org') {
    if(offline) return route.fulfill({status:503,json:{}});
    const meta=structuredClone(metadata), scores=structuredClone(payload);
    if(roundTwo){meta.rounds[0].ongoing=false;meta.rounds[0].finishedAt=Date.now()-1000;meta.rounds[1].ongoing=true;meta.defaultRoundId='Round002';scores.round={...meta.rounds[1]};}
    if(finished){meta.rounds.forEach(round=>{round.ongoing=false;round.finishedAt=Date.now()-1000;});scores.round={...meta.rounds[roundTwo?1:0]};scores.games[0].status='1-0';}
    return route.fulfill({json:url.pathname.endsWith('/top')?{active:[{tour:metadata.tour}]}:url.pathname.includes('/-/-/')?scores:meta});
   }
   if(url.hostname!=='overlay.test') return route.fulfill({json:{events:[],dates:[]}});
   const file=url.pathname==='/admin/'?'admin/index.html':url.pathname.slice(1);
   try{return route.fulfill({body:await fs.readFile(path.join(root,file)),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]});}
   catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://overlay.test/admin/');
  await page.evaluate(config=>localStorage.setItem('sports-overlay.config.v1',JSON.stringify(config)),config);
  await page.reload();
  const sport=page.locator('.sport-card[data-sport="chess"]');
  await sport.locator('.chess-browse').click();
  await sport.locator('.chess-current').selectOption('Tour1234');
  await sport.locator('.chess-round').waitFor({state:'visible'});
  await sport.locator('.chess-watch').click();
  await sport.locator('.chess-view').selectOption('player');
  await sport.locator('.chess-player').selectOption('fide:123');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).sports.find(s=>s.sport==='chess').events[0]?.playerId==='fide:123');
  await page.reload();
  assert.equal(await sport.locator('.chess-view').inputValue(),'player');
  assert.equal(await sport.locator('.chess-player').inputValue(),'fide:123');
  await page.getByRole('button',{name:'Live control',exact:true}).click();
  const queue=page.locator('#rotation-queue [data-game-key="chess:Tour1234:auto"]');
  await queue.waitFor(); assert.match(await queue.innerText(),/Masters Invitational.*Round 1/s);
  await queue.locator('.lock-game').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).lockedGameKeys.includes('chess:Tour1234:auto'));
  const banner=await context.newPage();banner.on('pageerror',e=>errors.push(e.message));
  await banner.goto('http://overlay.test/index.html?sport=chess');
  await banner.locator('.chess-focus').waitFor();
  assert.match(await banner.locator('.chess-focus').innerText(),/Gukesh D.*30:54.*Fabiano Caruana.*27:22/s);
  assert.match(await banner.locator('.chess-footer').innerText(),/Black to move.*move 32.*last broadcast update/);
  const box=await banner.locator('#sports-overlay').boundingBox();assert.equal(box.width,460);assert.equal(box.height,88);
  await banner.evaluate(()=>document.body.style.zoom='2');
  assert.equal((await banner.locator('#sports-overlay').boundingBox()).width,920);
  await banner.screenshot({path:'/tmp/sportsover-chess-player.png'});
  offline=true;
  await banner.waitForFunction(()=>document.querySelector('#sports-overlay')?.dataset.stale==='true',{},{timeout:15000});
  assert.match(await banner.locator('.chess-footer').innerText(),/STALE.*Last received/);
  assert.match(await banner.locator('.chess-focus').innerText(),/Gukesh D/);
  offline=false;roundTwo=true;
  await banner.waitForFunction(()=>document.querySelector('.chess-state')?.textContent.includes('Round 2') && document.querySelector('#sports-overlay').dataset.stale==='false',{},{timeout:40000});
  assert.match(await banner.locator('.chess-focus').innerText(),/Gukesh D/);
  // Lock identity is stable through automatically advancing rounds.
  assert.equal(await banner.evaluate(()=>window.SportsOverlay.engine.describe().currentGameKey),'chess:Tour1234:auto');
  finished=true;
  await banner.waitForFunction(()=>document.querySelector('#sports-overlay')?.dataset.state==='final',{},{timeout:15000});
  assert.match(await banner.locator('.chess-footer').innerText(),/White wins/);
  // Missing followed player falls back to the round overview, and escapes feed text.
  await banner.evaluate(()=>{
   const api=window.SportsOverlay,event=api.registry.getDemo('chess','live');
   api.registry.getLayout('chess').createLayout().render({...event,details:{...event.details,view:'player',playerId:'name:Absent',name:'<img src=x onerror=alert(1)>'}});
  });
  await banner.locator('.chess-entry').first().waitFor();
  assert.match(await banner.locator('.chess-footer').innerText(),/absent/);
  assert.equal(await banner.locator('.chess-event img').count(),0);
  await banner.screenshot({path:'/tmp/sportsover-chess-overview.png'});
  // Standings must preserve the break explanation when the next round has
  // pairings and an ongoing flag, but no moves on any board yet.
  await banner.evaluate(({metadata,payload})=>{
   const api=window.SportsOverlay;
   metadata.rounds[0].finishedAt=Date.now()-1000;
   metadata.rounds[1].ongoing=true;
   payload.round=metadata.rounds[1];
   payload.games=payload.games.map(game=>({...game,lastMove:'',status:'*'}));
   const event=api.lichess.normalizeEvent(metadata,payload,{tournamentId:'Tour1234',view:'overview'});
   api.registry.getLayout('chess').createLayout().render(event);
  },{metadata,payload});
  assert.match(await banner.locator('.chess-state').innerText(),/Round 2.*BREAK/);
  assert.match(await banner.locator('.chess-footer').innerText(),/Awaiting Round 2/);
  assert.doesNotMatch(await banner.locator('.chess-footer').innerText(),/complete/);
  // Before the next scheduled start, show Upcoming and retain tournament totals.
  const expectedStart=await banner.evaluate(({metadata,payload})=>{
   const api=window.SportsOverlay;
   metadata.rounds[0].finishedAt=Date.now()-1000;
   metadata.rounds[1].startsAt=Date.now()+86400000;
   const round=api.lichess.selectRound(metadata);
   payload.round=round;payload.games=[];
   const event=api.lichess.normalizeEvent(metadata,payload,{tournamentId:'Tour1234',view:'overview'});
   event.details.standings=[{name:'Leader',rank:1,played:1,score:1}];
   api.registry.getLayout('chess').createLayout().render(event);
   return api.model.formatPregameStart(event.startTime);
  },{metadata,payload});
  assert.match(await banner.locator('.chess-state').innerText(),/Round 2.*UPCOMING/);
  assert.ok((await banner.locator('.chess-footer').innerText()).includes(expectedStart));
  assert.match(await banner.locator('.chess-entry').innerText(),/Leader/);
  // The new sport participates in demo rotation with existing team layouts.
  await banner.evaluate(()=>{const c=JSON.parse(localStorage.getItem('sports-overlay.config.v1'));c.sports.forEach(g=>g.enabled=['basketball','chess'].includes(g.sport));localStorage.setItem('sports-overlay.config.v1',JSON.stringify(c));});
  await banner.goto('http://overlay.test/index.html?scenario=rotation');
  await banner.locator('.basketball-scorebug[data-state="live"]').waitFor();
  await banner.locator('.chess-scorebug[data-state="live"]').waitFor();
  await banner.locator('.basketball-scorebug[data-state="live"]').waitFor();
  // New demo state is accessible from the lab.
  await page.getByRole('button',{name:'Demo lab',exact:true}).click();
  await page.locator('#demo-sport').selectOption('chess');
  await page.locator('#demo-state').selectOption('player');
  await page.frameLocator('#demo-preview').locator('.chess-focus').waitFor();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await sport.locator('.sport-enabled').uncheck();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).sports.find(s=>s.sport==='chess').enabled===false);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('sports-overlay.config.v1')).sports.find(s=>s.sport==='chess').events[0].playerId),'fide:123');
  assert.deepEqual(errors,[]);
  console.log('Chess browser flow passed: browse, watch, player, persistence, queue lock, clocks, 200%, stale recovery, round advance, final, fallback, mixed rotation, demo, disable.');
 } finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
