'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../core/config.js');
require('../../../core/event-model.js');
require('../../../core/provider-refresh.js');
require('../../../sports/disc-golf/providers/pdga.js');
const api = globalThis.SportsOverlay;
let nextId = 970000;

function fixture({ phase = 'live', round = 1, finalRound = 2 } = {}) {
  const id = String(++nextId), calls = [], config = api.config.normalizeConfig();
  const session = api.pdga.createSession();
  const metadata = { Name: 'Cache Test Open', ScoringFormat: 'S', FinalRound: finalRound,
    Divisions: ['MPO', 'FPO'].map(Division => ({ Division, LatestRound: round })) };
  const rounds = new Map();
  let time = 0, failure = null;
  const put = (division, current, state, played = 5) => rounds.set(`${division}:${current}`, { scores: [{
    Name: `Test ${division} player`, PDGANum: division === 'MPO' ? 123 : 456, Round: current,
    Played: state === 'live' ? played : state === 'final' ? 18 : 0,
    RoundStarted: ['live', 'final'].includes(state) ? 1 : 0, Completed: state === 'final' ? 1 : 0,
    RunningPlace: 1, RoundScore: ['live', 'final'].includes(state) ? 55 : 0,
  }] });
  for (const division of ['MPO', 'FPO']) put(division, round, phase);
  const cache = api.providerRefresh.create({ config: () => config, now: () => time,
    wallNow: () => Date.parse('2026-10-07T00:00:00Z') + time, sleep: async () => {},
    fetchImpl: async value => {
      const url = new URL(value); calls.push({ url, time });
      if (url.pathname.endsWith('fetch_event')) {
        if (failure) return Response.json({}, failure);
        return Response.json({ data: metadata });
      }
      return Response.json({ data: rounds.get(`${url.searchParams.get('Division')}:${url.searchParams.get('Round')}`) });
    } });
  const fetch = cache.fetchFor('disc-golf', api.pdga);
  const options = { session, now: () => time, fetchImpl: fetch, watches: [
    ...['MPO', 'FPO'].map(division => ({ tournamentId: id, division, enabled: true })),
    { tournamentId: id, division: 'MPO', enabled: true, bannerId: 'player', view: 'player', playerId: '123' },
  ] };
  const client = api.pdga.createClient(options);
  return { id, metadata, put, calls, config, fetch, client, recreate: () => api.pdga.createClient(options),
    time: value => { time = value; }, fail: value => { failure = value; },
    event: (division = 'MPO') => client.getEvent(`${id}:${division}`),
    metadataCalls: () => calls.filter(call => call.url.pathname.endsWith('fetch_event')).length,
    roundCalls: () => calls.filter(call => call.url.pathname.endsWith('fetch_round')).length };
}

test('live PDGA scores update every 30 seconds while clients, divisions and player banners reuse metadata', async () => {
  const f = fixture();
  await f.client.discover();
  assert.equal(f.metadataCalls(), 1); assert.equal(f.roundCalls(), 2);
  for (const time of [30000, 60000, 90000]) {
    f.time(time); f.put('MPO', 1, 'live', time / 30000 + 5);
    assert.equal((await f.event()).competitors[0].played, time / 30000 + 5);
    await f.client.getEvent(`${f.id}:MPO:banner:player`);
    assert.equal(f.metadataCalls(), 1);
  }
  f.time(120000); await f.event(); assert.equal(f.metadataCalls(), 2);
  f.time(150000); await f.recreate().discover(); assert.equal(f.metadataCalls(), 2);
  assert.equal(f.roundCalls(), 8);
});

test('upcoming fields and round breaks cache metadata for five minutes without slowing the start of play', async () => {
  for (const round of [1, 2]) {
    const f = fixture({ phase: 'pregame', round, finalRound: 3 });
    const expected = round === 1 ? 'pregame' : 'interrupted';
    assert.equal((await f.event()).state, expected);
    for (const time of [60000, 120000, 299999]) {
      f.time(time); assert.equal((await f.event()).state, expected);
      assert.equal(f.metadataCalls(), 1);
    }
    f.time(300000); await f.event(); assert.equal(f.metadataCalls(), 2);
    f.time(360000); f.put('MPO', round, 'live');
    assert.equal((await f.event()).state, 'live');
    assert.equal(f.metadataCalls(), 2);
  }
});

