'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
require('../../core/config.js');
const configApi=global.SportsOverlay.config;
async function fixture({emptyChess=false,curated=false}={}){
 const config=configApi.normalizeConfig();
 config.sports.forEach(group=>group.enabled=['baseball','chess'].includes(group.sport));
 if(curated) config.rotationMode='curated';
 let release, notify, timer=0, releaseEvent, holdEvent=false;
 const timers=new Map(),renders=[],messages=[];
 const blocked=new Promise(resolve=>{release=resolve;});
 const baseballGame={id:'ready',sport:'baseball',state:'live',teamKeys:['136'],raw:{}};
 const chessGame={id:'Tour1234:auto',sport:'chess',state:'live',competitionType:'individual',teamKeys:[],raw:{automatic:true}};
 const baseball={toCandidate:game=>game,createClient:()=>({findGames:async()=>[baseballGame],findLeagueGames:async()=>[baseballGame],getEvent:async()=>{
  if(holdEvent){holdEvent=false;await new Promise(resolve=>{releaseEvent=resolve;});}
  return {...baseballGame,details:{}};
 }})};
 const chess={createSession:()=>({}),createClient:()=>({discover:async()=>{await blocked;const entries=emptyChess?[]:[{candidate:chessGame}];return{automaticEntries:entries,availableEntries:entries};},getEvent:async()=>({...chessGame,details:{}})})};
 const api={config:{...configApi,loadConfig:()=>structuredClone(config)},lichess:chess,
  shared:{waitForConfig:async()=>{},snapshot:()=>({instance:'test',catalogRevision:0}),subscribe:fn=>{notify=fn;}},
  registry:{getProvider:name=>name==='lichess'?chess:baseball,getLayout:()=>({createLayout:()=>({render:e=>renders.push(e.sport),renderNoEvent:message=>messages.push(message),handleError:()=>{}})})}};
 const context=vm.createContext({SportsOverlay:api,console,URLSearchParams,AbortSignal,Response,performance,Date,
  setTimeout:(fn,delay)=>{timers.set(++timer,{fn,delay});return timer;},clearTimeout:id=>timers.delete(id),
  fetch:async()=>{throw Error('Unexpected network request');},location:{search:''},addEventListener(){},
  document:{querySelector:()=>null,addEventListener(){}}});
 context.window=context;
 for(const name of ['game-selection','provider-refresh','provider-discovery','live-mode','app'])await vm.runInContext(fs.readFileSync(path.join(__dirname,`../../core/${name}.js`),'utf8'),context);
 const flush=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
 await flush();
 return{engine:api.engine,renders,messages,timers,flush,holdEvent:()=>{holdEvent=true;},releaseEvent:async()=>{releaseEvent();await flush();},save:async patch=>{
  Object.assign(config,configApi.normalizeConfig({...config,...patch}));
  await notify({initialized:true,instance:'test',catalogRevision:0,config:structuredClone(config)});await flush();
 },release:async()=>{release();await flush();},disableChess:async()=>{
  config.sports.find(group=>group.sport==='chess').enabled=false;
  await notify({initialized:true,instance:'test',catalogRevision:0,config:structuredClone(config)});await flush();
 }};
}
test('a blocked chess discovery does not delay ready games, polling, or live-control entries',async()=>{
 const f=await fixture();
 let state=f.engine.describe();
 assert.equal(state.discoveryPending,true);
 assert.deepEqual(Array.from(state.loadingSports),['chess']);
 assert.equal(state.discoveryComplete,true,'received sports are available before the whole scan finishes');
 assert.equal(state.renderedGameKey,'baseball:ready');
 assert.deepEqual(Array.from(state.queue,e=>e.candidate.sport),['baseball']);
 assert.ok(f.renders.includes('baseball'));
 const poll=[...f.timers.values()].find(timer=>timer.delay===12000);
 assert.ok(poll,'score polling runs while another sport is blocked');
 await poll.fn();await f.flush();assert.ok(f.renders.length>=2);
 await f.release();state=f.engine.describe();
 assert.equal(state.discoveryPending,false);
 assert.equal(state.loadingSports.length,0);
 assert.deepEqual(Array.from(state.queue,e=>e.candidate.sport),['baseball','chess']);
 assert.equal(state.renderedGameKey,'baseball:ready','late results do not switch the displayed game');
});

