const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../../../core/config.js'); require('../../../core/event-model.js'); require('../../../core/registry.js');
require('../../../core/provider-refresh.js'); require('../../../sports/formula-1/providers/espn.js');
const api = global.SportsOverlay, f1 = api.formula1;
const { fixture, watch } = require('./fixtures.js');
const normalize = f => f1.normalizeEvent(f.scoreboard.events[0], f.content, f.watch);
test('F1 normalizes all drivers, flags and separate constructor identity', () => {
  const event = normalize(fixture());
  assert.equal(event.state, 'live'); assert.equal(event.competitors.length, 22);
  assert.equal(event.competitors[0].id, '1000'); assert.equal(event.competitors[0].team, 'Demo Racing');
  assert.equal(event.competitors[0].laps, 12); assert.match(event.competitors[0].flag, /gbr.png$/);
  assert.equal(f1.flagUrl('https://evil.test/gbr.png'), '');
  assert.equal(f1.flagUrl('https://user:pass@a.espncdn.com/i/teamlogos/countries/500/gbr.png'), '');
  assert.equal(f1.flagUrl('https://a.espncdn.com/i/teamlogos/nfl/500/sea.png'), '');
});
test('practice completion retains results and next start without ending the weekend', () => {
  const event = normalize(fixture('final'));
  assert.equal(event.state, 'interrupted'); assert.equal(event.details.sessionActive, false);
  assert.equal(event.details.nextSession.name, 'Qualifying'); assert.equal(event.competitors.length, 22);
});
test('session transitions never display old timing as current', () => {
  const f = fixture('final');
  f.scoreboard.events[0].competitions[1].status.type = { state: 'in', description: 'Live' };
  const event = normalize(f);
  assert.equal(event.details.sessionId, '102'); assert.equal(event.state, 'live');
  assert.equal(event.details.missingTiming, true); assert.deepEqual(event.competitors, []);
});
test('race completion requires confirmed completion for every session', () => {
  const f = fixture('final');
  f.scoreboard.events[0].competitions.forEach(c => { c.status.type = { state: 'post', completed: true }; });
  assert.equal(normalize(f).state, 'final');
  f.scoreboard.events[0].competitions[2].status = {};
  assert.notEqual(normalize(f).state, 'final');
});
test('red flags remain interrupted active sessions and retirements preserve classification', () => {
  const f = fixture();
  f.scoreboard.events[0].competitions[0].status.type = { state: 'in', name: 'STATUS_RED_FLAG', description: 'Red flag' };
  f.content.gamepackage.filteredPositions[0].data[3].isRetired = true;
  const event = normalize(f); assert.equal(event.state, 'interrupted'); assert.equal(event.details.sessionActive, true);
  assert.equal(event.competitors[3].status, 'Retired'); assert.equal(event.competitors[3].position, 4);
});
test('qualifying uses segment times and invalid zero times remain unavailable', () => {
  const driver = f1.normalizeDriver({ id: '1', athlete: { displayName: 'Driver' }, q1: '1:21.345', q2: '1:20.123', q3: '0.000' });
  assert.equal(driver.bestTime, '1:20.123');
});
test('F1 config persists full field, driver IDs and only safe flag artwork', () => {
  const config = api.config.normalizeConfig({ sports: [{ sport: 'formula-1', events: [
    { ...watch, leaderboardSize: 'all' }, { view: 'player', playerId: '1000', name: 'Driver 1', flag: 'javascript:alert(1)' },
  ] }] });
  const group = config.sports.find(g => g.sport === 'formula-1');
  assert.equal(group.events[0].leaderboardSize, 'all'); assert.equal(group.events[1].bannerId, 'driver-1000');
  assert.equal(group.events[1].flag, '');
  assert.equal(api.config.isCandidateEnabled(config, { sport: 'formula-1', id: api.config.watchId(group.events[1]) }), true);
});
function harness(phase = 'live') {
  const data = fixture(phase), calls = [], session = f1.createSession(); let clock = 0, fail = false;
  const config = api.config.normalizeConfig();
  const refresh = api.providerRefresh.create({ config: () => config, now: () => clock, wallNow: () => clock, sleep: async () => {},
    fetchImpl: async url => { calls.push(url); return fail ? Response.json({}, { status: 429, headers: { 'Retry-After': '120' } })
      : Response.json(String(url).includes('scoreboard') ? data.scoreboard : data.content); } });
  const options = { watches: [watch, { ...watch, bannerId: 'driver', view: 'player', playerId: '1000' }], session,
    fetchImpl: refresh.fetchFor('formula-1', f1), now: () => clock };
  return { data, calls, config, options, client: f1.createClient(options), time: value => { clock = value; }, fail: value => { fail = value; } };
}
test('all banners and recreated clients share live responses without slowing score updates', async () => {
  const h = harness(); await h.client.discover();
  assert.equal(h.calls.length, 2);
  await Promise.all([h.client.getEvent(api.config.watchId(watch)), f1.createClient(h.options).discover()]);
  assert.equal(h.calls.length, 2);
  h.time(30000); h.data.content.gamepackage.filteredPositions[0].data[0].lapsCompleted = '13';
  assert.equal((await h.client.getEvent(api.config.watchId(watch))).competitors[0].laps, 13);
  assert.equal(h.calls.length, 4);
});
test('longer configured intervals are preserved and cached failures honor provider cooldown', async () => {
  const h = harness(); h.config.providerRefreshSeconds['formula-1'].live = 120;
  await h.client.discover(); h.time(30000); await h.client.discover(); assert.equal(h.calls.length, 2);
  h.time(120000); h.fail(true); assert.equal((await h.client.getEvent(api.config.watchId(watch))).details.stale, true);
  assert.equal(h.calls.length, 3);
  h.options.fetchImpl.retryFailed(); h.time(150000); await h.client.discover(); assert.equal(h.calls.length, 3);
  h.fail(false); h.time(240000); assert.equal((await h.client.getEvent(api.config.watchId(watch))).details.stale, false);
});
test('empty watches and a disabled sport make no upstream requests', async () => {
  const h = harness(); const empty = f1.createClient({ ...h.options, watches: [] });
  await empty.discover(); assert.equal(h.calls.length, 0);
  h.config.sports.find(g => g.sport === 'formula-1').enabled = false;
  await h.client.discover(); assert.equal(h.calls.length, 0);
});

