'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../core/event-model.js');
require('../../../core/config.js');
require('../../../core/registry.js');
require('../../../core/live-mode.js');
require('../../../core/provider-refresh.js');
require('../../../sports/disc-golf/providers/pdga.js');
require('../../../admin/pdga-settings.js');
const api = globalThis.SportsOverlay;
const metadata = require('./event.json');
const round = require('./round.json');
const watch = { tournamentId: '86076', division: 'MPO', enabled: true, view: 'leaderboard', playerId: '' };
const normalize = (r = round, m = metadata) => api.pdga.normalizeEvent(m, r, watch);

test('displayed PDGA scores promote shared discovery metadata and prioritize the round fetch', async () => {
  let release;
  const calls = [], promotions = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('fetch_event')) await new Promise(resolve => { release = resolve; });
    return Response.json({ data: url.includes('fetch_event') ? metadata : round });
  };
  fetchImpl.prioritize = url => promotions.push(url);
  const client = api.pdga.createClient({ watches: [watch], fetchImpl });
  const discovered = client.getMetadata(watch.tournamentId);
  const displayed = client.getEvent('86076:MPO', undefined, { priority: 'display' });
  assert.equal(calls.length, 1);
  assert.deepEqual(promotions, [calls[0].url]);
  release();
  await Promise.all([discovered, displayed]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.priority, 'display');
});

