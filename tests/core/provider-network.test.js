const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, serviceFor, sportFor } = require('../../core/provider-network.js');
const nba = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const nhl = 'https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/1/competitions/1/situation';
const mlb = 'https://statsapi.mlb.com/api/v1/schedule';
const pdga = 'https://www.pdga.com/apps/tournament/live-api/live_results_fetch_round?TournID=1';
const epoch = Date.parse('2026-10-03T00:00:00Z');

test('provider endpoints identify every supported sport, including catalogs and secondary ESPN hosts', () => {
  const endpoints = {
    baseball: [mlb, 'https://statsapi.mlb.com/api/v1/teams?sportId=1'],
    football: ['https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'],
    'college-football': ['https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams'],
    hockey: [nhl, 'https://site.web.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=1'],
    soccer: ['https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/teams/9726/schedule'],
    basketball: [nba],
    'college-basketball': ['https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams'],
    'disc-golf': [pdga, 'https://www.pdga.com/api/v1/feat/current-events/tournaments'],
    chess: ['https://lichess.org/api/broadcast/top', 'https://lichess.org/broadcast/Tour1234/players'],
  };
  for (const [sport, urls] of Object.entries(endpoints)) for (const url of urls) assert.equal(sportFor(url), sport);
  assert.equal(sportFor('https://example.com/scoreboard'), null);
});

test('disabling a sport while queued blocks its calls and lets enabled sports on the same provider proceed', async () => {
  let time = epoch, release, started, enabled = true;
  const active = new Promise(resolve => { started = resolve; }), calls = [];
  const fetch = create({ now: () => time, sleep: async ms => { time += ms; },
    isAllowed: url => sportFor(url) !== 'basketball' || enabled,
    fetchImpl: async url => {
      calls.push(url);
      return url === nba ? new Promise(resolve => { release = resolve; started(); }) : Response.json({});
    } });
  const first = fetch(nba); await active;
  const queued = fetch(nba + '?queued');
  const rejected = assert.rejects(queued, { code: 'SPORT_DISABLED' });
  const otherSport = fetch(nhl);
  enabled = false; release(Response.json({}));
  await Promise.all([first, rejected, otherSport]);
  await assert.rejects(fetch(nba + '?manual'), { code: 'SPORT_DISABLED' });
  assert.deepEqual(calls, [nba, nhl]);
  enabled = true; await fetch(nba + '?resumed');
  assert.deepEqual(calls, [nba, nhl, nba + '?resumed']);
});
function fixture() {
  let time = epoch, respond = () => Response.json({ state: 'live' });
  const calls = [];
  const fetch = create({ now: () => time, sleep: async ms => { time += ms; },
    fetchImpl: async (url, options) => { calls.push({ url, time, options }); return respond(url); } });
  return { fetch, calls, time: value => { time = epoch + value; }, respond: value => { respond = value; } };
}
test('ESPN hosts share a serial paced queue, while other services progress independently', async () => {
  const f = fixture();
  let finish;
  f.respond(url => url === nba ? new Promise(resolve => { finish = resolve; }) : Response.json({}));
  const first = f.fetch(nba);
  const second = f.fetch(nhl);
  await f.fetch(mlb);
  assert.deepEqual(f.calls.map(call => call.url), [nba, mlb]);
  finish(Response.json({}));
  await Promise.all([first, second]);
  assert.equal(f.calls[2].url, nhl);
  assert.ok(f.calls[2].time - f.calls[0].time >= 250);
});
test('429 blocks queued and new endpoints until the exact shared deadline', async () => {
  for (const retry of ['120', new Date(epoch + 120000).toUTCString(), 'invalid']) {
    const f = fixture();
    f.respond(() => new Response('', { status: 429, headers: { 'Retry-After': retry } }));
    const responses = await Promise.all([f.fetch(nba), f.fetch(nhl)]);
    assert.ok(responses.every(response => response.status === 429));
    assert.equal(f.calls.length, 1);
    const deadline = retry === 'invalid' ? 60000 : 120000;
    f.respond(() => Response.json({}));
    f.time(deadline - 1);
    assert.equal((await f.fetch(nhl)).status, 429);
    assert.equal(f.calls.length, 1);
    f.time(deadline);
    assert.equal((await f.fetch(nhl)).status, 200);
    assert.equal(f.calls.length, 2);
  }
});
test('repeated throttles back off across URLs; success resets the service penalty', async () => {
  const f = fixture();
  f.respond(() => new Response('', { status: 429 }));
  assert.equal((await f.fetch(pdga)).headers.get('Retry-After'), '60');
  f.time(60000);
  assert.equal((await f.fetch(pdga + '&Round=2')).headers.get('Retry-After'), '120');
  f.time(180000); f.respond(() => Response.json({}));
  await f.fetch(pdga);
  f.time(181000); f.respond(() => new Response('', { status: 429 }));
  assert.equal((await f.fetch(pdga)).headers.get('Retry-After'), '60');
});
test('403 and 503 Retry-After pause the service; plain forbidden responses do not become rate limits', async () => {
  for (const status of [403, 503]) {
    const f = fixture();
    f.respond(() => new Response('', { status, headers: { 'Retry-After': '90' } }));
    await f.fetch(nba); await f.fetch(nhl);
    assert.equal(f.calls.length, 1);
    f.time(90000); f.respond(() => new Response('', { status: 403 }));
    await f.fetch(nba); await f.fetch(nhl);
    assert.equal(f.calls.length, 3);
  }
});
test('queued timeout starts at dispatch and caller credentials, methods and redirects are not forwarded', async () => {
  const f = fixture();
  const controller = new AbortController(); controller.abort();
  await f.fetch(mlb, { signal: controller.signal, requestTimeoutMs: 8000, method: 'POST', headers: { Cookie: 'secret' } });
  const options = f.calls[0].options;
  assert.equal(options.signal.aborted, false);
  assert.equal(options.method, 'GET');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers, undefined);
});
test('unsupported hosts, protocols, credentials and PDGA paths are rejected before transport', async () => {
  const f = fixture();
  for (const url of ['http://127.0.0.1/api/v1/test', nba.replace('https:', 'http:'), nba.replace('espn.com', 'espn.com.evil.example'),
    nba.replace('https://', 'https://user:password@'), nba.replace('.com/', '.com:8443/'),
    'https://www.pdga.com/user/login', 'https://lichess.org/account/preferences',
    'https://lichess.org/api/broadcast/invalid', 'https://lichess.org/broadcast/Tour1234/teams']) {
    assert.equal(serviceFor(url), null);
    await assert.rejects(f.fetch(url), /Unsupported/);
  }
  assert.equal(f.calls.length, 0);
});

