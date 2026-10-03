"use strict";

(function initializeEspnMlsProvider(global) {
  const { EVENT_STATES, createEvent } = global.SportsOverlay.model;
  const API = "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1";

  function createClient(options) {
    const featuredTeamId = String(options.teamId || "");
    const requestTimeoutMs = Number(options.requestTimeoutMs);
    const fetchImpl = options.fetchImpl || global.fetch.bind(global);

    async function fetchJson(url, requestOptions = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal, requestTimeoutMs, priority: requestOptions.priority });
        if (!response.ok) throw new Error(`ESPN MLS feed returned HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    async function findGames(date = new Date()) {
      const url = `${API}/teams/${encodeURIComponent(featuredTeamId)}/schedule?season=${date.getFullYear()}`;
      // Soccer separates results from upcoming fixtures, unlike other ESPN sports.
      const responses = await Promise.allSettled([fetchJson(url), fetchJson(`${url}&fixture=true`)]);
      const schedules = responses.filter(result => result.status === "fulfilled");
      if (!schedules.length) throw responses[0].reason;
      const seen = new Set();
      return schedules.flatMap(result => result.value.events ?? []).filter(event => {
        const id = String(event.id || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }

    async function findLeagueGames() {
      return (await fetchJson(`${API}/scoreboard?limit=100`)).events ?? [];
    }

    async function getEvent(gameId, eventFeaturedTeamId = featuredTeamId, requestOptions = {}) {
      const summary = await fetchJson(`${API}/summary?event=${encodeURIComponent(gameId)}`, requestOptions);
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
    const detailedState = statusType.description || statusType.detail || "Scheduled";

    return createEvent({
      id: payload.header?.id ?? payload.id ?? competition.id ?? fallbackId,
      sport: "soccer",
      league: "MLS",
      state: normalizeState(statusType.state, statusType.completed, detailedState),
      detailedState,
      startTime: competition.date ?? payload.date ?? null,
      teams: {
        away: normalizeTeam(awaySource, awayStats?.team, featuredTeamId),
        home: normalizeTeam(homeSource, homeStats?.team, featuredTeamId),
      },
      details: {
        odds: global.SportsOverlay.model.espnOdds(payload),
        inPlay: statusType.state === "in",
        preseason: global.SportsOverlay.model.espnPreseason(payload, false),
        period: periodLabel(status.period, detailedState),
        clock: status.displayClock || statusType.shortDetail || "",
        awayPossession: statistic(awayStats, "possessionPct"),
        homePossession: statistic(homeStats, "possessionPct"),
        awayShotsOnTarget: statistic(awayStats, "shotsOnTarget"),
        homeShotsOnTarget: statistic(homeStats, "shotsOnTarget"),
        lastEvent: latestNotableEvent(payload.keyEvents),
      },
    });
  }

  function normalizeState(state, completed, detailedState) {
    if (/delay|postpon|suspend|cancel|abandon|halftime/i.test(detailedState || "")) return EVENT_STATES.INTERRUPTED;
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
      featured: teamMatches(competitor, featuredTeamId),
      logoUrl: team.logo || team.logos?.[0]?.href || boxscoreTeam.logo || "",
    };
  }

  function teamMatches(competitor, featuredTeamId) {
    const key = String(featuredTeamId || "").toUpperCase();
    const team = competitor.team ?? {};
    return [competitor.id, team.id, team.abbreviation, team.slug]
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

  function latestNotableEvent(events) {
    const event = [...(events ?? [])].reverse().find(item =>
      item.text && (item.scoringPlay || /card|penalty/i.test(item.type?.type || item.type?.text || ""))
    );
    return event?.text || "";
  }

  function periodLabel(period, detailedState) {
    if (/half.?time/i.test(detailedState || "")) return "HT";
    const value = Number(period);
    if (!Number.isFinite(value) || value <= 0) return "";
    if (value === 1) return "1ST";
    if (value === 2) return "2ND";
    return "ET";
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
    toCandidate: event => global.SportsOverlay.selection.espnCandidate(event, "soccer"),
  });
  global.SportsOverlay.espnMls = provider;
  global.SportsOverlay.registry?.registerProvider("espn-mls", provider);
})(typeof window === "undefined" ? globalThis : window);
