// Routine browsers share one deny-by-default boundary, including route.continue.
const { isLocal } = require('./offline-network.cjs');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
function protectContext(context, violations) {
  const deny = url => { violations.push(url); console.error(`[test-network] Unexpected browser request: ${url}`); };
  async function localFetch(route, options = {}) {
    let url = options.url || route.request().url();
    let method = options.method || route.request().method();
    let postData = options.postData ?? route.request().postDataBuffer();
    for (let redirects = 0; redirects <= 10; redirects++) {
      if (!isLocal(url)) { deny(url); await route.abort(); throw Error(`External browser request: ${url}`); }
      const response = await route.fetch({ ...options, url, method, postData, maxRedirects: 0, timeout: 10000 });
      const status = response.status(), location = response.headers().location;
      if (status < 300 || status >= 400 || !location) return response;
      url = new URL(location, url).href;
      if (status === 303 || ([301, 302].includes(status) && method === 'POST')) { method = 'GET'; postData = undefined; }
      await response.dispose();
    }
    throw Error('Too many local test redirects');
  }
  function protectedRoute(route) {
    return new Proxy(route, { get(target, key) {
      if (key === 'continue') return async options => route.fulfill({ response: await localFetch(route, options) });
      if (key === 'fetch') return options => localFetch(route, options);
      if (key === 'fulfill') return async (options = {}) => {
        const status = options.status ?? options.response?.status();
        const headers = options.headers ?? options.response?.headers() ?? {};
        const location = Object.entries(headers).find(([name]) => name.toLowerCase() === 'location')?.[1];
        if (status >= 300 && status < 400 && location) {
          // Prevent native redirects from escaping routing after a fixture.
          deny(new URL(location, route.request().url()).href);
          return route.abort();
        }
        return route.fulfill(options);
      };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  function wrapRoutes(surface) {
    const register = surface.route.bind(surface);
    const callbacks = new Map();
    surface.route = (url, handler, options) => {
      const wrapped = (route, request) => handler(protectedRoute(route), request);
      callbacks.set(handler, wrapped);
      return register(url, wrapped, options);
    };
    const unregister = surface.unroute.bind(surface);
    surface.unroute = (url, handler) => unregister(url, handler ? callbacks.get(handler) || handler : undefined);
  }
  return (async () => {
    // This is the last fallback; later test handlers can fulfill explicit mocks.
    await context.route('**/*', async route => {
      if (isLocal(route.request().url())) return route.fulfill({ response: await localFetch(route) });
      deny(route.request().url());
      await route.abort();
    });
    await context.routeWebSocket('**/*', route => {
      if (isLocal(route.url())) route.connectToServer();
      else { deny(route.url()); route.close(); }
    });
    wrapRoutes(context);
    context.on('page', wrapRoutes);
    return context;
  })();
}
const chromium = {
  async launch(options) {
    const browser = await playwright.chromium.launch(options);
    const violations = [];
    process.on('exit', () => { if (violations.length) process.exitCode = 1; });
    const create = browser.newContext.bind(browser);
    browser.newContext = async options => protectContext(await create({ ...options, serviceWorkers: 'block' }), violations);
    browser.newPage = async options => (await browser.newContext(options)).newPage();
    const close = browser.close.bind(browser);
    browser.close = async () => {
      await close();
      if (violations.length) throw Error(`Unexpected browser network requests: ${[...new Set(violations)].join(', ')}`);
    };
    return browser;
  },
};
module.exports = { chromium, protectContext };
