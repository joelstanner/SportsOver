"use strict";
(function initializePdgaDemos(global) {
  // Fixed demonstration data; no network requests or saved selections.
  const names = [[33705, "Jeremy Koling", "J. Koling", -18, -8], [50671, "Ezra Robinson", "E. Robinson", -18, -6], [96512, "Robert Burridge", "R. Burridge", -16, -7]];
  for (const state of ["pregame", "live", "interrupted", "final"]) {
    global.SportsOverlay.registry.registerDemo("disc-golf", state, () => {
      const competitors = names.map(([id, name, shortName, total, roundToPar], index) => ({
        id: String(id), pdgaNumber: String(id), name, shortName, place: state === "pregame" ? null : index + 1,
        tied: state !== "final" && index < 2, wonPlayoff: state === "final" && index === 0, status: "",
        total: state === "pregame" ? null : total, roundToPar: state === "pregame" ? null : roundToPar,
        roundScore: state === "pregame" ? null : 62 + roundToPar, played: state === "live" ? 14 + index : state === "pregame" ? 0 : 18,
        holes: 18, completed: ["final", "interrupted"].includes(state), started: state !== "pregame", teeTime: "10:30:00", holeScores: [],
      }));
      return global.SportsOverlay.model.createEvent({ id: "demo:MPO", sport: "disc-golf", league: "PDGA", competitionType: "individual",
        state, detailedState: state, competitors, details: { tournamentId: "86076", name: "New Zealand Open · DEMO", division: "MPO", round: 3,
          dateRange: "Demo scores", view: "leaderboard", playerId: "", layouts: [], stale: false } });
    });
  }
})(typeof window === "undefined" ? globalThis : window);
