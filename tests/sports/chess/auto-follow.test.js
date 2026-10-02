'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../../../core/config.js');require('../../../core/event-model.js');require('../../../core/live-mode.js');require('../../../core/provider-refresh.js');require('../../../sports/chess/providers/lichess.js');
const api=global.SportsOverlay,lichess=api.lichess;
function fixture(){
 let now=Date.parse('2026-10-02T18:00:00Z'),active=0,maximum=0,offlineDirectory=false;const directory=[],tours=new Map(),calls=[],session=lichess.createSession();
 const options={autoFollow:true,session,now:()=>now,fetchImpl:async value=>{
  const url=new URL(value);calls.push(url);maximum=Math.max(maximum,++active);await new Promise(resolve=>setImmediate(resolve));active--;
  if(url.pathname.endsWith('/top'))return offlineDirectory?new Response('{}',{status:503}):Response.json({active:directory.map(tour=>({tour}))});
  const id=url.pathname.split('/').at(-1),item=[...tours.values()].find(item=>item.metadata.tour.id===id || item.payload.round.id===id);
  if(!item||item.offline)return new Response('{}',{status:503});
  return Response.json(url.pathname.includes('/-/-/')?item.payload:item.metadata);
 }};
 function add(id,tier=5,state='live'){
  const tour={id,name:`Elite ${id}`,tier,dates:[now-1000,now+86400000]};directory.push(tour);
  const round={id:`R${id.slice(1)}`,name:'Round 1',startsAt:now-1000};
  const metadata={tour,rounds:[round,{id:`Z${id.slice(1)}`,name:'Round 2',startsAt:now+86400000}],defaultRoundId:round.id};
  const payload={tour,round,games:[{id:'Game0001',players:[{name:'Star',fideId:123,rating:2800},{name:'Opponent'}],fen:'8/8/8/8/8/8/8/8 w - - 0 5'}]};
  tours.set(id,{metadata,payload});set(id,state);return id;
 }
 function set(id,state){const item=tours.get(id);item.metadata.rounds.forEach(round=>{delete round.finishedAt;round.ongoing=false;});const round=item.metadata.rounds[state==='final'?1:0];if(state==='live')round.ongoing=true;if(['break','final'].includes(state))round.finishedAt=now;if(state==='final')item.metadata.rounds[0].finishedAt=now;item.payload.round=round;item.payload.games[0].lastMove=state==='pregame'?'':'e2e4';item.payload.games[0].status=['break','final'].includes(state)?'½-½':'*';}
 return{add,set,tours,directory,calls,session,options,client:lichess.createClient(options),advance:ms=>now+=ms,now:()=>now,maximum:()=>maximum,offlineDirectory:value=>offlineDirectory=value};
}
const ids=result=>result.automaticEntries.map(entry=>entry.candidate.id);
test('elite search uses official best/high tiers, nearby dates, unique IDs and bounded priority',()=>{
 const now=Date.now(),tour=(id,tier,start=now,end=now)=>({id,tier,dates:[start,end]});
 const directory=[tour('Best0001',5),tour('High0001',4),tour('Norm0001',3),tour('Other001',0),tour('Best0001',5),tour('Future01',5,now+8*86400000),tour('OldTour1',5,now-9*86400000,now-8*86400000)];
 assert.deepEqual(lichess.eliteEvents(directory,now).map(t=>t.id),['Best0001','High0001']);
 assert.equal(lichess.eliteEvents(Array.from({length:12},(_,i)=>tour(`Best${String(i).padStart(4,'0')}`,5)),now).length,8);
});
test('all live elite watches are discovered, saved-list descriptors are provided, and normal tiers are skipped',async()=>{
 const f=fixture();f.add('Best0001');f.add('High0001',4);f.add('Norm0001',3);
 const result=await f.client.discover();assert.deepEqual(ids(result),['Best0001:auto','High0001:auto']);
 assert.equal(result.automaticWatches.length,2);assert.equal(result.automaticWatchesComplete,true);
 assert.ok(result.availableEntries.every(entry=>entry.candidate.raw.automatic));
 assert.ok(!f.calls.some(url=>url.pathname.includes('Norm0001')));assert.equal(f.maximum(),1);
});
test('repeating discovery finds newly posted elite tournaments every fifteen minutes, including across client recreation',async()=>{
 const f=fixture();f.add('Best0001');await f.client.discover();
 f.add('Best0002');
 // Simulate actual response snapshots: the directory is not re-fetched early.
 await lichess.createClient(f.options).discover();assert.equal(f.calls.filter(url=>url.pathname.endsWith('/top')).length,1);
 f.advance(900000);assert.ok(ids(await lichess.createClient(f.options).discover()).includes('Best0002:auto'));
 assert.equal(f.calls.filter(url=>url.pathname.endsWith('/top')).length,2);
});
test('round breaks and directory rollover retain active tournaments; completed events retire after retention',async()=>{
 const f=fixture();f.add('Best0001');await f.client.discover();f.directory.length=0;f.advance(900000);f.set('Best0001','break');
 assert.deepEqual(ids(await f.client.discover()),['Best0001:auto']);assert.equal((await f.client.getEvent('Best0001:auto')).state,'interrupted');
 f.set('Best0001','final');let result=await f.client.discover({retentionMs:60000});assert.equal(result.automaticEntries[0].autoRetainUntil,f.now()+60000);
 f.advance(60000);result=await f.client.discover({retentionMs:60000});assert.deepEqual(ids(result),[]);assert.deepEqual(result.automaticWatches,[]);
});
test('outages preserve received automatic watches, cannot prove completion, and recover',async()=>{
 const f=fixture();f.add('Best0001');await f.client.discover();f.tours.get('Best0001').offline=true;f.offlineDirectory(true);f.advance(900000);
 const result=await f.client.discover();assert.deepEqual(ids(result),['Best0001:auto']);assert.equal(result.automaticWatches,null);assert.ok(result.failures>0);assert.equal(result.automaticEntries[0].candidate.raw.stale,true);
 f.tours.get('Best0001').offline=false;f.offlineDirectory(false);f.advance(900000);assert.equal((await f.client.discover()).failures,0);
});
test('manual views take precedence, disabled watches/exclusions are respected, and toggling auto follow removes Live mode eligibility',async()=>{
 const f=fixture();f.add('Best0001');f.add('High0001',4);
 const watches=[{tournamentId:'Best0001',roundId:'',name:'Saved',enabled:true,view:'player',playerId:'fide:123'},{tournamentId:'High0001',roundId:'',enabled:false}];
 const client=lichess.createClient({...f.options,watches});let result=await client.discover();assert.deepEqual(ids(result),['Best0001:auto']);assert.equal(result.availableEntries.length,1);assert.equal((await client.getEvent('Best0001:auto')).details.playerId,'fide:123');
 assert.equal(result.automaticWatches.length,0);
 const automatic=await f.client.discover({excludedKeys:['chess:Best0001:auto']});assert.deepEqual(ids(automatic),['High0001:auto']);
 const config=api.config.normalizeConfig({sports:[{sport:'chess',autoFollow:true}]});const mode=api.liveMode.create();mode.setActive(true,automatic.automaticEntries);
 config.sports[0].autoFollow=false;assert.deepEqual(mode.update({rotation:automatic.automaticEntries,available:[],enabledSports:['chess'],allows:entry=>api.config.isCandidateEnabled(config,entry.candidate)}),[]);
 const calls=f.calls.length;assert.deepEqual(ids(await lichess.createClient({...f.options,autoFollow:false}).discover()),[]);assert.equal(f.calls.length,calls);
});
test('upcoming/final/hide fallback choices and top favorite limit automatic rotation',async()=>{
 const f=fixture();f.add('Best0001',5,'pregame');f.add('High0001',4,'final');
 assert.deepEqual(ids(await f.client.discover()),['Best0001:auto']);assert.deepEqual(ids(await f.client.discover({fallbackMode:'recent-final'})),['High0001:auto']);assert.deepEqual(ids(await f.client.discover({fallbackMode:'hide'})),[]);
 f.set('Best0001','live');f.set('High0001','live');assert.equal((await f.client.discover({topFavoriteOnly:true})).automaticEntries.length,1);
});
test('automatic chess discovery defaults on for new configs while preserving an explicit off choice',()=>{
 assert.equal(api.config.normalizeConfig().sports.find(g=>g.sport==='chess').autoFollow,true);
 assert.equal(api.config.normalizeConfig({sports:[{sport:'chess',autoFollow:false}]}).sports[0].autoFollow,false);
});