test('an empty banner filter clears an incompatible override immediately and blocks new ones',async()=>{
 const f=await fixture({emptyChess:true});
 f.engine.override({gameKey:'baseball:ready'});await f.flush();
 assert.equal(f.engine.describe().overrideGameKey,'baseball:ready');
 await f.save({bannerSportFilter:'chess'});
 assert.equal(f.engine.describe().queue.length,0);
 assert.equal(f.engine.describe().overrideGameKey,null);
 assert.equal(f.engine.describe().currentGameKey,null);
 assert.equal(f.engine.describe().renderedGameKey,null);
 assert.equal(f.messages.at(-1),'Loading games…');
 const renders=f.renders.length;
 f.engine.override({gameKey:'baseball:ready'});await f.flush();
 assert.equal(f.engine.describe().overrideGameKey,null);
 assert.equal(f.renders.length,renders,'an incompatible override cannot redraw the old card');
 await f.release();
 assert.equal(f.engine.describe().renderedGameKey,null);
 assert.equal(f.messages.at(-1),'No Chess games in rotation');
 await f.save({bannerSportFilter:''});
 assert.equal(f.engine.describe().renderedGameKey,'baseball:ready','removing the filter resumes rotation');
});

test('ending an override clears an empty banner immediately while discovery is blocked',async()=>{
 const f=await fixture({curated:true});
 f.engine.override({gameKey:'baseball:ready'});await f.flush();
 assert.equal(f.engine.describe().renderedGameKey,'baseball:ready');
 f.engine.override(null);await f.flush();
 assert.equal(f.engine.describe().discoveryPending,true);
 assert.equal(f.engine.describe().renderedGameKey,null);
 assert.equal(f.engine.describe().currentGameKey,null);
 await f.release();
 assert.equal(f.engine.describe().renderedGameKey,null);
});

test('a delayed score request cannot restore a card excluded by an empty filter',async()=>{
 const f=await fixture({emptyChess:true});
 const poll=[...f.timers.values()].find(timer=>timer.delay===12000);
 f.holdEvent();const pending=poll.fn();await f.flush();
 await f.save({bannerSportFilter:'chess',fallbackMode:'hide'});
 const renders=f.renders.length;
 assert.equal(f.engine.describe().renderedGameKey,null);
 await f.releaseEvent();await pending;
 assert.equal(f.renders.length,renders);
 assert.equal(f.engine.describe().renderedGameKey,null);
 assert.ok(![...f.timers.values()].some(timer=>timer.delay===12000),'empty banners stop score polling');
 await f.release();
 assert.equal(f.messages.at(-1),'No Chess games in rotation');
});
test('a disabled slow sport cannot rejoin the progressively published queue',async()=>{
 const f=await fixture();await f.disableChess();await f.release();
 assert.deepEqual(Array.from(f.engine.describe().queue,e=>e.candidate.sport),['baseball']);
 assert.equal(f.engine.describe().loadingSports.length,0);
});

for(const live of [false,true]) test(`banner sport filter applies immediately during discovery and preserves locks (${live?'Live':'normal'} mode)`,async()=>{
 const f=await fixture();
 if(live){void f.engine.setLiveMode(true);await f.flush();}
 await f.save({lockedGameKeys:['baseball:ready'],bannerSportFilter:'chess'});
 assert.equal(f.engine.describe().queue.length,0,'other sports cannot fill an empty filter');
 assert.equal(f.engine.describe().renderedGameKey,null,'the old sport is cleared while waiting');
 await f.release();
 assert.deepEqual(Array.from(f.engine.describe().queue,e=>e.candidate.sport),['chess']);
 assert.equal(f.engine.describe().renderedGameKey,'chess:Tour1234:auto');
 assert.deepEqual(Array.from(f.engine.describe().normalQueue,e=>e.candidate.sport),['baseball','chess'],'the underlying rotation stays intact');
 await f.engine.next();
 assert.equal(f.engine.describe().renderedGameKey,'chess:Tour1234:auto');
 await f.save({bannerSportFilter:''});
 assert.equal(f.engine.describe().renderedGameKey,'baseball:ready','locks outside the filter resume when it is off');
 await f.save({lockedGameKeys:[],bannerSportFilter:'baseball'});
 assert.deepEqual(Array.from(f.engine.describe().queue,e=>e.candidate.sport),['baseball']);
 await f.disableChess();
 await f.save({bannerSportFilter:'chess'});
 assert.equal(f.engine.describe().renderedGameKey,'baseball:ready','disabled sport filters normalize off');
});
