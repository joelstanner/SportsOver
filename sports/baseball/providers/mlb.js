"use strict";

(function initializeMlbProvider(global) {
  const { EVENT_STATES, createEvent } = global.SportsOverlay.model;
  const FALLBACK_ABBREVIATIONS = Object.freeze({
    "Arizona Diamondbacks": "AZ", "Athletics": "ATH", "Atlanta Braves": "ATL",
    "Baltimore Orioles": "BAL", "Boston Red Sox": "BOS", "Chicago Cubs": "CHC",
    "Chicago White Sox": "CWS", "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE",
    "Colorado Rockies": "COL", "Detroit Tigers": "DET", "Houston Astros": "HOU",
    "Kansas City Royals": "KC", "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD",
    "Miami Marlins": "MIA", "Milwaukee Brewers": "MIL", "Minnesota Twins": "MIN",
    "New York Mets": "NYM", "New York Yankees": "NYY", "Philadelphia Phillies": "PHI",
    "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD", "San Francisco Giants": "SF",
    "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL", "Tampa Bay Rays": "TB",
    "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR", "Washington Nationals": "WSH",
  });

  function createClient(options) {
    const teamId = Number(options.teamId);
    const requestTimeoutMs = Number(options.requestTimeoutMs);
    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}`;

    async function fetchJson(url) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`MLB API returned HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    async function findGames(date = new Date()) {
      const schedule = await fetchJson(`${scheduleUrl}&date=${formatLocalDate(date)}`);
      return schedule.dates?.flatMap(entry => entry.games ?? []) ?? [];
    }

    async function getEvent(gameId) {
      const feed = await fetchJson(`https://statsapi.mlb.com/api/v1.1/game/${gameId}/feed/live`);
      return normalizeFeed(feed, teamId, gameId);
    }

    return Object.freeze({ findGames, getEvent });
  }

  function chooseGame(games) {
    const rank = { Live: 0, Preview: 1, Final: 2 };
    return [...games].sort((a, b) => {
      const aState = a.status?.abstractGameState;
      const bState = b.status?.abstractGameState;
      const stateDifference = (rank[aState] ?? 3) - (rank[bState] ?? 3);
      if (stateDifference) return stateDifference;
      return aState === "Final"
        ? new Date(b.gameDate) - new Date(a.gameDate)
        : new Date(a.gameDate) - new Date(b.gameDate);
    })[0];
  }

  function normalizeFeed(feed, featuredTeamId, fallbackId = "demo") {
    const gameData = feed.gameData ?? {};
    const liveData = feed.liveData ?? {};
    const linescore = liveData.linescore ?? {};
    const status = gameData.status ?? {};
    const detailedState = status.detailedState ?? status.abstractGameState ?? "Scheduled";
    const state = normalizeState(status.abstractGameState, detailedState);
    const away = normalizeTeam(gameData.teams?.away, linescore.teams?.away?.runs, featuredTeamId);
    const home = normalizeTeam(gameData.teams?.home, linescore.teams?.home?.runs, featuredTeamId);
    const matchup = liveData.plays?.currentPlay?.matchup ?? {};
    const pitcher = linescore.defense?.pitcher ?? matchup.pitcher ?? {};
    const batter = linescore.offense?.batter ?? matchup.batter ?? {};
    const pitchingSide = linescore.isTopInning ? "home" : "away";
    const battingSide = linescore.isTopInning ? "away" : "home";
    const pitcherStats = findPlayerStats(liveData.boxscore, pitchingSide, pitcher.id)?.pitching ?? {};
    const batterStats = findPlayerStats(liveData.boxscore, battingSide, batter.id)?.batting ?? {};
    const completedPlay = [...(liveData.plays?.allPlays ?? [])].reverse().find(play =>
      play.about?.isComplete && play.result?.description
    );

    return createEvent({
      id: gameData.game?.pk ?? fallbackId,
      sport: "baseball",
      league: "MLB",
      state,
      detailedState,
      startTime: gameData.datetime?.dateTime ?? null,
      teams: { away, home },
      details: {
        inningNumber: linescore.currentInning ?? null,
        inningOrdinal: linescore.currentInningOrdinal ?? null,
        inningState: linescore.inningState ?? null,
        isTopInning: Boolean(linescore.isTopInning),
        balls: integerOrNull(linescore.balls),
        strikes: integerOrNull(linescore.strikes),
        outs: integerOrNull(linescore.outs),
        bases: {
          first: Boolean(linescore.offense?.first),
          second: Boolean(linescore.offense?.second),
          third: Boolean(linescore.offense?.third),
        },
        pitcher: {
          name: displayName(pitcher),
          pitchCount: finiteNumberOrNull(pitcherStats.numberOfPitches ?? pitcherStats.pitchesThrown),
        },
        batter: {
          name: displayName(batter),
          hits: finiteNumberOrNull(batterStats.hits),
          atBats: finiteNumberOrNull(batterStats.atBats),
        },
        lastPlay: completedPlay?.result?.description?.trim() || "",
      },
    });
  }

  function normalizeState(abstractState, detailedState) {
    if (/delay|postpon|suspend|cancel/i.test(detailedState || "")) return EVENT_STATES.INTERRUPTED;
    if (abstractState === "Live") return EVENT_STATES.LIVE;
    if (abstractState === "Final") return EVENT_STATES.FINAL;
    return EVENT_STATES.PREGAME;
  }

  function normalizeTeam(team = {}, score, featuredTeamId) {
    const id = Number(team.id);
    return {
      id: Number.isInteger(id) ? id : null,
      name: team.name || team.teamName || "Team",
      abbreviation: teamAbbreviation(team, featuredTeamId),
      score: finiteNumberOrNull(score),
      featured: id === Number(featuredTeamId),
      logoUrl: Number.isInteger(id) ? `https://www.mlbstatic.com/team-logos/${id}.svg` : "",
    };
  }

  function teamAbbreviation(team, featuredTeamId) {
    if (Number(team.id) === Number(featuredTeamId) && Number(featuredTeamId) === 136) return "SEA";
    if (team.abbreviation) return String(team.abbreviation).toUpperCase();
    if (FALLBACK_ABBREVIATIONS[team.name]) return FALLBACK_ABBREVIATIONS[team.name];
    return String(team.teamName || team.name || "OPP").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
  }

  function findPlayerStats(boxscore, side, playerId) {
    if (!playerId) return null;
    return boxscore?.teams?.[side]?.players?.[`ID${playerId}`]?.stats ?? null;
  }

  function displayName(person) {
    return person.fullName || person.lastName || "—";
  }

  function integerOrNull(value) {
    return Number.isInteger(value) ? value : null;
  }

  function finiteNumberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const provider = Object.freeze({ createClient, chooseGame, normalizeFeed, normalizeState });
  global.SportsOverlay.mlb = provider;
  global.SportsOverlay.registry?.registerProvider("mlb", provider);
})(typeof window === "undefined" ? globalThis : window);
