"use strict";
(function initializeAutomaticWatches(global) {
  const keyOf = (sport, watch) => sport === "disc-golf" ? `${watch.tournamentId}:${watch.division}` : `${watch.tournamentId}:${watch.roundId || "auto"}`;
  function reconcile(config, discoveries) {
    const next = structuredClone(config);
    for (const result of discoveries) {
      const sport = result.sport;
      if (!["disc-golf", "chess"].includes(sport) || !Array.isArray(result.automaticWatches)) continue;
      const group = next.sports.find(group => group.sport === sport);
      if (!group?.enabled || !group.autoFollow) continue;
      const manual = new Set(group.events.map(watch => keyOf(sport, watch)));
      const previous = next.automaticWatchLists[sport];
      // Partial failures can add confirmed watches, but cannot retire old ones.
      const watches = new Map((result.automaticWatchesComplete ? [] : previous).map(watch => [keyOf(sport, watch), watch]));
      for (const watch of result.automaticWatches) watches.set(keyOf(sport, watch), watch);
      next.automaticWatchLists[sport] = [...watches.values()].filter(watch => !manual.has(keyOf(sport, watch)));
    }
    return global.SportsOverlay.config.normalizeConfig(next);
  }
  async function sync(discoveries) {
    const api = global.SportsOverlay.config, shared = global.SportsOverlay.shared;
    const before = api.loadConfig(), snapshot = shared?.snapshot();
    const next = reconcile(before, discoveries);
    if (JSON.stringify(before.automaticWatchLists) === JSON.stringify(next.automaticWatchLists)) return null;
    // Only discovery-owned data is written, using the same optimistic revision
    // check as Settings. A concurrent edit wins; the next discovery retries.
    try {
      return await api.saveConfig(next, shared ? { fields: ["automaticWatchLists"], revision: snapshot.revision, instance: snapshot.instance } : undefined);
    } catch (error) {
      console.warn("[SportsOver] Automatic watch list could not be saved; retrying on the next discovery.", error);
      return null;
    }
  }
  global.SportsOverlay.automaticWatches = { keyOf, reconcile, sync };
})(typeof window === "undefined" ? globalThis : window);
