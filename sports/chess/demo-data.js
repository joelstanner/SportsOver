"use strict";
(function initializeChessDemos(global) {
  const metadata = { tour: { id: "DemoTour", name: "Masters Invitational · DEMO", info: { tc: "90 min + 30 sec" } },
    rounds: [{ id: "DemoRnd1" }, { id: "DemoRnd2" }] };
  for (const state of ["pregame", "live", "interrupted", "final"]) {
    global.SportsOverlay.registry.registerDemo("chess", state, () => {
      const finished = ["final", "interrupted"].includes(state);
      const payload = { round: { id: state === "final" ? "DemoRnd2" : "DemoRnd1", name: state === "final" ? "Round 2" : "Round 1", ongoing: state === "live", finished },
        games: [
          { id: "DemoGme1", players: [{ name: "Gukesh D", title: "GM", rating: 2787, fideId: 46616543, fed: "IND", clock: 185400 }, { name: "Fabiano Caruana", title: "GM", rating: 2803, fideId: 2020009, fed: "USA", clock: 164200 }] },
          { id: "DemoGme2", players: [{ name: "Magnus Carlsen", title: "GM", rating: 2839 }, { name: "Hikaru Nakamura", title: "GM", rating: 2802 }] },
          { id: "DemoGme3", players: [{ name: "Judit Polgar", title: "GM", rating: 2675 }, { name: "Viswanathan Anand", title: "GM", rating: 2750 }] },
        ].map((game, index) => ({ ...game, fen: "8/8/8/8/8/8/8/8 b - - 0 32", lastMove: state === "pregame" ? "" : "e2e4", status: finished ? ["1-0", "½-½", "0-1"][index] : "*" })) };
      const event = global.SportsOverlay.lichess.normalizeEvent(metadata, payload, { tournamentId: "DemoTour", view: "overview" });
      event.details.standings = global.SportsOverlay.lichess.normalizeStandings([
        "Gukesh D", "Magnus Carlsen", "Fabiano Caruana", "Hikaru Nakamura", "Viswanathan Anand",
        "Judit Polgar", "Anish Giri", "Wesley So", "Ding Liren", "Alireza Firouzja",
      ].map((name, index) => ({ name, title: "GM", rank: index + 1, played: 7, score: 6 - Math.floor(index / 2) * 0.5 })));
      return event;
    });
  }
  global.SportsOverlay.registry.registerDemo("chess", "player", () => {
    const event = global.SportsOverlay.registry.getDemo("chess", "live");
    return { ...event, details: { ...event.details, view: "player", playerId: "fide:46616543" } };
  });
})(typeof window === "undefined" ? globalThis : window);
