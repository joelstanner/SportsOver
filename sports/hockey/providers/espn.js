"use strict";

(function initializeEspnNhlProvider(global) {
  const { EVENT_STATES, createEvent } = global.SportsOverlay.model;
  const API = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl";

  function createClient(options) {
    const featuredTeamId = String(options.teamId || "").toUpperCase();
    const requestTimeoutMs = Number(options.requestTimeoutMs);
    const fetchImpl = options.fetchImpl || global.fetch.bind(global);

    async function fetchJson(url) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`ESPN NHL feed returned HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    async function findGames(date = new Date()) {
      const team = featuredTeamId.toLowerCase();
      const schedule = await fetchJson(`${API}/teams/${team}/schedule?season=${seasonEndingYear(date)}`);
      return schedule.events ?? [];
    }

    async function findLeagueGames() {
      return (await fetchJson(`${API}/scoreboard?limit=100`)).events ?? [];
    }

    async function getEvent(gameId, eventFeaturedTeamId = featuredTeamId) {
      const summary = await fetchJson(`${API}/summary?event=${encodeURIComponent(gameId)}`);
      return normalizeEvent(summary, eventFeaturedTeamId, gameId);
    }

    return Object.freeze({ findGames, findLeagueGames, getEvent });
  }

  function chooseGame(events, featuredTeamId) {
    const teamKey = String(featuredTeamId || "").toUpperCase();
    const matching = events.filter(event => competitors(event).some(competitor =>
      String(competitor.team?.abbreviation || competitor.team?.id || competitor.id || "").toUpperCase() === teamKey
    ));
    const rank = { in: 0, pre: 1, post: 2 };
    return [...matching].sort((a, b) => {
      const aState = eventState(a);
      const bState = eventState(b);
      const stateDifference = (rank[aState] ?? 3) - (rank[bState] ?? 3);
      if (stateDifference) return stateDifference;
      return aState === "post"
        ? new Date(b.date) - new Date(a.date)
        : new Date(a.date) - new Date(b.date);
    })[0];
  }

  function normalizeEvent(payload, featuredTeamId, fallbackId = "demo") {
    const competition = payload.header?.competitions?.[0] ?? payload.competitions?.[0] ?? payload;
    const status = competition.status ?? payload.status ?? {};
    const statusType = status.type ?? {};
    const awaySource = competitors(competition).find(team => team.homeAway === "away") ?? {};
    const homeSource = competitors(competition).find(team => team.homeAway === "home") ?? {};
    const awayStats = findTeamStats(payload.boxscore, awaySource);
    const homeStats = findTeamStats(payload.boxscore, homeSource);
    const detailedState = statusType.description || statusType.detail || "Scheduled";

    return createEvent({
      id: payload.header?.id ?? payload.id ?? competition.id ?? fallbackId,
      sport: "hockey",
      league: "NHL",
      state: normalizeState(statusType.state, statusType.completed, detailedState),
      detailedState,
      startTime: competition.date ?? payload.date ?? null,
      teams: {
        away: normalizeTeam(awaySource, awayStats?.team, featuredTeamId),
        home: normalizeTeam(homeSource, homeStats?.team, featuredTeamId),
      },
      details: {
        preseason: global.SportsOverlay.model.espnPreseason(payload),
        period: periodLabel(status.period),
        clock: status.displayClock || "",
        awayShots: statistic(awayStats, "shotsTotal"),
        homeShots: statistic(homeStats, "shotsTotal"),
        awayPowerPlay: powerPlay(awayStats),
        homePowerPlay: powerPlay(homeStats),
        lastPlay: latestScoringPlay(payload.plays),
      },
    });
  }

  function normalizeState(state, completed, detailedState) {
    if (/intermission|delay|postpon|suspend|cancel/i.test(detailedState || "")) return EVENT_STATES.INTERRUPTED;
    if (completed || state === "post") return EVENT_STATES.FINAL;
    if (state === "in") return EVENT_STATES.LIVE;
    return EVENT_STATES.PREGAME;
  }

  function normalizeTeam(competitor = {}, boxscoreTeam = {}, featuredTeamId) {
    const team = competitor.team ?? {};
    const abbreviation = String(team.abbreviation || boxscoreTeam.abbreviation || "TEAM").toUpperCase();
    const totalRecord = [...(competitor.records ?? competitor.record ?? [])]
      .find(record => record.type === "total" || record.name === "overall");
    return {
      id: String(team.id ?? boxscoreTeam.id ?? competitor.id ?? ""),
      name: team.displayName || boxscoreTeam.displayName || team.name || "Team",
      abbreviation,
      record: totalRecord?.summary || totalRecord?.displayValue || "",
      score: finiteNumberOrNull(competitor.score?.value ?? competitor.score),
      featured: abbreviation === String(featuredTeamId || "").toUpperCase(),
      logoUrl: team.logo || boxscoreTeam.logo || "",
    };
  }

  function competitors(event) {
    return event.competitions?.[0]?.competitors ?? event.competitors ?? [];
  }

  function eventState(event) {
    return event.status?.type?.state ?? event.competitions?.[0]?.status?.type?.state ?? "pre";
  }

  function findTeamStats(boxscore, competitor) {
    const id = String(competitor.team?.id ?? competitor.id ?? "");
    return boxscore?.teams?.find(entry => String(entry.team?.id ?? "") === id) ?? null;
  }

  function statistic(teamStats, name) {
    const value = teamStats?.statistics?.find(item => item.name === name)?.displayValue;
    return finiteNumberOrNull(value);
  }

  function powerPlay(teamStats) {
    const goals = statistic(teamStats, "powerPlayGoals");
    const opportunities = statistic(teamStats, "powerPlayOpportunities");
    return goals === null || opportunities === null ? "—" : `${goals}/${opportunities}`;
  }

  function latestScoringPlay(plays) {
    return [...(plays ?? [])].reverse().find(play => play.scoringPlay)?.text || "";
  }

  function periodLabel(period) {
    const value = Number(period);
    if (!Number.isFinite(value) || value <= 0) return "";
    if (value <= 3) return value === 1 ? "1ST" : value === 2 ? "2ND" : "3RD";
    return value === 4 ? "OT" : "SO";
  }

  function seasonEndingYear(date) {
    return date.getMonth() >= 7 ? date.getFullYear() + 1 : date.getFullYear();
  }

  function finiteNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  const provider = Object.freeze({
    createClient,
    chooseGame,
    normalizeEvent,
    normalizeState,
    periodLabel,
    seasonEndingYear,
    toCandidate: event => global.SportsOverlay.selection.espnCandidate(event, "hockey"),
  });
  global.SportsOverlay.espnNhl = provider;
  global.SportsOverlay.registry?.registerProvider("espn-nhl", provider);
})(typeof window === "undefined" ? globalThis : window);
