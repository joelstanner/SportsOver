"use strict";

(function initializeProviderDiscovery(global) {
  async function discover({ teams, provider, createClient, toCandidate }) {
    // Keep large watched-team lists from launching every schedule simultaneously.
    const jobs = [() => provider.findLeagueGames?.() ?? Promise.resolve([]),
      ...teams.map(team => () => createClient(team).findGames())];
    const results = new Array(jobs.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (next < jobs.length) {
        const index = next++;
        try { results[index] = { games: await jobs[index]() }; }
        catch (error) { results[index] = { error }; }
      }
    }));
    const failures = results.filter(result => !result.games);
    if (failures.length === results.length) throw failures[0].error;
    function unique(games) {
      const seen = new Set();
      return games.filter(game => {
        const id = String(toCandidate(game).id || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }
    return {
      leagueGames: unique(results[0].games || []),
      favoriteGames: unique(results.slice(1).flatMap(result => result.games || [])),
      failures: failures.length,
    };
  }
  global.SportsOverlay.providerDiscovery = { discover };
})(typeof window === "undefined" ? globalThis : window);
