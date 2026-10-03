// Isolated native/OBS check using deterministic public-broadcast-shaped feeds.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
require('../core/config.js');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sportsover-chess-'));
 const config=global.SportsOverlay.config.normalizeConfig();
 config.sports.forEach(group=>group.enabled=group.sport==='chess');
 Object.assign(config.sports.find(group=>group.sport==='chess'),{events:[],autoFollow:false,discoverSecondTier:false});
 // Restore an existing Add selection without a saved watch or directory scan.
 config.includedGames=['chess:Tour1234:auto'];config.rotationMode='hybrid';
 config.providerRefreshSeconds.chess={live:5,pregame:5,idle:5,final:5};
 config.defaultGameDurations={live:45,pregame:5,final:5};
 await fs.writeFile(path.join(directory,'settings.json'),JSON.stringify({version:1,config,desktop:{visible:false}}));
 const metadata={tour:{id:'Tour1234',name:'Masters Invitational',info:{tc:'90+30'}},rounds:[{id:'Round001',name:'Round 1',ongoing:true},{id:'Round002',name:'Round 2'}],defaultRoundId:'Round001'};
 const round={tour:metadata.tour,round:metadata.rounds[0],games:[{id:'Game0001',players:[{name:'Gukesh D',title:'GM',rating:2787,fideId:123,clock:185400},{name:'Fabiano Caruana',title:'GM',rating:2803,clock:164200}],fen:'8/8/8/8/8/8/8/8 b - - 0 32',lastMove:'e2e4',status:'*'}]};
 let application;
 try {
  application=await electron.launch({...(process.env.SPORTSOVER_TEST_EXECUTABLE?{executablePath:process.env.SPORTSOVER_TEST_EXECUTABLE,args:[]}:{args:[path.resolve(__dirname,'..')]}),env:{...process.env,SPORTSOVER_TEST_DATA:directory}});
  await application.firstWindow();
  await application.evaluate(async({session},{metadata,round})=>{
   globalThis.chessTest={metadata,round,calls:0};
   await session.defaultSession.protocol.handle('https',request=>{
    if(new URL(request.url).hostname!=='lichess.org') return new Response(JSON.stringify({events:[],dates:[]}),{headers:{'Content-Type':'application/json'}});
    globalThis.chessTest.calls++;
    return new Response(JSON.stringify(request.url.endsWith('/players') ? [{name:'Gukesh D',fideId:123,rank:1,score:5.5,played:7}] : request.url.includes('/-/-/')?globalThis.chessTest.round:globalThis.chessTest.metadata),{headers:{'Content-Type':'application/json'}});
   });
  },{metadata,round});
  let pages;
  for(let i=0;i<60;i++){pages=application.windows();if(pages.some(p=>p.url().includes('/admin/'))&&pages.some(p=>p.url().includes('engine=1'))&&pages.some(p=>p.url().includes('display.html?desktop')))break;await new Promise(resolve=>setTimeout(resolve,100));}
  const admin=pages.find(p=>p.url().includes('/admin/')),engine=pages.find(p=>p.url().includes('engine=1')),banner=pages.find(p=>p.url().includes('display.html?desktop'));
  assert.ok(admin&&engine&&banner);
  await engine.reload();
  await banner.locator('.chess-matchup').first().waitFor({timeout:30000});
  assert.match(await banner.locator('.chess-matchup').innerText(),/Gukesh D.*5\.5.*30:54.*M32.*Fabiano Caruana.*27:22/s);
  const status=await admin.evaluate(()=>window.sportsDesktop.action('size',2));
  await banner.waitForFunction(()=>document.querySelector('#sports-overlay')?.getBoundingClientRect().width===920);
  const box=await banner.locator('#sports-overlay').boundingBox();assert.equal(box.width,920);assert.equal(box.height,176);
  // Broadcast links bypass banner navigation and open the system browser.
  await application.evaluate(({BrowserWindow,shell})=>{
   globalThis.chessTest.links=[];globalThis.chessTest.navigation=[];
   shell.openExternal=async url=>{globalThis.chessTest.links.push(url);};
   const engine=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('engine=1'));
   const send=engine.webContents.send.bind(engine.webContents);
   engine.webContents.send=(channel,...args)=>{
    if(channel==='engine:command'&&['next','previous'].includes(args[0]?.type))globalThis.chessTest.navigation.push(args[0].type);
    return send(channel,...args);
   };
  });
  await admin.evaluate(()=>window.sportsDesktop.action('show'));
  await banner.locator('.chess-footer a').click();
  await admin.evaluate(()=>window.sportsDesktop.action('lock'));
  await banner.locator('.chess-event').click();
  await banner.locator('.chess-footer a').focus();
  await banner.keyboard.press('Enter');
  await new Promise(resolve=>setTimeout(resolve,600));
  await banner.locator('.chess-name').first().click();
  await banner.locator('.chess-name').last().focus();
  await banner.keyboard.press('Enter');
  const linkResult=await application.evaluate(()=>({links:globalThis.chessTest.links,navigation:globalThis.chessTest.navigation}));
  assert.deepEqual(linkResult.links,[...Array(3).fill('https://lichess.org/broadcast/-/-/Round001'), ...Array(2).fill('https://lichess.org/broadcast/-/-/Round001/Game0001')]);
  assert.deepEqual(linkResult.navigation,[]);
  await admin.evaluate(()=>window.sportsDesktop.action('unlock'));
  await banner.locator('.chess-match-status').first().click();
  await new Promise(resolve=>setTimeout(resolve,600));
  assert.deepEqual(await application.evaluate(()=>globalThis.chessTest.navigation),['next']);
  let frame=await(await fetch(status.obsUrl.replace('/output','/api/output'))).json();
  assert.equal(frame.gameKey,'chess:Tour1234:auto');assert.match(frame.html,/Gukesh D/);
  const response=await fetch(status.obsUrl);assert.equal(response.status,200);assert.match(await response.text(),/sports\/chess\/style.css/);
  const sport=admin.locator('[data-sport="chess"]');
  await sport.locator('.chess-input').fill('Tour1234');
  await sport.locator('.chess-load').click();
  await sport.locator('.chess-watch').click();
  await sport.locator('.chess-view').selectOption('player');
  await sport.locator('.chess-player').selectOption('fide:123');
  await banner.waitForFunction(()=>document.querySelector('.chess-focus')?.textContent.includes('30:54'));
  assert.deepEqual(await banner.locator('.chess-focus .chess-name').evaluateAll(names=>names.map(a=>a.href)),Array(2).fill('https://lichess.org/broadcast/-/-/Round001/Game0001'));
  frame=await(await fetch(status.obsUrl.replace('/output','/api/output'))).json();assert.match(frame.html,/chess-focus/);
  await banner.locator('#sports-overlay').screenshot({path:'/tmp/sportsover-chess-native-player.png'});
  // Intermediate completion stays in normal rotation with final timing.
  await application.evaluate(()=>{globalThis.chessTest.round.games[0].status='1-0';globalThis.chessTest.round.round.ongoing=false;globalThis.chessTest.round.round.finishedAt=Date.now();globalThis.chessTest.metadata.rounds[0]=globalThis.chessTest.round.round;});
  await banner.waitForFunction(()=>document.querySelector('#sports-overlay')?.dataset.state==='interrupted',{},{timeout:15000});
  assert.equal((await admin.evaluate(()=>window.sportsDesktop.engine())).queue.length,1);
  const breakTiming=await engine.evaluate(()=>{
   const api=window.SportsOverlay,entry=api.engine.describe().queue[0],config=api.config.loadConfig();
   return {state:entry.candidate.state,seconds:api.selection.gameDurationSeconds(entry,config.gameDurations,undefined,config.defaultGameDurations)};
  });
  assert.deepEqual(breakTiming,{state:'interrupted',seconds:5});
  await application.evaluate(()=>{const t=globalThis.chessTest;t.metadata.rounds[1].ongoing=true;t.round.round=t.metadata.rounds[1];t.round.games[0].status='*';});
  await banner.waitForFunction(()=>document.querySelector('.chess-state')?.textContent.includes('Round 2'),{},{timeout:15000});
  assert.equal((await admin.evaluate(()=>window.sportsDesktop.engine())).currentGameKey,'chess:Tour1234:auto');
  await admin.evaluate(()=>window.sportsDesktop.action('live-mode',true));
  await admin.waitForFunction(async()=>(await window.sportsDesktop.engine()).liveMode.active);
  // Removing an active watched tournament removes it from the shared engine/outputs.
  await sport.locator('.chess-remove').click();
  await admin.waitForFunction(async()=>(await window.sportsDesktop.engine()).queue.length===0);
  await admin.waitForFunction(()=>!window.SportsOverlay.config.loadConfig().includedGames.includes('chess:Tour1234:auto'));
  await banner.waitForFunction(()=>!document.querySelector('.chess-entry,.chess-matchup,.chess-focus'));
  console.log('Chess desktop saved Add recovery, live matchups, standings bridge, broadcast links, banner clicks, 200% banner, player selection, shared OBS, break timing, round advance, Live mode, and removal passed.');
 }finally{if(application)await application.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
