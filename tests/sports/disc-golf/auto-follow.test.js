'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../core/event-model.js');
require('../../../core/config.js');
require('../../../core/provider-refresh.js');
require('../../../core/live-mode.js');
require('../../../sports/disc-golf/providers/pdga.js');
const api = global.SportsOverlay;
let nextId = 110000;
function fixture() {
  let now = Date.parse('2026-10-01T12:00:00Z'), active = 0, maximum = 0;
  const directory = [], events = new Map(), calls = [];
  const session = api.pdga.createSession();
  const options = { autoFollow: true, session, now: () => now, fetchImpl: async value => {
    const url = new URL(value); calls.push(url); active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    if (url.pathname.includes('current-events')) return Response.json(directory);
    const entry = events.get(url.searchParams.get('TournID'));
    if (entry.offline || entry.metadataOffline && url.pathname.endsWith('fetch_event')) return new Response('{}', {status:503});
    if (url.pathname.endsWith('fetch_event')) return Response.json({data:entry.metadata});
    const round = entry.rounds[url.searchParams.get('Division')];
    if (round === null) return new Response('{}', {status:503});
    return Response.json({data:round});
  }};
  function add(tier = 'ES', state = 'live') {
    const id = String(++nextId);
    directory.push({tournId:id,tier,eventType:'S',startDate:'2026-10-01',endDate:'2026-10-04',officialName:`Tour ${id}`});
    const entry = {metadata:{Name:`Tour ${id}`,ScoringFormat:'S',FinalRound:3,HighestCompletedRound:0,
      Divisions:['MPO','FPO'].map(Division=>({Division,LatestRound:1}))}, rounds:{}};
    events.set(id,entry);
    set(id,'MPO',state);set(id,'FPO',state);return id;
  }
  function set(id,division,state,round = state === 'final' ? 3 : 1) {
    const entry = events.get(id);
    entry.metadata.Divisions.find(item=>item.Division===division).LatestRound = round;
    entry.rounds[division] = {scores:[{Name:'Player',PDGANum:123,Round:round,Played:state==='pregame'?0:state==='live'?5:18,
      RoundStarted:state==='pregame'?0:1,Completed:['final','break'].includes(state)?1:0}]};
  }
  return { add,set,events,directory,calls,session,options, client:api.pdga.createClient(options),
    advance:ms=>{now+=ms;}, maximum:()=>maximum };
}
const ids = result => result.automaticEntries.map(entry=>entry.candidate.id);
test('automatic settings default off, divisions default on, and validate persisted choices',()=>{
  const old = api.config.normalizeConfig({sports:[{sport:'disc-golf'}]}).sports[0];
  assert.equal(old.autoFollow,false);assert.deepEqual(old.autoDivisions,['MPO','FPO']);
  const group = api.config.normalizeConfig({sports:[{sport:'disc-golf',autoFollow:true,autoDivisions:['FPO','FPO','MA1']}]}).sports[0];
  assert.deepEqual(group.autoDivisions,['FPO']);
  assert.deepEqual(api.config.normalizeConfig({sports:[{...group,autoDivisions:[]}]}).sports[0].autoDivisions,[]);
});
test('live event wins over upcoming Major; MPO/FPO share metadata and retain through overlap and next-round cards',async()=>{
  const f=fixture(), upcoming=f.add('M','pregame'), live=f.add();
  let result=await f.client.discover();assert.deepEqual(ids(result),[`${live}:MPO`,`${live}:FPO`]);
  assert.equal(f.calls.filter(url=>url.pathname.endsWith('fetch_event')).length,2);
  f.set(live,'MPO','break');f.set(live,'FPO','pregame',2);f.set(upcoming,'MPO','live');
  result=await f.client.discover();assert.deepEqual(ids(result),[`${live}:MPO`,`${live}:FPO`]);
  assert.ok(result.automaticEntries.every(entry=>entry.candidate.state==='interrupted'));
  f.set(live,'MPO','live',2);assert.equal((await f.client.getEvent(`${live}:MPO`)).details.round,2);
  assert.ok(f.maximum()<=3);
});
test('missing division feed or metadata never proves final, and completion retains before advancing',async()=>{
  const f=fixture(), first=f.add(), second=f.add();
  await f.client.discover();f.set(first,'MPO','final');f.events.get(first).rounds.FPO=null;
  let result=await f.client.discover({retentionMs:60000});
  assert.deepEqual(ids(result),[`${first}:MPO`,`${first}:FPO`]);assert.equal(result.failures,1);
  f.advance(120000);f.events.get(first).metadataOffline=true;
  result=await f.client.discover({retentionMs:60000});assert.deepEqual(ids(result),[`${first}:MPO`,`${first}:FPO`]);
  f.events.get(first).metadataOffline=false;f.set(first,'FPO','final');
  result=await f.client.discover({retentionMs:60000});assert.ok(result.automaticEntries.every(entry=>Number.isFinite(entry.autoRetainUntil)));
  f.advance(59999);assert.deepEqual(ids(await f.client.discover({retentionMs:60000})),[`${first}:MPO`,`${first}:FPO`]);
  f.advance(1);assert.deepEqual(ids(await f.client.discover({retentionMs:60000})),[`${second}:MPO`,`${second}:FPO`]);
});
test('final retention zero advances immediately; ordinary retention is one hour',async()=>{
  for(const retentionMs of [undefined,0]) {
    const f=fixture(),first=f.add(),second=f.add();await f.client.discover();
    f.set(first,'MPO','final');f.set(first,'FPO','final');
    const result=await f.client.discover({retentionMs});
    assert.deepEqual(ids(result),retentionMs===0?[`${second}:MPO`,`${second}:FPO`]:[`${first}:MPO`,`${first}:FPO`]);
    if(retentionMs===undefined){f.advance(3600000);assert.deepEqual(ids(await f.client.discover()),[`${second}:MPO`,`${second}:FPO`]);}
  }
});
test('manual watch merges once with its player preferences; disabled watches and exclusions are respected',async()=>{
  const f=fixture(),id=f.add(),other=f.add();
  const watches=[{tournamentId:id,division:'MPO',enabled:true,view:'player',playerId:'123'},
    {tournamentId:id,division:'FPO',enabled:false}];
  const client=api.pdga.createClient({...f.options,watches});
  const result=await client.discover();assert.deepEqual(ids(result),[`${id}:MPO`]);
  assert.equal(result.availableEntries.filter(entry=>entry.candidate.id===`${id}:MPO`).length,1);
  const event=await client.getEvent(`${id}:MPO`);assert.equal(event.details.view,'player');assert.equal(event.details.automatic,false);
  assert.deepEqual(ids(await client.discover({excludedKeys:[`disc-golf:${id}:MPO`]})),[`${id}:MPO`,`${other}:MPO`,`${other}:FPO`]);
  // Manual entry remains offered by the provider; rotation exclusions remove it.
  const config=api.config.normalizeConfig({sports:[{sport:'disc-golf',autoFollow:true,events:watches}]});
  assert.equal(api.config.isCandidateEnabled(config,{sport:'disc-golf',id:`${id}:FPO`,raw:{automatic:true,division:'FPO'}}),false);
});
test('disabling discovery and division choices immediately revoke automatic eligibility including Live mode',async()=>{
  const f=fixture(),id=f.add();const result=await f.client.discover();
  const config=api.config.normalizeConfig({sports:[{sport:'disc-golf',autoFollow:true}]});
  const mode=api.liveMode.create();mode.setActive(true,result.automaticEntries);
  const options={rotation:result.automaticEntries,available:[],enabledSports:['disc-golf'],allows:entry=>api.config.isCandidateEnabled(config,entry.candidate)};
  assert.equal(mode.update(options).length,2);
  config.sports[0].autoDivisions=['MPO'];assert.equal(mode.update(options).length,1);
  config.sports[0].autoFollow=false;assert.equal(mode.update(options).length,0);
  const before=f.calls.length;const disabled=api.pdga.createClient({...f.options,autoFollow:false});
  assert.deepEqual(ids(await disabled.discover()),[]);assert.equal(f.calls.length,before);
  await assert.rejects(disabled.getEvent(`${id}:MPO`),/not watched/);
});
test('fallback choices, unsupported formats, amateur tiers and directory cadence',async()=>{
  const f=fixture(),up=f.add('ES','pregame'),final=f.add('M','final');
  const amateur=f.add('A'),doubles=f.add();f.events.get(doubles).metadata.ScoringFormat='D';
  assert.deepEqual(ids(await f.client.discover()),[`${up}:MPO`,`${up}:FPO`]);
  assert.deepEqual(ids(await f.client.discover({fallbackMode:'hide'})),[]);
  assert.deepEqual(ids(await f.client.discover({fallbackMode:'recent-final'})),[`${final}:MPO`,`${final}:FPO`]);
  assert.ok(!f.calls.some(url=>url.searchParams.get('TournID')===amateur));
  const directoryCalls=()=>f.calls.filter(url=>url.pathname.includes('current-events')).length;
  assert.equal(directoryCalls(),1);f.advance(899999);await f.client.discover();assert.equal(directoryCalls(),1);
  f.advance(1);await f.client.discover();assert.equal(directoryCalls(),2);
  // Recreating clients for settings edits preserves both cadence and selection.
  await api.pdga.createClient(f.options).discover();assert.equal(directoryCalls(),2);
});
test('selected tournament survives directory rollover and request concurrency stays bounded',async()=>{
  const f=fixture(),first=f.add();for(let i=0;i<8;i++)f.add();
  await f.client.discover();f.directory.splice(0,1);f.advance(900000);
  assert.deepEqual(ids(await f.client.discover()),[`${first}:MPO`,`${first}:FPO`]);assert.equal(f.maximum(),3);
});
test('shared refresh cache keeps directory requests at fifteen minutes across clients',async()=>{
  let now=0,calls=0;const config=api.config.normalizeConfig();
  const cache=api.providerRefresh.create({config:()=>config,now:()=>now,fetchImpl:async()=>{calls++;return Response.json([]);}});
  const options={autoFollow:true,now:()=>now,fetchImpl:cache.fetchFor('disc-golf',api.pdga)};
  await api.pdga.createClient(options).discover();now=60000;await api.pdga.createClient(options).discover();assert.equal(calls,1);
  now=900000;await api.pdga.createClient(options).discover();assert.equal(calls,2);
});

