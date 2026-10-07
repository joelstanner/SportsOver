require('../../scripts/offline-network.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSession, checkProvider, cli } = require('../../scripts/provider-contracts.cjs');
function fixture(provider, respond = () => Response.json({})) {
  let clock = 100000;
  const calls = [], saved = [];
  const session = createSession({ provider, fetchImpl: async (url, options) => { calls.push({ url, options, clock }); return respond(url); },
    now: () => clock, sleep: async ms => { clock += ms; }, save: async state => saved.push({ ...state }), log() {} });
  return { session, calls, saved };
}
test('contract requests cap traffic, reject unrelated hosts, and serialize Lichess pacing', async () => {
  const f = fixture('lichess');
  for (let i = 0; i < 3; i++) await f.session.get('directory', 'https://lichess.org/api/broadcast/top', () => {});
  assert.deepEqual(f.calls.map(call => call.clock), [100000, 101500, 103000]);
  assert.ok(f.calls.every(call => call.options.redirect === 'error' && call.options.signal instanceof AbortSignal));
  await assert.rejects(f.session.get('extra', 'https://lichess.org/api/broadcast/top', () => {}), /cap/);
  await assert.rejects(f.session.get('wrong', 'https://example.com/feed', () => {}), /selected provider/);
  assert.equal(f.calls.length, 3);
});
test('429 and provider errors stop further requests and save Retry-After or exponential cooldowns', async () => {
  for (const status of [429, 403, 503]) {
    const f = fixture('pdga', () => Response.json({}, { status, headers: { 'Retry-After': '120' } }));
    const url = 'https://www.pdga.com/apps/tournament/live-api/live_results_fetch_event?TournID=1';
    await assert.rejects(f.session.get('metadata', url, () => {}), new RegExp(`HTTP ${status}`));
    await assert.rejects(f.session.get('retry', url, () => {}), /cooldown/);
    assert.equal(f.calls.length, 1);
    assert.equal(f.saved.at(-1).until, 220000);
    const state = f.saved.at(-1);
    const next = createSession({ provider: 'pdga', state, now: () => 100000, fetchImpl: () => assert.fail('cooldown must survive rerun') });
    await assert.rejects(next.get('metadata', url, () => {}), /cooldown/);
  }
});
test('transport and shape failures stop the run; redirects and bodies use a timeout', async () => {
  for (const respond of [() => { throw Error('Timed out'); }, () => new Response('invalid JSON'), () => Response.json({ drift: true })]) {
    const f = fixture('espn', respond);
    await assert.rejects(f.session.get('scoreboard', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', body => assert.ok(Array.isArray(body.events))));
    await assert.rejects(f.session.get('retry', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', () => {}), /cooldown/);
    assert.equal(f.calls.length, 1);
    assert.ok(f.saved.at(-1).until >= 160000);
  }
});
test('PDGA metadata determines the division round, without polling or extra discovery', async () => {
  const f = fixture('pdga', url => Response.json({ data: require(url.includes('fetch_event') ? '../sports/disc-golf/event.json' : '../sports/disc-golf/round.json') }));
  await checkProvider(f.session, { provider: 'pdga' });
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1].url, /Round=3/);
});
test('empty live directories report unverified score contracts instead of claiming complete coverage', async () => {
  for (const provider of ['espn', 'lichess']) {
    const f = fixture(provider, () => Response.json({ active: [], events: [] }));
    await assert.rejects(checkProvider(f.session, { provider }), /could not be verified/);
    assert.equal(f.calls.length, 1);
  }
});
test('live command requires explicit opt-in and validates provider names before dispatch', async () => {
  await assert.rejects(cli([]), /explicit/);
  await assert.rejects(cli(['--live', 'invalid']), /Unknown provider/);
  await assert.rejects(cli(['--live', 'mlb', 'mlb']), /repeat/);
});
test('ESPN and MLB checks validate identities, game states and scores with two requests', async () => {
  const competition = { status: { type: { state: 'post' } }, competitors: [
    { homeAway: 'away', score: '31', team: { id: '1', displayName: 'Arizona Cardinals' } },
    { homeAway: 'home', score: '17', team: { id: '2', displayName: 'Atlanta Falcons' } },
  ] };
  const espn = fixture('espn', url => Response.json(url.includes('summary') ? { header: { competitions: [competition] } }
    : { events: [{ id: '123', date: '2026-10-07T00:00:00Z', competitions: [competition] }] }));
  await checkProvider(espn.session, { provider: 'espn' });
  assert.equal(espn.calls.length, 2);
  const mlb = fixture('mlb', url => Response.json(url.includes('schedule')
    ? { dates: [{ games: [{ gamePk: 123, gameDate: '2025-06-01T00:00:00Z', status: { abstractGameState: 'Final' } }] }] }
    : { gameData: { status: { abstractGameState: 'Final' }, teams: { away: { id: 109, name: 'Arizona Diamondbacks' }, home: { id: 144, name: 'Atlanta Braves' } } }, liveData: { linescore: { teams: { away: { runs: 4 }, home: { runs: 2 } } } } }));
  await checkProvider(mlb.session, { provider: 'mlb' });
  assert.equal(mlb.calls.length, 2);
});
test('Lichess checks directory, metadata and one round without secondary discovery', async () => {
  const f = fixture('lichess', url => Response.json(url.endsWith('/top') ? { active: [{ tour: { id: 'Tour1234' } }] }
    : url.includes('/-/-/') ? { tour: { id: 'Tour1234' }, round: { id: 'Round001' }, games: [{ id: 'Game0001', players: [{ name: 'Player A' }, { name: 'Player B' }] }] }
    : { tour: { id: 'Tour1234' }, defaultRoundId: 'Round001', rounds: [{ id: 'Round001' }] }));
  await checkProvider(f.session, { provider: 'lichess' });
  assert.equal(f.calls.length, 3);
  assert.match(f.calls[2].url, /Round001$/);
});
test('contract recording happens only after validation and rejects oversized bodies', async () => {
  const recorded = [];
  const session = createSession({ provider: 'mlb', fetchImpl: async () => Response.json({ dates: [] }),
    record: async (name, body) => recorded.push({ name, body }), save: async () => {}, log() {} });
  const url = 'https://statsapi.mlb.com/api/v1/schedule';
  await session.get('schedule', url, body => assert.ok(Array.isArray(body.dates)));
  assert.deepEqual(recorded, [{ name: 'schedule', body: { dates: [] } }]);
  const large = createSession({ provider: 'mlb', fetchImpl: async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)), log() {} });
  await assert.rejects(large.get('oversized', url, () => assert.fail('must not validate oversized body')), /4 MiB/);
});
test('provider runs honor the shared invocation lock without issuing requests', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { runLive } = require('../../scripts/provider-contracts.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sportsover-contract-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'running'));
  await assert.rejects(runLive({ providers: ['pdga'], directory }), /Another provider check is running/);
});
