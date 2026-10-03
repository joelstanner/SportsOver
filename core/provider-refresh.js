"use strict";

(function initializeProviderRefresh(global) {
  // One cache per page, shared by discovery, rotation and all provider clients.
  // Cache raw responses so featured-team normalization remains caller-specific.
  function create({ config, fetchImpl = global.fetch.bind(global), now = () => performance.now(), wallNow = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const records = new Map(), gates = new Map();
    const network = global.SportsOverlay.providerNetwork
      || (typeof require === 'function' ? require('./provider-network.js') : null);
    const fetchProvider = network?.create({ fetchImpl, now: wallNow, sleep });
    function dispatch(url, options) {
      if (network?.serviceFor(url)) {
        // The desktop process owns one queue across engine, Settings and catalogs.
        if (global.location?.protocol === 'sportsover:') {
          const query = new URLSearchParams({ url, timeout: String(options?.requestTimeoutMs || 8000),
            priority: options?.priority === 'display' ? 'display' : 'background' });
          return fetchImpl(`/api/provider?${query}`);
        }
        return fetchProvider(url, options);
      }
      return fetchImpl(url, options?.requestTimeoutMs
        ? { ...options, signal: AbortSignal.timeout(options.requestTimeoutMs) } : options);
    }
    function networkRequest(sport, provider, run) {
      if (!provider.requestIntervalMs) return run();
      if (!gates.has(sport)) gates.set(sport, { tail: Promise.resolve(), next: -Infinity, cooldownUntil: 0 });
      const gate = gates.get(sport);
      const pending = gate.tail.catch(() => {}).then(async () => {
        if (now() < gate.cooldownUntil) throw gate.error;
        if (now() < gate.next) await sleep(gate.next - now());
        gate.next = now() + provider.requestIntervalMs;
        try { return await run(); }
        catch (error) {
          if (error.status === 429) {
            const delay = Math.max(provider.rateLimitCooldownMs || 60000, error.retryAfterMs || 0);
            error.retryAfterMs = delay;
            error.retryAt = wallNow() + delay;
            gate.cooldownUntil = now() + delay;
            gate.error = error;
          }
          throw error;
        }
      });
      gate.tail = pending;
      return pending;
    }
    function interval(sport, state) {
      return config().providerRefreshSeconds[sport][state === "interrupted" ? "live" : state] * 1000;
    }
    function classify(payload, provider, url) {
      const explicitState = provider.refreshState?.(payload, url);
      if (explicitState) return explicitState;
      const games = payload.dates?.flatMap(date => date.games ?? []) ?? payload.events;
      if (Array.isArray(games)) {
        const states = games.map(game => provider.toCandidate(game).state);
        return ["live", "interrupted", "pregame", "final"].find(state => states.includes(state)) || "idle";
      }
      return (provider.normalizeFeed || provider.normalizeEvent)(payload).state;
    }
    function fetchFor(sport, provider) {
      const fetchCached = async (url, options) => {
        const key = `${sport}:${url}`;
        let record = records.get(key);
        if (!record) {
          record = { sport, state: provider.refreshState?.(null, url) || "idle", completed: -Infinity, response: null, error: null, pending: null, failures: 0 };
          records.set(key, record);
        }
        if (record.pending && options?.priority === 'display') fetchCached.prioritize(url);
        const failureBackoff = typeof provider.failureBackoff === "function"
          ? provider.failureBackoff(record.state) : provider.failureBackoff;
        const baseDelay = provider.refreshIntervalMs?.(url) ?? interval(sport, record.state);
        const delay = record.error?.status === 429 ? Math.max(record.error.retryAfterMs || 60000, Math.min(300000, 30000 * 2 ** (record.failures - 1))) : failureBackoff && record.failures
          ? Math.max(baseDelay, Math.min(300000, 30000 * 2 ** (record.failures - 1)))
          : baseDelay;
        const due = record.error?.retryAt ? wallNow() >= record.error.retryAt : now() >= record.completed + delay;
        if (!record.pending && due) {
          record.priority = options?.priority;
          record.pending = networkRequest(sport, provider, async () => {
            const response = await dispatch(url, { ...options, priority: record.priority });
            if (!response.ok) {
              const error = new Error(`Score provider returned HTTP ${response.status}`);
              error.status = response.status;
              const retry = response.headers?.get('Retry-After');
              if (retry) {
                error.retryAfterMs = /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - wallNow()) || 0;
                if (Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0) error.retryAt = wallNow() + error.retryAfterMs;
              }
              throw error;
            }
            // Detach cached bytes from the fetch signal. Its request timeout
            // can still abort an unread Response body after a successful fetch.
            const cached = new Response(await response.arrayBuffer(), {
              status: response.status, statusText: response.statusText, headers: response.headers,
            });
            const state = classify(await cached.clone().json(), provider, url);
            record.state = ["live", "interrupted", "pregame", "final"].includes(state) ? state : "idle";
            record.response = cached;
            record.error = null;
            record.failures = 0;
          }).catch(error => {
            record.error = error;
            record.failures++;
          }).finally(() => {
            record.completed = now();
            record.pending = null;
            // Retire old schedules/games, never in-flight or still throttled records.
            for (const [oldKey, old] of records) {
              if (oldKey !== key && !old.pending && now() - old.completed > 3600_000) records.delete(oldKey);
            }
          });
        }
        if (record.pending) await record.pending;
        if (record.error) throw record.error;
        return record.response.clone();
      };
      fetchCached.prioritize = url => {
        const record = records.get(`${sport}:${url}`);
        if (!record?.pending || record.priority === 'display' || !network?.serviceFor(url)) return;
        record.priority = 'display';
        if (global.location?.protocol === 'sportsover:') {
          // A local queue operation only; it never initiates an upstream request.
          fetchImpl(`/api/provider/priority?${new URLSearchParams({ url })}`, { method: 'POST' }).catch(() => {});
        } else fetchProvider.prioritize(url);
      };
      // An explicit retry may retry failed feeds immediately. Successful feeds
      // keep their cached interval; provider-level rate-limit cooldowns remain.
      fetchCached.retryFailed = () => {
        for (const record of records.values()) {
          if (record.sport === sport && record.error && !record.pending) record.completed = -Infinity;
        }
      };
      return fetchCached;
    }
    return { fetchFor, interval };
  }
  global.SportsOverlay.providerRefresh = { create };
})(typeof window === "undefined" ? globalThis : window);
