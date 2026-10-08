const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('../../scripts/test-browser.cjs');
const root=process.env.SPORTSOVER_ROOT||path.resolve(__dirname,'../..');
const sizes={small:[360,76],normal:[647,137],large:[2304,280]};
const sports=['baseball','football','college-football','basketball','college-basketball','hockey','soccer','chess','disc-golf'];
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{channel:'chrome'})});
 try {
  const context=await browser.newContext();
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='overlay.test')return route.request().resourceType()==='image' ? route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="76" height="76"><rect width="76" height="76" fill="white"/></svg>'}) : route.abort();
   const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);
   try {return route.fulfill({body:await fs.readFile(path.join(root,relative)),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(relative)]||'application/octet-stream'});}
   catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const css=await fs.readFile(path.join(root,'core/obs-layouts.css'),'utf8');
  const {compactCSS,marker}=require('../../scripts/sync-obs-compact.cjs');
  assert.equal(css.replace(/\r\n/g,'\n').split(marker+'\n')[1],compactCSS().replace(/\r\n/g,'\n'),'Regenerate compact styles with node scripts/sync-obs-compact.cjs');
  let count=0;
  for(const sport of sports)for(const state of ['live','pregame','final'])for(const [mode,viewport]of Object.entries(sizes)){
   await page.setViewportSize({width:viewport[0],height:viewport[1]});
   await page.goto(`http://overlay.test/index.html?sport=${sport}&demo=${state}`);
   await page.waitForFunction(()=>document.querySelector('#sports-overlay')?.classList.contains('is-loading')===false && document.querySelector('#sports-overlay')?.textContent.trim());
   await page.addStyleTag({content:css});
   const box=await page.locator('#sports-overlay').boundingBox();
   assert(Math.abs(box.width-viewport[0])<1,`${sport} ${state} ${mode} width ${box.width}`);
   const bodyBox=await page.locator('body').boundingBox();
   assert(bodyBox.y+bodyBox.height>=box.y+box.height-1,`${sport} ${state} ${mode}: body clips banner`);
   assert(Math.abs(box.height-viewport[1])<1,`${sport} ${state} ${mode} height ${box.height}`);
   const clipped=await page.evaluate(()=>{
    const root=document.querySelector('#sports-overlay'),r=root.getBoundingClientRect();
    return [...root.querySelectorAll('.team__score,.football-score,.basketball-score,.hockey-score,.soccer-score,.chess-clock,.pdga-metric')].filter(el=>{
     const b=el.getBoundingClientRect();return b.width&&b.height&&(b.bottom>r.bottom+1||b.right>r.right+1||b.top<r.top-1||b.left<r.left-1);
    }).map(el=>el.className);
   });
   if(state==='final' && sport.includes('football') && mode!=='small') {
    const scores=await page.locator('.football-score').evaluateAll(els=>els.map(el=>({font:parseFloat(getComputedStyle(el).fontSize),box:el.getBoundingClientRect().toJSON(),row:el.closest('.football-main').getBoundingClientRect().toJSON()})));
    assert.deepEqual(scores.map(score=>score.font),[44,44],`${sport} final ${mode}: prominent scores`);
    for(const score of scores) assert(score.box.top>=score.row.top && score.box.bottom<=score.row.bottom,`${sport} final ${mode}: score fits team row`);
    assert(await page.locator('.team-name-label').first().isVisible(),`${sport} final ${mode}: team names retained`);
    assert(await page.locator('#football-status-text').isVisible(),`${sport} final ${mode}: final status retained`);
   }
   if(mode==='small' && !['chess','disc-golf'].includes(sport)){
    const compact=await page.evaluate(()=>{const r=document.querySelector('#sports-overlay');return {fonts:[...r.querySelectorAll('.team__score,.football-score,.basketball-score,.hockey-score,.soccer-score')].map(el=>parseFloat(getComputedStyle(el).fontSize)),date:!!r.querySelector('[data-compact-date]')};});
    assert.deepEqual(compact.fonts,[60,60],sport+' '+state+' compact scores');
    if(state==='pregame')assert(compact.date,sport+' compact upcoming date');
    if(state==='live' && ['football','basketball','soccer'].includes(sport)){
     await page.evaluate(()=>document.querySelector('#sports-overlay').dataset.halftime='true');
     assert.match(await page.locator('#sports-overlay').evaluate(el=>getComputedStyle(el,'::after').content),/H.*T/s,sport+' halftime marker');
    }
   }
   assert.deepEqual(clipped,[],`${sport} ${state} ${mode}: core scores/clocks clipped`);
   if(sport==='hockey' && state==='live' && mode==='normal') {
    for(const variant of ['standard','odds','preseason']) {
     if(variant!=='standard') await page.evaluate(variant=>{
      const event=SportsOverlay.registry.getDemo('hockey','live');
      event.teams.away.score=10;event.teams.home.score=11;
      if(variant==='odds') event.details.odds={moneyline:{live:{away:110,home:-120}}};
      else event.details.preseason=true;
      SportsOverlay.registry.getLayout('hockey').createLayout().render(event);
     },variant);
     const geometry=await page.evaluate(()=>{
      const root=document.querySelector('#sports-overlay'),row=root.querySelector('.hockey-main').getBoundingClientRect();
      return {row:row.toJSON(),detail:root.querySelector('.hockey-live-detail').getBoundingClientRect().toJSON(),bottom:root.getBoundingClientRect().bottom,
       children:[...root.children].filter(el=>el.getClientRects().length).map(el=>el.getBoundingClientRect().toJSON()),
       scores:[...root.querySelectorAll('.hockey-score')].map(el=>{
        const box=el.getBoundingClientRect(),team=el.closest('.hockey-team'),name=team.querySelector('.team-name-slot').getBoundingClientRect(),mark=team.querySelector('.hockey-mark').getBoundingClientRect(),bounds=team.getBoundingClientRect();
        const home=team.classList.contains('hockey-team--home'),gap=parseFloat(getComputedStyle(team).columnGap)*parseFloat(getComputedStyle(document.body).zoom);
        return {box:box.toJSON(),font:parseFloat(getComputedStyle(el).fontSize),leftGap:box.left-(home?bounds.left:name.right+gap),rightGap:(home?name.left-gap:bounds.right)-box.right,mark:mark.toJSON()};
       })};
     });
     for(const score of geometry.scores) {
      assert.equal(score.font,25.5,`${variant}: moderate hockey score size`);
      assert(Math.abs(score.leftGap-score.rightGap)<1,`${variant}: score centered between name and clock ${JSON.stringify(score)}`);
      assert(score.leftGap>0 && score.rightGap>0,`${variant}: score does not overlap names`);
      for(const box of [score.box,score.mark]) assert(box.top>=geometry.row.top-1 && box.bottom<=geometry.row.bottom+1,`${variant}: score/logo fits row`);
     }
     assert(geometry.detail.height>24,`${variant}: stats row retains breathing room`);
     for(const child of geometry.children) assert(child.bottom<=geometry.bottom+1,`${variant}: footer fits banner`);
     if(process.env.SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`hockey-normal-${variant}.png`)});
    }
   }
   if(process.env.SCREENSHOT_DIR&&state==='live')await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`${sport}-${mode}.png`)});
   count++;
  }
  assert.deepEqual(errors,[]);
  console.log(`OBS layouts: ${count} sport/state/size combinations passed; feeds mocked.`);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
