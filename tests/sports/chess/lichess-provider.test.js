"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
require("../../../core/config.js"); require("../../../core/event-model.js"); require("../../../core/registry.js"); require("../../../sports/chess/providers/lichess.js");
const api = global.SportsOverlay.lichess;
const metadata = { tour: { id: "Tour1234", name: "Masters", info: { tc: "90+30" } }, defaultRoundId: "Round001",
  rounds: [{ id: "Round001", name: "Round 1", startsAt: 1000, ongoing: true }, { id: "Round002", name: "Round 2", startsAt: 10000 }] };
const payload = { tour: metadata.tour, round: metadata.rounds[0], games: [
  { id: "Game0001", players: [{ name: "White", fideId: 123, rating: 2700, clock: 6500 }, { name: "Black", fideId: 456, clock: 0 }], fen: "8/8/8/8/8/8/8/8 b - - 0 32", lastMove: "e2e4", status: "*" },
  { id: "Game0002", players: [{ name: "Player A" }, { name: "Player B" }], status: "½-½" },
] };
const watch = { tournamentId: "Tour1234", roundId: "", view: "overview", enabled: true };
const response = (value, status = 200) => ({ ok: status === 200, status, json: async () => structuredClone(value) });
test('tournament candidates describe live matchups and switch back to standings outside play', () => {
  const event = api.normalizeEvent(metadata, payload, watch);
  assert.equal(api.toCandidate(event).raw.bannerLabel, 'Live round matchups');
  assert.equal(api.toCandidate({...event,state:'interrupted'}).raw.bannerLabel, 'Top 10 players');
});
test('player candidates identify their view and resolve names from pairings or standings', () => {
  const event = api.normalizeEvent(metadata, payload, { ...watch, view: 'player', playerId: 'fide:123' });
  assert.equal(api.toCandidate(event).raw.view, 'player');
  assert.equal(api.toCandidate(event).raw.bannerLabel, 'Player · White');
  event.competitors = [];
  event.details.standings = [{ id: 'fide:123', name: 'White' }];
  assert.equal(api.toCandidate(event).raw.bannerLabel, 'Player · White', 'a player sitting out the current round retains their name');
  event.details.standings = [];
  assert.equal(api.toCandidate(event).raw.bannerLabel, 'Player · Player unavailable');
  event.details.playerId = '';
  assert.equal(api.toCandidate(event).raw.bannerLabel, 'Player · Choose a player');
});
test("chess reference parsing distinguishes tournaments, rounds, and game links", () => {
  assert.deepEqual(api.reference("Tour1234"), { id: "Tour1234", round: false });
  assert.deepEqual(api.reference("https://lichess.org/broadcast/masters/Tour1234"), { id: "Tour1234", round: false });
  assert.deepEqual(api.reference("https://lichess.org/broadcast/masters/round-1/Round001/Game0001#32"), { id: "Round001", round: true });
  for (const bad of ["https://evil.com/broadcast/masters/Tour1234", "https://lichess.org.evil.com/broadcast/masters/Tour1234", "http://lichess.org/broadcast/masters/Tour1234", "../Tour1234", "https://lichess.org/@/Tour1234"]) assert.equal(api.reference(bad), null);
});
test("current round advances to the nearest scheduled round before its start", () => {
  assert.equal(api.selectRound(metadata, "", 5000).id, "Round001");
  const next = structuredClone(metadata); delete next.rounds[0].ongoing; next.rounds[0].finishedAt = 4000;
  assert.equal(api.selectRound(next, "", 5000).id, "Round002");
  assert.equal(api.selectRound(next, "", 11000).id, "Round002");
  next.rounds[1].ongoing = true;
  assert.equal(api.selectRound(next, "", 11000).id, "Round002");
  assert.equal(api.selectRound(next, "Round001").id, "Round001");
  assert.equal(api.selectRound(next, "Missing1"), null);
  next.rounds.push({ id: 'Round003', startsAt: 20000 });
  delete next.rounds[1].ongoing;
  assert.equal(api.selectRound(next, '', 5000).id, 'Round002');
  next.rounds[1].finishedAt = 12000;
  next.rounds[2].finishedAt = 22000;
  assert.equal(api.selectRound(next, '', 23000).id, 'Round003');
});

