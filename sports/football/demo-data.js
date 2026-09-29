"use strict";

(function initializeFootballDemos(global) {
  const { createEvent, EVENT_STATES } = global.SportsOverlay.model;
  const teams = {
    away: { id: "det", name: "Detroit Lions", abbreviation: "DET", record: "3–1", score: 17, timeoutsRemaining: 2, featured: false, logoUrl: "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/det.png" },
    home: { id: "sea", name: "Seattle Seahawks", abbreviation: "SEA", record: "2–2", score: 21, timeoutsRemaining: 1, featured: true, logoUrl: "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/sea.png" },
  };
  const base = {
    sport: "football",
    league: "NFL",
    startTime: "2026-10-04T20:05:00Z",
    teams,
  };
  const demos = {
    pregame: createEvent({ ...base, id: "nfl-pregame", state: EVENT_STATES.PREGAME, detailedState: "Scheduled" }),
    live: createEvent({
      ...base,
      id: "nfl-live",
      state: EVENT_STATES.LIVE,
      detailedState: "In Progress",
      details: {
        quarter: "3RD",
        clock: "08:42",
        down: 3,
        distance: 4,
        yardLine: "DET 18",
        possessionTeam: "SEA",
        lastPlay: "Geno Smith pass complete to Jaxon Smith-Njigba for 12 yards.",
      },
    }),
    interrupted: createEvent({ ...base, id: "nfl-interrupted", state: EVENT_STATES.INTERRUPTED, detailedState: "Halftime" }),
    final: createEvent({ ...base, id: "nfl-final", state: EVENT_STATES.FINAL, detailedState: "Final" }),
  };

  Object.entries(demos).forEach(([name, event]) => {
    global.SportsOverlay.registry.registerDemo("football", name, () => structuredClone(event));
  });
})(typeof window === "undefined" ? globalThis : window);
