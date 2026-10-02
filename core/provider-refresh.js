"use strict";

(function initializeProviderRefresh(global) {
  // One cache per page, shared by discovery, rotation and all provider clients.
  // Cache raw responses so featured-team normalization remains caller-specific.
  function create({ config, fetchImpl = global.fetch.bind(global), now = () => performance.now() }) {
    const records = new Map();
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
      return async (url, options) => {
        const key = `${sport}:${url}`;
        let record = records.get(key);
        if (!record) {
          record = { sport, state: provider.refreshState?.(null, url) || "idle", completed: -Infinity, response: null, error: null, pending: null, failures: 0 };
          records.set(key, record);
        }
        const failureBackoff = typeof provider.failureBackoff === "function"
          ? provider.failureBackoff(record.state) : provider.failureBackoff;
        const baseDelay = provider.refreshIntervalMs?.(url) ?? interval(sport, record.state);
        const delay = failureBackoff && record.failures
          ? Math.max(baseDelay, Math.min(300000, 30000 * 2 ** (record.failures - 1)))
          : baseDelay;
        if (!record.pending && now() >= record.completed + delay) {
          record.pending = Promise.resolve().then(async () => {
            try {
              const response = await fetchImpl(url, options);
              if (!response.ok) { const error = new Error(`Score provider returned HTTP ${response.status}`); error.status = response.status; throw error; }
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
            } catch (error) {
              record.error = error;
              record.failures++;
            } finally {
              record.completed = now();
              record.pending = null;
              // Retire old schedules/games, never in-flight or still throttled records.
              for (const [oldKey, old] of records) {
                if (oldKey !== key && !old.pending && now() - old.completed > 3600_000) records.delete(oldKey);
              }
            }
          });
        }
        if (record.pending) await record.pending;
        if (record.error) throw record.error;
        return record.response.clone();
      };
    }
    return { fetchFor, interval };
  }
  global.SportsOverlay.providerRefresh = { create };
})(typeof window === "undefined" ? globalThis : window);
