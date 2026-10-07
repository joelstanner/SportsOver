const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.env.SPORTSOVER_ROOT||path.resolve(__dirname,'../..');
const sizes={small:[360,76],normal:[647,137],large:[2304,280]};
const sports=['baseball','football','basketball','hockey','soccer','chess','disc-golf'];
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{channel:'chrome'})});
 try {
  const context=await browser.newContext();
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='overlay.test')return route.abort();
   const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);
   try {return route.fulfill({body:await fs.readFile(path.join(root,relative)),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(relative)]||'application/octet-stream'});}
   catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const css=await fs.readFile(path.join(root,'core/obs-layouts.css'),'utf8');
  let count=0;
  for(const sport of sports)for(const state of ['live','pregame','final'])for(const [mode,viewport]of Object.entries(sizes)){
   await page.setViewportSize({width:viewport[0],height:viewport[1]});
   await page.goto(`http://overlay.test/index.html?sport=${sport}&demo=${state}`);
   await page.waitForFunction(()=>document.querySelector('#sports-overlay')?.classList.contains('is-loading')===false && document.querySelector('#sports-overlay')?.textContent.trim());
   await page.addStyleTag({content:css});
   const box=await page.locator('#sports-overlay').boundingBox();
   assert(Math.abs(box.width-viewport[0])<1,`${sport} ${state} ${mode} width ${box.width}`);
   assert(Math.abs(box.height-viewport[1])<1,`${sport} ${state} ${mode} height ${box.height}`);
   const clipped=await page.evaluate(()=>{
    const root=document.querySelector('#sports-overlay'),r=root.getBoundingClientRect();
    return [...root.querySelectorAll('.team__score,.football-score,.basketball-score,.hockey-score,.soccer-score,.chess-clock,.pdga-metric')].filter(el=>{
     const b=el.getBoundingClientRect();return b.width&&b.height&&(b.bottom>r.bottom+1||b.right>r.right+1||b.top<r.top-1||b.left<r.left-1);
    }).map(el=>el.className);
   });
   assert.deepEqual(clipped,[],`${sport} ${state} ${mode}: core scores/clocks clipped`);
   if(process.env.SCREENSHOT_DIR&&state==='live'&&mode==='large')await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`${sport}-large.png`)});
   count++;
  }
  assert.deepEqual(errors,[]);
  console.log(`OBS layouts: ${count} sport/state/size combinations passed; feeds mocked.`);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
