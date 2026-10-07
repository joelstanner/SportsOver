// Optional real-network PDGA check with isolated preferences and native output.
const { electron } = require('./test-mode.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
require('../core/config.js');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'sportsover-pdga-'));
  const config = global.SportsOverlay.config.normalizeConfig();
  config.sports.forEach(group=>{ group.enabled = group.sport === 'disc-golf'; });
  config.sports.find(group=>group.sport === 'disc-golf').autoFollow = false;
  config.sports.find(group=>group.sport === 'disc-golf').discoverSecondTier = false;
  config.sports.find(group=>group.sport === 'disc-golf').events = [{tournamentId:'86076',division:'MPO',name:'New Zealand Open',enabled:true,view:'leaderboard',playerId:''}];
  await fs.writeFile(path.join(directory,'settings.json'),JSON.stringify({version:1,config,desktop:{visible:false}}));
  let application;
  try {
    application = await electron.launch({network:'live', ...(process.env.SPORTSOVER_TEST_EXECUTABLE
      ? {executablePath:process.env.SPORTSOVER_TEST_EXECUTABLE,args:[]}
      : {args:[path.resolve(__dirname,'..')]}),env:{...process.env,SPORTSOVER_TEST_DATA:directory}});
    await application.firstWindow();
    let pages;
    for (let i=0;i<60;i++) {
      pages = application.windows();
      if (pages.some(page=>page.url().includes('/admin/')) && pages.some(page=>page.url().includes('display.html?desktop'))) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const admin = pages.find(page=>page.url().includes('/admin/'));
    const banner = pages.find(page=>page.url().includes('display.html?desktop'));
    const engine = pages.find(page=>page.url().includes('engine=1'));
    assert.ok(admin && banner && engine);
    await banner.locator('.pdga-entry').first().waitFor({timeout:30000});
    assert.match(await banner.locator('.pdga-board').innerText(),/Jeremy Koling/);
    const status = await admin.evaluate(()=>window.sportsDesktop.action('size',2));
    assert.equal(status.version,require('../package.json').version);
    const frame = await (await fetch(status.obsUrl.replace('/output','/api/output'))).json();
    assert.match(frame.html,/Jeremy Koling/);
    assert.equal(frame.gameKey,'disc-golf:86076:MPO');
    const size = await banner.locator('#sports-overlay').boundingBox();
    assert.equal(size.width,920); assert.equal(size.height,176);
    await banner.screenshot({path:path.join(directory,'pdga-200.png')});
    const sport = admin.locator('[data-sport="disc-golf"]');
    assert.ok(await sport.locator('.pdga-watch-name').isVisible(), 'watched tournament name remains visible in native Settings');
    await sport.locator('.pdga-view').selectOption('player');
    await sport.locator('.pdga-player').selectOption('41760');
    await banner.waitForFunction(()=>document.querySelector('.pdga-focus')?.textContent.includes('Kevin Jones'));
    const state = await admin.evaluate(()=>window.sportsDesktop.engine());
    assert.equal(state.currentGameKey,'disc-golf:86076:MPO');
    assert.equal(state.queue.length,1);
    await banner.screenshot({path:path.join(directory,'pdga-player-200.png')});
    // Simulate an active round only after verifying the real PDGA response.
    const round = structuredClone(require('../tests/sports/disc-golf/round.json'));
    Object.assign(round.scores[0], {Completed:0,Played:12,WonPlayoff:'no'});
    const metadata = require('../tests/sports/disc-golf/event.json');
    await application.evaluate(async ({session}, {round,metadata}) => {
      await session.defaultSession.protocol.handle('https', request => new Response(JSON.stringify({data:request.url.includes('fetch_event')?metadata:round}),{headers:{'Content-Type':'application/json'}}));
    }, {round,metadata});
    await engine.reload();
    await banner.waitForFunction(()=>document.querySelector('#sports-overlay')?.dataset.state==='live');
    await admin.evaluate(()=>window.sportsDesktop.action('live-mode',true));
    await admin.waitForFunction(async()=>(await window.sportsDesktop.engine()).liveMode.active);
    await sport.locator('.pdga-remove').click();
    await admin.waitForFunction(async()=>(await window.sportsDesktop.engine()).queue.length===0);
    await banner.waitForFunction(()=>!document.querySelector('.pdga-entry,.pdga-focus'));
    assert.equal(await banner.locator('.pdga-entry,.pdga-focus').count(),0,'removed division no longer displays during Live mode');
    console.log(`PDGA real API, native 200% banner, shared player selection, rotation and OBS passed. Screenshots: ${directory}`);
  } finally { if (application) await application.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