test('chess API and standings share pacing, join duplicate requests, and let other providers progress', async () => {
  const f = fixture();
  const metadata = 'https://lichess.org/api/broadcast/Tour1234';
  const round = 'https://lichess.org/api/broadcast/-/-/Round001';
  const players = 'https://lichess.org/broadcast/Tour1234/players';
  let release, started;
  const active = new Promise(resolve => { started = resolve; });
  f.respond(url => url === metadata ? new Promise(resolve => { release = resolve; started(); }) : Response.json({}));
  const first = f.fetch(metadata); await active;
  const duplicate = f.fetch(metadata);
  const background = f.fetch(round);
  const display = f.fetch(players, { priority: 'display' });
  await f.fetch(mlb);
  assert.deepEqual(f.calls.map(call => call.url), [metadata, mlb]);
  release(Response.json({ tour: 'shared' }));
  const results = await Promise.all([first, duplicate, background, display]);
  assert.deepEqual(await results[0].json(), { tour: 'shared' });
  assert.deepEqual(await results[1].json(), { tour: 'shared' });
  const chessCalls = f.calls.filter(call => serviceFor(call.url) === 'lichess');
  assert.deepEqual(chessCalls.map(call => call.url), [metadata, players, round]);
  for (let index = 1; index < chessCalls.length; index++) assert.ok(chessCalls[index].time - chessCalls[index - 1].time >= 1500);
  assert.equal(serviceFor('https://lichess.org/api/broadcast/top'), 'lichess');
});

test('a chess API rate limit pauses standings and other chess windows through the shared deadline', async () => {
  const f = fixture();
  const metadata = 'https://lichess.org/api/broadcast/Tour1234';
  const standings = 'https://lichess.org/broadcast/Tour1234/players';
  f.respond(() => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
  await f.fetch(metadata);
  assert.equal((await f.fetch(standings, { priority: 'display' })).status, 429);
  assert.equal(f.calls.length, 1);
  f.time(120000); f.respond(() => Response.json([]));
  assert.equal((await f.fetch(standings)).status, 200);
  assert.equal(f.calls.length, 2);
});

test('display requests pass queued discovery without interrupting the running request or starving discovery', async () => {
  const f = fixture();
  let release, started;
  const active = new Promise(resolve => { started = resolve; });
  f.respond(url => url === nba ? new Promise(resolve => { release = resolve; started(); }) : Response.json({}));
  const first = f.fetch(nba);
  await active;
  const background = [f.fetch(nhl + '?background=1'), f.fetch(nhl + '?background=2')];
  const display = Array.from({ length: 7 }, (_, index) => f.fetch(nba + `?display=${index}`, { priority: 'display' }));
  assert.equal(f.calls.length, 1, 'the running request is not interrupted');
  release(Response.json({}));
  await Promise.all([first, ...background, ...display]);
  assert.deepEqual(f.calls.map(call => call.url), [nba,
    ...[0, 1, 2].map(index => nba + `?display=${index}`), nhl + '?background=1',
    ...[3, 4, 5].map(index => nba + `?display=${index}`), nhl + '?background=2', nba + '?display=6']);
  for (let index = 1; index < f.calls.length; index++) assert.ok(f.calls[index].time - f.calls[index - 1].time >= 250);
});

test('a display request arriving during the pacing wait is selected next; promotion adds no requests', async () => {
  let time = epoch, release;
  const calls = [];
  const fetch = create({ now: () => time, sleep: ms => new Promise(resolve => { release = () => { time += ms; resolve(); }; }),
    fetchImpl: async url => { calls.push(url); return Response.json({}); } });
  await fetch(nba);
  const background = fetch(nhl), promoted = fetch(nba + '?next');
  await new Promise(resolve => setImmediate(resolve));
  fetch.prioritize(nba + '?next');
  release();
  await promoted;
  assert.deepEqual(calls, [nba, nba + '?next']);
  release();
  await background;
  assert.deepEqual(calls, [nba, nba + '?next', nhl]);
});

test('display priority and promotion never bypass a service cooldown', async () => {
  const f = fixture();
  f.respond(() => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
  await f.fetch(nba);
  const pending = f.fetch(nhl, { priority: 'display' });
  f.fetch.prioritize(nhl);
  assert.equal((await pending).status, 429);
  assert.equal(f.calls.length, 1);
});
