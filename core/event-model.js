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

  function formatPregameStart(isoDate, now = new Date()) {
    if (!isoDate) return "";
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "";
    const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
    const isToday = date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
    if (isToday) return time;
    const day = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
    return `${day} · ${time}`;
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.model = Object.freeze({ EVENT_STATES, createEvent, validateEvent, formatPregameStart });
})(typeof window === "undefined" ? globalThis : window);
