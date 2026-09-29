"use strict";

(function sharedSettings(global) {
  const local = global.SportsOverlay.config;
  const query = new URLSearchParams(global.location.search);
  const hosted = global.location.pathname.startsWith("/sports/");
  const demo = query.has("demo") || query.has("scenario");
  if (!hosted || demo) return;
  const cacheKey = "sports-overlay.shared-cache.v1";
  let state = null;
  let connected = false;
  let writing = false;
  let generation = 0;
  let delay = 1000;
  const listeners = new Set();
  try { state = JSON.parse(global.localStorage.getItem(cacheKey)); } catch (_) { /* Cache is optional. */ }
  const emit = () => listeners.forEach(listener => {
    Promise.resolve().then(() => listener(state, connected)).catch(error => console.warn("[Sports settings]", error));
  });
  function accept(value) {
    if (state?.instance === value.instance && state.revision > value.revision) return;
    state = value;
    try { global.localStorage.setItem(cacheKey, JSON.stringify(value)); } catch (_) { /* Display still works. */ }
  }
  async function request(path, options = {}) {
    const response = await fetch(path, { cache: "no-store", ...options, signal: AbortSignal.timeout(5000) });
    const value = await response.json();
    if (!response.ok) {
      if (response.status === 409) { accept(value.detail); connected = true; }
      const error = new Error(response.status === 409
        ? "Settings changed elsewhere. Your draft is preserved. Review it, then save again to apply."
        : typeof value.detail === "string" ? value.detail : "Shared settings are unavailable.");
      error.conflict = response.status === 409;
      throw error;
    }
    return value;
  }
  async function poll() {
    const start = generation;
    if (!writing) {
      try {
        const next = await request("/api/sports/state");
        if (start === generation) { accept(next); connected = true; emit(); }
        delay = 1000;
      } catch (_) {
        if (start === generation) { connected = false; emit(); }
        delay = Math.min(delay * 2, 10000);
      }
    }
    global.setTimeout(poll, delay);
  }
  const ready = local.ready.then(poll);
  async function saveConfig(config, options = {}) {
    if (!connected) throw new Error("Disconnected. Reconnect before saving.");
    if (writing) throw new Error("A save is already in progress. Try again shortly.");
    if (!state.initialized && !options.initialize) throw new Error("Import settings or choose defaults first.");
    const normalized = local.normalizeConfig(config);
    const fields = options.fields || Object.keys(normalized);
    const changes = Object.fromEntries(fields.map(key => [key, normalized[key]]));
    writing = true;
    generation += 1;
    try {
      const next = await request(state.initialized ? "/api/sports/state" : "/api/sports/state/import", {
        method: state.initialized ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: options.revision ?? state.revision,
          instance: options.instance ?? state.instance,
          config: state.initialized ? changes : normalized,
        }),
      });
      accept(next);
      return local.normalizeConfig(next.config);
    } finally { writing = false; generation += 1; }
  }
  global.SportsOverlay.shared = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot: () => state,
    connected: () => connected,
    ready,
    async waitForConfig() {
      await ready;
      if (state?.initialized) return;
      await new Promise(resolve => {
        const unsubscribe = this.subscribe(value => {
          if (value?.initialized) { unsubscribe(); resolve(); }
        });
      });
    },
  };
  global.SportsOverlay.config = Object.freeze({
    ...local, ready,
    loadConfig: () => state?.initialized ? local.normalizeConfig(state.config) : local.loadConfig(),
    saveConfig,
    resetConfig: options => saveConfig(local.DEFAULT_CONFIG, options),
  });
})(window);
