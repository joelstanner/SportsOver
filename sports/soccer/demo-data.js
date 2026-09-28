"use strict";

(function initializeSoccerDemos(global) {
  const { createEvent, EVENT_STATES } = global.SportsOverlay.model;
  const teams = {
    away: { id: "17362", name: "Minnesota United FC", abbreviation: "MIN", record: "7–8–12", score: 1, featured: false, logoUrl: "https://a.espncdn.com/i/teamlogos/soccer/500/17362.png" },
    home: { id: "9726", name: "Seattle Sounders FC", abbreviation: "SEA", record: "9–8–9", score: 3, featured: true, logoUrl: "https://a.espncdn.com/i/teamlogos/soccer/500/9726.png" },
  };
  const base = { sport: "soccer", league: "MLS", startTime: "2026-09-27T00:30:00Z", teams };
  const demos = {
    pregame: createEvent({ ...base, id: "mls-pregame", state: EVENT_STATES.PREGAME, detailedState: "Scheduled" }),
    live: createEvent({
      ...base,
      id: "mls-live",
      state: EVENT_STATES.LIVE,
      detailedState: "In Progress",
      details: { period: "2ND", clock: "83'", awayPossession: 44.9, homePossession: 55.1, awayShotsOnTarget: 2, homeShotsOnTarget: 8, lastEvent: "Goal! Paul Arriola scores for Seattle Sounders FC." },
    }),
    interrupted: createEvent({ ...base, id: "mls-interrupted", state: EVENT_STATES.INTERRUPTED, detailedState: "Match Delayed" }),
    final: createEvent({ ...base, id: "mls-final", state: EVENT_STATES.FINAL, detailedState: "Full Time" }),
  };
  Object.entries(demos).forEach(([name, event]) => {
    global.SportsOverlay.registry.registerDemo("soccer", name, () => structuredClone(event));
  });
})(typeof window === "undefined" ? globalThis : window);
