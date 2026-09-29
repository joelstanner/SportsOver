"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
require("../../core/config.js");
require("../../core/provider-refresh.js");
const api = globalThis.SportsOverlay;
const provider = { toCandidate: game => game, normalizeEvent: payload => payload };

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
