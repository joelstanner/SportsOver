"use strict";

(function initializeLiveMode(global) {
  const isLive = entry => ["live", "interrupted"].includes(entry?.candidate?.state);
  const keyOf = entry => `${entry.candidate.sport}:${entry.candidate.id}`;

  // Session-only state. Saved queue settings and locks remain untouched.
  function create({ now = Date.now } = {}) {
    let active = false;
    const admitted = new Map();

    function setActive(value, rotation = []) {
      if (value && !active && !rotation.some(isLive)) return false;
      if (active !== value) admitted.clear();
      active = value;
      return active;
    }

    function observe(entry) {
      if (!active || !admitted.has(keyOf(entry))) return;
      const previous = admitted.get(keyOf(entry));
      admitted.set(keyOf(entry), {
        entry,
        finishedAt: entry.candidate.state === "final" ? previous.finishedAt ?? now() : null,
      });
    }

    function update({ rotation = [], available = [], excludedKeys = [], enabledSports = [],
      rotationOrder = [], retentionMinutes = 20 } = {}) {
      if (!active) return rotation;
      const enabled = new Set(enabledSports);
      const excluded = new Set(excludedKeys);
      const current = new Map([...rotation, ...available].map(entry => [keyOf(entry), entry]));
      for (const entry of rotation) {
        const key = keyOf(entry);
        if (!admitted.has(key) && isLive(entry) && !excluded.has(key)) {
          admitted.set(key, { entry, finishedAt: null });
        }
      }
      const entries = [];
      const timestamp = now();
      for (const [key, previous] of admitted) {
        if (!enabled.has(previous.entry.candidate.sport)) { admitted.delete(key); continue; }
        let entry = current.get(key) || previous.entry;
        // A score summary can detect final before the league scoreboard does.
        if (previous.finishedAt !== null && entry.candidate.state !== "final") entry = previous.entry;
        const finishedAt = entry.candidate.state === "final" ? previous.finishedAt ?? timestamp : null;
        admitted.set(key, { entry, finishedAt });
        if (excluded.has(key)) continue;
        if (isLive(entry) || (finishedAt !== null && timestamp < finishedAt + retentionMinutes * 60_000)) {
          entries.push({ ...entry, ...(finishedAt !== null ? { liveModeFinishedAt: finishedAt } : {}) });
        }
      }
      const order = new Map(rotationOrder.map((key, index) => [key, index]));
      return entries.sort((a, b) => (order.get(keyOf(a)) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(keyOf(b)) ?? Number.MAX_SAFE_INTEGER));
    }

    function nextExpiry(retentionMinutes = 20) {
      return Math.min(...[...admitted.values()].filter(item => item.finishedAt !== null)
        .map(item => item.finishedAt + retentionMinutes * 60_000).filter(time => time > now()), Infinity);
    }

    return Object.freeze({ setActive, update, observe, nextExpiry, isActive: () => active });
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.liveMode = Object.freeze({ create, isLive });
})(typeof window === "undefined" ? globalThis : window);
