"use strict";

(function initializeTeamTheme(global) {
  const FALLBACK = Object.freeze({ primary: "#071b2c", accent: "#31556f" });

  function apply(element, event) {
    if (!element || !event?.teams) return FALLBACK;
    const featured = event.teams.away?.featured
      ? event.teams.away
      : event.teams.home?.featured
        ? event.teams.home
        : event.teams.home || event.teams.away;
    const theme = resolve(event.sport, featured);
    const primary = normalizeHex(theme.primary) || FALLBACK.primary;
    const accent = normalizeHex(theme.accent) || FALLBACK.accent;

    element.style.setProperty("--team-primary-deep", mix(primary, "#06111f", 0.46));
    element.style.setProperty("--team-accent-deep", mix(accent, "#080f17", 0.46));
    element.style.setProperty("--team-accent-rgb", hexToRgb(accent).join(", "));
    element.style.setProperty("--team-accent-text", mix(accent, "#ffffff", 0.58));
    element.dataset.featuredTeam = featured?.abbreviation || "";
    return Object.freeze({ primary, accent });
  }

  function resolve(sport, team = {}) {
    const direct = team.theme || (team.color ? { primary: team.color, accent: team.alternateColor || team.color } : null);
    if (direct) return direct;
    const normalizedSport = String(sport || "").toLowerCase();
    const values = [team.id, team.abbreviation, team.name].map(value => String(value || "").toUpperCase());
    return global.SportsOverlay.config?.TEAM_CATALOG.find(candidate =>
      candidate.sport === normalizedSport
      && [candidate.teamId, candidate.abbreviation, candidate.name]
        .some(value => values.includes(String(value || "").toUpperCase()))
    )?.theme || FALLBACK;
  }

  function normalizeHex(value) {
    const match = String(value || "").trim().match(/^#?([0-9a-f]{6})$/i);
    return match ? `#${match[1].toLowerCase()}` : "";
  }

  function hexToRgb(hex) {
    const value = normalizeHex(hex).slice(1);
    return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
  }

  function mix(foreground, background, foregroundWeight) {
    const front = hexToRgb(foreground);
    const back = hexToRgb(background);
    const weight = Math.min(1, Math.max(0, Number(foregroundWeight)));
    return `#${front.map((channel, index) => Math.round(channel * weight + back[index] * (1 - weight))
      .toString(16).padStart(2, "0")).join("")}`;
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.teamTheme = Object.freeze({ apply, resolve, normalizeHex, mix });
})(typeof window === "undefined" ? globalThis : window);