test('real PDGA round maps a field, authoritative playoff places and round number', () => {
  const event = normalize();
  assert.equal(event.competitionType, 'individual');
  assert.equal(event.teams, undefined);
  assert.equal(event.state, 'final');
  assert.equal(event.details.round, 3); // raw id is the division ID (100)
  assert.equal(event.competitors.length, 20);
  assert.deepEqual(event.competitors.slice(0,2).map(p => [p.name, p.total, p.place, p.wonPlayoff]),
    [['Jeremy Koling',-18,1,true],['Ezra Robinson',-18,2,false]]);
  const candidate = api.pdga.toCandidate(event);
  assert.equal(candidate.id, '86076:MPO');
  assert.equal(candidate.sport, 'disc-golf');
  assert.ok(candidate.competitorKeys.includes('33705'));
  assert.equal(event.details.fullName, metadata.Name);
  assert.equal(candidate.raw.fullName, metadata.Name);
});
test('LoCo Open first-round live totals use ParThruRound when ToPar is empty', () => {
  // Public 98293/MPO round-one feed, October 3, 2026.
  const event = normalize(require('./live-round.json'));
  assert.equal(event.state, 'live');
  assert.deepEqual(event.competitors.map(p => [p.name, p.total, p.roundToPar]), [
    ['Lucas Oberholtzer Hess', -2, -2], ['Matt Hammersten', -1, -1], ['Conor Hahler', -1, -1],
  ]);
});
test('running totals take precedence over posted totals, including even par', () => {
  const score = {Round:2, RoundStarted:1, ToPar:-4, RoundtoPar:-2, ParThruRound:'-6'};
  assert.equal(api.pdga.normalizePlayer(score).total, -6);
  assert.equal(api.pdga.normalizePlayer({...score, ParThruRound:0}).total, 0);
  for (const ParThruRound of [null, undefined, '', 'invalid']) {
    assert.equal(api.pdga.normalizePlayer({...score, ParThruRound}).total, -4);
  }
  assert.equal(api.pdga.normalizePlayer({...score, Round:1, RoundStarted:0}).total, null);
  assert.equal(api.pdga.normalizePlayer({...score, RoundStatus:'WD'}).total, null);
  assert.equal(api.pdga.normalizePlayer({...score, RoundStarted:0, ParThruRound:-4}).total, -4);
  assert.equal(api.pdga.normalizePlayer({...score, ToPar:null, ParThruRound:null}).total, null);
});
test('upcoming fields sort by player rating, with alphabetical ties and unrated players last', () => {
  const scores = [
    {Name:'A Unrated', Rating:0}, {Name:'B Lower', Rating:'1010'},
    {Name:'Z Highest', Rating:1050}, {Name:'C Equal', Rating:1010},
    {Name:'D Invalid', Rating:'unknown'}, {Name:'E Missing'},
  ].map((player, index) => ({...player, Round:1, RunningPlace:index+1}));
  const event = normalize({scores});
  assert.equal(event.state, 'pregame');
  assert.deepEqual(event.competitors.map(p => p.name), ['Z Highest','B Lower','C Equal','A Unrated','D Invalid','E Missing']);
  assert.deepEqual(event.competitors.map(p => p.rating), [1050,1010,1010,null,null,null]);
  assert.ok(event.competitors.every(p => p.place === null && p.total === null));
});
test('live, final and between-round standings take precedence over player ratings', () => {
  for (const phase of ['live','final','break']) {
    const scores = [
      {Name:'Higher rated', Rating:1050, RunningPlace:2, ToPar:-4},
      {Name:'Tournament leader', Rating:1010, RunningPlace:1, ToPar:-6},
    ].map(player => ({...player, Round:phase === 'break' ? 2 : 1,
      RoundStarted:phase === 'break' ? 0 : 1, Completed:phase === 'final' ? 1 : 0}));
    const event = normalize({scores}, {...metadata, FinalRound:1});
    assert.equal(event.competitors[0].name, 'Tournament leader');
    assert.equal(event.competitors[0].place, 1);
  }
});
test('round completion, not the calendar, governs event status', () => {
  assert.equal(normalize(round, {...metadata,FinalRound:4}).state, 'interrupted');
  const live = structuredClone(round); Object.assign(live.scores[0], {Completed:0,Played:12});
  assert.equal(normalize(live).state, 'live');
  const pregame = {scores:[{Name:'New player',Round:1,RoundStarted:0,HasRoundScore:0,Played:0,ToPar:0,RoundtoPar:0,RunningPlace:1}],layouts:[]};
  const event = normalize(pregame);
  assert.equal(event.state,'pregame');
  assert.equal(event.competitors[0].total,null);
  assert.equal(event.competitors[0].place,null);
});
test('null, ties, DNF, withdrawn and unplayed players never become numeric scores', () => {
  for (const RoundScore of [888,999,'999']) {
    const player = api.pdga.normalizePlayer({...round.scores[0],RoundScore});
    assert.equal(player.status,'DNF'); assert.equal(player.total,null); assert.equal(player.place,null);
  }
  assert.equal(api.pdga.normalizePlayer({...round.scores[0],RoundStatus:'WD'}).status,'WD');
  assert.equal(api.pdga.normalizePlayer({...round.scores[0],Tied:'1',ToPar:null}).tied,true);
  assert.equal(api.pdga.normalizePlayer({...round.scores[0],ToPar:null}).total,null);
  assert.equal(api.pdga.normalizePlayer({...round.scores[0],ToPar:0}).total,0);
});
test('Buffalo Run round 2 DNF card cannot make an unstarted field live', () => {
  // Public feed for 103574/MPO, checked October 2, 2026: the DNF has
  // Played=18 despite RoundStarted=0 and all remaining players awaiting tees.
  const scores = [
    { Name:'Waiting player', Round:2, RoundStarted:0, HasRoundScore:0, Played:null, Holes:18, Completed:0, RoundScore:0, ToPar:-10, RunningPlace:1 },
    { Name:'DNF player', Round:2, RoundStarted:0, HasRoundScore:0, Played:18, Holes:18, Completed:1, RoundStatus:'', RoundScore:'999' },
  ];
  const event = normalize({scores}, {...metadata, FinalRound:3});
  assert.equal(event.state, 'interrupted');
  assert.equal(event.detailedState, 'Awaiting round 2');
  assert.equal(event.competitors[0].total, -10);
  assert.equal(event.competitors[0].roundScore, null);
  assert.equal(api.pdga.toCandidate(event).raw.detailedState, 'Awaiting round 2');
  assert.equal(api.pdga.refreshState({data:{scores}}, 'live_results_fetch_round'), 'pregame');
  for (const status of ['WD','DNS','DQ','DNF']) {
    scores[1] = {...scores[1], Completed:0, RoundScore:0, RoundStatus:status, RoundStarted:1};
    assert.equal(normalize({scores}).state, 'interrupted');
  }
  scores[0].Played = 1;
  assert.equal(normalize({scores}).state, 'live');
});
test('finished cards and unstarted players show a gap, while an unfinished player keeps play live', () => {
  const done = {...round.scores[0], Round:1};
  const waiting = {Round:1, RoundStarted:0, HasRoundScore:0, Played:0, Completed:0};
  const event = normalize({scores:[done,waiting]});
  assert.equal(event.state, 'interrupted');
  assert.equal(event.detailedState, 'Awaiting remaining players');
  assert.equal(normalize({scores:[done,{...waiting,RoundStarted:1}]}).state, 'live');
  assert.equal(normalize({scores:[done]}).detailedState, 'Round complete');
  assert.equal(normalize({scores:[waiting]}).state, 'pregame');
});
test('settings preserve teams and normalize saved divisions and view preferences', () => {
  const config = api.config.normalizeConfig({sports:[{sport:'disc-golf',events:[watch,{...watch}, {...watch,division:'fpo',view:'player',playerId:123}, {...watch,tournamentId:'bad'}]}]});
  assert.equal(config.sports[0].events.length,2);
  assert.equal(config.sports[0].events[1].division,'FPO');
  assert.equal(config.sports[0].events[1].playerId,'123');
  assert.equal(config.providerRefreshSeconds['disc-golf'].live,30);
  assert.deepEqual(api.config.normalizeConfig(config),config);
  assert.equal(api.config.normalizeConfig({}).sports.at(-1).events.length,0);
});
test('tournament links only resolve PDGA event IDs', () => {
  for (const value of ['86076','https://www.pdga.com/tour/event/86076','https://www.pdgalive.com/event/86076']) assert.equal(api.pdgaSettings.tournamentId(value),'86076');
  for (const value of ['https://evil.example/event/86076','0','1234xyz','']) assert.equal(api.pdgaSettings.tournamentId(value),'');
});
test('discovery isolates failed divisions and preserves last good scores as stale', async () => {
  let fail = false;
  const client = api.pdga.createClient({watches:[watch,{...watch,tournamentId:'90000'}],fetchImpl:async url => {
    if (fail || url.includes('90000')) return new Response('{}',{status:503});
    return Response.json({data:url.includes('fetch_event')?metadata:round});
  }});
  const initial = await client.discover();
  assert.equal(initial.availableEntries.length,1); assert.equal(initial.failures,1);
  fail = true;
  const stale = await client.getEvent('86076:MPO');
  assert.equal(stale.details.stale,true); assert.equal(stale.competitors[0].total,-18);
  const failed = await client.discover(); assert.equal(failed.availableEntries.length,1); assert.equal(failed.failures,2);
});
test('a registered first-round division with no score feed remains upcoming', async () => {
  const client = api.pdga.createClient({watches:[{...watch,tournamentId:'90001'}],fetchImpl:async url =>
    url.includes('fetch_event') ? Response.json({data:{...metadata,LatestRound:1,HighestCompletedRound:0,Divisions:[{Division:'MPO',LatestRound:1}]}}) : new Response('{}',{status:404})});
  const event = await client.getEvent('90001:MPO');
  assert.equal(event.state,'pregame'); assert.deepEqual(event.competitors,[]);
  assert.equal((await client.getEvent('90001:MPO')).details.stale,false);
});
test('only individual stroke play is accepted', async () => {
  const client = api.pdga.createClient({fetchImpl:async()=>Response.json({data:{...metadata,ScoringFormat:'D'}})});
  await assert.rejects(client.getMetadata('86076'),/individual stroke-play/);
});

