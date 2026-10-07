// Install before windows or launch checks start. HTTPS is allowed only after
// tests register a protocol fixture; HTTP retains its native local OBS behavior.
let state = null;
function installTestNetwork({ session, env = process.env }) {
  if (!env.SPORTSOVER_TEST_DATA || env.SPORTSOVER_TEST_NETWORK === 'live') return;
  if (env.SPORTSOVER_TEST_NETWORK && env.SPORTSOVER_TEST_NETWORK !== 'fixtures') {
    throw Error('SPORTSOVER_TEST_NETWORK must be "fixtures" or "live".');
  }
  state = { blocked: 0, local: 0, urls: new Set() };
  globalThis.sportsTestNetworkState = testNetworkState;
  const remoteRedirects = new Set();
  const isLocal = url => url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
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
      state.blocked++;
      state.urls.add(request.url);
      if (state.blocked === 1) console.warn('[test-network] External requests blocked. Install fixtures before reloading the engine.');
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
  return state && { blocked: state.blocked, local: state.local, urls: [...state.urls] };
}
module.exports = { installTestNetwork, testNetworkState };
