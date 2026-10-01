"use strict";

(function initializeHockeyDemos(global) {
  const { createEvent, EVENT_STATES } = global.SportsOverlay.model;
  const teams = {
    away: { id: "23", name: "Vancouver Canucks", abbreviation: "VAN", record: "2–1–0", score: 2, featured: false, logoUrl: "https://a.espncdn.com/i/teamlogos/nhl/500/van.png" },
    home: { id: "124292", name: "Seattle Kraken", abbreviation: "SEA", record: "2–0–1", score: 3, featured: true, logoUrl: "https://a.espncdn.com/i/teamlogos/nhl/500/sea.png" },
  };
  const base = { sport: "hockey", league: "NHL", startTime: "2026-10-05T00:00:00Z", teams };
  const demos = {
    pregame: createEvent({ ...base, id: "nhl-pregame", state: EVENT_STATES.PREGAME, detailedState: "Scheduled" }),
    live: createEvent({
      ...base,
      id: "nhl-live",
      state: EVENT_STATES.LIVE,
      detailedState: "In Progress",
      details: { period: "2ND", clock: "08:42", awayShots: 19, homeShots: 24, awayPowerPlay: "0/2", homePowerPlay: "1/3", powerPlayActive: true, powerPlayTeamId: "124292", lastPlay: "Jared McCann scores on a wrist shot." },
    }),
    interrupted: createEvent({ ...base, id: "nhl-interrupted", state: EVENT_STATES.INTERRUPTED, detailedState: "2nd Intermission" }),
    final: createEvent({ ...base, id: "nhl-final", state: EVENT_STATES.FINAL, detailedState: "Final" }),
  };
  Object.entries(demos).forEach(([name, event]) => {
    global.SportsOverlay.registry.registerDemo("hockey", name, () => structuredClone(event));
  });
})(typeof window === "undefined" ? globalThis : window);
