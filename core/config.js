"use strict";

(function initializeSportsConfig(global) {
  // currentScript is only available while this script is executing.
  const configScriptUrl = typeof document === "undefined" ? null
    : document.currentScript?.src || `${global.location?.origin || ""}/core/config.js`;
  const STORAGE_KEY = "sports-overlay.config.v1";
  const SPORT_CATALOG = Object.freeze([
    Object.freeze({ key: "baseball", name: "Baseball", league: "MLB" }),
    Object.freeze({ key: "football", name: "Football", league: "NFL" }),
    Object.freeze({ key: "college-football", name: "College football", league: "NCAAF" }),
    Object.freeze({ key: "hockey", name: "Hockey", league: "NHL" }),
    Object.freeze({ key: "soccer", name: "Soccer", league: "MLS" }),
    Object.freeze({ key: "basketball", name: "Basketball", league: "NBA" }),
    Object.freeze({ key: "college-basketball", name: "NCAA men’s basketball", league: "NCAAM" }),
    Object.freeze({ key: "disc-golf", name: "Disc golf", league: "PDGA", competitionType: "individual", provider: "pdga" }),
    Object.freeze({ key: "chess", name: "Chess", league: "Lichess", competitionType: "individual", provider: "lichess" }),
  ]);
  const CATALOG_SPORTS = Object.freeze(["baseball", "football", "college-football", "hockey", "soccer", "basketball", "college-basketball"]);
  const TEAM_CATALOG = loadTeamCatalogSync();
  const ready = TEAM_CATALOG.length
    ? Promise.resolve(TEAM_CATALOG)
    : loadTeamCatalog().then(teams => {
      TEAM_CATALOG.push(...teams);
      return TEAM_CATALOG;
    });
  const DEFAULT_CONFIG = Object.freeze({
    version: 8,
    sports: Object.freeze([
      frozenSport("baseball", ["mlb:136"]),
      frozenSport("football", ["nfl:sea"]),
      frozenSport("college-football", ["ncaaf:158", "ncaaf:264"]),
      frozenSport("hockey", ["nhl:sea"]),
      frozenSport("soccer", ["mls:9726"]),
      frozenSport("basketball", ["nba:det"]),
      frozenSport("college-basketball", ["ncaam:158", "ncaam:264", "ncaam:2547"]),
      Object.freeze({ sport: "disc-golf", enabled: true, favorites: Object.freeze([]), events: Object.freeze([]), autoFollow: false, discoverSecondTier: true, autoDivisions: Object.freeze(["MPO", "FPO"]) }),
      Object.freeze({ sport: "chess", enabled: true, favorites: Object.freeze([]), events: Object.freeze([]), autoFollow: true, discoverSecondTier: true }),
    ]),
    providerRefreshSeconds: Object.freeze(Object.fromEntries(SPORT_CATALOG.map(({ key: sport }) =>
      [sport, Object.freeze({ live: ["disc-golf", "chess"].includes(sport) ? 30 : 12, pregame: 60, idle: 300, final: sport === "chess" ? 900 : 300 })]))),
    automaticWatchLists: Object.freeze({ "disc-golf": Object.freeze([]), chess: Object.freeze([]) }),
    rotationSeconds: 10,
    timeZone: "local",
    showBettingInfo: true,
    showAlternateContent: false,
    bettingReplacement: "hidden",
    bettingReplacementText: "",
    bettingMixSources: Object.freeze(["betting", "player-stats", "custom", "game-details"]),
    rotationMode: "automatic",
    bannerSportFilter: "",
    liveModeFinalMinutes: 20,
    includedGames: Object.freeze([]),
    excludedGames: Object.freeze([]),
    rotationOrder: Object.freeze([]),
    defaultGameDurations: Object.freeze({ live: 20, pregame: 5, final: 10 }),
    gameDurations: Object.freeze({}),
    lockedGameKeys: Object.freeze([]),
    fallbackMode: "up-next",
    displayMode: "automatic",
  });
  const FALLBACK_MODES = new Set(["up-next", "recent-final", "hide"]);
  // Legacy "rotate" used the same selection as "automatic"; normalize both to one choice.
  const DISPLAY_MODES = new Set(["automatic", "top-favorite"]);
  const ROTATION_MODES = new Set(["automatic", "hybrid", "curated"]);

  function loadTeamCatalogSync() {
    if (typeof module === "undefined" || !module.exports || typeof require !== "function") return [];
    return CATALOG_SPORTS.flatMap(sport => normalizeCatalog(require(`../sports/${sport}/teams.json`)));
  }

  async function loadTeamCatalog() {
    const catalogs = await Promise.all(CATALOG_SPORTS.map(async sport => {
      const url = new URL(`../sports/${sport}/teams.json`, configScriptUrl);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Team catalog ${sport} returned HTTP ${response.status}`);
      return response.json();
    }));
    return catalogs.flatMap(normalizeCatalog);
  }

  async function reloadTeamCatalog() {
    const teams = await loadTeamCatalog();
    TEAM_CATALOG.splice(0, TEAM_CATALOG.length, ...teams);
    return TEAM_CATALOG;
  }

  function normalizeCatalog(catalog) {
    const sport = String(catalog?.sport || "");
    const league = String(catalog?.league || "");
    const provider = String(catalog?.provider || "");
    if (!findSportMetadata(sport) || !league || !provider || !Array.isArray(catalog?.teams)) return [];
    return catalog.teams.map(team => Object.freeze({
      ...team,
      sport,
      league,
      provider,
      providerStatus: "live",
      theme: Object.freeze({ ...team.theme }),
    }));
  }

  function findSportMetadata(sportKey) {
    return SPORT_CATALOG.find(sport => sport.key === String(sportKey || "").toLowerCase()) || null;
  }

  function frozenSport(sport, teamKeys) {
    return Object.freeze({
      sport,
      enabled: true,
      favorites: Object.freeze(teamKeys.map(teamKey => Object.freeze({ teamKey, enabled: true }))),
    });
  }

  function normalizeConfig(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const requestedSports = Array.isArray(source.sports)
      ? source.sports
      : groupFavorites(Array.isArray(source.favorites) ? source.favorites : flattenFavorites(DEFAULT_CONFIG.sports));
    const sports = [];
    const seenSports = new Set();

    requestedSports.forEach(group => {
      const sport = String(group?.sport || "").toLowerCase();
      if (!findSport(sport) || seenSports.has(sport)) return;
      seenSports.add(sport);
      sports.push({ sport, enabled: group.enabled !== false, favorites: normalizeFavorites(group.favorites, sport),
        ...(sport === "disc-golf" ? { events: normalizePdgaEvents(group.events), autoFollow: group.autoFollow === true, discoverSecondTier: group.discoverSecondTier !== false,
          autoDivisions: Array.isArray(group.autoDivisions) ? ["MPO", "FPO"].filter(division => group.autoDivisions.includes(division)) : ["MPO", "FPO"] } : {}),
        ...(sport === "chess" ? { events: normalizeChessEvents(group.events), autoFollow: group.autoFollow !== false, discoverSecondTier: group.discoverSecondTier !== false } : {}) });
    });
    SPORT_CATALOG.forEach(sport => {
      if (!seenSports.has(sport.key)) sports.push({ sport: sport.key, enabled: true, favorites: [],
        ...(sport.key === "disc-golf" ? { events: [], autoFollow: false, discoverSecondTier: true, autoDivisions: ["MPO", "FPO"] } : {}),
        ...(sport.key === "chess" ? { events: [], autoFollow: true, discoverSecondTier: true } : {}) });
    });

    const rotationSeconds = Number(source.rotationSeconds);
    return {
      version: 8,
      timeZone: normalizeTimeZone(source.timeZone),
      showBettingInfo: source.showBettingInfo !== false,
      showAlternateContent: source.showAlternateContent === true,
      bettingReplacement: ["hidden", "custom", "player-stats", "game-details", "blank", "scrolling"].includes(source.bettingReplacement) ? source.bettingReplacement : "hidden",
      bettingReplacementText: typeof source.bettingReplacementText === "string" ? source.bettingReplacementText.replace(/\s+/g, " ").slice(0, 160) : "",
      bettingMixSources: Array.isArray(source.bettingMixSources)
        ? [...new Set(source.bettingMixSources.filter(value => ["betting", "player-stats", "custom", "game-details"].includes(value)))]
        : [...DEFAULT_CONFIG.bettingMixSources],
      providerRefreshSeconds: normalizeProviderRefresh(source.providerRefreshSeconds),
      sports,
      automaticWatchLists: {
        "disc-golf": normalizePdgaEvents(source.automaticWatchLists?.["disc-golf"]),
        chess: normalizeChessEvents(source.automaticWatchLists?.chess),
      },
      rotationSeconds: Number.isFinite(rotationSeconds)
        ? Math.min(300, Math.max(5, Math.round(rotationSeconds)))
        : DEFAULT_CONFIG.rotationSeconds,
      rotationMode: ROTATION_MODES.has(source.rotationMode) ? source.rotationMode : DEFAULT_CONFIG.rotationMode,
      bannerSportFilter: sports.some(group => group.enabled && group.sport === source.bannerSportFilter) ? source.bannerSportFilter : "",
      liveModeFinalMinutes: typeof source.liveModeFinalMinutes === "number" && Number.isFinite(source.liveModeFinalMinutes)
        ? Math.min(1440, Math.max(0, Math.round(source.liveModeFinalMinutes))) : DEFAULT_CONFIG.liveModeFinalMinutes,
      includedGames: normalizeGameKeys(source.includedGames),
      excludedGames: normalizeGameKeys(source.excludedGames),
      rotationOrder: normalizeGameKeys(source.rotationOrder),
      defaultGameDurations: Object.fromEntries(Object.entries(DEFAULT_CONFIG.defaultGameDurations).map(([state, fallback]) => {
        const value = source.defaultGameDurations?.[state];
        return [state, typeof value === "number" && Number.isFinite(value)
          ? Math.min(300, Math.max(5, Math.round(value / 5) * 5)) : fallback];
      })),
      gameDurations: normalizeGameDurations(source.gameDurations),
      lockedGameKeys: normalizeGameKeys(Array.isArray(source.lockedGameKeys) ? source.lockedGameKeys : [source.lockedGameKey]),
      fallbackMode: FALLBACK_MODES.has(source.fallbackMode) ? source.fallbackMode : DEFAULT_CONFIG.fallbackMode,
      displayMode: DISPLAY_MODES.has(source.displayMode) ? source.displayMode : DEFAULT_CONFIG.displayMode,
    };
  }

  function normalizeProviderRefresh(value) {
    return Object.fromEntries(SPORT_CATALOG.map(({ key: sport }) => [sport, Object.fromEntries(
      Object.entries(DEFAULT_CONFIG.providerRefreshSeconds[sport]).map(([state, fallback]) => {
        const seconds = value?.[sport]?.[state];
        return [state, Number.isInteger(seconds) && seconds >= 5 && seconds <= 3600 ? seconds : fallback];
      })
    )]));
  }

  // Keep legacy tournament keys stable; extra banners have their own identity.
  function watchId(watch) {
    return `${watch.tournamentId}:${watch.division || watch.roundId || "auto"}${watch.bannerId ? `:banner:${watch.bannerId}` : ""}`;
  }

  function bannerOptions(event) {
    return { ...(/^[a-zA-Z0-9-]{1,64}$/.test(String(event?.bannerId || "")) ? { bannerId: String(event.bannerId) } : {}),
      leaderboardSize: event?.leaderboardSize === 3 ? 3 : 10 };
  }

  function normalizePdgaEvents(events) {
    const seen = new Set();
    return (Array.isArray(events) ? events : []).flatMap(event => {
      const tournamentId = String(event?.tournamentId || "");
      const division = String(event?.division || "").toUpperCase();
      const options = bannerOptions(event);
      const key = watchId({ tournamentId, division, ...options });
      if (!/^[1-9]\d{0,8}$/.test(tournamentId) || !/^[A-Z][A-Z0-9]{1,5}$/.test(division) || seen.has(key)) return [];
      seen.add(key);
      return [{ tournamentId, division, ...options, name: String(event.name || `PDGA ${tournamentId}`).slice(0, 180),
        enabled: event.enabled !== false, view: event.view === "player" ? "player" : "leaderboard",
        playerId: /^[1-9]\d{0,8}$/.test(String(event.playerId || "")) ? String(event.playerId) : "" }];
    }).slice(0, 30);
  }

  function normalizeChessEvents(events) {
    const seen = new Set();
    return (Array.isArray(events) ? events : []).flatMap(event => {
      const tournamentId = String(event?.tournamentId || "");
      const roundId = String(event?.roundId || "");
      const options = bannerOptions(event);
      const key = watchId({ tournamentId, roundId, ...options });
      if (!/^[a-zA-Z0-9]{8}$/.test(tournamentId) || (roundId && !/^[a-zA-Z0-9]{8}$/.test(roundId)) || seen.has(key)) return [];
      seen.add(key);
      return [{ tournamentId, roundId, ...options, name: String(event.name || `Chess ${tournamentId}`).slice(0, 180),
        enabled: event.enabled !== false, view: event.view === "player" ? "player" : "overview",
        playerId: /^(fide:[1-9]\d{0,9}|name:.{1,180})$/.test(String(event.playerId || "")) ? String(event.playerId) : "" }];
    }).slice(0, 30);
  }

  function normalizeTimeZone(value) {
    if (typeof value !== "string" || value === "local") return "local";
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; }
    catch (_) { return "local"; }
  }

  function normalizeGameKeys(keys) {
    if (!Array.isArray(keys)) return [];
    const seen = new Set();
    return keys.map(value => String(value || "").trim())
      .filter(value => {
        const separator = value.indexOf(":");
        const sport = separator > 0 ? value.slice(0, separator) : "";
        if (!findSport(sport) || !value.slice(separator + 1) || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  }

  function normalizeGameDurations(durations) {
    if (!durations || typeof durations !== "object" || Array.isArray(durations)) return {};
    const normalized = {};
    Object.entries(durations).forEach(([key, value]) => {
      if (!normalizeGameKeys([key]).length) return;
      const seconds = Number(value);
      if (!Number.isFinite(seconds)) return;
      normalized[key] = Math.min(300, Math.max(5, Math.round(seconds / 5) * 5));
    });
    return normalized;
  }

  function normalizeFavorites(favorites, sport) {
    const seen = new Set();
    const normalized = [];
    if (!Array.isArray(favorites)) return normalized;
    favorites.forEach(favorite => {
      const teamKey = String(favorite?.teamKey || "").toLowerCase();
      const team = findTeam(teamKey);
      if (!team || team.sport !== sport || seen.has(teamKey)) return;
      seen.add(teamKey);
      normalized.push({ teamKey, enabled: favorite.enabled !== false });
    });
    return normalized;
  }

  function loadConfig(storage = browserStorage()) {
    if (!storage) return normalizeConfig(DEFAULT_CONFIG);
    try {
      const saved = storage.getItem(STORAGE_KEY);
      return saved ? normalizeConfig(migrateConfig(JSON.parse(saved))) : normalizeConfig(DEFAULT_CONFIG);
    } catch (error) {
      console.warn("[Sports overlay] Saved configuration could not be read; using defaults.", error);
      return normalizeConfig(DEFAULT_CONFIG);
    }
  }

  function saveConfig(config, storage = browserStorage()) {
    const normalized = normalizeConfig(config);
    if (!storage) throw new Error("Browser storage is unavailable. Serve the overlay over local HTTP.");
    storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function resetConfig(storage = browserStorage()) {
    if (storage) storage.removeItem(STORAGE_KEY);
    return normalizeConfig(DEFAULT_CONFIG);
  }

  function findSport(sportKey) {
    return findSportMetadata(sportKey);
  }

  function findTeam(teamKey) {
    return TEAM_CATALOG.find(team => team.key === String(teamKey || "").toLowerCase()) || null;
  }

  function migrateConfig(source) {
    const version = Number(source?.version || 1);
    if (version >= 5) return source;
    const favorites = Array.isArray(source?.favorites) ? [...source.favorites] : [];
    const existing = new Set(favorites.map(favorite => String(favorite?.teamKey || "").toLowerCase()));
    const additions = version < 2
      ? ["nhl:sea", "mls:9726", "nba:det", "ncaaf:158", "ncaaf:264"]
      : version < 3
        ? ["nba:det", "ncaaf:158", "ncaaf:264"]
        : version < 4
          ? ["ncaaf:158", "ncaaf:264"]
          : [];
    flattenFavorites(DEFAULT_CONFIG.sports).filter(favorite => additions.includes(favorite.teamKey)).forEach(favorite => {
      if (!existing.has(favorite.teamKey)) favorites.push(favorite);
    });
    const { favorites: _legacyFavorites, ...rest } = source || {};
    return { ...rest, version: 8, sports: groupFavorites(favorites) };
  }

  function groupFavorites(favorites) {
    const groups = [];
    const bySport = new Map();
    favorites.forEach(favorite => {
      const team = findTeam(favorite?.teamKey);
      if (!team) return;
      if (!bySport.has(team.sport)) {
        const group = { sport: team.sport, favorites: [] };
        bySport.set(team.sport, group);
        groups.push(group);
      }
      bySport.get(team.sport).favorites.push(favorite);
    });
    SPORT_CATALOG.forEach(sport => {
      if (!bySport.has(sport.key)) groups.push({ sport: sport.key, favorites: [] });
    });
    return groups;
  }

  function flattenFavorites(sports) {
    return sports.flatMap(group => group.favorites);
  }

  function enabledTeams(config) {
    return normalizeConfig(config).sports.filter(group => group.enabled).flatMap(group => group.favorites
      .filter(favorite => favorite.enabled)
      .map(favorite => findTeam(favorite.teamKey))
      .filter(Boolean));
  }

  function isWatchEnabled(watch) {
    return Boolean(watch && watch.enabled !== false && (watch.view !== "player" || watch.playerId));
  }

  // Explicit rotation selections are durable identities, even when a temporary
  // discovery shortlist changes or disappears after restarting the engine.
  function eventWatches(config, sport) {
    const group = config.sports.find(group => group.sport === sport);
    const watches = [...(group?.events || [])], seen = new Set(watches.map(watchId));
    for (const key of config.includedGames || []) {
      const match = sport === "chess" ? /^chess:([a-zA-Z0-9]{8}):auto$/.exec(key)
        : sport === "disc-golf" ? /^disc-golf:([1-9]\d{0,8}):([A-Z][A-Z0-9]{1,5})$/.exec(key) : null;
      if (!match) continue;
      const watch = sport === "chess"
        ? { tournamentId: match[1], roundId: "", view: "overview" }
        : { tournamentId: match[1], division: match[2], view: "leaderboard" };
      const id = watchId(watch);
      if (seen.has(id)) continue;
      seen.add(id);
      watches.push({ ...watch, name: `${sport === "chess" ? "Chess" : "PDGA"} ${match[1]}`, enabled: true, playerId: "", leaderboardSize: 10 });
    }
    return watches;
  }

  function isCandidateEnabled(config, candidate) {
    const group = config.sports.find(group => group.sport === candidate?.sport);
    if (!group || group.enabled === false) return false;
    if (candidate.sport === "chess") {
      const watch = eventWatches(config, "chess").find(event => watchId(event) === candidate.id);
      return watch ? isWatchEnabled(watch) : candidate.raw?.automatic === true
        && (candidate.raw.discoveryTier === "second" ? group.discoverSecondTier !== false : group.autoFollow === true);
    }
    if (candidate.sport !== "disc-golf") return true;
    const watch = eventWatches(config, "disc-golf").find(event => watchId(event) === candidate.id);
    if (watch) return isWatchEnabled(watch);
    return candidate.raw?.automatic === true
      && (candidate.raw.discoveryTier === "second" ? group.discoverSecondTier !== false : group.autoFollow === true)
      && group.autoDivisions.includes(candidate.raw.division);
  }

  function browserStorage() {
    try {
      return global.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.config = Object.freeze({
    STORAGE_KEY,
    SPORT_CATALOG,
    TEAM_CATALOG,
    ready,
    reloadTeamCatalog,
    DEFAULT_CONFIG,
    normalizeConfig,
    loadConfig,
    saveConfig,
    resetConfig,
    findSport,
    findTeam,
    enabledTeams,
    isCandidateEnabled,
    isWatchEnabled,
    eventWatches,
    watchId,
  });
})(typeof window === "undefined" ? globalThis : window);
