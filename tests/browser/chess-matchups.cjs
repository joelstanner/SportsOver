'use strict';
const {chromium} = require('../../scripts/test-browser.cjs');
const assert = require('node:assert/strict'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
(async()=>{
 const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
 try {
  const page = await browser.newPage({viewport:{width:472,height:100}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*', route=>route.abort());
  await page.route('http://overlay.test/', route=>route.fulfill({contentType:'text/html',body:'<main id="sports-overlay"></main>'}));
  await page.route('**/teams.json', route=>route.fulfill({json:{teams:[]}}));
  await page.goto('http://overlay.test/');
  for(const file of ['sports/baseball/style.css','sports/chess/style.css','core/scrolling.css']) await page.addStyleTag({path:path.join(root,file)});
  for(const file of ['core/config.js','core/registry.js','core/event-model.js','core/scrolling.js','sports/chess/providers/lichess.js','sports/chess/layout.js']) await page.addScriptTag({path:path.join(root,file)});
  await page.evaluate(()=>{
   const api=window.SportsOverlay;
   const metadata={tour:{id:'Tour1234',name:'Open Championship',info:{tc:'90+30'}},rounds:[{id:'Round006',name:'Round 6',ongoing:true}]};
   const payload={round:{...metadata.rounds[0],delay:1800},games:Array.from({length:12},(_,i)=>({
    id:`Game${String(i+1).padStart(4,'0')}`,players:[{name:i?'White Player '+i:'Long White Player Name',fideId:i*2+1,title:'GM',clock:i?null:6500},
     {name:i?'Black Player '+i:'<img src=x onerror=alert(1)>',fideId:i*2+2,title:'IM',clock:0}],
    status:['*','1-0','½-½','0-1'][i%4],lastMove:'e2e4',fen:'8/8/8/8/8/8/8/8 w - - 0 19'
   }))};
   window.matchEvent=api.lichess.normalizeEvent(metadata,payload,{tournamentId:'Tour1234',view:'overview',leaderboardSize:3});
   window.matchEvent.details.standings=api.lichess.normalizeStandings([{name:'Long White Player Name',fideId:1,score:0,played:5,rank:20},
    {name:'<img src=x onerror=alert(1)>',fideId:2,score:3.5,played:5,rank:2}]);
   window.matchLayout=api.registry.getLayout('chess').createLayout();
   window.matchLayout.render(window.matchEvent);
  });
  assert.equal(await page.locator('.chess-matchup').count(),12,'all boards shown, independent of standings size');
  assert.equal(await page.locator('.chess-entry').count(),0);
  assert.match(await page.locator('.chess-matchup').first().innerText(),/Long White Player Name.*0.*1:05.*M19.*3\.5.*0:00/s);
  assert.equal(await page.locator('.chess-match-clock.is-turn').first().innerText(),'1:05');
  assert.equal(await page.locator('.chess-matchup img').count(),0);
  assert.deepEqual(await page.locator('.chess-matchup').first().locator('.chess-name').evaluateAll(names=>names.map(a=>a.href)),Array(2).fill('https://lichess.org/broadcast/-/-/Round006/Game0001'));
  assert.deepEqual(await page.locator('.chess-match-status').allTextContents(),['M19','1-0','½-½','0-1','M19','1-0','½-½','0-1','M19','1-0','½-½','0-1']);
  assert.match(await page.locator('.chess-footer').innerText(),/3 live.*9\/12 finished.*90\+30.*Clocks: last broadcast update.*1800s broadcast delay/);
  const viewport=page.locator('.scorebug-vertical-viewport'), track=page.locator('.scorebug-vertical-track');
  assert.match(await viewport.getAttribute('aria-label'),/12 round matchups/);
  assert.equal(await track.evaluate(el=>el.style.getPropertyValue('--vertical-distance')),'-135px');
  const box=await page.locator('#sports-overlay').boundingBox();assert.equal(box.width,460);assert.equal(box.height,88);
  assert.ok(await page.locator('.chess-matchup').evaluateAll(rows=>rows.every(row=>row.scrollWidth===row.clientWidth)),'no horizontal overflow');
  await page.screenshot({path:'/tmp/sportsover-chess-matchups.png'});
  await page.waitForTimeout(100);
  await page.evaluate(()=>window.matchLayout.render(window.matchEvent));
  assert.ok(await track.evaluate(el=>parseFloat(el.style.getPropertyValue('--vertical-delay'))<-.05),'polls preserve scroll phase');
  await viewport.hover();assert.equal(await track.evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await track.evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await viewport.evaluate(el=>getComputedStyle(el).overflowY),'auto');
  // Standings outages must not hide live matchups or imply their clocks are stale.
  await page.evaluate(()=>{window.matchEvent.details.standingsUnavailable=true;window.matchLayout.render(window.matchEvent);});
  assert.match(await page.locator('.chess-footer').innerText(),/STALE tournament points/);
  assert.equal(await page.locator('.chess-matchup').count(),12);
  await page.evaluate(()=>{window.matchEvent.details.standings=[];window.matchLayout.render(window.matchEvent);});
  assert.match(await page.locator('.chess-footer').innerText(),/Tournament points unavailable/);
  assert.deepEqual(await page.locator('.chess-total').allTextContents(),Array(24).fill('—'));
  assert.equal(await page.locator('.chess-match-clock').first().innerText(),'1:05');
  // Unknown position/clock data stays unknown, not a fabricated move or draw.
  await page.evaluate(()=>{const g=window.matchEvent.details.games[0];g.turn=null;g.move=null;g.players[0].clock=null;window.matchLayout.render(window.matchEvent);});
  assert.equal(await page.locator('.chess-match-status').first().innerText(),'LIVE');
  assert.equal(await page.locator('.chess-match-clock').first().innerText(),'—');
  assert.equal(await page.locator('.chess-matchup').first().locator('.is-turn').count(),0);
  await page.evaluate(()=>{window.matchEvent.details.stale=true;window.matchLayout.render(window.matchEvent);});
  assert.match(await page.locator('.chess-footer').innerText(),/STALE · Last received broadcast/);
  assert.equal(await page.locator('.chess-matchup').count(),12);
  // Non-live tournament banners retain standings, while followed-player output remains independent.
  for(const state of ['pregame','interrupted','final']) {
   await page.evaluate(state=>{window.matchLayout.render({...window.matchEvent,state,details:{...window.matchEvent.details,stale:false,standingsUnavailable:false,standings:[{id:'fide:1',name:'Leader',rank:1,score:4,played:6}]}});},state);
   assert.equal(await page.locator('.chess-matchup').count(),0);
   assert.equal(await page.locator('.chess-entry .chess-name').getAttribute('href'),'https://lichess.org/broadcast/-/-/Round006#players/1');
   assert.match(await page.locator('.chess-entry').innerText(),/Leader.*6.*4/s);
  }
  await page.evaluate(()=>window.matchLayout.render({...window.matchEvent,details:{...window.matchEvent.details,view:'player',playerId:'fide:1'}}));
  assert.equal(await page.locator('.chess-focus').count(),1);
  assert.deepEqual(errors,[]);
  console.log('Live chess matchups passed: all boards, points, clocks, moves, results, missing/stale data, scrolling, size, standings transitions and player view.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
