"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../core/config.js');
require('../../core/event-model.js');
require('../../core/game-selection.js');
require('../../core/provider-discovery.js');
require('../../core/provider-refresh.js');
require('../../sports/hockey/providers/espn.js');
require('../../sports/baseball/providers/mlb.js');
const api = globalThis.SportsOverlay;
const generic = { toCandidate: game => game, normalizeEvent: payload => payload };
const espn = 'https://site.api.espn.com/apis/site/v2/sports';
const mlb = 'https://statsapi.mlb.com/api/v1/schedule';
const teamSchedule = `${espn}/hockey/nhl/teams/bos/schedule?season=2027`;

function fixture(reply = () => Response.json({ state: 'live' })) {
  let time = 0;
  const calls = [], config = api.config.normalizeConfig();
  const cache = api.providerRefresh.create({ config: () => config, now: () => time,
    wallNow: () => Date.parse('2026-10-07T00:00:00Z') + time, sleep: async () => {},
    fetchImpl: async url => { calls.push(url); return reply(url); } });
  return { cache, config, calls, time: value => { time = value; } };
}

test('season and team date-range schedules share a 15-minute minimum across clients', async () => {
  const urls = [
    ...['hockey/nhl', 'basketball/nba', 'basketball/mens-college-basketball', 'football/college-football', 'soccer/usa.1']
      .map(league => `${espn}/${league}/teams/1/schedule?season=2026`),
    `${espn}/soccer/usa.1/teams/1/schedule?season=2026&fixture=true`,
    `${mlb}?sportId=1&teamId=111&startDate=2026-10-06&endDate=2026-10-14&hydrate=seriesStatus`,
  ];
  for (const url of urls) {
    const f = fixture(), first = f.cache.fetchFor('baseball', generic), second = f.cache.fetchFor('baseball', generic);
    await Promise.all([first(url), second(url)]);
    for (const time of [12000, 60000, 300000, 899999]) {
      f.time(time); await second(url);
    }
    assert.equal(f.calls.length, 1, url);
    f.time(900000); await first(url);
    assert.equal(f.calls.length, 2, url);
  }
});

test('schedule caches respect longer settings and keep seasons and date ranges separate', async () => {
  const f = fixture(), fetch = f.cache.fetchFor('hockey', generic);
  f.config.providerRefreshSeconds.hockey.live = 1800;
  await fetch(teamSchedule);
  f.time(900000); await fetch(teamSchedule);
  assert.equal(f.calls.length, 1);
  await fetch(teamSchedule.replace('2027', '2028'));
  assert.equal(f.calls.length, 2);
  f.time(1800000); await fetch(teamSchedule);
  assert.equal(f.calls.length, 3);
  const baseball = f.cache.fetchFor('baseball', generic);
  const range = `${mlb}?teamId=111&startDate=2026-10-06&endDate=2026-10-14`;
  await baseball(range); await baseball(range.replace('10-06', '10-07').replace('10-14', '10-15'));
  assert.equal(f.calls.length, 5);
});

test('scoreboards, NFL week feeds, summaries and live MLB game feeds keep normal cadence', async () => {
  for (const url of [
    `${espn}/hockey/nhl/scoreboard?limit=100`,
    `${espn}/football/nfl/scoreboard?limit=100&dates=2026&seasontype=2&week=5`,
    `${espn}/hockey/nhl/summary?event=1`,
    `${mlb}?sportId=1&date=2026-10-07&hydrate=broadcasts,linescore,seriesStatus`,
    'https://statsapi.mlb.com/api/v1.1/game/1/feed/live',
  ]) {
    const f = fixture(), fetch = f.cache.fetchFor('baseball', generic);
    await fetch(url); f.time(11999); await fetch(url);
    assert.equal(f.calls.length, 1, url);
    f.time(12000); await fetch(url);
    assert.equal(f.calls.length, 2, url);
  }
});

