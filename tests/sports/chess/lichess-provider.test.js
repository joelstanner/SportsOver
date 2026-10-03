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
test("chess reference parsing distinguishes tournaments, rounds, and game links", () => {
  assert.deepEqual(api.reference("Tour1234"), { id: "Tour1234", round: false });
  assert.deepEqual(api.reference("https://lichess.org/broadcast/masters/Tour1234"), { id: "Tour1234", round: false });
  assert.deepEqual(api.reference("https://lichess.org/broadcast/masters/round-1/Round001/Game0001#32"), { id: "Round001", round: true });
  for (const bad of ["https://evil.com/broadcast/masters/Tour1234", "https://lichess.org.evil.com/broadcast/masters/Tour1234", "http://lichess.org/broadcast/masters/Tour1234", "../Tour1234", "https://lichess.org/@/Tour1234"]) assert.equal(api.reference(bad), null);
});
test("current round advances and keeps a completed round as a break before the next start", () => {
  assert.equal(api.selectRound(metadata, "", 5000).id, "Round001");
  const next = structuredClone(metadata); delete next.rounds[0].ongoing; next.rounds[0].finishedAt = 4000;
  assert.equal(api.selectRound(next, "", 5000).id, "Round001");
  assert.equal(api.selectRound(next, "", 11000).id, "Round002");
  next.rounds[1].ongoing = true;
  assert.equal(api.selectRound(next, "", 11000).id, "Round002");
  assert.equal(api.selectRound(next, "Round001").id, "Round001");
  assert.equal(api.selectRound(next, "Missing1"), null);
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