test('completed prior weekend supplies results and the upcoming weekend supplies the next start', async () => {
  const upcoming = fixture('pregame'), prior = fixture('final');
  prior.content.gamepackage.raceStrip.data.sessions.forEach(s => { s.statusState = 'post'; s.completed = true; });
  prior.content.gamepackage.filteredPositions.push({ competitionId: '103', title: 'Race', sessionState: 'post', data: prior.content.gamepackage.filteredPositions[0].data });
  upcoming.scoreboard.leagues[0].calendar = [{ label: 'Previous Grand Prix', endDate: '2026-10-04T12:00Z', event: { $ref: 'http://sports.core.api.espn.pvt/v2/sports/racing/leagues/f1/events/50001?lang=en' } }];
  const client = f1.createClient({ watches: [watch], session: f1.createSession(), now: () => Date.parse('2026-10-08T12:00Z'), fetchImpl: async url =>
    Response.json(url === f1.SCOREBOARD ? upcoming.scoreboard : String(url).includes('/50001?') ? prior.content : upcoming.content) });
  const event = await client.getEvent(api.config.watchId(watch));
  assert.equal(event.state, 'interrupted'); assert.equal(event.details.name, 'Previous Grand Prix');
  assert.equal(event.details.sessionName, 'Race'); assert.equal(event.details.nextSession.name, 'Free Practice 1');
  assert.equal(event.details.nextSession.date, '2026-10-09T09:00Z');
});

test('display priority promotes in-flight discovery and its subsequent shared result request', async () => {
  const f = fixture(), calls = [], promoted = []; let release;
  const fetchImpl = async (url, options) => {
    calls.push({ url, priority: options.priority });
    if (url === f1.SCOREBOARD) await new Promise(resolve => { release = resolve; });
    return Response.json(url === f1.SCOREBOARD ? f.scoreboard : f.content);
  };
  fetchImpl.prioritize = url => promoted.push(url);
  const client = f1.createClient({ watches: [watch], session: f1.createSession(), fetchImpl });
  const discovery = client.discover();
  const display = client.getEvent(api.config.watchId(watch), null, { priority: 'display' });
  release(); await Promise.all([discovery, display]);
  assert.deepEqual(promoted, [f1.SCOREBOARD]); assert.equal(calls.length, 2); assert.equal(calls[1].priority, 'display');
});

test('desktop relay accepts only F1 results JSON and honors the sport disable switch', async () => {
  const { createHandler } = require('../../../desktop/protocol.cjs');
  const config = api.config.normalizeConfig(); let calls = 0;
  const handler = createHandler({ store: { snapshot: () => ({ config }) }, fetchProvider: async () => { calls++; return Response.json(fixture().content); } });
  const request = target => handler(new Request(`sportsover://app/api/provider?${new URLSearchParams({ url: target })}`));
  assert.equal((await request(f1.resultsUrl('60001'))).status, 200);
  config.sports.find(group => group.sport === 'formula-1').enabled = false;
  assert.equal((await request(f1.resultsUrl('60001'))).status, 409); assert.equal(calls, 1);
  assert.equal((await request('https://www.espn.com/login')).status, 400);
});
