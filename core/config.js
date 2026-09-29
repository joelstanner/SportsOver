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
  ]);
  const CATALOG_SPORTS = Object.freeze(["baseball", "football", "college-football", "hockey", "soccer", "basketball"]);
  const TEAM_CATALOG = loadTeamCatalogSync();
  const ready = TEAM_CATALOG.length
    ? Promise.resolve(TEAM_CATALOG)
    : loadTeamCatalog().then(teams => {
      TEAM_CATALOG.push(...teams);
      return TEAM_CATALOG;
    });
  const DEFAULT_CONFIG = Object.freeze({
    version: 7,
    sports: Object.freeze([
      frozenSport("baseball", ["mlb:136"]),
      frozenSport("football", ["nfl:sea"]),
      frozenSport("college-football", ["ncaaf:158", "ncaaf:264"]),
      frozenSport("hockey", ["nhl:sea"]),
      frozenSport("soccer", ["mls:9726"]),
      frozenSport("basketball", ["nba:det"]),
    ]),
    providerRefreshSeconds: Object.freeze(Object.fromEntries(CATALOG_SPORTS.map(sport =>
      [sport, Object.freeze({ live: 12, pregame: 60, idle: 300, final: 300 })]))),
    rotationSeconds: 10,
    timeZone: "local",
    rotationMode: "automatic",
    includedGames: Object.freeze([]),
    excludedGames: Object.freeze([]),
    rotationOrder: Object.freeze([]),
    gameDurations: Object.freeze({}),
    lockedGameKeys: Object.freeze([]),
    fallbackMode: "up-next",
    displayMode: "automatic",
  });
  const FALLBACK_MODES = new Set(["up-next", "recent-final", "hide"]);
  const DISPLAY_MODES = new Set(["automatic", "rotate", "top-favorite"]);
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
      sports.push({ sport, favorites: normalizeFavorites(group.favorites, sport) });
    });
    SPORT_CATALOG.forEach(sport => {
      if (!seenSports.has(sport.key)) sports.push({ sport: sport.key, favorites: [] });
    });

    const rotationSeconds = Number(source.rotationSeconds);
    return {
      version: 7,
      timeZone: normalizeTimeZone(source.timeZone),
      providerRefreshSeconds: normalizeProviderRefresh(source.providerRefreshSeconds),
      sports,
      rotationSeconds: Number.isFinite(rotationSeconds)
        ? Math.min(300, Math.max(5, Math.round(rotationSeconds)))
        : DEFAULT_CONFIG.rotationSeconds,
      rotationMode: ROTATION_MODES.has(source.rotationMode) ? source.rotationMode : DEFAULT_CONFIG.rotationMode,
      includedGames: normalizeGameKeys(source.includedGames),
      excludedGames: normalizeGameKeys(source.excludedGames),
      rotationOrder: normalizeGameKeys(source.rotationOrder),
      gameDurations: normalizeGameDurations(source.gameDurations),
      lockedGameKeys: normalizeGameKeys(Array.isArray(source.lockedGameKeys) ? source.lockedGameKeys : [source.lockedGameKey]),
      fallbackMode: FALLBACK_MODES.has(source.fallbackMode) ? source.fallbackMode : DEFAULT_CONFIG.fallbackMode,
      displayMode: DISPLAY_MODES.has(source.displayMode) ? source.displayMode : DEFAULT_CONFIG.displayMode,
    };
  }

  function normalizeProviderRefresh(value) {
    return Object.fromEntries(CATALOG_SPORTS.map(sport => [sport, Object.fromEntries(
      Object.entries(DEFAULT_CONFIG.providerRefreshSeconds[sport]).map(([state, fallback]) => {
        const seconds = value?.[sport]?.[state];
        return [state, Number.isInteger(seconds) && seconds >= 5 && seconds <= 3600 ? seconds : fallback];
      })
    )]));
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
    return { ...rest, version: 7, sports: groupFavorites(favorites) };
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
    return normalizeConfig(config).sports.flatMap(group => group.favorites
      .filter(favorite => favorite.enabled)
      .map(favorite => findTeam(favorite.teamKey))
      .filter(Boolean));
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
  });
})(typeof window === "undefined" ? globalThis : window);
