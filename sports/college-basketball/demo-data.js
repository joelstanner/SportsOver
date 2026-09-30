"use strict";

(function initializeCollegeBasketballDemos(global) {
  const { createEvent, EVENT_STATES } = global.SportsOverlay.model;
  const teams = {
    away: { id: "158", name: "Nebraska Cornhuskers", abbreviation: "NEB", record: "2–1", score: 54, timeoutsRemaining: 2, featured: false, logoUrl: "https://a.espncdn.com/i/teamlogos/ncaa/500/158.png" },
    home: { id: "264", name: "Washington Huskies", abbreviation: "WASH", record: "3–0", score: 61, timeoutsRemaining: 1, featured: true, logoUrl: "https://a.espncdn.com/i/teamlogos/ncaa/500/264.png" },
  };
  const base = { sport: "college-basketball", league: "NCAAM", startTime: "2026-11-10T23:00:00Z", teams };
  const demos = {
    pregame: createEvent({ ...base, id: "ncaam-pregame", state: EVENT_STATES.PREGAME, detailedState: "Scheduled" }),
    live: createEvent({
      ...base,
      id: "ncaam-live",
      state: EVENT_STATES.LIVE,
      detailedState: "In Progress",
      details: { period: "2ND HALF", clock: "06:42", awayFieldGoalPct: 44.1, homeFieldGoalPct: 49.3, awayRebounds: 31, homeRebounds: 38, lastPlay: "Washington makes a three-point jump shot." },
    }),
    interrupted: createEvent({ ...base, id: "ncaam-interrupted", state: EVENT_STATES.INTERRUPTED, detailedState: "Halftime" }),
    final: createEvent({ ...base, id: "ncaam-final", state: EVENT_STATES.FINAL, detailedState: "Final" }),
  };
  Object.entries(demos).forEach(([name, event]) => {
    global.SportsOverlay.registry.registerDemo("college-basketball", name, () => structuredClone(event));
  });
})(typeof window === "undefined" ? globalThis : window);
