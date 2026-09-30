"use strict";

(function initializeSportsModel(global) {
  const EVENT_STATES = Object.freeze({
    PREGAME: "pregame",
    LIVE: "live",
    INTERRUPTED: "interrupted",
    FINAL: "final",
  });

  function createEvent(input) {
    const event = {
      id: String(input.id || ""),
      sport: String(input.sport || ""),
      league: String(input.league || ""),
      state: input.state,
      detailedState: String(input.detailedState || ""),
      startTime: input.startTime || null,
      teams: input.teams,
      details: input.details || {},
    };

    validateEvent(event);
    return event;
  }

  function validateEvent(event) {
    if (!event.id) throw new TypeError("Sports event requires an id.");
    if (!event.sport) throw new TypeError("Sports event requires a sport.");
    if (!event.league) throw new TypeError("Sports event requires a league.");
    if (!Object.values(EVENT_STATES).includes(event.state)) {
      throw new TypeError(`Unsupported sports event state: ${event.state}`);
    }
    if (!event.teams?.away || !event.teams?.home) {
      throw new TypeError("Sports event requires away and home competitors.");
    }
    return event;
  }

  // Read game-level metadata only; league metadata may describe a different season.
  function espnPreseason(payload, numericType = true) {
    const season = payload.header?.season ?? payload.season
      ?? payload.header?.competitions?.[0]?.season ?? payload.competitions?.[0]?.season;
    const type = season?.type;
    const name = typeof type === "object" ? type?.name : "";
    const slug = season?.slug || name || season?.name || "";
    if (/^pre[ -]?season$/i.test(slug)) return true;
    return numericType && Number(typeof type === "object" ? type?.id ?? type?.type : type) === 1;
  }

  function selectedTimeZone() {
    const configured = global.SportsOverlay?.config?.loadConfig()?.timeZone;
    return !configured || configured === "local"
      ? new Intl.DateTimeFormat().resolvedOptions().timeZone : configured;
  }

  function formatGameTime(isoDate, timeZone = selectedTimeZone()) {
    const date = new Date(isoDate || "invalid");
    if (Number.isNaN(date.getTime())) return "";
    const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
    const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(date).find(part => part.type === "timeZoneName").value;
    // Explicit US labels avoid OBS/Chrome differences in ICU abbreviation data.
    const usLabels = {
      "America/Los_Angeles": { "GMT-8": "PST", "GMT-7": "PDT" },
      "America/Denver": { "GMT-7": "MST", "GMT-6": "MDT" },
      "America/Phoenix": { "GMT-7": "MST" },
      "America/Chicago": { "GMT-6": "CST", "GMT-5": "CDT" },
      "America/New_York": { "GMT-5": "EST", "GMT-4": "EDT" },
      "America/Anchorage": { "GMT-9": "AKST", "GMT-8": "AKDT" },
      "Pacific/Honolulu": { "GMT-10": "HST" },
    };
    const label = usLabels[timeZone]?.[offset] || offset.replace("GMT", "UTC");
    return `${time} ${label}`;
  }

  function formatPregameStart(isoDate, now = new Date(), timeZone = selectedTimeZone()) {
    const date = new Date(isoDate || "invalid");
    if (Number.isNaN(date.getTime())) return "";
    const time = formatGameTime(isoDate, timeZone);
    const dayKey = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    if (dayKey.format(date) === dayKey.format(now)) return time;
    const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(date);
    return `${day} · ${time}`;
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.model = Object.freeze({ EVENT_STATES, createEvent, validateEvent, espnPreseason, formatPregameStart, formatGameTime });
})(typeof window === "undefined" ? globalThis : window);