test('a scheduled next round is upcoming with tournament standings, then breaks or goes live after its start', async () => {
  let now = Date.parse('2026-10-03T07:00:00Z');
  const meta = { tour: { id: 'Tour1234', name: 'League tournament' }, defaultRoundId: 'Round001', rounds: [
    { id: 'Round001', name: 'Round 1', startsAt: Date.parse('2026-09-19T11:00:00Z'), finished: true },
    { id: 'Round002', name: 'Round 2', startsAt: Date.parse('2026-10-03T11:00:00Z') },
    { id: 'Round003', name: 'Round 3', startsAt: Date.parse('2026-10-31T12:00:00Z') },
  ] };
  const round = { tour: meta.tour, round: meta.rounds[1], games: [] };
  const urls = [];
  const client = api.createClient({ watches: [watch], session: api.createSession(), now: () => now, fetchImpl: async url => {
    urls.push(url);
    return response(url.endsWith('/players') ? [{ name: 'Leader', score: 1, rank: 1, played: 1 }]
      : url.includes('/-/-/') ? round : meta);
  }});
  const discovered = await client.discover();
  const candidate = discovered.availableEntries[0].candidate;
  assert.equal(candidate.raw.roundName, 'Round 2');
  assert.equal(candidate.state, 'pregame');
  assert.equal(candidate.startTime, '2026-10-03T11:00:00.000Z');
  let event = await client.getEvent('Tour1234:auto');
  assert.equal(event.detailedState, 'Upcoming');
  assert.equal(event.details.standings[0].score, 1);
  assert.ok(urls.some(url => url.endsWith('/-/-/Round002')));
  assert.ok(!urls.some(url => url.endsWith('/-/-/Round001')));
  assert.equal(api.selectRound(meta, 'Round001', now).id, 'Round001');
  round.games.push({ id: 'Game0002', status: '½-½' }, { id: 'Game0003', status: '*' });
  event = await client.getEvent('Tour1234:auto');
  assert.equal(event.state, 'pregame', 'advance results do not turn future unstarted pairings into a break');
  assert.equal(event.details.games[0].result, '½-½');
  round.games[1].lastMove = 'd2d4';
  assert.equal((await client.getEvent('Tour1234:auto')).state, 'live', 'actual early play takes precedence over the scheduled start');
  delete round.games[1].lastMove;
  now = meta.rounds[1].startsAt;
  event = await client.getEvent('Tour1234:auto');
  assert.equal(event.state, 'interrupted');
  assert.equal(event.detailedState, 'Awaiting remaining games');
  round.games.push({ id: 'Game0001', status: '*', lastMove: 'e2e4' });
  assert.equal((await client.getEvent('Tour1234:auto')).state, 'live');
});
test("results, competitors, clock snapshots, turn, and event states normalize", () => {
  const live = api.normalizeEvent(metadata, payload, watch);
  assert.equal(live.state, "live"); assert.equal(live.id, "Tour1234:auto");
  assert.equal(live.details.games[0].turn, "black"); assert.equal(live.details.games[0].move, 32);
  assert.equal(live.competitors[0].id, "fide:123"); assert.equal(live.competitors[1].clock, 0);
  assert.equal(live.details.games[1].result, "½-½");
  const finalPayload = structuredClone(payload); finalPayload.games[0].status = "1-0";
  assert.equal(api.normalizeEvent(metadata, finalPayload, watch).state, "interrupted");
  assert.equal(api.normalizeEvent(metadata, finalPayload, { ...watch, roundId: "Round001" }).state, "final");
  finalPayload.round.id = "Round002";
  assert.equal(api.normalizeEvent(metadata, finalPayload, watch).state, "final");
  const upcoming = { ...payload, round: { ...payload.round, ongoing: false }, games: [] };
  assert.equal(api.normalizeEvent(metadata, upcoming, watch).state, "pregame");
  assert.equal(api.toCandidate(live).competitionType, "individual");
});
test("public resolution, watch discovery, top watch, and cached stale recovery", async () => {
  let offline = false;
  const session = api.createSession();
  const client = api.createClient({ session, watches: [watch, { ...watch, roundId: "Round001" }], now: () => 5000,
    fetchImpl: async url => response(url.endsWith("Tour1234") ? metadata : payload, offline ? 503 : 200) });
  const resolved = await client.resolve("https://lichess.org/broadcast/masters/round-1/Round001");
  assert.equal(resolved.metadata.tour.id, "Tour1234"); assert.equal(resolved.roundId, "Round001");
  assert.equal((await client.discover({ topFavoriteOnly: true })).automaticEntries.length, 1);
  assert.equal((await client.discover()).availableEntries.length, 2);
  offline = true;
  const event = await client.getEvent("Tour1234:auto");
  assert.equal(event.details.stale, true); assert.equal(event.competitors[0].name, "White");
  assert.equal((await client.discover()).failures, 2);
  await assert.rejects(client.getEvent("Missing1:auto"), /not watched/);
});
test('ongoing round flags and unplayed pairings do not imply live chess', () => {
  const next = {...payload, games:[]};
  assert.equal(api.roundState(next), 'pregame');
  next.games = [{id:'Game0001',status:'*'}];
  assert.equal(api.normalizeEvent(metadata,next,watch).state, 'pregame');
  assert.equal(api.gameState(next.games[0],next.round), 'pregame');
  next.games.push({id:'Game0002',status:'1-0',lastMove:'e2e4'});
  let event = api.normalizeEvent(metadata,next,watch);
  assert.equal(event.state, 'interrupted');
  assert.equal(event.detailedState, 'Awaiting remaining games');
  assert.equal(api.toCandidate(event).raw.detailedState, event.detailedState);
  next.games[0].lastMove = 'd2d4';
  assert.equal(api.roundState(next), 'live');
  next.round = {...next.round,ongoing:false};
  assert.equal(api.roundState(next), 'live', 'a long think or absent round flag cannot prove a pause');
  next.games[0].status = '0-1';
  assert.equal(api.roundState(next), 'final');
});
test('a posted next round stays on break until a board actually starts', () => {
  const meta = structuredClone(metadata);
  meta.rounds[0].finishedAt = 4000;
  // Completion wins over a lingering ongoing flag in metadata.
  assert.equal(api.selectRound(meta,'',11000).id, 'Round002');
  const next = {tour:meta.tour,round:meta.rounds[1],games:[{id:'Game0003',status:'*'}]};
  const event = api.normalizeEvent(meta,next,watch);
  assert.equal(event.state, 'interrupted');
  assert.equal(event.detailedState, 'Awaiting Round 2');
  assert.equal(api.normalizeEvent(meta,next,{...watch,roundId:'Round002'}).state, 'pregame');
  next.games[0].lastMove = 'e2e4';
  assert.equal(api.normalizeEvent(meta,next,watch).state, 'live');
});
test("Lichess requests are serialized, deduplicated, and paused for 60 seconds after 429", async () => {
  let active = 0, maximum = 0, calls = 0, now = 0, limited = false;
  const session = api.createSession(), client = api.createClient({ session, now: () => now,
    fetchImpl: async url => { calls++; maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return response(url.endsWith("top") ? { active: [{ tour: metadata.tour }] } : metadata, limited ? 429 : 200); } });
  await Promise.all([client.getMetadata("Tour1234"), client.getMetadata("Tour1234"), client.listCurrentEvents()]);
  assert.equal(maximum, 1); assert.equal(calls, 2);
  now = 900000; limited = true; await assert.rejects(client.getMetadata("Tour1234"), /429/);
  await assert.rejects(client.listCurrentEvents(), /rate limit/); assert.equal(calls, 3);
  now = 959999; await assert.rejects(client.listCurrentEvents(), /rate limit/); assert.equal(calls, 3);
  now = 1800000; limited = false; assert.equal((await client.listCurrentEvents()).length, 1); assert.equal(calls, 4);
});
test("configuration validates, deduplicates, preserves player selection, and gates locks", () => {
  const config = global.SportsOverlay.config.normalizeConfig({ sports: [{ sport: "chess", events: [watch, watch, { ...watch, roundId: "Round001", view: "player", playerId: "fide:123", enabled: false }, { tournamentId: "../bad" }] }] });
  const group = config.sports.find(group => group.sport === "chess");
  assert.equal(group.events.length, 2); assert.equal(group.events[1].playerId, "fide:123");
  const enabled = global.SportsOverlay.config.isCandidateEnabled;
  assert.equal(enabled(config, { sport: "chess", id: "Tour1234:auto" }), true);
  assert.equal(enabled(config, { sport: "chess", id: "Tour1234:Round001" }), false);
  group.enabled = false; assert.equal(enabled(config, { sport: "chess", id: "Tour1234:auto" }), false);
});

