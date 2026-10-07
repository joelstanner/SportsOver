const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const root = process.env.SPORTSOVER_SOURCE || path.resolve(__dirname, '../..');
const { chromium } = require('../../scripts/test-browser.cjs');
(async () => {
 const browser = await chromium.launch({headless:true,channel:'chrome'});
 try {
 let frame={ready:false};
 const context=await browser.newContext({viewport:{width:472,height:100},reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  if(new URLSearchParams(location.search).has('desktop')) window.sportsDesktop={status:async()=>({fullscreen:false}), action:async()=>({}), onFullscreenChange:()=>{}, onFrame:()=>{}, onBrowseFeedback:()=>{}};
 });
 await context.route('**/*', async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/output') return route.fulfill({json:frame});
  if(url.hostname!=='overlay.test') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#eee"/><text x="20" y="25" text-anchor="middle" font-size="16">L</text></svg>'});
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
  try {await route.fulfill({body:await fs.readFile(path.join(root,file)),contentType:({'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'})[path.extname(file)]});} catch {await route.fulfill({status:404,body:''});}
 });
 const engine=await context.newPage();
 await engine.goto('http://overlay.test/?sport=basketball&demo=live');
 await engine.locator('.basketball-scorebug[data-state="live"]').waitFor();
 const output=await context.newPage();
 const errors=[];output.on('pageerror',error=>errors.push(error.message));
 await output.goto('http://overlay.test/display.html?desktop=1');
 let sequence=0, cases=0;
 for(const sport of ['baseball','football','college-football','basketball','college-basketball','hockey','soccer']) for(const state of ['live','final','pregame','halftime','live-odds','live-timeout']) {
  const html=await engine.evaluate(({sport,state})=>{
   const api=SportsOverlay, event=api.registry.getDemo(sport,['halftime','live-odds','live-timeout'].includes(state)?'live':state);
   if(state==='live-timeout') { event.details.down=null;event.details.distance=null;event.details.yardLine='';event.details.clock='13:00';event.details.period='4TH';event.details.lastPlay='Official Timeout at 13:00.'; }
   if(state==='live-odds') { event.details.lastPlay='';event.details.lastEvent='';event.details.odds={spread:{live:{away:-1.5,home:1.5},prices:{live:{away:-120,home:110}}},moneyline:{live:{away:-120,home:110}}}; }
   if(state==='halftime') { event.detailedState='Halftime'; event.details.period='HALFTIME'; }
   if(sport.includes('basketball') && state!=='pregame') for(const team of Object.values(event.teams)) team.score+=100;
   if(state==='live') event.details.preseason=true;
   api.registry.getLayout(sport).createLayout().render(event);
   return document.querySelector('#sports-overlay').outerHTML;
  },{sport,state});
  frame={ready:true,instance:'sizing-test',sequence:++sequence,gameKey:`${sport}:${state}`,html};
  await output.waitForFunction(sequence=>document.body.dataset.sequence===String(sequence),sequence);
  let original=null;
  for(const scale of [1,0.75,0.5,1.25]) {
   await output.setViewportSize({width:472*scale,height:100*scale});
   await output.waitForFunction(({scale})=>Math.abs(new DOMMatrix(getComputedStyle(document.body).transform).a-scale)<0.001,{scale});
   if(scale===0.5) {
    await output.mouse.click(120,25);
    frame={...frame,sequence:++sequence,gameKey:`${sport}:${state}:browse`};
    await output.waitForFunction(sequence=>document.body.dataset.sequence===String(sequence),sequence);
   }
   const size=await output.evaluate(()=>{
    const mount=document.querySelector('#sports-overlay'), rect=mount.getBoundingClientRect();
    const score=mount.querySelector('.team__score, .football-score, .basketball-score, .hockey-score, .soccer-score');
    return {font:Number.parseFloat(getComputedStyle(score).fontSize),height:rect.height,
     mainHeight:mount.querySelector('.game-view,.football-main,.basketball-main,.hockey-main,.soccer-main').getBoundingClientRect().height,
     visibleIds:[...mount.querySelectorAll('[id]:not(img)')].filter(node=>node.getClientRects().length).map(node=>node.id),
     logoSize:mount.querySelector('.team__logo,.football-mark,.basketball-mark,.hockey-mark,.soccer-mark').offsetWidth,
     clockVisible:!!mount.querySelector('.football-center, .basketball-center, .hockey-center, .soccer-center, .inning')?.getClientRects().length,
     names:[...mount.querySelectorAll('.team-name-slot,.team__abbr')].some(node=>node.getClientRects().length),
     rows:[...mount.children].filter(node=>node.getClientRects().length).map(node=>node.getBoundingClientRect().bottom),
     bottom:rect.bottom,
     teams:[...mount.querySelectorAll('.team,.football-team,.basketball-team,.hockey-team,.soccer-team')].map(node=>({width:node.clientWidth,scroll:node.scrollWidth})),
     scores:[...mount.querySelectorAll('.team__score,.football-score,.basketball-score,.hockey-score,.soccer-score,.team__logo,.football-mark,.basketball-mark,.hockey-mark,.soccer-mark')].filter(node=>node.getClientRects().length).map(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom,rowTop:node.closest('.game-view,.football-main,.basketball-main,.hockey-main,.soccer-main').getBoundingClientRect().top,rowBottom:node.closest('.game-view,.football-main,.basketball-main,.hockey-main,.soccer-main').getBoundingClientRect().bottom})),
     width:innerWidth};
   });
   const label=`${sport} ${state} ${scale}`;
   if(scale===1) original=size;
   assert.ok(Math.abs(size.font/original.font-(scale===0.5?1.4:scale===0.75?1.2:1))<0.02,`${label}: score emphasis`);
   assert.ok(Math.abs(size.logoSize/original.logoSize-(scale===0.5?1.3:scale===0.75?1.15:1))<0.04,`${label}: logo emphasis`);
   assert.deepEqual(size.visibleIds,original.visibleIds,`${label}: all details retained after resizing and browsing`);
   assert.ok(Math.abs(size.height-88*scale)<0.6,`${label}: stable height`);
   if(sport==='football' && ['final','live-timeout'].includes(state)) assert.ok(Math.abs(size.mainHeight-42*scale)<0.6,`${label}: compact score row without down/field information`);
   for(const team of size.teams) assert.ok(team.scroll<=team.width+1,`${label}: team overflow ${JSON.stringify(team)}`);
   for(const row of size.rows) assert.ok(row<=size.bottom+0.6,`${label}: clipped row ${JSON.stringify(size)}`);
   for(const score of size.scores) assert.ok(score.left>=0 && score.right<=size.width && score.top>=0 && score.bottom<=size.bottom,`${label}: score clipped`);
   for(const score of size.scores) assert.ok(score.top>=score.rowTop-0.6 && score.bottom<=score.rowBottom+0.6,`${label}: logo or score overlaps footer ${JSON.stringify(score)}`);
   cases++;
   if(sport==='basketball' && state==='live' && scale===0.5 && process.env.SPORTSOVER_PREVIEW) await output.screenshot({path:process.env.SPORTSOVER_PREVIEW});
  }
 }
 assert.deepEqual(errors,[]);
 console.log(`${cases} size/state/sport combinations passed with larger logos/scores and every detail retained after resizing and browsing.`);
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
