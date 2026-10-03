'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
require('../../core/config.js');
const configApi=global.SportsOverlay.config;
async function fixture(){
 const config=configApi.normalizeConfig();
 config.sports.forEach(group=>group.enabled=['baseball','chess'].includes(group.sport));
 let release, notify, timer=0;
 const timers=new Map(),renders=[];
 const blocked=new Promise(resolve=>{release=resolve;});
 const baseballGame={id:'ready',sport:'baseball',state:'live',teamKeys:['136'],raw:{}};
 const chessGame={id:'Tour1234:auto',sport:'chess',state:'live',competitionType:'individual',teamKeys:[],raw:{automatic:true}};
 const baseball={toCandidate:game=>game,createClient:()=>({findGames:async()=>[baseballGame],findLeagueGames:async()=>[baseballGame],getEvent:async()=>({...baseballGame,details:{}})})};
 const chess={createSession:()=>({}),createClient:()=>({discover:async()=>{await blocked;return{automaticEntries:[{candidate:chessGame}],availableEntries:[{candidate:chessGame}]};},getEvent:async()=>({...chessGame,details:{}})})};
 const api={config:{...configApi,loadConfig:()=>structuredClone(config)},lichess:chess,
  shared:{waitForConfig:async()=>{},snapshot:()=>({instance:'test',catalogRevision:0}),subscribe:fn=>{notify=fn;}},
  registry:{getProvider:name=>name==='lichess'?chess:baseball,getLayout:()=>({createLayout:()=>({render:e=>renders.push(e.sport),renderNoEvent:()=>{},handleError:()=>{}})})}};
 const context=vm.createContext({SportsOverlay:api,console,URLSearchParams,AbortSignal,Response,performance,Date,
  setTimeout:(fn,delay)=>{timers.set(++timer,{fn,delay});return timer;},clearTimeout:id=>timers.delete(id),
  fetch:async()=>{throw Error('Unexpected network request');},location:{search:''},addEventListener(){},
  document:{querySelector:()=>null,addEventListener(){}}});
 context.window=context;
 for(const name of ['game-selection','provider-refresh','provider-discovery','live-mode','app'])await vm.runInContext(fs.readFileSync(path.join(__dirname,`../../core/${name}.js`),'utf8'),context);
 const flush=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
 await flush();
 return{engine:api.engine,renders,timers,flush,release:async()=>{release();await flush();},disableChess:async()=>{
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
test('a disabled slow sport cannot rejoin the progressively published queue',async()=>{
 const f=await fixture();await f.disableChess();await f.release();
 assert.deepEqual(Array.from(f.engine.describe().queue,e=>e.candidate.sport),['baseball']);
 assert.equal(f.engine.describe().loadingSports.length,0);
});
