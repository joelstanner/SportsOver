require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../core/event-model.js');
require('../../sports/baseball/providers/mlb.js');
const { freeBroadcasts } = globalThis.SportsOverlay.model;
const tv = (name, extra = {}) => ({ region: 'us', type: { shortName: 'TV' }, media: { shortName: name }, ...extra });
const read = entries => freeBroadcasts({ header: { competitions: [{ broadcasts: entries }] } });

test('only exact free US television and streaming services qualify', () => {
  assert.deepEqual(read([tv(' NBC '), tv('Fox'), tv('Tubi'), tv('Pluto TV'), tv('CBS Sports Golazo Network')]), [
    { name: 'NBC', access: 'Antenna' }, { name: 'FOX', access: 'Antenna' },
    { name: 'Tubi', access: 'Free stream' }, { name: 'Pluto TV', access: 'Free stream' },
    { name: 'CBS Sports Golazo Network', access: 'Free stream' },
  ]);
  for (const name of ['ESPN', 'ESPN+', 'FS1', 'FOX ONE', 'Fox Sports', 'CBS Sports Network', 'Peacock',
    'Paramount+', 'Prime Video', 'Netflix', 'YouTube', 'YouTube TV', 'Unknown', '<b>NBC</b>']) {
    assert.deepEqual(read([tv(name)]), [], name);
  }
});

test('region, media type and authorization are honored; uncertain listings stay hidden', () => {
  for (const extra of [{ region: 'au' }, { region: 'ca' }, { region: '' }, { type: '' }, { postGameShow: true }, { type: { shortName: 'Radio' } }, { type: 'AM' }, { type: 'FM' }, { type: 'web' }]) {
    assert.deepEqual(read([tv('ABC', extra)]), [], JSON.stringify(extra));
  }
  assert.deepEqual(read([tv('Tubi', { type: 'web', mvpdAuthRequired: true })]), []);
  assert.equal(read([tv('Tubi', { type: 'web' })])[0].name, 'Tubi');
  assert.deepEqual(freeBroadcasts({ competitions: [{ broadcasts: [{ names: ['ABC'] }], geoBroadcasts: [tv('ABC', { region: 'au' })] }] }), []);
  for (const value of [{}, { broadcasts: [null, 3, {}] }, { broadcasts: 'NBC' }]) assert.deepEqual(freeBroadcasts(value), []);
});

test('mixed listings and duplicates retain only their free component', () => {
  assert.deepEqual(read([tv('ESPN/ABC'), tv('ABC'), tv('FOX / FOX ONE'), tv('FS1')]), [
    { name: 'ABC', access: 'Antenna' }, { name: 'FOX', access: 'Antenna' },
  ]);
  assert.deepEqual(freeBroadcasts({ competitions: [{ broadcasts: [{ names: ['ESPN'] }], geoBroadcasts: [tv('NBC')] }] }), [{ name: 'NBC', access: 'Antenna' }]);
});

test('MLB schedule metadata reaches regular-season events without altering scores or state', () => {
  const event = { id: '10', state: 'live', teams: { away: { score: 1 }, home: { score: 2 } }, details: { inningNumber: 3 } };
  const game = { gamePk: 10, gameType: 'R', broadcasts: [
    { name: 'FOX / FOX ONE', type: 'TV', freeGame: false, mvpdAuthRequired: true },
    { name: 'FOX / FOX ONE', type: 'TV' }, { name: 'NBC', type: 'AM' },
  ] };
  const updated = globalThis.SportsOverlay.mlb.withSchedule(event, game);
  assert.deepEqual(updated.details.freeBroadcasts, [{ name: 'FOX', access: 'Antenna' }]);
  assert.equal(updated.teams, event.teams);
  assert.equal(updated.state, 'live');
  assert.equal(updated.details.inningNumber, 3);
  assert.equal(event.details.freeBroadcasts, undefined);
  assert.equal(globalThis.SportsOverlay.mlb.withSchedule(event, { ...game, gamePk: 11 }), event);
});
