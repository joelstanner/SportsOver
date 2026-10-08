'use strict';
require('../../../scripts/offline-network.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
require('../../../core/config.js');
require('../../../core/event-model.js');
require('../../../core/provider-refresh.js');
require('../../../sports/chess/providers/lichess.js');
const api = global.SportsOverlay;

function fixture(state = 'live', watchOptions = {}) {
  const epoch = Date.parse('2026-10-07T18:00:00Z');
  let time = 0, limited = false;
  const calls = [];
  const metadata = { tour: { id: 'Tour1234', name: 'Masters' }, rounds: [
    { id: 'Round001', name: 'Round 1', startsAt: epoch - 1000, ongoing: state === 'live' },
    { id: 'Round002', name: 'Round 2', startsAt: epoch + 86400000 },
  ] };
  const round = { tour: metadata.tour, round: { ...metadata.rounds[0] }, games: [
    { id: 'Game0001', players: [{ name: 'Player A', fideId: 1 }, { name: 'Player B', fideId: 2 }], status: '*', lastMove: state === 'live' ? 'e2e4' : '' },
    { id: 'Game0002', players: [{ name: 'Player C' }, { name: 'Player D' }], status: '*', lastMove: state === 'live' ? 'e2e4' : '' },
  ] };
  const standings = [{ name: 'Player A', fideId: 1, score: 0, rank: 1, played: 0 }];
  if (state === 'final') {
    metadata.rounds.forEach(item => { item.finished = true; item.ongoing = false; });
    round.round.finished = true;
    round.games.forEach(item => { item.status = '1-0'; });
  }
  const cache = api.providerRefresh.create({ config: () => api.config.normalizeConfig(), now: () => time,
    wallNow: () => epoch + time, sleep: async ms => { time += ms; }, fetchImpl: async url => {
      calls.push(url);
      if (limited) return new Response('', { status: 429, headers: { 'Retry-After': '120' } });
      return Response.json(url.endsWith('/players') ? standings : url.includes('/-/-/')
        ? url.endsWith('/Round001') ? round : { tour: metadata.tour, round: metadata.rounds[1], games: [] }
        : metadata);
    } });
  const fetch = cache.fetchFor('chess', api.lichess);
  const client = api.lichess.createClient({ watches: [{ tournamentId: 'Tour1234', view: 'overview', enabled: true, ...watchOptions }],
    session: api.lichess.createSession(), fetchImpl: fetch, now: () => epoch + time });
  return { client, metadata, round, standings, calls, fetch, advance: ms => { time += ms; }, limited: value => { limited = value; },
    count: suffix => calls.filter(url => url.endsWith(suffix)).length };
}

test('live chess keeps round updates while reusing metadata and standings; published results expire standings early', async () => {
  const f = fixture();
  await f.client.getEvent('Tour1234:auto');
  for (let index = 0; index < 3; index++) { f.advance(30000); await f.client.getEvent('Tour1234:auto'); }
  assert.equal(f.count('/Tour1234'), 1);
  assert.equal(f.count('/players'), 1);
  assert.equal(f.count('/Round001'), 4);
  f.round.games[0].status = '1-0'; f.standings[0].score = 1; f.standings[0].played = 1;
  f.advance(30000);
  assert.equal((await f.client.getEvent('Tour1234:auto')).details.standings[0].score, 1);
  assert.equal(f.count('/players'), 2);
  f.round.games[1].status = '1-0'; f.round.round.finished = true;
  f.metadata.rounds[0].finished = true; f.metadata.rounds[0].ongoing = false;
  f.advance(30000);
  assert.equal((await f.client.getEvent('Tour1234:auto')).detailedState, 'Round complete');
  const before = f.count('/Tour1234');
  const next = await f.client.getEvent('Tour1234:auto');
  assert.equal(next.details.roundId, 'Round002');
  assert.equal(f.count('/Tour1234'), before + 1, 'round completion advances before the metadata cache expires');
});

test('pregame chess metadata and standings last five minutes without slowing the scheduled round feed', async () => {
  const f = fixture('pregame');
  await f.client.getEvent('Tour1234:auto');
  for (let index = 0; index < 4; index++) { f.advance(60000); await f.client.getEvent('Tour1234:auto'); }
  assert.equal(f.count('/Tour1234'), 1);
  assert.equal(f.count('/players'), 1);
  assert.equal(f.count('/Round001'), 5);
  f.round.games[0].lastMove = 'e2e4'; f.advance(60000);
  assert.equal((await f.client.getEvent('Tour1234:auto')).state, 'live');
  assert.equal(f.count('/Tour1234'), 2);
  assert.equal(f.count('/players'), 2);
});

test('completed chess metadata and standings remain cached for fifteen minutes', async () => {
  const f = fixture('final', { roundId: 'Round001' });
  await f.client.getEvent('Tour1234:Round001');
  for (let index = 0; index < 10; index++) { f.advance(60000); await f.client.getEvent('Tour1234:Round001'); }
  assert.equal(f.count('/Tour1234'), 1);
  assert.equal(f.count('/players'), 1);
  f.advance(300000); await f.client.getEvent('Tour1234:Round001');
  assert.equal(f.count('/Tour1234'), 2);
  assert.equal(f.count('/players'), 2);
});

test('a finished watched round does not freeze standings while another tournament round is live', async () => {
  const f = fixture('live', { roundId: 'Round001' });
  f.round.round.finished = true; f.round.games.forEach(game => { game.status = '1-0'; });
  f.metadata.rounds[0].finished = true; f.metadata.rounds[0].ongoing = false;
  f.metadata.rounds[1].ongoing = true;
  await f.client.getEvent('Tour1234:Round001');
  f.standings[0].score = 2; f.advance(120000);
  assert.equal((await f.client.getEvent('Tour1234:Round001')).details.standings[0].score, 2);
  assert.equal(f.count('/players'), 2);
});

test('known result changes and manual invalidation cannot bypass chess rate-limit cooldowns', async () => {
  const f = fixture();
  await f.client.getEvent('Tour1234:auto');
  f.limited(true); f.advance(30000);
  await f.client.getEvent('Tour1234:auto');
  const before = f.calls.length;
  f.fetch.invalidate('https://lichess.org/api/broadcast/Tour1234');
  f.fetch.retryFailed(); f.limited(false); f.advance(30000);
  const stale = await f.client.getEvent('Tour1234:auto');
  assert.equal(stale.details.stale, true);
  assert.equal(f.calls.length, before);
  f.advance(120000);
  assert.equal((await f.client.getEvent('Tour1234:auto')).details.stale, false);
});

test('directory errors recover before the healthy cache expires and honor provider cooldowns', async () => {
  for (const status of [503, 429]) {
    let time = 0, failed = true, calls = 0;
    const cache = api.providerRefresh.create({ config: () => api.config.normalizeConfig(), now: () => time,
      wallNow: () => time, sleep: async ms => { time += ms; }, fetchImpl: async () => {
        calls++;
        return failed ? new Response('', { status, headers: status === 429 ? { 'Retry-After': '120' } : {} })
          : Response.json({ active: [] });
      } });
    const fetch = cache.fetchFor('chess', api.lichess);
    const options = { session: api.lichess.createSession(), fetchImpl: fetch, now: () => time, discoverSecondTier: true };
    await assert.rejects(api.lichess.createClient(options).listCurrentEvents());
    failed = false;
    const retry = status === 429 ? 120000 : 60000;
    time = retry - 1; fetch.retryFailed(); fetch.invalidate('https://lichess.org/api/broadcast/top');
    await assert.rejects(api.lichess.createClient(options).listCurrentEvents());
    assert.equal(calls, 1);
    time = retry;
    assert.deepEqual(await api.lichess.createClient(options).listCurrentEvents(), []);
    assert.equal(calls, 2);
    time += 899999;
    await api.lichess.createClient(options).listCurrentEvents();
    assert.equal(calls, 2, 'healthy directory still lasts fifteen minutes');
  }
});

test('metadata failures recover on configured timing while longer healthy refresh preferences remain intact', async () => {
  for (const seconds of [60, 600]) {
    let time = 0, failed = true, calls = 0;
    const config = api.config.normalizeConfig();
    config.providerRefreshSeconds.chess.pregame = seconds;
    const cache = api.providerRefresh.create({ config: () => config, now: () => time, wallNow: () => time,
      sleep: async ms => { time += ms; }, fetchImpl: async () => {
        calls++;
        return failed ? new Response('', { status: 503 }) : Response.json({ tour: { id: 'Tour1234' }, rounds: [] });
      } });
    const client = api.lichess.createClient({ session: api.lichess.createSession(), now: () => time,
      fetchImpl: cache.fetchFor('chess', api.lichess) });
    await assert.rejects(client.getMetadata('Tour1234'));
    failed = false; time = seconds * 1000 - 1;
    await assert.rejects(client.getMetadata('Tour1234'));
    assert.equal(calls, 1);
    time++;
    assert.equal((await client.getMetadata('Tour1234')).tour.id, 'Tour1234');
    assert.equal(calls, 2);
    time += Math.max(300, seconds) * 1000 - 1;
    await client.getMetadata('Tour1234');
    assert.equal(calls, 2);
    time++;
    await client.getMetadata('Tour1234');
    assert.equal(calls, 3);
  }
});