test('expired finals outside the directory window cannot become a permanent recent-final fallback',async()=>{
  const f=fixture(),id=f.add();await f.client.discover();
  f.set(id,'MPO','final');f.set(id,'FPO','final');
  await f.client.discover({fallbackMode:'recent-final',retentionMs:1000});
  f.directory.length=0;f.advance(900000);
  assert.deepEqual(ids(await f.client.discover({fallbackMode:'recent-final',retentionMs:1000})),[]);
});

test('unselected discovered finals stay available through metadata failures and recover',async()=>{
  const f=fixture(),id=f.add('ES','final');
  const initial=await f.client.discover({fallbackMode:'up-next'});
  assert.deepEqual(ids(initial),[]);
  assert.deepEqual(initial.availableEntries.map(entry=>entry.candidate.id),[`${id}:MPO`,`${id}:FPO`]);
  f.events.get(id).metadataOffline=true;
  for(let i=0;i<3;i++) {
    const failed=await f.client.discover({fallbackMode:'up-next'});
    assert.deepEqual(ids(failed),[]);
    assert.deepEqual(failed.availableEntries.map(entry=>entry.candidate.id),[`${id}:MPO`,`${id}:FPO`]);
    assert.ok(failed.availableEntries.every(entry=>entry.candidate.raw.stale && entry.candidate.raw.automatic));
    assert.ok(failed.failures>0);
    assert.equal((await f.client.getEvent(`${id}:FPO`)).details.stale,true);
  }
  f.events.get(id).metadataOffline=false;
  const recovered=await f.client.discover();
  assert.equal(recovered.failures,0);
  assert.ok(recovered.availableEntries.every(entry=>!entry.candidate.raw.stale));
});
test('cached available divisions still respect settings, directory expiry and unsupported formats during outages',async()=>{
  const f=fixture(),id=f.add('ES','final');await f.client.discover();
  f.events.get(id).metadataOffline=true;
  const mpo=api.pdga.createClient({...f.options,autoDivisions:['MPO']});
  assert.deepEqual((await mpo.discover()).availableEntries.map(entry=>entry.candidate.id),[`${id}:MPO`]);
  const disabled=api.pdga.createClient({...f.options,watches:[{tournamentId:id,division:'MPO',enabled:false}]});
  assert.deepEqual((await disabled.discover()).availableEntries.map(entry=>entry.candidate.id),[`${id}:FPO`]);
  assert.deepEqual((await api.pdga.createClient({...f.options,autoFollow:false}).discover()).availableEntries,[]);
  f.events.get(id).metadataOffline=false;f.events.get(id).metadata.ScoringFormat='D';
  assert.deepEqual((await f.client.discover()).availableEntries,[]);
  f.directory.length=0;f.advance(900000);
  assert.deepEqual((await f.client.discover()).availableEntries,[]);
});
test('manual preferences survive metadata outages without duplicate discovered divisions',async()=>{
  const f=fixture(),id=f.add('ES','final');
  const client=api.pdga.createClient({...f.options,watches:[{tournamentId:id,division:'MPO',enabled:true,view:'player',playerId:'123'}]});
  await client.discover();f.events.get(id).metadataOffline=true;
  const failed=await client.discover();
  assert.deepEqual(failed.availableEntries.map(entry=>entry.candidate.id),[`${id}:MPO`,`${id}:FPO`]);
  assert.equal(failed.availableEntries[0].candidate.raw.automatic,false);
  assert.deepEqual(ids(failed),[`${id}:MPO`]);
  const manual=await client.getEvent(`${id}:MPO`);
  assert.equal(manual.details.view,'player');assert.equal(manual.details.playerId,'123');
});