test('Live mode drops an explicitly removed PDGA division even when its feed disappears', () => {
  const config = api.config.normalizeConfig({sports:[{sport:'disc-golf',events:[watch]}]});
  const entry = {candidate:{...api.pdga.toCandidate(normalize()),state:'live'}};
  const mode = api.liveMode.create();
  mode.setActive(true,[entry]);
  const options = {enabledSports:['disc-golf'],allows:item=>api.config.isCandidateEnabled(config,item.candidate)};
  assert.equal(mode.update({...options,rotation:[entry],available:[entry]}).length,1);
  config.sports[0].events = [];
  assert.deepEqual(mode.update({...options,rotation:[],available:[]}),[]);
});

test('live PDGA errors retain HTTP status and back off without hammering upstream', async () => {
  const config = api.config.normalizeConfig();
  let now=0,calls=0,fail=false;
  const cache = api.providerRefresh.create({config:()=>config,now:()=>now,fetchImpl:async()=>{
    calls++; return fail ? new Response('{}',{status:503}) : Response.json({data:{scores:[{RoundStarted:1,Played:1}]}});
  }});
  const fetch = cache.fetchFor('disc-golf',api.pdga);
  const url='https://www.pdga.com/apps/tournament/live-api/live_results_fetch_round?TournID=1';
  await fetch(url);
  now=30000; fail=true; await assert.rejects(fetch(url),error=>error.status===503);
  now=60000; await assert.rejects(fetch(url)); assert.equal(calls,3);
  now=90000; await assert.rejects(fetch(url)); assert.equal(calls,3);
  now=120000; await assert.rejects(fetch(url)); assert.equal(calls,4);
  now=240000; await assert.rejects(fetch(url)); assert.equal(calls,5);
  now=480000; await assert.rejects(fetch(url)); assert.equal(calls,6);
  now=779999; await assert.rejects(fetch(url)); assert.equal(calls,6);
  now=780000; fail=false; await fetch(url); assert.equal(calls,7);
  now=810000; await fetch(url); assert.equal(calls,8);
});

