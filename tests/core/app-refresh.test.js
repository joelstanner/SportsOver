"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

async function fixture(extraFavorites = []) {
  let now = 0, timerId = 0, notify, visibility;
  const timers = new Map(), calls = [], renders = [];
  let release = null, holdNext = false;
  const config = { sports: [{ sport: "baseball", favorites: [{ teamKey: "team", enabled: true }, ...extraFavorites] }],
    providerRefreshSeconds: { baseball: { live: 12, pregame: 60, idle: 300, final: 300 } },
    gameDurations: {}, lockedGameKeys: [], fallbackMode: "up-next", displayMode: "automatic" };
  const games = [{ id: "1", state: "live", teamKeys: ["team"] }, { id: "2", state: "live", teamKeys: ["team"] }];
  const response = data => ({ ok: true, clone: () => response(data), json: async () => data });
  const provider = { toCandidate: game => game, normalizeEvent: event => event,
    createClient: ({ fetchImpl, teamId }) => ({
      findGames: async () => (await (await fetchImpl(teamId === "team" ? "schedule" : `schedule/${teamId}`)).json()).events,
      findLeagueGames: async () => (await (await fetchImpl("schedule")).json()).events,
      getEvent: async id => (await fetchImpl(`game/${id}`)).json(),
    }) };
  const api = { config: { ready: Promise.resolve(), loadConfig: () => structuredClone(config),
      normalizeConfig: structuredClone, TEAM_CATALOG: [{ sport: "baseball", teamId: "team" }],
      findTeam: teamId => ({ teamId }) },
    shared: { waitForConfig: async () => {}, snapshot: () => ({ instance: "one", catalogRevision: 0 }), subscribe: fn => { notify = fn; } },
    registry: { getProvider: () => provider, getLayout: () => ({ createLayout: () => ({
      render: event => renders.push(event.id), renderNoEvent: () => {}, handleError: () => {},
    }) }) },
    selection: { buildRotationQueue: ({ favoriteGames }) => favoriteGames.map(candidate => ({ candidate })),
      applyRotationControls: ({ automaticEntries }) => automaticEntries,
      retainAutoFinals: (_previous, automaticEntries) => automaticEntries,
      applyGameLocks: entries => entries, gameDurationSeconds: (_entry, _overrides, _keyOf, defaults) => defaults?.live || 5 },
  };
  const context = vm.createContext({ console, URLSearchParams, performance: { now: () => now },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    fetch: async url => {
      calls.push({ url, at: now });
      if (holdNext) { holdNext = false; await new Promise(resolve => { release = resolve; }); }
      return response(url.startsWith("schedule") ? { events: games } : { id: url, state: "live" });
    },
    SportsOverlay: api, location: { search: "" }, addEventListener: () => {},
    document: { querySelector: () => null, addEventListener: (_, fn) => { visibility = fn; } },
  });
  context.window = context;
  for (const file of ["provider-refresh.js", "provider-discovery.js", "app.js"]) {
    await vm.runInContext(fs.readFileSync(path.join(__dirname, "../../core", file), "utf8"), context);
  }
  const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  await flush();
  async function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    }
    now = end; await flush();
  }
  return { calls, renders, timers, advance, flush, visibility, engine: api.engine,
    async updateDefaultDuration(seconds) {
      config.defaultGameDurations = { live: seconds, pregame: 5, final: 10 };
      await notify({ initialized: true, instance: "one", catalogRevision: 0, config: structuredClone(config) });
      await flush();
    },
    async update(seconds) {
      config.providerRefreshSeconds.baseball.live = seconds;
      await notify({ initialized: true, instance: "one", catalogRevision: 0, config: structuredClone(config) });
      await flush();
    },
    hold() { holdNext = true; }, async release() { const fn = release; release = null; fn(); await flush(); },
  };
}

test("actual banner rotation and discovery obey request limits and update without reload", async () => {
  const f = await fixture();
  await f.advance(60000);
  assert.ok(new Set(f.renders).size === 2, "rotation continues during discovery");
  for (const url of ["schedule", "game/1", "game/2"]) {
    const calls = f.calls.filter(call => call.url === url);
    assert.ok(calls.length >= 3, `${url} continues updating`);
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= 12000);
  }
  await f.update(60);
  const before = f.calls.length;
  for (let i = 0; i < 5; i++) { f.visibility(); await f.flush(); }
  await f.advance(40000);
  assert.equal(f.calls.length, before, "settings and visibility cannot bypass the new interval");
  await f.update(5);
  await f.advance(10000);
  assert.ok(f.calls.length > before);
  assert.ok(f.timers.size <= 3, "only discovery, rotation and score timers remain");
});

test("a settings update during a slow score request cannot create extra poll loops", async () => {
  const f = await fixture();
  f.hold();
  await f.advance(15000);
  // Discovery and rendering can join the same pending request.
  const update = f.update(30);
  await f.flush();
  await f.release();
  await update;
  const before = f.calls.length;
  await f.advance(60000);
  assert.ok(f.calls.length > before, "updates resume after the held request completes");
  assert.ok(f.timers.size <= 3);
  for (const url of ["schedule", "game/1", "game/2"]) {
    const calls = f.calls.filter(call => call.url === url);
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= 12000);
  }
});


test("banner discovers secondary included teams and skips excluded teams", async () => {
  const f = await fixture([{ teamKey: "second", enabled: true }, { teamKey: "disabled", enabled: false }]);
  assert.ok(f.calls.some(call => call.url === "schedule/second"));
  assert.ok(!f.calls.some(call => call.url.includes("disabled")));
  assert.equal(f.calls.filter(call => call.url === "schedule").length, 1);
});

test("default timing changes immediately reschedule banner rotation", async () => {
  const app = await fixture();
  await app.advance(1000);
  await app.updateDefaultDuration(20);
  const count = app.renders.length;
  await app.advance(5000);
  assert.equal(app.renders.length, count);
  await app.advance(15000);
  assert.equal(app.renders.at(-1), "game/2");
});

test("manual next wraps the queue and gives the next game a fresh dwell interval", async () => {
  const app = await fixture();
  await app.advance(4000);
  await app.engine.next();
  assert.equal(app.renders.at(-1), "game/2");
  await app.advance(1000);
  assert.equal(app.renders.at(-1), "game/2", "old rotation deadline was cancelled");
  await app.advance(4000);
  assert.equal(app.renders.at(-1), "game/1");
  await app.engine.next();
  await app.engine.next();
  assert.equal(app.renders.at(-1), "game/1");
  assert.ok(app.timers.size <= 3);
});

test("manual next preserves a temporary game override", async () => {
  const app = await fixture();
  app.engine.override({ gameKey: "baseball:2" });
  await app.flush();
  const before = app.engine.describe().currentGameKey;
  await app.engine.next();
  assert.equal(app.engine.describe().currentGameKey, before);
  assert.equal(app.engine.describe().overrideGameKey, "baseball:2");
});
