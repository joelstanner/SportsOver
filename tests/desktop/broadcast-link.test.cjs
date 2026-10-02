const test = require('node:test');
const assert = require('node:assert/strict');
const { broadcastUrl } = require('../../desktop/broadcast-link.cjs');

test('opens Lichess broadcast rounds and individual games', () => {
  for (const url of ['https://lichess.org/broadcast/-/-/Round001', 'https://lichess.org/broadcast/masters/round-1/Round001/Game0001#32']) {
    assert.equal(broadcastUrl(url), url);
  }
});

test('rejects unrelated sites, credentials, ports, and non-web links', () => {
  for (const url of [null, {}, 'not a URL', 'javascript:alert(1)', 'file:///tmp/game',
    'http://lichess.org/broadcast/-/-/Round001', 'https://lichess.org.evil.com/broadcast/-/-/Round001',
    'https://evil.com/broadcast/-/-/Round001', 'https://lichess.org/@/player',
    'https://user:password@lichess.org/broadcast/-/-/Round001', 'https://lichess.org:8080/broadcast/-/-/Round001']) {
    assert.throws(() => broadcastUrl(url));
  }
});