test('completed intermediate rounds expire metadata once and load a newly posted round immediately', async () => {
  const f = fixture(); await f.event();
  f.time(30000); f.put('MPO', 1, 'final');
  f.metadata.Divisions[0].LatestRound = 2; f.put('MPO', 2, 'live');
  assert.equal((await f.event()).detailedState, 'Round complete');
  const next = await f.event();
  assert.equal(next.details.round, 2); assert.equal(next.state, 'live');
  assert.equal(f.metadataCalls(), 2);
  await f.event(); assert.equal(f.metadataCalls(), 2);
});

test('an unpublished next round does not cause repeated metadata invalidation', async () => {
  const f = fixture(); await f.event();
  f.time(30000); f.put('MPO', 1, 'final'); await f.event();
  await f.event(); assert.equal(f.metadataCalls(), 2);
  for (const time of [60000, 90000, 120000, 329999]) {
    f.time(time); await f.event(); assert.equal(f.metadataCalls(), 2);
  }
  f.time(330000); await f.event(); assert.equal(f.metadataCalls(), 3);
});

test('finished tournaments cache metadata for fifteen minutes only after all listed divisions are confirmed final', async () => {
  const f = fixture({ phase: 'final', round: 2 });
  await f.client.discover();
  for (const time of [60000, 300000, 899999]) {
    f.time(time); await f.client.discover(); assert.equal(f.metadataCalls(), 1);
  }
  f.time(900000); await f.client.discover(); assert.equal(f.metadataCalls(), 2);

  const mixed = fixture({ round: 2 }); mixed.put('MPO', 2, 'final');
  await mixed.client.discover(); mixed.time(120000); await mixed.event();
  assert.equal(mixed.metadataCalls(), 2, 'a live FPO division keeps metadata on its live cadence');
  const unknown = fixture({ phase: 'final', round: 2 }); await unknown.event();
  unknown.time(300000); await unknown.event();
  assert.equal(unknown.metadataCalls(), 2, 'an unchecked FPO division cannot prove completion');
});

test('longer configured PDGA intervals remain authoritative', async () => {
  for (const phase of ['live', 'pregame']) {
    const f = fixture({ phase, round: 2, finalRound: 3 });
    f.config.providerRefreshSeconds['disc-golf'].live = 1800;
    await f.event(); f.time(300000); await f.event(); assert.equal(f.metadataCalls(), 1);
    f.time(1800000); await f.event(); assert.equal(f.metadataCalls(), 2);
  }
});

test('metadata failures preserve last received scores and recover on normal live retry timing', async () => {
  const f = fixture(); await f.event();
  f.time(120000); f.fail({ status: 503 });
  assert.equal((await f.event()).details.stale, true);
  f.time(149999); f.fail(null); assert.equal((await f.event()).details.stale, true);
  assert.equal(f.metadataCalls(), 2);
  f.time(150000); assert.equal((await f.event()).details.stale, false);
  assert.equal(f.metadataCalls(), 3);
});

test('metadata invalidation and manual retry cannot bypass PDGA rate-limit cooldowns', async () => {
  const f = fixture(); f.fail({ status: 429, headers: { 'Retry-After': '120' } });
  await assert.rejects(f.client.getMetadata(f.id), /429/);
  f.time(60000); f.fail(null); f.fetch.retryFailed();
  f.fetch.invalidate(`https://www.pdga.com/apps/tournament/live-api/live_results_fetch_event?TournID=${f.id}`);
  await assert.rejects(f.client.getMetadata(f.id), /429/);
  assert.equal(f.metadataCalls(), 1);
  f.time(120000); await f.client.getMetadata(f.id); assert.equal(f.metadataCalls(), 2);
});
