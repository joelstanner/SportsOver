"use strict";

(function initializeSportsConfig(global) {
  const STORAGE_KEY = "sports-overlay.config.v1";
  const SPORT_CATALOG = Object.freeze([
    Object.freeze({ key: "baseball", name: "Baseball", league: "MLB" }),
    Object.freeze({ key: "football", name: "Football", league: "NFL" }),
    Object.freeze({ key: "college-football", name: "College football", league: "NCAAF" }),
    Object.freeze({ key: "hockey", name: "Hockey", league: "NHL" }),
    Object.freeze({ key: "soccer", name: "Soccer", league: "MLS" }),
    Object.freeze({ key: "basketball", name: "Basketball", league: "NBA" }),
  ]);
  const TEAM_CATALOG = Object.freeze([
    Object.freeze({ key: "mlb:136", sport: "baseball", league: "MLB", teamId: 136, name: "Seattle Mariners", abbreviation: "SEA", provider: "mlb", providerStatus: "live" }),
    Object.freeze({ key: "nfl:sea", sport: "football", league: "NFL", teamId: "SEA", name: "Seattle Seahawks", abbreviation: "SEA", provider: "espn-nfl", providerStatus: "live" }),
    Object.freeze({ key: "ncaaf:158", sport: "college-football", league: "NCAAF", teamId: "158", name: "Nebraska Cornhuskers", abbreviation: "NEB", logoUrl: "https://a.espncdn.com/i/teamlogos/ncaa/500/158.png", provider: "espn-ncaaf", providerStatus: "live" }),
    Object.freeze({ key: "ncaaf:264", sport: "college-football", league: "NCAAF", teamId: "264", name: "Washington Huskies", abbreviation: "WASH", logoUrl: "https://a.espncdn.com/i/teamlogos/ncaa/500/264.png", provider: "espn-ncaaf", providerStatus: "live" }),
    Object.freeze({ key: "nhl:sea", sport: "hockey", league: "NHL", teamId: "SEA", name: "Seattle Kraken", abbreviation: "SEA", provider: "espn-nhl", providerStatus: "live" }),
    Object.freeze({ key: "mls:9726", sport: "soccer", league: "MLS", teamId: 9726, name: "Seattle Sounders FC", abbreviation: "SEA", provider: "espn-mls", providerStatus: "live" }),
    Object.freeze({ key: "nba:det", sport: "basketball", league: "NBA", teamId: "DET", name: "Detroit Pistons", abbreviation: "DET", provider: "espn-nba", providerStatus: "live" }),
  ]);
  const DEFAULT_CONFIG = Object.freeze({
    version: 5,
    sports: Object.freeze([
      frozenSport("baseball", ["mlb:136"]),
      frozenSport("football", ["nfl:sea"]),
      frozenSport("college-football", ["ncaaf:158", "ncaaf:264"]),
      frozenSport("hockey", ["nhl:sea"]),
      frozenSport("soccer", ["mls:9726"]),
      frozenSport("basketball", ["nba:det"]),
    ]),
    rotationSeconds: 30,
    fallbackMode: "up-next",
    displayMode: "automatic",
  });
  const FALLBACK_MODES = new Set(["up-next", "recent-final", "hide"]);
  const DISPLAY_MODES = new Set(["automatic", "rotate", "top-favorite"]);

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
      version: 5,
      sports,
      rotationSeconds: Number.isFinite(rotationSeconds)
        ? Math.min(300, Math.max(10, Math.round(rotationSeconds)))
        : DEFAULT_CONFIG.rotationSeconds,
      fallbackMode: FALLBACK_MODES.has(source.fallbackMode) ? source.fallbackMode : DEFAULT_CONFIG.fallbackMode,
      displayMode: DISPLAY_MODES.has(source.displayMode) ? source.displayMode : DEFAULT_CONFIG.displayMode,
    };
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
    return SPORT_CATALOG.find(sport => sport.key === String(sportKey || "").toLowerCase()) || null;
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
    return { ...rest, version: 5, sports: groupFavorites(favorites) };
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
