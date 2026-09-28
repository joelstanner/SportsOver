"use strict";

// Static game data for visual development on off days. This intentionally
// mirrors only the parts of the MLB live-feed response that the overlay uses.
window.MARINERS_DEMO_FEEDS = Object.freeze({
  pregame: {
    gameData: {
      datetime: { dateTime: "2026-08-19T01:40:00Z" },
      status: {
        abstractGameState: "Preview",
        detailedState: "Scheduled",
      },
      teams: {
        away: { id: 136, name: "Seattle Mariners", abbreviation: "SEA" },
        home: { id: 133, name: "Oakland Athletics", abbreviation: "ATH" },
      },
    },
  },
  live: {
    gameData: {
      status: {
        abstractGameState: "Live",
        detailedState: "In Progress",
      },
      teams: {
        away: { id: 136, name: "Seattle Mariners", abbreviation: "SEA" },
        home: { id: 133, name: "Oakland Athletics", abbreviation: "ATH" },
      },
    },
    liveData: {
      linescore: {
        currentInning: 6,
        currentInningOrdinal: "6th",
        inningState: "Top",
        isTopInning: true,
        balls: 2,
        strikes: 1,
        outs: 1,
        teams: {
          away: { runs: 4 },
          home: { runs: 2 },
        },
        offense: {
          first: { id: 672284, fullName: "Julio Rodríguez" },
          second: null,
          third: { id: 677594, fullName: "Cal Raleigh" },
          batter: { id: 666176, fullName: "Jorge Polanco" },
        },
        defense: {
          pitcher: { id: 680869, fullName: "Mason Miller" },
        },
      },
      plays: {
        currentPlay: {
          matchup: {
            batter: { id: 666176, fullName: "Jorge Polanco" },
            pitcher: { id: 680869, fullName: "Mason Miller" },
          },
        },
        allPlays: [{
          about: { isComplete: true },
          result: {
            description: "Cal Raleigh doubles on a sharp line drive to right field. Julio Rodríguez scores.",
          },
        }],
      },
      boxscore: {
        teams: {
          away: {
            players: {
              ID666176: { stats: { batting: { hits: 1, atBats: 2 } } },
            },
          },
          home: {
            players: {
              ID680869: { stats: { pitching: { numberOfPitches: 73 } } },
            },
          },
        },
      },
    },
  },
});
