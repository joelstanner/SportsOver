"use strict";

(function initializeEspnNflProvider(global) {
  const { EVENT_STATES, createEvent } = global.SportsOverlay.model;
  const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100";
  const SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=";

  function createClient(options) {
    const featuredTeamId = String(options.teamId || "").toUpperCase();
    const requestTimeoutMs = Number(options.requestTimeoutMs);
    const fetchImpl = options.fetchImpl || global.fetch.bind(global);

    async function fetchJson(url) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`ESPN NFL feed returned HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    async function findGames() {
      const scoreboard = await fetchJson(SCOREBOARD_URL);
      const visibleEvents = scoreboard.events ?? [];
      if (visibleEvents.some(event => hasTeam(event, featuredTeamId))) return visibleEvents;

      const seasonYear = scoreboard.season?.year ?? scoreboard.leagues?.[0]?.season?.year;
      const seasonType = scoreboard.season?.type ?? scoreboard.leagues?.[0]?.season?.type?.id;
      const week = scoreboard.week?.number;
      if (!seasonYear || !seasonType || !week) return visibleEvents;
      const weeklyUrl = `${SCOREBOARD_URL}&dates=${seasonYear}&seasontype=${seasonType}&week=${week}`;
      return (await fetchJson(weeklyUrl)).events ?? visibleEvents;
    }

    async function findLeagueGames() {
      return (await fetchJson(SCOREBOARD_URL)).events ?? [];
    }

    async function getEvent(gameId, eventFeaturedTeamId = featuredTeamId) {
      const summary = await fetchJson(`${SUMMARY_URL}${encodeURIComponent(gameId)}`);
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

  function hasTeam(event, featuredTeamId) {
    const teamKey = String(featuredTeamId || "").toUpperCase();
    return competitors(event).some(competitor =>
      String(competitor.team?.abbreviation || competitor.team?.id || competitor.id || "").toUpperCase() === teamKey
    );
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
      sport: "football",
      league: "NFL",
      state: normalizeState(statusType.state, statusType.completed, detailedState),
      detailedState,
      startTime: competition.date ?? payload.date ?? null,
      teams: { away, home },
      details: {
        odds: global.SportsOverlay.model.espnOdds(payload),
        inPlay: statusType.state === "in",
        preseason: global.SportsOverlay.model.espnPreseason(payload),
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
      featured: abbreviation === String(featuredTeamId || "").toUpperCase(),
      logoUrl: team.logo || team.logos?.find(logo => logo.rel?.includes("scoreboard") && !logo.rel?.includes("dark"))?.href || "",
    };
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
    const match = String(text || "").match(/\bat\s+([A-Z]{2,3}\s+\d{1,2})\b/i);
    return match ? match[1].toUpperCase() : "";
  }

  function latestPlayText(drives) {
    const current = drives?.current?.plays;
    if (current?.length) return current.at(-1)?.text || "";
    const previous = drives?.previous;
    if (!previous?.length) return "";
    const plays = previous[0]?.plays;
    return plays?.at(-1)?.text || "";
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
    toCandidate: event => global.SportsOverlay.selection.espnCandidate(event, "football"),
  });
  global.SportsOverlay.espnNfl = provider;
  global.SportsOverlay.registry?.registerProvider("espn-nfl", provider);
})(typeof window === "undefined" ? globalThis : window);