test('standings use published tournament scores and tiebreak ranks, excluding unscored players', () => {
  const standings = api.normalizeStandings([
    { name: 'Unscored', rank: 1 }, { name: 'Zero', score: 0, rank: 4 },
    { name: 'Tie second', score: 5.5, rank: 2, played: 7 },
    { name: 'Leader', score: 6, rank: 1 }, { name: 'Tie third', score: 5.5, rank: 3 },
  ]);
  assert.deepEqual(standings.map(p => p.name), ['Leader', 'Tie second', 'Tie third', 'Zero']);
  assert.equal(standings[1].played, 7);
  assert.throws(() => api.normalizeStandings({ games: [] }), /unavailable/);
});

test('desktop standings use the local bridge while browser standings use Lichess directly', async t => {
  const original = global.location;
  t.after(() => { if (original === undefined) delete global.location; else global.location = original; });
  for (const protocol of ['sportsover:', 'http:']) {
    global.location = { protocol };
    const urls = [];
    let limited = false;
    const client = api.createClient({ session: api.createSession(), fetchImpl: async url => {
      urls.push(url);
      return limited ? response({}, 429) : response([{ name: 'Leader', score: 1, rank: 1 }]);
    }});
    assert.equal((await client.getStandings('Tour1234'))[0].score, 1);
    assert.equal(urls[0], protocol === 'sportsover:' ? '/api/chess/broadcast/Tour1234/players' : 'https://lichess.org/broadcast/Tour1234/players');
    limited = true;
    await assert.rejects(client.getStandings('Tour1234'), /429/);
    await assert.rejects(client.getMetadata('Tour1234'), /rate limit/);
    assert.equal(urls.length, 2);
  }
});

