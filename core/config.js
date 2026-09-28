"use strict";

(function initializeSportsConfig(global) {
  const STORAGE_KEY = "sports-overlay.config.v1";
  const TEAM_CATALOG = Object.freeze([
    Object.freeze({ key: "mlb:136", sport: "baseball", league: "MLB", teamId: 136, name: "Seattle Mariners", abbreviation: "SEA", provider: "mlb", providerStatus: "live" }),
    Object.freeze({ key: "nfl:sea", sport: "football", league: "NFL", teamId: "SEA", name: "Seattle Seahawks", abbreviation: "SEA", provider: "espn-nfl", providerStatus: "live" }),
    Object.freeze({ key: "nhl:sea", sport: "hockey", league: "NHL", teamId: "SEA", name: "Seattle Kraken", abbreviation: "SEA", provider: "espn-nhl", providerStatus: "live" }),
    Object.freeze({ key: "mls:9726", sport: "soccer", league: "MLS", teamId: 9726, name: "Seattle Sounders FC", abbreviation: "SEA", provider: "espn-mls", providerStatus: "live" }),
    Object.freeze({ key: "nba:det", sport: "basketball", league: "NBA", teamId: "DET", name: "Detroit Pistons", abbreviation: "DET", provider: "espn-nba", providerStatus: "live" }),
  ]);
  const DEFAULT_CONFIG = Object.freeze({
    version: 3,
    favorites: Object.freeze([
      Object.freeze({ teamKey: "mlb:136", enabled: true }),
      Object.freeze({ teamKey: "nfl:sea", enabled: true }),
      Object.freeze({ teamKey: "nhl:sea", enabled: true }),
      Object.freeze({ teamKey: "mls:9726", enabled: true }),
      Object.freeze({ teamKey: "nba:det", enabled: true }),
    ]),
    rotationSeconds: 30,
    fallbackMode: "up-next",
    displayMode: "automatic",
  });
  const FALLBACK_MODES = new Set(["up-next", "recent-final", "hide"]);
  const DISPLAY_MODES = new Set(["automatic", "rotate", "top-favorite"]);

  function normalizeConfig(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const seen = new Set();
    const favorites = [];
    const requestedFavorites = Array.isArray(source.favorites) ? source.favorites : DEFAULT_CONFIG.favorites;

    requestedFavorites.forEach(favorite => {
      const teamKey = String(favorite?.teamKey || "").toLowerCase();
      if (!findTeam(teamKey) || seen.has(teamKey)) return;
      seen.add(teamKey);
      favorites.push({ teamKey, enabled: favorite.enabled !== false });
    });

    const rotationSeconds = Number(source.rotationSeconds);
    return {
      version: 3,
      favorites,
      rotationSeconds: Number.isFinite(rotationSeconds)
        ? Math.min(300, Math.max(10, Math.round(rotationSeconds)))
        : DEFAULT_CONFIG.rotationSeconds,
      fallbackMode: FALLBACK_MODES.has(source.fallbackMode) ? source.fallbackMode : DEFAULT_CONFIG.fallbackMode,
      displayMode: DISPLAY_MODES.has(source.displayMode) ? source.displayMode : DEFAULT_CONFIG.displayMode,
    };
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

  function findTeam(teamKey) {
    return TEAM_CATALOG.find(team => team.key === String(teamKey || "").toLowerCase()) || null;
  }

  function migrateConfig(source) {
    const version = Number(source?.version || 1);
    if (version >= 3) return source;
    const favorites = Array.isArray(source?.favorites) ? [...source.favorites] : [];
    const existing = new Set(favorites.map(favorite => String(favorite?.teamKey || "").toLowerCase()));
    const additions = version < 2 ? ["nhl:sea", "mls:9726", "nba:det"] : ["nba:det"];
    DEFAULT_CONFIG.favorites.filter(favorite => additions.includes(favorite.teamKey)).forEach(favorite => {
      if (!existing.has(favorite.teamKey)) favorites.push(favorite);
    });
    return { ...source, version: 3, favorites };
  }

  function enabledTeams(config) {
    return normalizeConfig(config).favorites
      .filter(favorite => favorite.enabled)
      .map(favorite => findTeam(favorite.teamKey))
      .filter(Boolean);
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
    TEAM_CATALOG,
    DEFAULT_CONFIG,
    normalizeConfig,
    loadConfig,
    saveConfig,
    resetConfig,
    findTeam,
    enabledTeams,
  });
})(typeof window === "undefined" ? globalThis : window);
