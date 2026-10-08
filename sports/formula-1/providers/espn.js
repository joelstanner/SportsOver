"use strict";
(function initializeFormula1(global) {
  const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard";
  const validId = value => /^[1-9]\d{0,11}$/.test(String(value || ""));
  const text = value => typeof value === "string" || typeof value === "number" ? String(value).slice(0, 180) : "";
  const numeric = value => value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const watchId = watch => global.SportsOverlay.config.watchId(watch);
  const resultsUrl = id => {
    if (!validId(id)) throw Error("Invalid Formula 1 weekend ID");
    return `https://www.espn.com/f1/results/_/id/${id}?_xhr=pageContent`;
  };
  function flagUrl(value) {
    try {
      const url = new URL(value);
      return url.origin === "https://a.espncdn.com" && /^\/i\/teamlogos\/countries\/500\/[a-z]{2,3}\.png$/.test(url.pathname)
        && !url.username && !url.password && !url.search && !url.hash ? url.href : "";
    } catch (_) { return ""; }
  }
  function driverId(row) {
    if (validId(row.id)) return String(row.id);
    try {
      const url = new URL(row.athlete?.links);
      if (url.origin === "https://www.espn.com") return url.pathname.match(/^\/racing\/driver\/_\/id\/([1-9]\d{0,11})(?:\/|$)/)?.[1] || "";
    } catch (_) { /* Missing identity cannot become a followed driver. */ }
    return "";
  }
  function normalizeDriver(row) {
    const athlete = row.athlete || {};
    const qualifying = [row.q1, row.q2, row.q3].map(value => text(value));
    const validTime = value => value && !["--", "0.000", "0:00.000"].includes(value);
    const explicit = text(row.status?.type?.abbreviation || row.status?.type?.description || row.status).toUpperCase();
    return { id: driverId(row), name: text(athlete.displayName || athlete.fullName) || "Driver",
      shortName: text(athlete.shortName || athlete.displayName), abbreviation: text(athlete.abbrev),
      flag: flagUrl(athlete.logo || athlete.flag?.href), country: text(athlete.country || athlete.flag?.alt),
      team: text(row.team || athlete.team || row.vehicle?.manufacturer),
      position: numeric(row.position ?? row.order), laps: numeric(row.lapsCompleted),
      time: text(row.raceTime), gap: text(row.timeBehindLeader), qualifying,
      bestTime: [...qualifying].reverse().find(validTime) || text(row.raceTime),
      status: ["DNS", "DSQ", "DQ", "DNF"].includes(explicit) ? explicit : row.isRetired === true ? "Retired" : "" };
  }
  function statusOf(status) {
    const type = status?.type || status || {};
    if (/DELAY|SUSPEND|RED_FLAG|POSTPON|CANCEL/i.test(type.name || "")) return "interrupted";
    if (type.completed === true || type.state === "post") return "final";
    if (type.state === "in") return "live";
    return "pregame";
  }
  function sessionsFor(weekend, content) {
    const strip = content?.gamepackage?.raceStrip?.data?.sessions || [];
    const tables = content?.gamepackage?.filteredPositions || [];
    // The scoreboard carries authoritative session IDs and scheduled UTC times.
    // A results-only historical weekend uses the results page's session metadata.
    const source = weekend?.competitions?.length ? weekend.competitions : strip.map(session => ({
      id: tables.find(table => table.title === session.session)?.competitionId,
      date: session.date, type: { text: session.session, abbreviation: session.sessionAbbrev },
      status: { type: { state: session.statusState, completed: session.completed } },
    }));
    return source.map(session => {
      const table = tables.find(table => String(table.competitionId) === String(session.id));
      const label = strip.find(item => item.sessionAbbrev === session.type?.abbreviation);
      return { id: text(session.id), name: text(session.type?.text || label?.session || table?.title || session.type?.abbreviation) || "Session",
        abbreviation: text(session.type?.abbreviation), date: session.date || null,
        state: statusOf(session.status), detail: text(session.status?.type?.description), table };
    }).sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  }
  function chooseSession(sessions) {
    const active = sessions.find(session => session.state === "live") || sessions.find(session => session.state === "interrupted");
    const next = sessions.find(session => session.state === "pregame");
    const finished = sessions.filter(session => session.state === "final");
    const selected = active || finished.at(-1) || next;
    const complete = sessions.length > 0 && sessions.every(session => session.state === "final")
      && sessions.some(session => session.abbreviation === "Race" || session.name === "Race");
    return { selected, next, active, state: active?.state || (finished.length && !complete ? "interrupted" : complete ? "final" : "pregame") };
  }
  function normalizeEvent(weekend, content, watch, upcoming = null) {
    const sessions = sessionsFor(weekend, content), choice = chooseSession(sessions);
    if (!choice.selected) throw Error("Formula 1 sessions are unavailable");
    const { selected, active } = choice;
    const next = upcoming || choice.next;
    const state = !active && upcoming ? "interrupted" : choice.state;
    const competitors = (selected.table?.data || []).map(normalizeDriver).filter(driver => driver.id)
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
    const name = text(weekend.name || content.gamepackage?.raceStrip?.overview?.name) || "Formula 1";
    const missingTiming = selected.state !== "pregame" && (!selected.table?.data?.length
      || active && selected.table.sessionState !== "in");
    // Never relabel completed-session timing as live for the next session.
    if (missingTiming) competitors.length = 0;
    return global.SportsOverlay.model.createEvent({ id: watchId(watch), sport: "formula-1", league: "F1", competitionType: "individual",
      state, detailedState: active ? active.detail || (active.state === "live" ? "Live" : "Interrupted")
        : state === "interrupted" ? "Between sessions" : state === "final" ? "Final" : "Upcoming",
      startTime: active?.date || next?.date || selected.date, competitors,
      details: { name, weekendId: String(weekend.id), sessionId: selected.id, sessionName: selected.name,
        sessionActive: Boolean(active), resultState: selected.state, nextSession: next ? { name: next.name, date: next.date } : null,
        view: watch.view, playerId: watch.playerId || "", playerName: watch.name || "Driver", playerFlag: flagUrl(watch.flag),
        leaderboardSize: watch.leaderboardSize, qualifying: /qual|shootout/i.test(selected.name),
        missingTiming, stale: false } });
  }
  function toCandidate(event) {
    const player = event.competitors.find(driver => driver.id === event.details.playerId);
    const label = event.details.view === "player" ? `Driver · ${player?.name || event.details.playerName}`
      : event.details.leaderboardSize === "all" ? "Full field" : `Top ${event.details.leaderboardSize}`;
    return { id: event.id, sport: "formula-1", competitionType: "individual", state: event.state, startTime: event.startTime,
      teamKeys: [], competitorKeys: event.competitors.map(driver => driver.id),
      raw: { ...event.details, bannerLabel: label, player, detailedState: event.detailedState } };
  }
  function refreshState(payload, url) {
    if (url?.startsWith(SCOREBOARD)) {
      const states = (payload?.events || []).flatMap(event => event.competitions || []).map(session => statusOf(session.status));
      return ["live", "interrupted", "pregame", "final"].find(state => states.includes(state)) || "idle";
    }
    return chooseSession(sessionsFor(null, payload)).state;
  }
  const createSession = () => ({ lastGood: new Map(), pending: new Map() });
  const defaultSession = createSession();
  function createClient({ watches = [], fetchImpl = global.fetch.bind(global), session = defaultSession, requestTimeoutMs = 8000, now = Date.now } = {}) {
    const enabled = () => watches.filter(global.SportsOverlay.config.isWatchEnabled);
    async function get(url, options) {
      const response = await fetchImpl(url, { requestTimeoutMs, ...options });
      if (!response.ok) { const error = Error(`ESPN Formula 1 returned HTTP ${response.status}`); error.status = response.status; throw error; }
      return response.json();
    }
    async function scoreboard(options) {
      const data = await get(SCOREBOARD, options);
      if (!Array.isArray(data.events)) throw Error("ESPN Formula 1 schedule unavailable");
      return data;
    }
    async function results(id, options) {
      const data = await get(resultsUrl(id), options);
      if (!Array.isArray(data.gamepackage?.filteredPositions) || !Array.isArray(data.gamepackage?.raceStrip?.data?.sessions))
        throw Error("ESPN Formula 1 timing unavailable");
      return data;
    }
    function previousWeekend(data, currentId) {
      return (data.leagues?.[0]?.calendar || []).filter(item => Date.parse(item.endDate) < now())
        .sort((a, b) => Date.parse(b.endDate) - Date.parse(a.endDate))
        .map(item => ({ id: String(item.event?.$ref || "").match(/\/events\/([1-9]\d{0,11})(?:\?|$)/)?.[1], name: item.label }))
        .find(item => validId(item.id) && item.id !== currentId);
    }
    async function loadBundle(options = {}) {
      // Settings, discovery and all banners in this client share in-flight work.
      const key = "weekend";
      if (session.pending.has(key)) {
        if (options.priority === "display") {
          session.bundlePriority = "display";
          for (const url of session.pendingUrls || []) fetchImpl.prioritize?.(url);
        }
        return session.pending.get(key);
      }
      session.bundlePriority = options.priority;
      const requestOptions = () => ({ ...options, priority: session.bundlePriority });
      const pending = (async () => {
        session.pendingUrls = [SCOREBOARD];
        const data = await scoreboard(requestOptions());
        const current = data.events.find(event => event.competitions?.some(comp => ["live", "interrupted"].includes(statusOf(comp.status)))) || data.events[0];
        if (!current || !validId(current.id)) return null;
        session.pendingUrls.push(resultsUrl(current.id));
        const content = await results(current.id, requestOptions());
        const choice = chooseSession(sessionsFor(current, content));
        if (choice.state === "pregame") {
          const previous = previousWeekend(data, String(current.id));
          if (previous) {
            session.pendingUrls.push(resultsUrl(previous.id));
            try {
              const last = await results(previous.id, requestOptions());
              if (chooseSession(sessionsFor(previous, last)).state === "final")
                return { weekend: previous, content: last, upcoming: choice.next };
            } catch (error) {
              // Keep the confirmed upcoming schedule; never claim the past race finished.
              if ([429, 403].includes(error.status)) throw error;
            }
          }
        }
        return { weekend: current, content };
      })();
      session.pending.set(key, pending);
      try { return await pending; } finally { session.pending.delete(key); session.pendingUrls = []; }
    }
    function fromBundle(bundle, watch) {
      const event = normalizeEvent(bundle.weekend, bundle.content, watch, bundle.upcoming);
      session.lastGood.set(event.id, event);
      if (session.lastGood.size > 200) session.lastGood.delete(session.lastGood.keys().next().value);
      return event;
    }
    async function getEvent(id, _featured, options = {}) {
      const watch = enabled().find(watch => watchId(watch) === id);
      if (!watch) throw Error("Formula 1 banner is no longer watched");
      try {
        const bundle = await loadBundle(options);
        if (!bundle) throw Error("No Formula 1 weekend available");
        return fromBundle(bundle, watch);
      } catch (error) {
        const previous = session.lastGood.get(id);
        if (!previous) throw error;
        return { ...previous, details: { ...previous.details, stale: true } };
      }
    }
    async function discover({ topFavoriteOnly = false, excludedKeys = [] } = {}) {
      const selected = enabled();
      if (!selected.length) return { automaticEntries: [], availableEntries: [], failures: 0 };
      let events, failures = 0;
      try {
        const bundle = await loadBundle();
        events = bundle ? selected.map(watch => fromBundle(bundle, watch)) : [];
      } catch (error) {
        failures = 1;
        events = selected.flatMap(watch => {
          const previous = session.lastGood.get(watchId(watch));
          return previous ? [{ ...previous, details: { ...previous.details, stale: true } }] : [];
        });
      }
      const availableEntries = events.map(event => ({ kind: "favorite", candidate: toCandidate(event), featuredTeamId: null }));
      const allowed = availableEntries.filter(entry => !excludedKeys.includes(`formula-1:${entry.candidate.id}`));
      return { availableEntries, automaticEntries: topFavoriteOnly ? allowed.slice(0, 1) : allowed, failures };
    }
    async function listDrivers() {
      const bundle = await loadBundle();
      if (!bundle) return [];
      const drivers = new Map();
      for (const table of bundle.content.gamepackage.filteredPositions) for (const row of table.data || []) {
        const driver = normalizeDriver(row);
        if (driver.id && !drivers.has(driver.id)) drivers.set(driver.id, driver);
      }
      return [...drivers.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    return { getEvent, discover, listDrivers };
  }
  const api = { SCOREBOARD, resultsUrl, flagUrl, normalizeDriver, normalizeEvent, toCandidate, refreshState,
    createSession, createClient, failureBackoff: true };
  global.SportsOverlay.formula1 = api;
  global.SportsOverlay.registry.registerProvider("espn-f1", api);
})(typeof window === "undefined" ? globalThis : window);
