"use strict";

(function initializeEspnCollegeFootballProvider(global) {
  const { EVENT_STATES, createEvent } = global.SportsOverlay.model;
  const API = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";

  function createClient(options) {
    const featuredTeamId = String(options.teamId || "").toUpperCase();
    const requestTimeoutMs = Number(options.requestTimeoutMs);
    const fetchImpl = options.fetchImpl || global.fetch.bind(global);

    async function fetchJson(url) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`ESPN NCAAF feed returned HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    async function findGames() {
      const date = new Date();
      const season = date.getMonth() < 2 ? date.getFullYear() - 1 : date.getFullYear();
      const schedule = await fetchJson(`${API}/teams/${encodeURIComponent(featuredTeamId)}/schedule?season=${season}`);
      return schedule.events ?? [];
    }

    async function findLeagueGames() {
      return (await fetchJson(`${API}/scoreboard?groups=80&limit=1000`)).events ?? [];
    }

    async function getEvent(gameId, eventFeaturedTeamId = featuredTeamId) {
      const summary = await fetchJson(`${API}/summary?event=${encodeURIComponent(gameId)}`);
      return normalizeEvent(summary, eventFeaturedTeamId, gameId);
    }

    return Object.freeze({ findGames, findLeagueGames, getEvent });
  }

  function chooseGame(events, featuredTeamId) {
    const matching = events.filter(event => competitors(event).some(competitor => teamMatches(competitor, featuredTeamId)));
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
    const situation = resolveSituation(payload, competition);
    const awaySource = competitors(competition).find(team => team.homeAway === "away") ?? {};
    const homeSource = competitors(competition).find(team => team.homeAway === "home") ?? {};
    const away = normalizeTeam(awaySource, featuredTeamId);
    const home = normalizeTeam(homeSource, featuredTeamId);
    const possessionId = String(situation.possession || situation.lastPlay?.team?.id || "");
    const possession = [away, home].find(team => String(team.id) === possessionId);
    const detailedState = statusType.description || statusType.detail || "Scheduled";

    return createEvent({
      id: payload.header?.id ?? payload.id ?? competition.id ?? fallbackId,
      sport: "college-football",
      league: "NCAAF",
      state: normalizeState(statusType.state, statusType.completed, detailedState),
      detailedState,
      startTime: competition.date ?? payload.date ?? null,
      teams: { away, home },
      details: {
        quarter: periodLabel(status.period),
        clock: status.displayClock || "",
        down: finiteNumberOrNull(situation.down),
        distance: finiteNumberOrNull(situation.distance),
        yardLine: situation.possessionText || yardLineFromText(situation.shortDownDistanceText),
        possessionTeam: possession?.abbreviation || "",
        redZone: typeof situation.isRedZone === "boolean" ? situation.isRedZone : undefined,
        lastPlay: situation.lastPlay?.text || latestPlayText(payload.drives) || "",
      },
    });
  }

  function normalizeState(state, completed, detailedState) {
    if (/halftime|delay|postpon|suspend|cancel/i.test(detailedState || "")) return EVENT_STATES.INTERRUPTED;
    if (completed || state === "post") return EVENT_STATES.FINAL;
    if (state === "in") return EVENT_STATES.LIVE;
    return EVENT_STATES.PREGAME;
  }

  function normalizeTeam(competitor = {}, featuredTeamId) {
    const team = competitor.team ?? {};
    const abbreviation = String(team.abbreviation || "TEAM").toUpperCase();
    const totalRecord = [...(competitor.records ?? competitor.record ?? [])]
      .find(record => record.type === "total" || record.name === "overall");
    return {
      id: String(team.id ?? competitor.id ?? ""),
      name: team.displayName || team.name || "Team",
      abbreviation,
      record: totalRecord?.summary || totalRecord?.displayValue || "",
      score: finiteNumberOrNull(competitor.score?.value ?? competitor.score),
      timeoutsRemaining: global.SportsOverlay.timeouts.remaining(competitor, 3),
      featured: teamMatches(competitor, featuredTeamId),
      logoUrl: team.logo
        || team.logos?.find(logo => logo.rel?.includes("scoreboard") && !logo.rel?.includes("dark"))?.href
        || team.logos?.[0]?.href
        || "",
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

  function periodLabel(period) {
    const value = Number(period);
    if (!Number.isFinite(value) || value <= 0) return "";
    if (value > 4) return value === 5 ? "OT" : `${value - 4}OT`;
    return value === 1 ? "1ST" : value === 2 ? "2ND" : value === 3 ? "3RD" : "4TH";
  }

  function yardLineFromText(text) {
    const match = String(text || "").match(/\bat\s+([A-Z]{2,4}\s+\d{1,2})\b/i);
    return match ? match[1].toUpperCase() : "";
  }

  function latestPlayText(drives) {
    const current = drives?.current?.plays;
    if (current?.length) return current.at(-1)?.text || "";
    const previous = drives?.previous;
    if (!previous?.length) return "";
    return previous[0]?.plays?.at(-1)?.text || "";
  }

  function resolveSituation(payload, competition) {
    const direct = competition.situation ?? payload.situation ?? {};
    const latestPlay = payload.drives?.current?.plays?.at(-1);
    const playSituation = latestPlay?.end ?? latestPlay?.start ?? {};
    return {
      ...playSituation,
      ...direct,
      possession: direct.possession ?? playSituation.team?.id,
      possessionText: direct.possessionText ?? playSituation.possessionText,
      shortDownDistanceText: direct.shortDownDistanceText ?? playSituation.shortDownDistanceText,
      lastPlay: direct.lastPlay ?? latestPlay,
    };
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
    toCandidate: event => global.SportsOverlay.selection.espnCandidate(event, "college-football"),
  });
  global.SportsOverlay.espnNcaaf = provider;
  global.SportsOverlay.registry?.registerProvider("espn-ncaaf", provider);
})(typeof window === "undefined" ? globalThis : window);
