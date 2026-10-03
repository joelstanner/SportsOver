"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
require("../../core/config.js");

async function fixture(extraFavorites = [], gameCount = 2, useRealSelection = false, discoveryIntervalMs, individual = false) {
  let now = 0, timerId = 0, notify, visibility;
  const timers = new Map(), calls = [], renders = [];
  const mount = { dataset: {}, classList: { remove() {} } };
  let release = null, holdNext = false, schedulesOffline = false;
  const config = { sports: [{ sport: "baseball", favorites: [{ teamKey: "team", enabled: true }, ...extraFavorites] }],
    providerRefreshSeconds: { baseball: { live: 12, pregame: 60, idle: 300, final: 300 } },
    gameDurations: {}, lockedGameKeys: [], fallbackMode: "up-next", displayMode: "automatic" };
  const games = Array.from({ length: gameCount }, (_, index) => ({ sport: "baseball", id: String(index + 1), state: "live",
    teamKeys: individual ? [] : [useRealSelection ? "TEAM" : "team"], ...(individual ? { competitionType: "individual" } : {}),
    ...(useRealSelection ? { startTime: new Date(0).toISOString() } : {}) }));
  const response = data => Response.json(data);
  const provider = { toCandidate: game => game, normalizeEvent: event => event,
    createClient: ({ fetchImpl, teamId }) => ({ discoveryIntervalMs,
      findGames: async () => (await (await fetchImpl(teamId === "team" ? "schedule" : `schedule/${teamId}`)).json()).events,
      findLeagueGames: async () => (await (await fetchImpl("schedule")).json()).events,
      getEvent: async id => (await fetchImpl(`game/${id}`)).json(),
    }) };
  const api = { config: { ready: Promise.resolve(), loadConfig: () => structuredClone(config),
      isCandidateEnabled: globalThis.SportsOverlay.config.isCandidateEnabled,
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
  const context = vm.createContext({ console, URLSearchParams, Response, performance: { now: () => now },
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    fetch: async url => {
      calls.push({ url, at: now });
      if (holdNext) { holdNext = false; await new Promise(resolve => { release = resolve; }); }
      if (schedulesOffline && url.startsWith("schedule")) return new Response('{}', { status: 503 });
      const game = games.find(game => `game/${game.id}` === url);
      return response(url.startsWith("schedule") ? { events: structuredClone(games) } : { id: url, state: game?.state || "live", competitionType: game?.competitionType });
    },
    SportsOverlay: api, location: { search: "" }, addEventListener: () => {},
    matchMedia: () => ({ matches: true }),
    document: { querySelector: () => mount, addEventListener: (_, fn) => { visibility = fn; } },
  });
  context.window = context;
  const mockedSelection = api.selection;
  await vm.runInContext(fs.readFileSync(path.join(__dirname, "../../core/game-selection.js"), "utf8"), context);
  api.selection = { ...api.selection, ...(useRealSelection ? {} : { buildRotationQueue: mockedSelection.buildRotationQueue }),
    ...(individual ? {} : { gameDurationSeconds: mockedSelection.gameDurationSeconds }) };
  for (const file of ["provider-refresh.js", "provider-discovery.js", "live-mode.js", "app.js"]) {
    await vm.runInContext(fs.readFileSync(path.join(__dirname, "../../core", file), "utf8"), context);
  }
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
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
  return { calls, renders, timers, advance, flush, visibility, mount, engine: api.engine, config, games,
    failSchedules: value => { schedulesOffline = value; },
    async save(patch) {
      Object.assign(config, patch);
      await notify({ initialized: true, instance: "one", catalogRevision: 0, config: structuredClone(config) });
      await flush();
    },
    time: value => { now = value; },
    async setSportEnabled(enabled) {
      config.sports[0].enabled = enabled;
      await notify({ initialized: true, instance: "one", catalogRevision: 0, config: structuredClone(config) });
      await flush();
    },
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

test('scrolls hold at the bottom during rotation and repeat for a single banner or override', async () => {
  const app = await fixture();
  assert.equal(app.mount.dataset.rotationActive, 'true');
  await app.engine.override({ gameKey: 'baseball:1' }); await app.flush();
  assert.equal(app.mount.dataset.rotationActive, 'false');
  await app.engine.override(null); await app.flush();
  assert.equal(app.mount.dataset.rotationActive, 'true');
  await app.save({ lockedGameKeys: ['baseball:1'] });
  assert.equal(app.mount.dataset.rotationActive, 'false');
  await app.save({ lockedGameKeys: [] });
  assert.equal(app.mount.dataset.rotationActive, 'true');
  const single = await fixture([], 1);
  assert.equal(single.mount.dataset.rotationActive, 'false');
});

test('a discovery outage retains received games and recovers to a genuinely empty feed', async () => {
  const app = await fixture();
  assert.equal(app.engine.describe().availableEntries.length, 2);
  app.failSchedules(true);
  await app.advance(12000);
  assert.equal(app.engine.describe().availableEntries.length, 2);
  assert.equal(app.engine.describe().queue.length, 2);
  assert.ok(app.engine.describe().discoveryFailures > 0);
  app.failSchedules(false);
  app.games.length = 0;
  await app.advance(12000);
  assert.equal(app.engine.describe().availableEntries.length, 0);
  assert.equal(app.engine.describe().queue.length, 0);
  assert.equal(app.engine.describe().discoveryFailures, 0);
});

test('discovery reports loading while a refresh is pending without clearing received games', async () => {
  const app = await fixture();
  assert.equal(app.engine.describe().discoveryComplete, true);
  assert.equal(app.engine.describe().discoveryPending, false);
  app.time(12000); app.hold();
  const refresh = app.engine.refresh(); await app.flush();
  assert.equal(app.engine.describe().discoveryPending, true);
  assert.equal(app.engine.describe().availableEntries.length, 2);
  await app.release(); await refresh;
  assert.equal(app.engine.describe().discoveryPending, false);
});

test("disabling the sport clears rotation and overrides, stops polling, and supports re-enabling", async () => {
  const f = await fixture();
  f.engine.override({ gameKey: 'baseball:1' }); await f.flush();
  assert.equal(f.engine.describe().overrideGameKey, 'baseball:1');
  await f.setSportEnabled(false);
  assert.equal(f.engine.describe().queue.length, 0);
  assert.equal(f.engine.describe().availableEntries.length, 0);
  assert.equal(f.engine.describe().overrideGameKey, null);
  assert.equal(f.engine.describe().renderedGameKey, null);
  const calls = f.calls.length, renders = f.renders.length;
  await f.advance(60000);
  assert.equal(f.calls.length, calls);
  assert.equal(f.renders.length, renders);
  await f.setSportEnabled(true);
  assert.equal(f.engine.describe().queue.length, 2);
  assert.ok(f.renders.length > renders);
});

test("disabled sports cannot return through an in-flight discovery", async () => {
  const f = await fixture();
  f.time(12000);
  f.hold();
  const pending = f.engine.refresh();
  await f.flush();
  await f.setSportEnabled(false);
  await f.release(); await pending; await f.flush();
  assert.equal(f.engine.describe().queue.length, 0);
  assert.equal(f.engine.describe().availableEntries.length, 0);
});

test("watched-team finals stay beside their next game and expire at the 24-hour boundary", async () => {
  const f = await fixture([], 1, true);
  f.games[0].state = "final";
  f.games.push({ sport: "baseball", id: "2", state: "pregame", teamKeys: ["TEAM"],
    startTime: new Date(2 * 86_400_000).toISOString() });
  await f.advance(12_000);
  assert.deepEqual(Array.from(f.engine.describe().queue, entry => [entry.candidate.id, entry.candidate.state]),
    [["2", "pregame"], ["1", "final"]]);
  const deadline = f.engine.describe().queue.find(entry => entry.candidate.id === "1").autoRetainUntil;
  assert.equal(deadline, 12_000 + 86_400_000);
  f.time(deadline - 1); await f.engine.refresh(); await f.flush();
  assert.equal(f.engine.describe().queue.length, 2);
  f.time(deadline); await f.engine.refresh(); await f.flush();
  assert.deepEqual(Array.from(f.engine.describe().queue, entry => entry.candidate.id), ["2"]);
});

test("starting the next watched game removes its preceding final before 24 hours", async () => {
  const f = await fixture([], 1, true);
  f.games[0].state = "final";
  f.games.push({ sport: "baseball", id: "2", state: "pregame", teamKeys: ["TEAM"],
    startTime: new Date(3_600_000).toISOString() });
  await f.advance(12_000);
  assert.equal(f.engine.describe().queue.length, 2);
  f.time(3_600_000); f.games[1].state = "live";
  await f.engine.refresh(); await f.flush();
  assert.deepEqual(Array.from(f.engine.describe().queue, entry => [entry.candidate.id, entry.candidate.state]), [["2", "live"]]);
});

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

test('hover keeps the original rotation deadline when the pointer leaves early', async () => {
  const app = await fixture();
  await app.advance(1000);
  app.engine.setHovered(true);
  await app.advance(3000);
  await app.engine.setHovered(false);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:1');
  await app.advance(999);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:1');
  await app.advance(1);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:2');
});

test('expired rotation waits through hover and discovery while scores continue polling', async () => {
  const app = await fixture();
  app.engine.setHovered(true);
  await app.advance(30000);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:1');
  assert.ok(app.calls.filter(call => call.url === 'game/1').length >= 3);
  await app.engine.setHovered(false);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:2');
  await app.advance(4999);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:2');
  await app.advance(1);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:1');
});

test('manual browsing during hover discards the expired dwell and starts a full new one', async () => {
  const app = await fixture();
  app.engine.setHovered(true);
  await app.advance(6000);
  await app.engine.next();
  assert.equal(app.engine.describe().currentGameKey, 'baseball:2');
  await app.engine.setHovered(false);
  await app.advance(4999);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:2');
  await app.advance(1);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:1');
});

test('an override invalidates any rotation waiting for hover to end', async () => {
  const app = await fixture();
  app.engine.setHovered(true);
  await app.advance(6000);
  app.engine.override({ gameKey: 'baseball:2' });
  await app.engine.setHovered(false);
  await app.flush();
  assert.equal(app.engine.describe().currentGameKey, 'baseball:2');
  await app.advance(10000);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:2');
  app.engine.override(null);
  await app.flush();
  await app.advance(4999);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:1');
  await app.advance(1);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:2');
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

test('fast navigation displays a cached game before an outstanding score request finishes', async () => {
  const app = await fixture([], 3);
  await app.engine.next();
  app.hold();
  const slow = app.engine.next();
  await app.flush();
  await app.engine.previous({ fast: true });
  assert.equal(app.engine.describe().renderedGameKey, 'baseball:2');
  assert.equal(app.engine.describe().rotationTransition, 'quick');
  await app.release(); await slow;
  assert.equal(app.engine.describe().renderedGameKey, 'baseball:2', 'late response cannot replace the selected game');
  assert.equal(app.engine.describe().rotationTransition, 'quick', 'score updates preserve the navigation transition');
});

test('fast navigation to an unseen game bypasses an unrelated pending render', async () => {
  const app = await fixture([], 3);
  app.hold();
  const slow = app.engine.next();
  await app.flush();
  await app.engine.next({ fast: true });
  assert.equal(app.engine.describe().renderedGameKey, 'baseball:3');
  assert.equal(app.engine.describe().rotationTransition, 'quick');
  await app.release(); await slow;
  assert.equal(app.engine.describe().renderedGameKey, 'baseball:3');
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


test("manual previous selects the preceding item, wraps, and resets its display interval", async () => {
  const app = await fixture([], 3);
  await app.advance(4000);
  await app.engine.previous();
  assert.equal(app.renders.at(-1), "game/3");
  await app.advance(1000);
  assert.equal(app.renders.at(-1), "game/3", "previous game gets a fresh interval");
  await app.engine.previous();
  assert.equal(app.renders.at(-1), "game/2");
  await app.advance(5000);
  assert.equal(app.renders.at(-1), "game/3", "automatic rotation continues forwards");
  assert.ok(app.timers.size <= 3);
});

test("previous respects temporary overrides and queues with fewer than two items", async () => {
  const app = await fixture([], 3);
  app.engine.override({ gameKey: "baseball:2" });
  await app.flush();
  await app.engine.previous();
  assert.equal(app.engine.describe().currentGameKey, "baseball:2");
  assert.equal(app.engine.describe().overrideGameKey, "baseball:2");
  const single = await fixture([], 1);
  const count = single.renders.length;
  await single.engine.previous();
  assert.equal(single.renders.length, count);
  await single.setSportEnabled(false);
  await single.engine.previous();
  assert.equal(single.engine.describe().currentGameKey, null);
});

test('Live mode ignores locks on upcoming games, then restores the full rotation and locks', async () => {
  const app = await fixture([], 3);
  app.games[0].state = 'pregame';
  await app.save({ rotationMode: 'curated', includedGames: ['baseball:1', 'baseball:2'], lockedGameKeys: ['baseball:1'] });
  await app.advance(12000);
  assert.deepEqual(Array.from(app.engine.describe().queue, entry => entry.candidate.id), ['1']);
  assert.equal(app.engine.describe().liveMode.canActivate, true, 'live games behind a lock still enable Live mode');
  const saved = structuredClone(app.config);
  await app.engine.setLiveMode(true); await app.flush();
  assert.deepEqual(Array.from(app.engine.describe().queue, entry => entry.candidate.id), ['2']);
  assert.deepEqual(app.config, saved);
  await app.engine.setLiveMode(false); await app.flush();
  assert.deepEqual(Array.from(app.engine.describe().queue, entry => entry.candidate.id), ['1']);
  assert.deepEqual(app.config, saved);
});

test('Live mode honors single and multiple locks while keeping all eligible games available to controls', async () => {
  const app = await fixture([], 3);
  await app.engine.setLiveMode(true); await app.flush();
  const ids = key => Array.from(app.engine.describe()[key], entry => entry.candidate.id);
  await app.save({lockedGameKeys:['baseball:2']});
  assert.deepEqual(ids('queue'), ['2']);
  assert.deepEqual(ids('liveQueue'), ['1','2','3']);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:2');
  await app.save({lockedGameKeys:['baseball:2','baseball:3']});
  assert.deepEqual(ids('queue'), ['2','3']);
  await app.engine.next();
  assert.equal(app.engine.describe().currentGameKey, 'baseball:3');
  await app.save({lockedGameKeys:[]});
  assert.deepEqual(ids('queue'), ['1','2','3']);
  await app.save({lockedGameKeys:['baseball:2'],liveModeFinalMinutes:0});
  app.games[1].state = 'final';
  await app.advance(12000);
  assert.deepEqual(ids('queue'), ['1','3'], 'expired locked finals cannot block remaining live games');
  assert.deepEqual(ids('liveQueue'), ['1','3']);
  assert.deepEqual(app.config.lockedGameKeys, ['baseball:2']);
});

test('Live mode expiry drops the last final, stays latched, and allows deactivation with no live games', async () => {
  const app = await fixture([], 1);
  await app.save({ liveModeFinalMinutes: 1 });
  await app.engine.setLiveMode(true); await app.flush();
  app.games[0].state = 'final';
  await app.advance(12000);
  assert.equal(app.engine.describe().queue[0].candidate.state, 'final');
  assert.equal(app.engine.describe().liveMode.canActivate, false);
  await app.advance(59999);
  assert.equal(app.engine.describe().queue.length, 1);
  await app.advance(1);
  assert.equal(app.engine.describe().queue.length, 0);
  assert.equal(app.engine.describe().renderedGameKey, null);
  assert.equal(app.engine.describe().liveMode.active, true);
  await app.engine.setLiveMode(false); await app.flush();
  assert.equal(app.engine.describe().liveMode.active, false);
});

test('manual removals persist after Live mode deactivation and new sessions start inactive', async () => {
  const app = await fixture([], 2);
  await app.engine.setLiveMode(true); await app.flush();
  await app.save({ excludedGames: ['baseball:1'] });
  assert.deepEqual(Array.from(app.engine.describe().queue, entry => entry.candidate.id), ['2']);
  await app.engine.setLiveMode(false); await app.flush();
  assert.deepEqual(Array.from(app.engine.describe().queue, entry => entry.candidate.id), ['2']);
  const restarted = await fixture();
  assert.equal(restarted.engine.describe().liveMode.active, false);
});

test('Live mode cannot activate without live rotation games and zero retention removes a detected final', async () => {
  const app = await fixture([], 1);
  await app.save({ liveModeFinalMinutes: 0 });
  await app.engine.setLiveMode(true); await app.flush();
  app.games[0].state = 'final';
  await app.advance(12000);
  assert.equal(app.engine.describe().queue.length, 0);
  await app.engine.setLiveMode(false); await app.flush();
  await app.engine.setLiveMode(true); await app.flush();
  assert.equal(app.engine.describe().liveMode.active, false);
});

test('activating during a pending refresh publishes a filtered queue immediately', async () => {
  const app = await fixture([], 2);
  app.games[0].state = 'pregame';
  await app.save({ lockedGameKeys: ['baseball:1'] });
  await app.advance(12000);
  app.time(24000); app.hold();
  const refresh = app.engine.refresh(); await app.flush();
  const activation = app.engine.setLiveMode(true);
  assert.equal(app.engine.describe().liveMode.active, true);
  assert.deepEqual(Array.from(app.engine.describe().queue, entry => entry.candidate.id), ['2']);
  await app.release(); await refresh; await activation; await app.flush();
  assert.deepEqual(Array.from(app.engine.describe().queue, entry => entry.candidate.id), ['2']);
});

test('a polled individual break leaves Live mode immediately and returns when play resumes', async () => {
  const app = await fixture([], 1);
  app.games[0].competitionType = 'individual';
  await app.advance(12000);
  await app.engine.setLiveMode(true); await app.flush();
  assert.equal(app.engine.describe().queue.length, 1);
  await app.save({lockedGameKeys:['baseball:1']});
  const renders = app.renders.length;
  app.games[0].state = 'interrupted';
  await app.advance(12000);
  assert.equal(app.engine.describe().queue.length, 0);
  assert.equal(app.engine.describe().liveMode.active, true);
  assert.equal(app.engine.describe().liveMode.canActivate, false);
  assert.equal(app.renders.length, renders, 'the paused banner must not render in Live mode');
  app.games[0].state = 'live';
  await app.advance(60000);
  assert.equal(app.engine.describe().queue.length, 1);
});

test('normal tournament rotation updates the queue and timer when a refresh detects a break', async () => {
  const app = await fixture([], 2, false, undefined, true);
  await app.save({ defaultGameDurations: { live: 45, pregame: 15, final: 5 } });
  app.games[0].state = 'interrupted';
  await app.advance(12000);
  assert.equal(app.engine.describe().queue[0].candidate.state, 'interrupted');
  assert.equal(app.engine.describe().availableEntries[0].candidate.state, 'interrupted');
  assert.equal(app.engine.describe().currentGameKey, 'baseball:1');
  await app.advance(4999);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:1');
  await app.advance(1);
  assert.equal(app.engine.describe().currentGameKey, 'baseball:2');
});

test("recurring directory discovery is capped independently of long score refresh intervals", async () => {
  const f = await fixture([], 1, false, 900000);
  await f.update(3600);
  assert.ok([...f.timers.values()].some(timer => timer.at === 900000), "directory discovery remains scheduled at fifteen minutes");
});