test('recent-final fallback does not move between rotation and available games during metadata outages',async()=>{
  const f=fixture(),id=f.add('ES','final');
  const options={fallbackMode:'recent-final'};
  assert.deepEqual(ids(await f.client.discover(options)),[`${id}:MPO`,`${id}:FPO`]);
  f.events.get(id).metadataOffline=true;
  const failed=await f.client.discover(options);
  assert.deepEqual(ids(failed),[`${id}:MPO`,`${id}:FPO`]);
  assert.ok(failed.automaticEntries.every(entry=>entry.candidate.raw.stale));
  f.events.get(id).metadataOffline=false;
  assert.deepEqual(ids(await f.client.discover(options)),[`${id}:MPO`,`${id}:FPO`]);
});

test('unselected player banners stay out of discovery and cannot reappear as automatic leaderboards', async()=>{
 const f=fixture(),id=f.add();
 const pending={tournamentId:id,division:'MPO',enabled:true,view:'player',playerId:''};
 const leaderboard={...pending,view:'leaderboard',bannerId:'leaders'};
 const client=api.pdga.createClient({...f.options,autoDivisions:['MPO'],watches:[pending,leaderboard]});
 let result=await client.discover({topFavoriteOnly:true});
 assert.deepEqual(ids(result),[`${id}:MPO:banner:leaders`]);
 assert.deepEqual(result.availableEntries.map(e=>e.candidate.id),[`${id}:MPO:banner:leaders`]);
 await assert.rejects(client.getEvent(`${id}:MPO`),/not watched/);
 pending.playerId='123';
 result=await client.discover();assert.equal(result.automaticEntries.length,2);
 assert.equal((await client.getEvent(`${id}:MPO`)).details.playerId,'123');
 pending.playerId='';
 result=await client.discover();assert.deepEqual(ids(result),[`${id}:MPO:banner:leaders`]);
});