test('upcoming PDGA failures keep routine checks and recover automatically into live scoring', async () => {
  const config = api.config.normalizeConfig();
  const upcomingMetadata = {...metadata,LatestRound:1,HighestCompletedRound:0,Divisions:[{Division:'MPO',LatestRound:1}]};
  let now=0,fail=false,started=false;
  const calls = {metadata:0,round:0};
  const cache = api.providerRefresh.create({config:()=>config,now:()=>now,fetchImpl:async url=>{
    const isMetadata = url.includes('fetch_event');
    calls[isMetadata ? 'metadata' : 'round']++;
    if (fail) return new Response('{}',{status:503});
    return Response.json({data:isMetadata ? upcomingMetadata : {scores:[{Name:'Player',Round:1,RoundStarted:started ? 1 : 0,Played:started ? 1 : 0,TeeTime:'09:00'}]}});
  }});
  const client = api.pdga.createClient({watches:[{...watch,tournamentId:'90002'}],fetchImpl:cache.fetchFor('disc-golf',api.pdga)});
  assert.equal((await client.getEvent('90002:MPO')).state,'pregame');
  fail=true;
  for (now=60000; now<=300000; now+=60000) {
    const discovery = await client.discover();
    assert.equal(discovery.availableEntries[0].candidate.state,'pregame');
    assert.equal(discovery.availableEntries[0].candidate.raw.stale,false);
    assert.equal(discovery.failures,0);
    assert.equal((await client.getEvent('90002:MPO')).competitors[0].teeTime,'09:00');
    assert.equal(calls.metadata,now < 300000 ? 1 : 2);
    if (now < 300000) assert.equal(calls.round,1+now/60000);
  }
  // Healthy cached metadata lets round checks continue through their own
  // failures. Once metadata expires, its failure blocks the next round check.
  assert.equal(calls.round,5);
  fail=false; started=true;
  const live = await client.getEvent('90002:MPO');
  assert.equal(live.state,'live'); assert.equal(live.details.stale,false);
  now+=30000;
  await client.getEvent('90002:MPO');
  assert.equal(calls.round,7);
});

test('a missing first score feed uses upcoming checks rather than live retries', async () => {
  const config = api.config.normalizeConfig();
  let now=0,calls=0;
  const cache = api.providerRefresh.create({config:()=>config,now:()=>now,fetchImpl:async()=>{
    calls++; return new Response('{}',{status:404});
  }});
  const fetch = cache.fetchFor('disc-golf',api.pdga);
  const url='https://www.pdga.com/apps/tournament/live-api/live_results_fetch_round?TournID=90003';
  await assert.rejects(fetch(url));
  now=30000; await assert.rejects(fetch(url)); assert.equal(calls,1);
  for (now=60000; now<=300000; now+=60000) {
    await assert.rejects(fetch(url)); assert.equal(calls,1+now/60000);
  }
});

test('leaderboard and player banners for one division survive discovery independently', async () => {
  const watches = [watch, {...watch,bannerId:'kevin',view:'player',playerId:'41760'}];
  const client = api.pdga.createClient({watches,fetchImpl:async url=>({ok:true,json:async()=>({data:url.includes('fetch_event')?metadata:round})})});
  const result = await client.discover();
  assert.deepEqual(result.automaticEntries.map(e=>e.candidate.id),['86076:MPO','86076:MPO:banner:kevin']);
  const [board, player] = result.automaticEntries.map(e => e.candidate.raw);
  assert.equal(board.view, 'leaderboard');
  assert.equal(board.player, null);
  assert.equal(player.view, 'player');
  assert.equal(player.bannerLabel, 'Player · Kevin Jones');
  assert.deepEqual(player.player, {name:'Kevin Jones', place:4, tied:false, total:-12, roundToPar:-7,
    played:18, completed:true, started:true, teeTime:'14:36:00', status:''});
  assert.equal((await client.getEvent('86076:MPO:banner:kevin')).details.playerId,'41760');
  assert.equal((await client.getEvent('86076:MPO')).details.view,'leaderboard');
});