test('failed schedule refreshes recover at the score interval rather than waiting 15 minutes', async () => {
  let offline = false;
  const f = fixture(() => { if (offline) throw Error('offline'); return Response.json({ state: 'live' }); });
  const fetch = f.cache.fetchFor('hockey', generic);
  await fetch(teamSchedule);
  offline = true; f.time(900000); await assert.rejects(fetch(teamSchedule), /offline/);
  offline = false; f.time(911999); await assert.rejects(fetch(teamSchedule), /offline/);
  assert.equal(f.calls.length, 2);
  f.time(912000); await fetch(teamSchedule);
  assert.equal(f.calls.length, 3);
  f.time(924000); await fetch(teamSchedule);
  assert.equal(f.calls.length, 3);
});

test('manual schedule retries preserve provider cooldowns', async () => {
  let limited = true;
  const f = fixture(() => limited ? Response.json({}, { status: 429, headers: { 'Retry-After': '120' } })
    : Response.json({ state: 'live' }));
  const fetch = f.cache.fetchFor('hockey', generic);
  await assert.rejects(fetch(teamSchedule), /429/);
  limited = false; f.time(60000); fetch.retryFailed();
  await assert.rejects(fetch(teamSchedule), /429/);
  assert.equal(f.calls.length, 1);
  f.time(120000); await fetch(teamSchedule);
  assert.equal(f.calls.length, 2);
});

test('fresh ESPN and MLB discovery wins over cached schedules through game transitions', async () => {
  const date = new Date('2026-10-07T20:00:00Z');
  for (const sport of ['hockey', 'baseball']) {
    let state = 'pregame';
    const game = current => sport === 'hockey' ? {
      id: '1', date: date.toISOString(), competitions: [{
        status: { type: { state: { pregame: 'pre', live: 'in', final: 'post' }[current] } },
        competitors: [
          { id: 'BOS', team: { id: 'BOS', abbreviation: 'BOS' } },
          { id: 'NYR', team: { id: 'NYR', abbreviation: 'NYR' } },
        ],
      }],
    } : { gamePk: 1, gameDate: date.toISOString(),
      status: { abstractGameState: { pregame: 'Preview', live: 'Live', final: 'Final' }[current] },
      teams: { away: { team: { id: 111 } }, home: { team: { id: 147 } } } };
    const f = fixture(url => {
      const schedule = url.includes('/teams/') || url.includes('teamId=');
      const games = [game(schedule ? 'pregame' : state)];
      return Response.json(sport === 'hockey' ? { events: games } : { dates: [{ games }] });
    });
    const provider = sport === 'hockey' ? api.espnNhl : api.mlb;
    const team = { teamId: sport === 'hockey' ? 'BOS' : 111 };
    const createClient = team => {
      const client = provider.createClient({ ...team, requestTimeoutMs: 8000, fetchImpl: f.cache.fetchFor(sport, provider) });
      return { ...client, findGames: () => client.findGames(date), findLeagueGames: () => client.findLeagueGames(date) };
    };
    for (const [time, nextState] of [[0, 'pregame'], [60000, 'live'], [72000, 'final']]) {
      state = nextState; f.time(time);
      const discovery = await api.providerDiscovery.discover({ teams: [team], provider: createClient(team),
        createClient, toCandidate: provider.toCandidate });
      assert.equal(provider.toCandidate(discovery.favoriteGames[0]).state, 'pregame');
      const queue = api.selection.buildRotationQueue({ ...discovery, favoriteTeamIds: [team.teamId],
        toCandidate: provider.toCandidate, fallbackMode: nextState === 'final' ? 'recent-final' : 'up-next' });
      assert.equal(queue[0].candidate.state, nextState, sport);
      assert.equal(queue[0].kind, nextState === 'live' ? 'favorite-live' : 'favorite');
    }
    assert.equal(f.calls.filter(url => url.includes('/teams/') || url.includes('teamId=')).length, 1, sport);
    assert.equal(f.calls.length, 4, sport);
  }
});
