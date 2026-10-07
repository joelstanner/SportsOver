// Install before windows or launch checks start; unexpected traffic is retained
// for the launcher's final assertion, even when application code catches errors.
let state = null;
function installTestNetwork({ session, net, env = process.env }) {
  if (!env.SPORTSOVER_TEST_DATA || env.SPORTSOVER_TEST_NETWORK === 'live') return;
  if (env.SPORTSOVER_TEST_NETWORK && env.SPORTSOVER_TEST_NETWORK !== 'fixtures') {
    throw Error('SPORTSOVER_TEST_NETWORK must be "fixtures" or "live".');
  }
  require('./test-node-network.cjs');
  state = { blocked: 0, local: 0, urls: new Set(), fixtures: new Set() };
  globalThis.sportsTestNetworkState = testNetworkState;
  const remoteRedirects = new Set();
  const block = url => {
    state.blocked++;
    state.urls.add(url);
    console.error(`[test-network] Unexpected external request: ${url}`);
  };
  // Keep one HTTPS dispatcher. Replacing fixtures never exposes native HTTPS.
  // Unknown startup URLs fail even when a later harness installs its fixtures.
  if (net) {
    const fetch = net.fetch.bind(net);
    net.fetch = (url, options = {}) => {
      if (options.bypassCustomProtocol) { block(String(url)); return Promise.reject(Error('Tests cannot bypass protocol fixtures')); }
      return fetch(url, options);
    };
  }
  if (session.protocol.handle) {
    const handle = session.protocol.handle.bind(session.protocol);
    let fixture = request => require('./test-fixtures.cjs').startupFixture(request.url);
    handle('https', async request => {
      try {
        const response = await fixture(request);
        if (response) { state.fixtures.add(request.url); return response; }
      } catch (error) {
        block(request.url);
        throw error;
      }
      block(request.url);
      return new Response('', { status: 599 });
    });
    const unhandle = session.protocol.unhandle?.bind(session.protocol);
    session.protocol.unhandle = scheme => {
      if (scheme === 'https') throw Error('Tests cannot remove HTTPS fixture protection');
      return unhandle?.(scheme);
    };
    session.protocol.handle = (scheme, handler) => {
      if (scheme !== 'https') return handle(scheme, handler);
      fixture = handler;
    };
  }
  const isLocal = url => ['http:', 'ws:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && !url.username && !url.password;
  console.log('[test-network] Fixtures only; local OBS/API connections remain available.');
  // Compose with logging's single webRequest listeners: Electron replaces
  // earlier listeners. Native redirect requests keep the same request ID.
  return {
    allowRequest(request) {
      const url = new URL(request.url);
      if (!remoteRedirects.has(request.id)) {
        if (isLocal(url)) { state.local++; return true; }
        if (url.protocol === 'https:' && session.protocol.isProtocolHandled('https')) return true;
      }
      block(request.url);
      return false;
    },
    onRedirect(request) {
      // Native HTTP redirects may bypass a custom HTTPS handler. Cancel the
      // redirected request even when a fixture for its scheme exists.
      if (!isLocal(new URL(request.redirectURL))) remoteRedirects.add(request.id);
    },
    onFinished(request) { remoteRedirects.delete(request.id); },
  };
}
function testNetworkState() {
  return state && { blocked: state.blocked, local: state.local, urls: [...state.urls], fixtures: [...state.fixtures], nodeViolations: require('./test-node-network.cjs').violations.slice() };
}
module.exports = { installTestNetwork, testNetworkState };
