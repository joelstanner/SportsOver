"use strict";

(function initializeEspnNbaProvider(global) {
  const { EVENT_STATES, createEvent } = global.SportsOverlay.model;
  const API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

  function createClient(options) {
    const featuredTeamId = String(options.teamId || "").toUpperCase();
    const requestTimeoutMs = Number(options.requestTimeoutMs);
    const fetchImpl = options.fetchImpl || global.fetch.bind(global);

    async function fetchJson(url) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`ESPN NBA feed returned HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    async function findGames(date = new Date()) {
      const schedule = await fetchJson(`${API}/teams/${featuredTeamId.toLowerCase()}/schedule?season=${seasonEndingYear(date)}`);
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
    const matching = events.filter(event => competitors(event).some(competitor => teamMatches(competitor, teamKey)));
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
    const period = Number(status.period);
    const detailedState = statusType.description || statusType.detail || "Scheduled";

    return createEvent({
      id: payload.header?.id ?? payload.id ?? competition.id ?? fallbackId,
      sport: "basketball",
      league: "NBA",
      state: normalizeState(statusType.state, statusType.completed, detailedState),
      detailedState,
      startTime: competition.date ?? payload.date ?? null,
      teams: {
        away: normalizeTeam(awaySource, awayStats?.team, featuredTeamId, basketballTimeoutsRemaining(payload, awaySource, period)),
        home: normalizeTeam(homeSource, homeStats?.team, featuredTeamId, basketballTimeoutsRemaining(payload, homeSource, period)),
      },
      details: {
        odds: global.SportsOverlay.model.espnOdds(payload),
        inPlay: statusType.state === "in",
        preseason: global.SportsOverlay.model.espnPreseason(payload),
        period: periodLabel(status.period),
        clock: status.displayClock || "",
        awayFieldGoalPct: statistic(awayStats, "fieldGoalPct"),
        homeFieldGoalPct: statistic(homeStats, "fieldGoalPct"),
        awayRebounds: statistic(awayStats, "totalRebounds"),
        homeRebounds: statistic(homeStats, "totalRebounds"),
        lastPlay: latestScoringPlay(payload.plays),
      },
    });
  }

  function normalizeState(state, completed, detailedState) {
    if (/half.?time|delay|postpon|suspend|cancel/i.test(detailedState || "")) return EVENT_STATES.INTERRUPTED;
    if (completed || state === "post") return EVENT_STATES.FINAL;
    if (state === "in") return EVENT_STATES.LIVE;
    return EVENT_STATES.PREGAME;
  }

  function normalizeTeam(competitor = {}, boxscoreTeam = {}, featuredTeamId, timeoutsRemaining = null) {
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
      timeoutsRemaining,
      featured: teamMatches(competitor, featuredTeamId),
      logoUrl: team.logo || team.logos?.[0]?.href || boxscoreTeam.logo || "",
    };
  }

  function teamMatches(competitor, featuredTeamId) {
    const key = String(featuredTeamId || "").toUpperCase();
    const team = competitor.team ?? {};
    return [competitor.id, team.id, team.abbreviation]
      .some(value => String(value || "").toUpperCase() === key);
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

  function latestScoringPlay(plays) {
    return [...(plays ?? [])].reverse().find(play => play.scoringPlay && play.text)?.text || "";
  }

  function basketballTimeoutsRemaining(payload, competitor, period) {
    const maximum = period > 4 ? 2 : 7;
    const direct = global.SportsOverlay.timeouts.remaining(competitor, maximum);
    if (direct !== null) return direct;
    if (!Array.isArray(payload.plays)) return null;
    const teamId = String(competitor.team?.id ?? competitor.id ?? "");
    const used = payload.plays.filter(play => {
      const playPeriod = Number(play.period?.number);
      const relevantPeriod = period > 4 ? playPeriod === period : playPeriod <= 4;
      return relevantPeriod
        && String(play.team?.id ?? "") === teamId
        && /timeout/i.test(play.type?.text || "");
    }).length;
    return Math.max(0, maximum - used);
  }

  function periodLabel(period) {
    const value = Number(period);
    if (!Number.isFinite(value) || value <= 0) return "";
    return value <= 4 ? `Q${value}` : `OT${value === 5 ? "" : value - 4}`;
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
    toCandidate: event => global.SportsOverlay.selection.espnCandidate(event, "basketball"),
  });
  global.SportsOverlay.espnNba = provider;
  global.SportsOverlay.registry?.registerProvider("espn-nba", provider);
})(typeof window === "undefined" ? globalThis : window);
