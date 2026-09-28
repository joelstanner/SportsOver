"use strict";

(function initializeBasketballDemos(global) {
  const { createEvent, EVENT_STATES } = global.SportsOverlay.model;
  const teams = {
    away: { id: "4", name: "Chicago Bulls", abbreviation: "CHI", record: "2–1", score: 84, featured: false, logoUrl: "https://a.espncdn.com/i/teamlogos/nba/500/chi.png" },
    home: { id: "8", name: "Detroit Pistons", abbreviation: "DET", record: "3–0", score: 91, featured: true, logoUrl: "https://a.espncdn.com/i/teamlogos/nba/500/det.png" },
  };
  const base = { sport: "basketball", league: "NBA", startTime: "2026-10-10T23:00:00Z", teams };
  const demos = {
    pregame: createEvent({ ...base, id: "nba-pregame", state: EVENT_STATES.PREGAME, detailedState: "Scheduled" }),
    live: createEvent({
      ...base,
      id: "nba-live",
      state: EVENT_STATES.LIVE,
      detailedState: "In Progress",
      details: { period: "Q4", clock: "06:42", awayFieldGoalPct: 44.1, homeFieldGoalPct: 49.3, awayRebounds: 31, homeRebounds: 38, lastPlay: "Cade Cunningham makes a 16-foot pullup jump shot." },
    }),
    interrupted: createEvent({ ...base, id: "nba-interrupted", state: EVENT_STATES.INTERRUPTED, detailedState: "Halftime" }),
    final: createEvent({ ...base, id: "nba-final", state: EVENT_STATES.FINAL, detailedState: "Final" }),
  };
  Object.entries(demos).forEach(([name, event]) => {
    global.SportsOverlay.registry.registerDemo("basketball", name, () => structuredClone(event));
  });
})(typeof window === "undefined" ? globalThis : window);
