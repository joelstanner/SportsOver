require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { installHttpLogging } = require('../../desktop/http-logging.cjs');

function fixture(log) {
  const handlers = {}, messages = [];
  let time = 100;
  const session = { webRequest: Object.fromEntries(['onBeforeRequest', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred']
    .map(name => [name, (filter, handler) => {
      assert.deepEqual(filter.urls, ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']);
      handlers[name] = handler;
    }])) };
  installHttpLogging(session, { log: log || (message => messages.push(message)), now: () => time });
  return { handlers, messages, advance: ms => { time += ms; } };
}

test('HTTP diagnostics pair concurrent requests with statuses and timing without modifying them', () => {
  const f = fixture();
  const first = { id: 1, method: 'GET', url: 'https://statsapi.mlb.com/api/v1/schedule?teamId=136' };
  const second = { id: 2, method: 'GET', url: 'https://lichess.org/api/broadcast/top' };
  const allowed = [];
  f.handlers.onBeforeRequest(first, value => allowed.push(value));
  f.advance(10);
  f.handlers.onBeforeRequest(second, value => allowed.push(value));
  f.advance(30);
  f.handlers.onCompleted({ ...second, statusCode: 429 });
  f.advance(20);
  f.handlers.onCompleted({ ...first, statusCode: 200 });
  assert.deepEqual(allowed, [{}, {}]);
  assert.match(f.messages[0], /#1 → GET .*teamId=136/);
  assert.match(f.messages[2], /#2 ← 429 GET .* · 30 ms$/);
  assert.match(f.messages[3], /#1 ← 200 GET .* · 60 ms$/);
});

test('redirects and failures retain useful URLs while excluding credentials, headers and bodies', () => {
  const f = fixture();
  const request = { id: 3, method: 'POST', url: 'https://user:private@example.com/feed?api_key=private&division=MPO',
    uploadData: [{ bytes: Buffer.from('private') }], requestHeaders: { Authorization: 'Bearer private' } };
  f.handlers.onBeforeRequest(request, () => {});
  f.handlers.onBeforeRedirect({ ...request, statusCode: 302, redirectURL: 'https://example.com/next?token=private' });
  f.advance(20);
  f.handlers.onErrorOccurred({ ...request, error: 'net::ERR_TIMED_OUT' });
  assert.match(f.messages[1], /← 302 POST .*redirect to/);
  assert.match(f.messages[2], /net::ERR_TIMED_OUT · 20 ms$/);
  assert.ok(f.messages.every(message => !message.includes('private')));
  assert.match(f.messages[0], /division=MPO/);
});

test('a failed log sink never blocks a request', () => {
  const f = fixture(() => { throw Error('terminal unavailable'); });
  let continued = false;
  assert.doesNotThrow(() => f.handlers.onBeforeRequest({ id: 4, method: 'GET', url: 'https://example.com/' }, () => { continued = true; }));
  assert.equal(continued, true);
  assert.doesNotThrow(() => f.handlers.onCompleted({ id: 4, method: 'GET', url: 'https://example.com/', statusCode: 200 }));
});
