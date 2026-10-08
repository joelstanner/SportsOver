"use strict";
(function initializeFormula1Demos(global) {
  const named = [
    ["5579", "Lando Norris", "McLaren", "gbr"], ["5752", "Oscar Piastri", "McLaren", "aus"],
    ["5498", "Charles Leclerc", "Ferrari", "mon"], ["868", "Lewis Hamilton", "Ferrari", "gbr"],
    ["4665", "Max Verstappen", "Red Bull", "ned"],
  ];
  function sample(state) {
    const live = state === "live", complete = ["final", "interrupted"].includes(state);
    const date = new Date(Date.now() + (state === "pregame" ? 1800000 : -1800000)).toISOString();
    const sessions = [{ id: "901", date, type: { abbreviation: complete && state === "interrupted" ? "FP1" : "Race", text: complete && state === "interrupted" ? "Free Practice 1" : "Race" },
      status: { type: { state: live ? "in" : complete ? "post" : "pre", completed: complete, description: live ? "Live" : complete ? "Final" : "Upcoming" } } }];
    if (state === "interrupted") sessions.push({ id: "902", date: new Date(Date.now() + 3600000).toISOString(), type: { abbreviation: "Qual", text: "Qualifying" }, status: { type: { state: "pre" } } });
    const rows = Array.from({ length: 22 }, (_, index) => {
      const [id, name, team, country] = named[index] || [String(9000 + index), `Demo Driver ${index + 1}`, "Demo Racing", "usa"];
      return { order: index + 1, position: index + 1, lapsCompleted: String(complete ? 52 : 28),
        raceTime: index ? "--" : "45:21.334", timeBehindLeader: index ? `+${(index * 2.437).toFixed(3)}` : "45:21.334", isRetired: index === 21,
        athlete: { displayName: name, shortName: name, logo: `https://a.espncdn.com/i/teamlogos/countries/500/${country}.png`, country, team,
          links: `https://www.espn.com/racing/driver/_/id/${id}` } };
    });
    const content = { gamepackage: { raceStrip: { data: { sessions: [] } }, filteredPositions: state === "pregame" ? []
      : [{ competitionId: "901", title: sessions[0].type.text, sessionState: live ? "in" : "post", data: rows }] } };
    return global.SportsOverlay.formula1.normalizeEvent({ id: "900001", name: "Coastal Grand Prix · DEMO", competitions: sessions }, content,
      { tournamentId: "season", bannerId: "demo", view: "leaderboard", leaderboardSize: 10 });
  }
  for (const state of ["live", "pregame", "interrupted", "final"]) global.SportsOverlay.registry.registerDemo("formula-1", state, () => sample(state));
  global.SportsOverlay.registry.registerDemo("formula-1", "player", () => {
    const event = sample("live");
    return { ...event, details: { ...event.details, view: "player", playerId: "5579", playerName: "Lando Norris" } };
  });
})(typeof window === "undefined" ? globalThis : window);
