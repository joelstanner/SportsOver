const test = require('node:test');
const assert = require('node:assert/strict');
const { bannerUrl } = require('../../desktop/banner-link.cjs');

test('opens Lichess broadcast rounds and individual games', () => {
  for (const url of ['https://lichess.org/broadcast/-/-/Round001', 'https://lichess.org/broadcast/masters/round-1/Round001/Game0001#32']) {
    assert.equal(bannerUrl(url), url);
  }
});

test('rejects unrelated sites, credentials, ports, and non-web links', () => {
  for (const url of [null, {}, 'not a URL', 'javascript:alert(1)', 'file:///tmp/game',
    'http://lichess.org/broadcast/-/-/Round001', 'https://lichess.org.evil.com/broadcast/-/-/Round001',
    'https://evil.com/broadcast/-/-/Round001', 'https://lichess.org/@/player',
    'https://user:password@lichess.org/broadcast/-/-/Round001', 'https://lichess.org:8080/broadcast/-/-/Round001']) {
    assert.throws(() => bannerUrl(url));
  }
});

test('opens PDGA round scores, tournament details, and player profiles', () => {
  for (const url of ['https://www.pdga.com/live/event/86076/MPO/scores?round=3',
    'https://www.pdga.com/live/event/97346/FPO/scores?round=1',
    'https://www.pdga.com/tour/event/86076', 'https://www.pdga.com/player/33705']) {
    assert.equal(bannerUrl(url), url);
  }
});

test('rejects unsafe or unrelated PDGA links', () => {
  for (const url of ['http://www.pdga.com/tour/event/86076', 'https://www.pdga.com.evil.com/tour/event/86076',
    'https://user:password@www.pdga.com/player/33705', 'https://www.pdga.com:8080/player/33705',
    'https://www.pdga.com', 'https://www.pdga.com/apps/tournament/score/login',
    'https://www.pdga.com/live/event/86076/MPO/scoring']) assert.throws(() => bannerUrl(url));
});
