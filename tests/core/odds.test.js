'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../core/event-model.js');
require('../../core/odds.js');
const { espnOdds } = global.SportsOverlay.model;
const { createTracker, GRACE_MS } = global.SportsOverlay.odds;
const legacy = { details: 'AWY -3.5', spread: 3.5, awayTeamOdds: { moneyLine: -185 }, homeTeamOdds: { moneyLine: 154 } };
const competition = { competitors: [{ homeAway: 'away', team: { abbreviation: 'AWY' } }, { homeAway: 'home', team: { abbreviation: 'HME' } }] };
function event(state = 'pregame', odds = espnOdds({ pickcenter: [legacy], header: { competitions: [competition] } })) {
  return { id: '1', sport: 'football', state, startTime: new Date(1000).toISOString(), teams: { away: { abbreviation: 'AWY', score: 0 }, home: { abbreviation: 'HME', score: 0 } }, details: { odds } };
}
test('summary and scoreboard odds normalize named spreads and signed moneylines', () => {
  const odds = espnOdds({ pickcenter: [legacy], header: { competitions: [competition] } });
  assert.equal(odds.spread.pregame.away, -3.5);
  assert.equal(odds.spread.pregame.home, 3.5);
  assert.equal(odds.moneyline.pregame.home, 154);
  assert.deepEqual(espnOdds({ competitions: [{ ...competition, odds: [legacy] }] }), odds);
  assert.equal(espnOdds({}), null);
  assert.equal(espnOdds({ odds: [{ moneyline: { home: { close: { odds: 'OFF' } } } }] }), null);
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
