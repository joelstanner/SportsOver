"use strict";

(function initializeProviderNetwork(global) {
  // These are SportsOver's conservative pacing choices, not provider quotas.
  const REQUEST_INTERVAL_MS = 250;
  function serviceFor(value) {
    let url;
    try { url = new URL(value); } catch (_) { return null; }
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return null;
    if (['site.api.espn.com', 'site.web.api.espn.com'].includes(url.hostname)
      && url.pathname.startsWith('/apis/site/')) return 'espn';
    if (url.hostname === 'sports.core.api.espn.com' && url.pathname.startsWith('/v2/sports/')) return 'espn';
    if (url.hostname === 'statsapi.mlb.com' && /^\/api\/v1(?:\.1)?\//.test(url.pathname)) return 'mlb';
    if (url.hostname === 'www.pdga.com' && (url.pathname === '/api/v1/feat/current-events/tournaments'
      || /^\/apps\/tournament\/live-api\/live_results_fetch_(?:event|round)$/.test(url.pathname))) return 'pdga';
    if (url.hostname === 'lichess.org' && (/^\/api\/broadcast\/(?:top|[a-zA-Z0-9]{8}|-\/-\/[a-zA-Z0-9]{8})$/.test(url.pathname)
      || /^\/broadcast\/[a-zA-Z0-9]{8}\/players$/.test(url.pathname))) return 'lichess';
    return null;
  }
  function retryAfterMs(value, now) {
    if (!value) return 0;
    const delay = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
    return Number.isFinite(delay) ? Math.max(0, delay) : 0;
  }
  function create({ fetchImpl = (...args) => global.fetch(...args), now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    const services = new Map();
    async function run(service, gate, url, options) {
      const limitedResponse = () => Response.json({ error: `${service} requests are paused; try again after the cooldown.` }, {
        status: gate.status,
        headers: { 'Retry-After': String(Math.ceil((gate.until - now()) / 1000)), 'Cache-Control': 'no-store' },
      });
      if (now() < gate.until) return limitedResponse();
      const timeout = Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs > 0
        ? Math.min(30000, Math.round(options.requestTimeoutMs)) : 8000;
      gate.next = now() + (service === 'lichess' ? 1500 : REQUEST_INTERVAL_MS);
      // Start the timeout at dispatch, after waiting for other requests.
      // Do not forward cookies, caller headers, methods or redirects.
      const response = await fetchImpl(url, {
        method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
        signal: AbortSignal.timeout(timeout),
      });
      const retry = response.headers.get('Retry-After');
      if (response.status === 429 || ([403, 503].includes(response.status) && retry)) {
        gate.failures++;
        const delay = Math.max(retryAfterMs(retry, now()), Math.min(300000, 60000 * 2 ** Math.min(3, gate.failures - 1)));
        gate.until = now() + delay;
        gate.status = response.status;
        await response.body?.cancel();
        return limitedResponse();
      }
      if (response.ok) gate.failures = 0;
      // Consume bytes before releasing the service queue or timeout signal.
      return new Response(await response.arrayBuffer(), {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    }
    async function drain(service, gate) {
      try {
        while (gate.queue.length) {
          // Pick after pacing so a display request arriving during the wait wins.
          if (now() >= gate.until && now() < gate.next) await sleep(gate.next - now());
          const foreground = gate.queue.findIndex(job => job.priority === 'display');
          const background = gate.queue.findIndex(job => job.priority !== 'display');
          const index = foreground >= 0 && (background < 0 || gate.displayStreak < 3) ? foreground : background;
          const [job] = gate.queue.splice(index, 1);
          gate.displayStreak = job.priority === 'display' ? gate.displayStreak + 1 : 0;
          try { job.resolve(await run(service, gate, job.url, job.options)); }
          catch (error) { job.reject(error); }
        }
      } catch (error) {
        for (const job of gate.queue.splice(0)) job.reject(error);
      } finally { gate.running = false; gate.displayStreak = 0; }
    }
    async function fetchProvider(url, options = {}) {
      const service = serviceFor(url);
      if (!service) throw new Error('Unsupported score provider URL');
      if (!services.has(service)) services.set(service, { queue: [], pending: new Map(), running: false, displayStreak: 0, next: 0, until: 0, failures: 0 });
      const gate = services.get(service);
      if (service === 'lichess' && gate.pending.has(url)) {
        if (options.priority === 'display') fetchProvider.prioritize(url);
        return (await gate.pending.get(url)).clone();
      }
      const pending = new Promise((resolve, reject) => {
        gate.queue.push({ url, options, priority: options.priority, resolve, reject });
        if (!gate.running) {
          gate.running = true;
          Promise.resolve().then(() => drain(service, gate));
        }
      });
      if (service !== 'lichess') return pending;
      gate.pending.set(url, pending);
      try { return (await pending).clone(); }
      finally { gate.pending.delete(url); }
    }
    // Promote an already queued cache miss without adding another request.
    fetchProvider.prioritize = url => {
      for (const job of services.get(serviceFor(url))?.queue || []) {
        if (job.url === url) job.priority = 'display';
      }
    };
    return fetchProvider;
  }
  const api = { create, serviceFor, retryAfterMs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (global.SportsOverlay ||= {}).providerNetwork = api;
})(typeof window === 'undefined' ? globalThis : window);
