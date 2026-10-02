"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
require("../../core/config.js");
require("../../core/provider-refresh.js");
const api = globalThis.SportsOverlay;
const provider = { toCandidate: game => game, normalizeEvent: payload => payload };

test("cached scores survive the original request signal expiring without extra requests", async () => {
  const http = require('node:http');
  const payload = { state: 'live', score: 7 };
  let calls = 0;
  const server = http.createServer((_request, response) => {
    calls++;
    response.writeHead(200, { 'Content-Type': 'application/json', 'X-Feed': 'scores' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const cache = api.providerRefresh.create({ config: () => api.config.normalizeConfig(), now: () => 0 });
    const fetch = cache.fetchFor('baseball', provider);
    const url = `http://127.0.0.1:${server.address().port}/scores`;
    const controller = new AbortController();
    assert.deepEqual(await (await fetch(url, { signal: controller.signal })).json(), payload);
    controller.abort();
    const cached = await fetch(url, { signal: new AbortController().signal });
    assert.equal(cached.headers.get('X-Feed'), 'scores');
    assert.deepEqual(await cached.json(), payload);
    assert.deepEqual(await (await fetch(url)).json(), payload);
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("NHL situations use the live interval even after an initial failure", async () => {
  require('../../core/event-model.js');
  require('../../sports/hockey/providers/espn.js');
  let clock = 0, calls = 0;
  const config = api.config.normalizeConfig();
  const cache = api.providerRefresh.create({ config: () => config, now: () => clock, fetchImpl: async () => {
    if (++calls === 1) throw new Error('offline');
    return new Response(JSON.stringify({ powerPlay: calls === 2 }));
  } });
  const fetch = cache.fetchFor('hockey', api.espnNhl);
  const url = 'https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/1/competitions/1/situation';
  await assert.rejects(fetch(url), /offline/);
  clock = 11000;
  await assert.rejects(fetch(url), /offline/);
  assert.equal(calls, 1);
  clock = 12000;
  assert.equal((await (await fetch(url)).json()).powerPlay, true);
  clock = 23000;
  assert.equal((await (await fetch(url)).json()).powerPlay, true);
  clock = 24000;
  assert.equal((await (await fetch(url)).json()).powerPlay, false);
  assert.equal(calls, 3);
});

function fixture() {
  const config = api.config.normalizeConfig();
  let clock = 0, calls = 0, payload = { state: "live" }, fail = false;
  const cache = api.providerRefresh.create({ config: () => config, now: () => clock,
    fetchImpl: async () => {
      calls++;
      if (fail) throw new Error("offline");
      return new Response(JSON.stringify(payload));
    } });
  return { config, cache, fetch: cache.fetchFor("baseball", provider),
    time: value => { clock = value; }, payload: value => { payload = value; },
    fail: value => { fail = value; }, calls: () => calls };
}

test("rotation, discovery and concurrent clients cannot bypass per-feed intervals", async () => {
  const f = fixture();
  const secondClient = f.cache.fetchFor("baseball", provider);
  const responses = await Promise.all([f.fetch("game/1"), secondClient("game/1"), f.fetch("game/1")]);
  assert.equal(f.calls(), 1);
  for (const response of responses) assert.deepEqual(await response.json(), { state: "live" });
  for (let time = 1000; time < 12000; time += 1000) {
    f.time(time); await secondClient("game/1");
  }
  assert.equal(f.calls(), 1);
  f.time(12000); await f.fetch("game/1");
  assert.equal(f.calls(), 2);
  await f.fetch("game/2");
  assert.equal(f.calls(), 3);
});

test("state transitions and live configuration changes recalculate existing deadlines", async () => {
  const f = fixture();
  f.payload({ state: "pregame" }); await f.fetch("game");
  f.time(12000); await f.fetch("game"); assert.equal(f.calls(), 1);
  f.config.providerRefreshSeconds.baseball.pregame = 5;
  f.payload({ state: "interrupted" }); await f.fetch("game"); assert.equal(f.calls(), 2);
  f.time(24000); f.payload({ state: "final" }); await f.fetch("game");
  f.time(36000); await f.fetch("game"); assert.equal(f.calls(), 3);
  f.time(324000); await f.fetch("game"); assert.equal(f.calls(), 4);
  f.config.providerRefreshSeconds.baseball.final = 3600;
  f.time(624000); await f.fetch("game"); assert.equal(f.calls(), 4);
});

test("schedule aggregation, idle discovery, and sport isolation", async () => {
  const f = fixture();
  f.payload({ events: [] }); await f.fetch("scoreboard");
  f.time(60000); await f.fetch("scoreboard"); assert.equal(f.calls(), 1);
  f.time(300000); f.payload({ events: [{ state: "final" }, { state: "pregame" }, { state: "live" }] });
  await f.fetch("scoreboard");
  f.time(312000); await f.fetch("scoreboard"); assert.equal(f.calls(), 3);
  await f.cache.fetchFor("hockey", provider)("scoreboard"); assert.equal(f.calls(), 4);
});

test("failed requests are throttled, recover, and retain the previous state deadline", async () => {
  const f = fixture();
  await f.fetch("game"); f.fail(true); f.time(12000);
  await assert.rejects(f.fetch("game"), /offline/);
  f.time(13000); await assert.rejects(f.fetch("game"), /offline/);
  assert.equal(f.calls(), 2);
  f.fail(false); f.time(24000); await f.fetch("game"); assert.equal(f.calls(), 3);
});

test("old and malformed settings receive bounded defaults without sharing mutable objects", () => {
  const config = api.config.normalizeConfig({ providerRefreshSeconds: { baseball: { live: 4, pregame: 3601, idle: "5", final: 5 } } });
  assert.deepEqual(config.providerRefreshSeconds.baseball, { live: 12, pregame: 60, idle: 300, final: 5 });
  config.providerRefreshSeconds.hockey.live = 50;
  assert.equal(api.config.normalizeConfig().providerRefreshSeconds.hockey.live, 12);
});


test("a synchronous transport failure releases the in-flight slot for retry", async () => {
  let clock = 0, calls = 0;
  const config = api.config.normalizeConfig();
  const cache = api.providerRefresh.create({ config: () => config, now: () => clock,
    fetchImpl: () => {
      if (++calls === 1) throw new Error("transport");
      return Promise.resolve(new Response(JSON.stringify({ events: [] })));
    } });
  const fetch = cache.fetchFor("baseball", provider);
  await assert.rejects(fetch("schedule"), /transport/);
  clock = 300000;
  await fetch("schedule");
  assert.equal(calls, 2);
});

test('explicit retry refreshes failed feeds only and preserves other sports and healthy caches', async () => {
  const f = fixture();
  await f.fetch('healthy');
  const other = f.cache.fetchFor('chess', provider);
  f.fail(true);
  await assert.rejects(f.fetch('failed'), /offline/);
  await assert.rejects(other('other-failed'), /offline/);
  f.fail(false);
  await assert.rejects(f.fetch('failed'), /offline/);
  assert.equal(f.calls(), 3);
  f.fetch.retryFailed();
  await f.fetch('failed');
  await f.fetch('healthy');
  await assert.rejects(other('other-failed'), /offline/);
  assert.equal(f.calls(), 4);
});
