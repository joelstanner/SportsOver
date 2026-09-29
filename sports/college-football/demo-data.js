"use strict";

(function initializeCollegeFootballDemos(global) {
  const { EVENT_STATES, createEvent } = global.SportsOverlay.model;
  const teams = {
    away: { id: "264", name: "Washington Huskies", abbreviation: "WASH", record: "5–1", score: 17, timeoutsRemaining: 1, featured: false, logoUrl: "https://a.espncdn.com/i/teamlogos/ncaa/500/264.png" },
    home: { id: "158", name: "Nebraska Cornhuskers", abbreviation: "NEB", record: "6–0", score: 31, timeoutsRemaining: 3, featured: true, logoUrl: "https://a.espncdn.com/i/teamlogos/ncaa/500/158.png" },
  };
  const base = { sport: "college-football", league: "NCAAF", startTime: "2026-10-31T19:30:00Z", teams };
  const demos = {
    pregame: createEvent({ ...base, id: "ncaaf-pregame", state: EVENT_STATES.PREGAME, detailedState: "Scheduled" }),
    live: createEvent({
      ...base,
      id: "ncaaf-live",
      state: EVENT_STATES.LIVE,
      detailedState: "In Progress",
      details: { quarter: "3RD", clock: "08:42", down: 3, distance: 4, yardLine: "WASH 18", possessionTeam: "NEB", lastPlay: "Pass complete for 12 yards." },
    }),
    interrupted: createEvent({ ...base, id: "ncaaf-interrupted", state: EVENT_STATES.INTERRUPTED, detailedState: "Halftime" }),
    final: createEvent({ ...base, id: "ncaaf-final", state: EVENT_STATES.FINAL, detailedState: "Final" }),
  };

  Object.entries(demos).forEach(([name, event]) => {
    global.SportsOverlay.registry.registerDemo("college-football", name, () => structuredClone(event));
  });
})(typeof window === "undefined" ? globalThis : window);
