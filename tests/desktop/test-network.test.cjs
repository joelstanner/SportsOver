require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { installTestNetwork, testNetworkState } = require('../../desktop/test-network.cjs');
const { installHttpLogging } = require('../../desktop/http-logging.cjs');

test('test protection is confined to isolated fixture profiles', () => {
  const session = { protocol: { isProtocolHandled() { throw Error('Unexpected interception'); } } };
  assert.equal(installTestNetwork({ session, env: {} }), undefined);
  assert.equal(installTestNetwork({ session, env: { SPORTSOVER_TEST_NETWORK: 'fixtures' } }), undefined);
  assert.equal(installTestNetwork({ session, env: { SPORTSOVER_TEST_DATA: '/test', SPORTSOVER_TEST_NETWORK: 'live' } }), undefined);
  assert.throws(() => installTestNetwork({ session, env: { SPORTSOVER_TEST_DATA: '/test', SPORTSOVER_TEST_NETWORK: 'typo' } }), /fixtures.*live/);
});

test('startup cancellation and fixtures compose with diagnostics while preserving local output and blocking redirect escapes', () => {
  const handlers = {}, messages = [];
  let fixtures = false;
  const session = { protocol: { isProtocolHandled: scheme => scheme === 'https' && fixtures },
    webRequest: Object.fromEntries(['onBeforeRequest', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred'].map(name => [name, (_filter, handler) => { handlers[name] = handler; }])) };
  const guard = installTestNetwork({ session, env: { SPORTSOVER_TEST_DATA: '/test' } });
  installHttpLogging(session, { ...guard, log: message => messages.push(message) });
  let id = 0;
  const request = (url, requestId = ++id) => {
    let result;
    handlers.onBeforeRequest({ id: requestId, method: 'GET', url }, value => { result = value; });
    return result;
  };
  for (const url of ['https://lichess.org/api/broadcast', 'http://site.api.espn.com/scoreboard', 'http://localhost.example.com/',
    'http://127.0.0.1.example.com/', 'http://user@localhost/']) assert.deepEqual(request(url), { cancel: true });
  for (const hostname of ['127.0.0.1', 'localhost', '[::1]']) assert.deepEqual(request(`http://${hostname}:1234/output`), {});
  fixtures = true;
  assert.deepEqual(request('https://lichess.org/api/broadcast'), {}, 'HTTPS is allowed after a fixture handler is registered');
  assert.equal(testNetworkState().blocked, 5);
  assert.equal(testNetworkState().local, 3);
  assert.equal(messages.length, 9, 'blocked requests still receive HTTP diagnostics');
  const local = 'http://127.0.0.1:1234/output', target = 'https://live-feed.test/escape';
  assert.deepEqual(request(local, 100), {});
  handlers.onBeforeRedirect({ id: 100, method: 'GET', url: local, statusCode: 302, redirectURL: target });
  assert.deepEqual(request(target, 100), { cancel: true }, 'a native redirect cannot bypass protection after fixtures exist');
  handlers.onErrorOccurred({ id: 100, method: 'GET', url: target, error: 'net::ERR_BLOCKED_BY_CLIENT' });
  assert.deepEqual(request(target, 100), {}, 'completed redirect bookkeeping is released');
  handlers.onBeforeRedirect({ id: 101, method: 'GET', url: local, statusCode: 302, redirectURL: 'http://127.0.0.1:1234/sports/display.html' });
  assert.deepEqual(request('http://127.0.0.1:1234/sports/display.html', 101), {});
  installHttpLogging(session, { ...guard, log() { throw Error('terminal unavailable'); } });
  assert.deepEqual(request('http://live-feed.test/'), { cancel: true }, 'a broken log sink cannot bypass protection');
});

test('startup fixtures precede traffic; replacement, unknown URLs and bypass attempts keep their assertions', async () => {
  let dispatcher, nativeFetches = 0;
  const session = { protocol: {
    handle(scheme, handler) { assert.equal(scheme, 'https'); dispatcher = handler; },
    isProtocolHandled: scheme => scheme === 'https', unhandle() {},
  } };
  const net = { fetch: async () => { nativeFetches++; return Response.json({ native: true }); } };
  installTestNetwork({ session, net, env: { SPORTSOVER_TEST_DATA: '/test' } });
  const request = url => dispatcher({ url });
  assert.equal((await request('https://api.github.com/repos/joelstanner/SportsOver/releases/latest')).status, 404);
  assert.deepEqual(await (await request('https://lichess.org/api/broadcast/top')).json(), { active: [], upcoming: [], past: [], rounds: [], games: [] });
  assert.equal(testNetworkState().blocked, 0);
  assert.equal((await request('https://unexpected.test/startup')).status, 599);
  session.protocol.handle('https', () => Response.json({ fixture: true }));
  assert.deepEqual(await (await request('https://fixture.test/feed')).json(), { fixture: true });
  await assert.rejects(net.fetch('https://fixture.test/feed', { bypassCustomProtocol: true }), /bypass/);
  assert.equal(nativeFetches, 0);
  assert.throws(() => session.protocol.unhandle('https'), /cannot remove/);
  session.protocol.handle('https', () => { throw Error('Broken fixture'); });
  await assert.rejects(request('https://fixture.test/broken'), /Broken fixture/);
  assert.deepEqual(testNetworkState().urls, ['https://unexpected.test/startup', 'https://fixture.test/feed', 'https://fixture.test/broken']);
});
