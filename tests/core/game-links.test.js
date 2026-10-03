const test = require('node:test');
const assert = require('node:assert/strict');
global.window = globalThis;
require('../../core/event-model.js');
require('../../core/timeouts.js');
require('../../core/registry.js');
const { gameUrl, espnGameUrl } = globalThis.SportsOverlay.model;
const { bannerUrl } = require('../../desktop/banner-link.cjs');
const sports = { football: 'nfl', 'college-football': 'college-football', basketball: 'nba', 'college-basketball': 'mens-college-basketball', hockey: 'nhl', soccer: 'soccer' };
const providers = { football: 'espnNfl', 'college-football': 'espnNcaaf', basketball: 'espnNba', 'college-basketball': 'espnNcaam', hockey: 'espnNhl', soccer: 'espnMls' };
const link = (href, type = 'summary') => ({ href, rel: [type, 'desktop', 'event'] });

for (const [sport, path] of Object.entries(sports)) {
  require(`../../sports/${sport}/providers/espn.js`);
  test(`${sport} retains game links from both summary and scoreboard feeds`, () => {
    const href = `https://www.espn.com/${path}/${sport === 'soccer' ? 'match' : 'game'}/_/gameId/12345`;
    const competition = { id: '12345', competitors: [], status: { type: { state: 'pre' } } };
    const provider = globalThis.SportsOverlay[providers[sport]];
    for (const payload of [{ header: { id: '12345', links: [link(href)], competitions: [competition] } },
      { id: '12345', links: [link(href)], competitions: [competition] }]) {
      assert.equal(provider.normalizeEvent(payload, '').details.gameUrl, href);
    }
    assert.equal(gameUrl(href), href);
    assert.equal(bannerUrl(href), href);
    assert.equal(provider.normalizeEvent({ competitions: [competition] }, '').details.gameUrl, '');
  });
}

test('prefers a summary, falls back to a box score, and ignores unsafe or app links', () => {
  const summary = 'https://www.espn.com/nfl/game/_/gameId/12345/lions-bears';
  const box = 'https://www.espn.com/nfl/boxscore/_/gameId/12345';
  const links = [link(box, 'boxscore'), link('sportscenter://game/12345'), link(summary)];
  assert.equal(espnGameUrl({ header: { links } }), summary);
  assert.equal(espnGameUrl({ links: links.slice(0, 2) }), box);
  assert.equal(espnGameUrl({ links: [null, { rel: {} }, link('https://evil.com/game')] }), '');
});

test('MLB derives Gameday from a real game ID and leaves demo IDs unlinked', () => {
  require('../../sports/baseball/providers/mlb.js');
  require('../../sports/baseball/demo-data.js');
  const feed = structuredClone(globalThis.MARINERS_DEMO_FEEDS.live);
  const provider = globalThis.SportsOverlay.mlb;
  feed.gameData.game = { ...feed.gameData.game, pk: 12345 };
  const href = 'https://www.mlb.com/gameday/12345';
  assert.equal(provider.normalizeFeed(feed, 136).details.gameUrl, href);
  assert.equal(bannerUrl(href), href);
  delete feed.gameData.game.pk;
  assert.equal(provider.normalizeFeed(feed, 136, 'demo-live').details.gameUrl, '');
});

test('renderer and desktop reject unsafe or unrelated game URLs', () => {
  for (const href of [null, 'javascript:alert(1)', 'http://www.espn.com/nfl/game/_/gameId/123',
    'https://www.espn.com.evil.com/nfl/game/_/gameId/123', 'https://user:pass@www.espn.com/nfl/game/_/gameId/123',
    'https://www.espn.com:8080/nfl/game/_/gameId/123', 'https://www.espn.com/nfl/team/_/name/det',
    'https://www.mlb.com/gameday/demo', 'https://www.mlb.com/account', 'https://www.mlb.com.evil.com/gameday/123']) {
    assert.equal(gameUrl(href), '');
    assert.throws(() => bannerUrl(href));
  }
});
