'use strict';
require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../core/event-model.js');
require('../../core/odds.js');
const { espnOdds } = global.SportsOverlay.model;
const { createTracker, GRACE_MS, isNearEven, isCloseSpread } = global.SportsOverlay.odds;
const legacy = { details: 'AWY -3.5', spread: 3.5, awayTeamOdds: { moneyLine: -185 }, homeTeamOdds: { moneyLine: 154 } };
const competition = { competitors: [{ homeAway: 'away', team: { abbreviation: 'AWY' } }, { homeAway: 'home', team: { abbreviation: 'HME' } }] };
function event(state = 'pregame', odds = espnOdds({ pickcenter: [legacy], header: { competitions: [competition] } })) {
  return { id: '1', sport: 'football', state, startTime: new Date(1000).toISOString(), teams: { away: { abbreviation: 'AWY', score: 0 }, home: { abbreviation: 'HME', score: 0 } }, details: { odds } };
}
test('near-even prices include both ±120 boundaries and exclude invalid American odds', () => {
  for (const value of [-120, -110, -100, 100, 110, 120]) assert.equal(isNearEven(value), true, value);
  for (const value of [-121, 121, -99, 99, 0, null, undefined, NaN, Infinity, '-110']) assert.equal(isNearEven(value), false, String(value));
});
test('close spreads use sport units and include pick’em and both threshold boundaries', () => {
  for (const sport of ['football', 'college-football', 'basketball', 'college-basketball']) {
    for (const value of [-3, 0, 3]) assert.equal(isCloseSpread(sport, value), true);
    for (const value of [-3.5, 3.5, null, NaN]) assert.equal(isCloseSpread(sport, value), false);
  }
  for (const sport of ['hockey', 'soccer']) {
    for (const value of [-0.5, 0, 0.5]) assert.equal(isCloseSpread(sport, value), true);
    for (const value of [-1.5, 1.5]) assert.equal(isCloseSpread(sport, value), false);
  }
  assert.equal(isCloseSpread('disc-golf', 0), false);
});
test('close point spreads qualify independently of lopsided moneylines and neutral payout prices', () => {
  const rows = createTracker()(event('pregame', {
    spread: { pregame: { away: -2.5, home: 2.5 }, prices: { pregame: { away: -110, home: -110 } } },
    moneyline: { pregame: { away: -142, home: 120 } },
  }), 1000);
  assert.equal(rows[0].text, 'AWY -2.5 (-110) · HME +2.5 (-110)');
  assert.deepEqual(rows[0].values.map(value => value.closeSpread), [true, true]);
  assert.ok(rows.flatMap(row => row.values).every(value => value.nearEven === false));
});
test('spread payout prices stay neutral even when they are close to even money', () => {
  const odds = espnOdds({ odds: [{ pointSpread: {
    away: { close: { line: '-3.5', odds: '-120' }, live: { line: '-1.5', odds: '+120' } },
    home: { close: { line: '+3.5', odds: '-121' } },
  }, moneyline: { away: { close: { odds: '+100' } }, home: { close: { odds: '+121' } } } }] });
  const rows = createTracker()(event('pregame', odds), 1000);
  assert.equal(rows[0].text, 'AWY -3.5 (-120) · HME +3.5 (-121)');
  assert.deepEqual(rows[0].values.map(value => value.nearEven), [false, false]);
  assert.deepEqual(rows[1].values.map(value => value.nearEven), [false, false]);
  const live = createTracker()(event('live', odds), 1000 + GRACE_MS);
  assert.equal(live[0].text, 'AWY -1.5 (+120)');
  assert.equal(live[0].values[0].nearEven, false);
  const pointsOnly = createTracker()(event('pregame', { spread: { pregame: { away: -110 } } }), 1000);
  assert.equal(pointsOnly[0].values[0].nearEven, false);
});
test('highlight evenly matched teams only when both visible moneylines are within ±120', () => {
  const highlights = (pregame, live, state = 'pregame') => createTracker()(event(state, { moneyline: { pregame, live } }), 1000)
    .flatMap(row => row.values.filter(value => value.nearEven).map(value => value.price));
  assert.deepEqual(highlights({ away: -120, home: 100, draw: 110 }), [-120, 100]);
  assert.deepEqual(highlights({ away: 120, home: -120 }), [120, -120]);
  assert.deepEqual(highlights({ away: 120, home: -142 }), []);
  assert.deepEqual(highlights({ away: -121, home: 100 }), []);
  assert.deepEqual(highlights({ away: 110 }), []);
  assert.deepEqual(highlights({}, { away: -110, home: 120 }, 'live'), [-110, 120]);
  assert.deepEqual(highlights({ away: -110, home: 100 }, { away: -180 }, 'live'), []);
  assert.deepEqual(highlights({ home: 110 }, { away: -110 }, 'live'), []);
});
test('summary and scoreboard odds normalize named spreads and signed moneylines', () => {
  const odds = espnOdds({ pickcenter: [legacy], header: { competitions: [competition] } });
  assert.equal(odds.spread.pregame.away, -3.5);
  assert.equal(odds.spread.pregame.home, 3.5);
  assert.equal(odds.moneyline.pregame.home, 154);
  assert.deepEqual(espnOdds({ competitions: [{ ...competition, odds: [legacy] }] }), odds);
  assert.equal(espnOdds({}), null);
  assert.equal(espnOdds({ odds: [{ moneyline: { home: { close: { odds: 'OFF' } } } }] }), null);
});
test('empty odds entries cannot prevent cards from rendering and valid embedded markets remain available', () => {
  for (const missing of [null, undefined, 'OFF', 0, []]) {
    assert.equal(espnOdds({ odds: [missing] }), null);
    assert.equal(espnOdds({ odds: [missing, { moneyline: { away: { close: { odds: '-110' } } } }] }).moneyline.pregame.away, -110);
  }
  assert.equal(espnOdds({ pickcenter: [null], odds: [null], competitions: [{ odds: [legacy] }] }).moneyline.pregame.home, 154);
});
test('moneyline details never become a puck line and missing markets stay absent', () => {
  const odds = espnOdds({ odds: [{ ...legacy, details: 'AWY -185', spread: -1.5 }], competitions: [competition] });
  assert.equal(odds.spread.pregame.away, null);
  assert.equal(createTracker()(event('pregame', odds), 1000).length, 1);
});
test('closing, opening and live lines stay separate, including soccer draws', () => {
  const odds = espnOdds({ odds: [{ moneyline: { away: { open: { odds: '+200' }, close: { odds: '+150' }, live: { odds: '+250' } }, draw: { close: { odds: '+300' }, live: { odds: '+350' } } }, pointSpread: { home: { close: { line: '0' }, live: { line: '-1.5' } } } }] });
  assert.equal(odds.moneyline.pregame.away, 150);
  assert.equal(odds.moneyline.live.away, 250);
  const rows = createTracker()(event('live', odds), 1000);
  assert.ok(rows.some(row => row.label === 'LIVE ML' && row.text.includes('DRAW +350')));
  assert.ok(rows.some(row => row.label === 'LIVE SPREAD' && row.text === 'HME -1.5'));
  assert.ok(!rows.some(row => row.text.includes('+150')));
});
test('pregame lines expire five minutes after observed start and cannot reset on rotation', () => {
  const rows = createTracker();
  assert.equal(rows(event(), 1000).length, 2);
  assert.equal(rows(event('live'), 5000).length, 2);
  assert.equal(rows(event('live'), 5000 + GRACE_MS - 1).length, 2);
  rows({ ...event(), id: 'other' }, 6000);
  assert.equal(rows(event('live'), 5000 + GRACE_MS).length, 0);
  assert.equal(rows(event('interrupted'), 5000 + GRACE_MS).length, 0);
});
test('joining a game already underway hides closing odds; explicit live odds remain', () => {
  const rows = createTracker();
  assert.deepEqual(rows(event('live'), 1000 + GRACE_MS), []);
  const liveOdds = espnOdds({ odds: [{ moneyline: { away: { live: { odds: '-110' } } } }] });
  assert.equal(rows(event('live', liveOdds), 1000 + GRACE_MS * 3)[0].label, 'LIVE ML');
  assert.deepEqual(rows(event('final', liveOdds), 1000 + GRACE_MS * 3), []);
  assert.deepEqual(rows(event('live', null), 1000 + GRACE_MS * 3), []);
});
test('a delayed pregame retains odds and zero spreads display as pick’em', () => {
  const rows = createTracker();
  assert.equal(rows(event(), 1000 + GRACE_MS * 3).length, 2);
  assert.equal(rows(event('interrupted'), 1000 + GRACE_MS * 4).length, 2);
  const odds = espnOdds({ odds: [{ pointSpread: { away: { close: { line: '0' } } } }] });
  assert.equal(rows(event('pregame', odds), 1000)[0].text, 'AWY PK');
});

test('a scoreless intermission is already in play and hides old lines on joining', () => {
  const game = event('interrupted');
  game.details.inPlay = true;
  assert.deepEqual(createTracker()(game, 1000 + GRACE_MS), []);
});

require('../../core/timeouts.js');
require('../../core/registry.js');
for (const sport of ['football', 'college-football', 'basketball', 'college-basketball', 'hockey', 'soccer']) {
  require(`../../sports/${sport}/providers/espn.js`);
}
test('all six ESPN providers retain embedded odds and in-play status', () => {
  for (const name of ['espn-nfl', 'espn-ncaaf', 'espn-nba', 'espn-ncaam', 'espn-nhl', 'espn-mls']) {
    const game = global.SportsOverlay.registry.getProvider(name).normalizeEvent({ id: 'odds-test', pickcenter: [legacy], header: { competitions: [{ ...competition, status: { type: { state: 'in' } } }] } });
    assert.equal(game.details.odds.moneyline.pregame.away, -185, name);
    assert.equal(game.details.inPlay, true, name);
  }
});
