"use strict";

(function initializeEspnCollegeFootballProvider(global) {
  const { EVENT_STATES, createEvent } = global.SportsOverlay.model;
  const API = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";

  function createClient(options) {
    const featuredTeamId = String(options.teamId || "").toUpperCase();
    const requestTimeoutMs = Number(options.requestTimeoutMs);
    const fetchImpl = options.fetchImpl || global.fetch.bind(global);

    async function fetchJson(url, requestOptions = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal, requestTimeoutMs, priority: requestOptions.priority });
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

    async function getEvent(gameId, eventFeaturedTeamId = featuredTeamId, requestOptions = {}) {
      const summary = await fetchJson(`${API}/summary?event=${encodeURIComponent(gameId)}`, requestOptions);
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
    const timeouts = collegeTimeouts(payload, competition, status);
    away.timeoutsRemaining = timeouts.away;
    home.timeoutsRemaining = timeouts.home;
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
        gameUrl: global.SportsOverlay.model.espnGameUrl(payload),
        timeoutMaximum: timeouts.maximum,
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
      featured: teamMatches(competitor, featuredTeamId),
      logoUrl: team.logo
        || team.logos?.find(logo => logo.rel?.includes("scoreboard") && !logo.rel?.includes("dark"))?.href
        || team.logos?.[0]?.href
        || "",
    };
  }

  function collegeTimeouts(payload, competition, status) {
    const period = Number(status.period);
    const maximum = period > 4 ? 1 : 3;
    const teams = competitors(competition);
    const result = { maximum, away: null, home: null };
    // Show the next half's fresh allocation once halftime has been announced.
    const halftime = /halftime/i.test(status.type?.description || status.type?.detail || "");
    // NCAA Rule 3-1-3: 1OT and 2OT each get one; 3OT onward share one.
    const firstPeriod = period <= 2 ? 1 : period <= 4 ? 3 : Math.min(period, 7);
    const drives = [...(payload.drives?.previous || []), ...(payload.drives?.current ? [payload.drives.current] : [])];
    const plays = [...new Map(drives.flatMap(drive => drive.plays || [])
      .map(play => [play.id ?? play.sequenceNumber ?? JSON.stringify(play), play])).values()];
    const playPeriod = play => Number(play.period?.number);
    const coveredStart = plays.some(play => playPeriod(play) < firstPeriod
      || (playPeriod(play) === firstPeriod && play.clock?.displayValue === "15:00"));
    const coveredPeriods = new Set(plays.map(playPeriod).filter(value => Number.isInteger(value) && value >= firstPeriod && value <= period));
    if (period <= 4 && status.displayClock === "15:00") coveredPeriods.add(period);
    const used = { away: 0, home: 0 };
    let reliable = Number.isInteger(period) && period > 0 && coveredStart && coveredPeriods.size === period - firstPeriod + 1;
    for (const play of plays) {
      const charged = (play.teamParticipants || []).filter(participant => participant.timeout === true);
      const isTimeout = charged.length || String(play.type?.id) === "21" || /^timeout$/i.test(play.type?.text || "");
      if (!isTimeout) continue;
      if (!Number.isInteger(playPeriod(play))) { reliable = false; continue; }
      if (playPeriod(play) < firstPeriod || playPeriod(play) > period) continue;
      let chargedTeams = charged.map(participant => teams.find(team =>
        String(team.team?.id ?? team.id) === String(participant.id ?? participant.team?.id)));
      if (!charged.length) {
        // Possession/start/end team IDs can belong to the opponent. Only use an
        // explicitly named timeout team when participant charge flags are absent.
        if (/official|media|two[ -]minute/i.test(play.text || "")) continue;
        const name = /^timeout\s+(.+?),\s*clock\b/i.exec(play.text || "")?.[1].trim().toLowerCase();
        chargedTeams = name ? teams.filter(({ team = {} }) =>
          [team.displayName, team.shortDisplayName, team.location, team.nickname, team.abbreviation, team.name]
            .some(value => value && value.toLowerCase() === name)) : [];
        if (chargedTeams.length !== 1) { reliable = false; continue; }
      }
      for (const team of chargedTeams) {
        if (!team || !(team.homeAway in used)) reliable = false;
        else used[team.homeAway]++;
      }
    }
    for (const team of teams) {
      const side = team.homeAway;
      if (!(side in used)) continue;
      const explicit = timeoutCount(team.timeoutsRemaining, maximum);
      if (halftime) result[side] = 3;
      else if (explicit !== null) result[side] = explicit;
      else if (reliable) result[side] = used[side] <= maximum ? maximum - used[side] : null;
      // Used counts can be cumulative across halves. They are only unambiguous
      // before halftime; never subtract the whole-game total in later periods.
      else if (period === 1 || period === 2) {
        const count = timeoutCount(team.timeoutsUsed, maximum);
        result[side] = count === null ? null : maximum - count;
      }
    }
    return result;
  }

  function timeoutCount(value, maximum) {
    if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
    const count = Number(value);
    return Number.isInteger(count) && count >= 0 && count <= maximum ? count : null;
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
