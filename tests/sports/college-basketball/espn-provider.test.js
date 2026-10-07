require('../../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../core/event-model.js');
require('../../../core/registry.js');
require('../../../core/game-selection.js');
require('../../../sports/college-basketball/providers/espn.js');
require('../../../sports/basketball/layout.js');
require('../../../sports/college-basketball/demo-data.js');
const provider = globalThis.SportsOverlay.espnNcaam;
const registry = globalThis.SportsOverlay.registry;
// Trimmed ESPN summary for the 2025 Florida–Houston championship, retrieved 2026-09-30.
const summary = require('./championship-summary.json');

test('normalizes a real NCAA championship summary and keeps college identity', () => {
  const event = provider.normalizeEvent(summary, '57');
  assert.equal(event.sport, 'college-basketball');
  assert.equal(event.league, 'NCAAM');
  assert.equal(event.state, 'final');
  assert.equal(event.teams.away.name, 'Florida Gators');
  assert.equal(event.teams.away.score, 65);
  assert.equal(event.teams.home.score, 63);
  assert.equal(event.teams.away.featured, true);
  assert.equal(event.teams.home.featured, false);
  assert.equal(event.details.period, '2ND HALF');
  assert.equal(event.teams.home.timeoutsRemaining, null);
  assert.ok(Number.isFinite(event.details.homeRebounds));
  assert.match(event.teams.home.logoUrl, /ncaa/);
});

test('college periods use halves, then overtime, and preserve a 20-minute clock', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(provider.periodLabel), ['', '1ST HALF', '2ND HALF', 'OT', 'OT2', 'OT3']);
  const payload = structuredClone(summary);
  payload.header.competitions[0].status = { period: 1, displayClock: '20:00', type: { state: 'in', description: 'In Progress' } };
  const event = provider.normalizeEvent(payload);
  assert.equal(event.state, 'live');
  assert.equal(event.details.clock, '20:00');
  assert.equal(event.details.period, '1ST HALF');
  payload.header.competitions[0].status.type.description = 'Halftime';
  assert.equal(provider.normalizeEvent(payload).state, 'interrupted');
});

test('college timeouts use explicit counts without NBA allocation or play-log guesses', () => {
  const payload = structuredClone(summary);
  const competition = payload.header.competitions[0];
  competition.status = { period: 4, type: { state: 'in', description: 'In Progress' } };
  const team = competition.competitors[0];
  team.timeoutsUsed = 1;
  payload.plays = [{ team: { id: team.id }, period: { number: 4 }, type: { text: 'Timeout' } }];
  assert.equal(provider.normalizeEvent(payload).teams.home.timeoutsRemaining, null);
  for (const count of [0, 1, 3, 5]) {
    team.timeoutsRemaining = count;
    assert.equal(provider.normalizeEvent(payload).teams.home.timeoutsRemaining, count);
  }
  team.timeoutsRemaining = -1;
  assert.equal(provider.normalizeEvent(payload).teams.home.timeoutsRemaining, null);
});

test('client requests the men’s college schedule, all D-I scoreboard, and summary', async () => {
  const requests = [];
  const client = provider.createClient({ teamId: '264', requestTimeoutMs: 1000,
    fetchImpl: async url => {
      requests.push(url);
      return { ok: true, json: async () => url.includes('/summary') ? summary : { events: [{ id: '401746082' }] } };
    } });
  assert.equal((await client.findGames(new Date('2026-11-10T12:00:00Z')))[0].id, '401746082');
  assert.equal((await client.findLeagueGames()).length, 1);
  assert.equal((await client.getEvent('401746082', '57')).teams.away.featured, true);
  assert.match(requests[0], /basketball\/mens-college-basketball\/teams\/264\/schedule\?season=2027$/);
  assert.match(requests[1], /scoreboard\?groups=50&limit=1000$/);
  assert.match(requests[2], /summary\?event=401746082$/);
  assert.equal(provider.seasonEndingYear(new Date('2027-03-10T12:00:00Z')), 2027);
  const candidate = provider.toCandidate({ id: '1', competitions: summary.header.competitions });
  assert.equal(candidate.sport, 'college-basketball');
  assert.ok(candidate.teamKeys.includes('57'));
});

test('college basketball has a registered layout and four lifecycle demos', () => {
  assert.equal(typeof registry.getLayout('college-basketball').createLayout, 'function');
  assert.deepEqual(registry.listDemos('college-basketball'), ['pregame', 'live', 'interrupted', 'final']);
  assert.equal(registry.getDemo('college-basketball', 'live').details.period, '2ND HALF');
});