test('tournament standings and player banners remain independent through discovery and a standings outage', async () => {
  let failed = false;
  const watches = [watch, { ...watch, bannerId: 'follow-white', view: 'player', playerId: 'fide:123' }];
  const client = api.createClient({ watches, session: api.createSession(), fetchImpl: async url => {
    if (url.endsWith('/players')) return failed ? response({}, 503) : response([{name:'Leader', score:5.5, rank:1, played:7}]);
    return response(url.includes('/-/-/') ? payload : metadata);
  }});
  const discovered = await client.discover();
  assert.deepEqual(discovered.automaticEntries.map(e => e.candidate.id), ['Tour1234:auto', 'Tour1234:auto:banner:follow-white']);
  assert.equal((await client.getEvent('Tour1234:auto')).details.standings[0].score, 5.5);
  assert.equal((await client.getEvent('Tour1234:auto:banner:follow-white')).details.playerId, 'fide:123');
  failed = true;
  const retained = await client.getEvent('Tour1234:auto');
  assert.equal(retained.details.standings[0].score, 5.5);
  assert.equal(retained.details.standingsUnavailable, true);
  assert.equal((await client.getEvent('Tour1234:auto:banner:follow-white')).details.stale, false);
});

test('429 thrown by the shared refresh cache activates cooldown and retries directory after that cooldown', async () => {
  let now=1000,calls=0,limited=true;
  const session=api.createSession();
  const client=api.createClient({session,now:()=>now,fetchImpl:async()=>{
    calls++;
    if(limited){const error=Error('Score provider returned HTTP 429');error.status=429;error.retryAt=121000;throw error;}
    return response({active:[]});
  }});
  await assert.rejects(client.listCurrentEvents(),/429/);
  await assert.rejects(client.getMetadata('Tour1234'),/rate limit/);
  assert.equal(calls,1);assert.equal(client.discoveryIntervalMs,120000);
  now=120999;await assert.rejects(client.listCurrentEvents(),/429/);assert.equal(calls,1);
  now=121000;limited=false;assert.deepEqual(await client.listCurrentEvents(),[]);assert.equal(calls,2);
});
