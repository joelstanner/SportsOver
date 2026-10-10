const test = require('node:test');
const assert = require('node:assert/strict');
require('../../core/event-model.js');
require('../../core/registry.js');
require('../../sports/college-football/providers/espn.js');
require('../../sports/college-basketball/providers/espn.js');
const { espnTeamRank } = globalThis.SportsOverlay.model;

test('ESPN display ranks accept top 25 only and prefer scoreboard metadata', () => {
  for (const rank of [1, 9, 25, '12']) assert.equal(espnTeamRank({ rank }), Number(rank));
  for (const rank of [undefined, null, '', 0, -1, 26, 99, 1.5, 'invalid', true, Infinity]) {
    assert.equal(espnTeamRank({ rank }), null);
  }
  assert.equal(espnTeamRank({ curatedRank: { current: 7 }, rank: 2 }), 7);
  assert.equal(espnTeamRank({ curatedRank: { current: 99 }, rank: 2 }), null);
});

for (const [sport, provider] of [
  ['college-football', globalThis.SportsOverlay.espnNcaaf],
  ['college-basketball', globalThis.SportsOverlay.espnNcaam],
]) {
  test(`${sport} preserves scoreboard and summary ranks without reusing absent ranks`, () => {
    const competitors = ['away', 'home'].map((homeAway, index) => ({
      homeAway, team: { id: ['57', '248'][index], displayName: ['Florida Gators', 'Houston Cougars'][index], abbreviation: ['FLA', 'HOU'][index] },
      score: [70, 65][index], rank: [3, 25][index],
    }));
    const competition = { id: 'rank-test', competitors, status: { type: { state: 'in' } } };
    const normalize = () => provider.normalizeEvent({ header: { id: 'rank-test', competitions: [competition] } });
    assert.equal(normalize().teams.away.rank, 3);
    assert.equal(normalize().teams.home.rank, 25);
    competitors[0].curatedRank = { current: 8 };
    assert.equal(normalize().teams.away.rank, 8);
    delete competitors[0].curatedRank;
    delete competitors[0].rank;
    competitors[1].rank = 99;
    assert.equal(normalize().teams.away.rank, null);
    assert.equal(normalize().teams.home.rank, null);
  });
}
