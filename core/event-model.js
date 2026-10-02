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
      competitionType: input.competitionType || "team",
      teams: input.teams,
      competitors: input.competitors,
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
    if (event.competitionType === "individual") {
      if (!Array.isArray(event.competitors)) throw new TypeError("Individual event requires a competitor list.");
    } else if (!event.teams?.away || !event.teams?.home) {
      throw new TypeError("Sports event requires away and home competitors.");
    }
    return event;
  }

  // Read game-level metadata only; league metadata may describe a different season.
  function espnPreseason(payload, numericType = true) {
    const season = payload.header?.season ?? payload.season
      ?? payload.header?.competitions?.[0]?.season ?? payload.competitions?.[0]?.season;
    const type = season?.type ?? payload.header?.seasonType ?? payload.seasonType
      ?? payload.header?.competitions?.[0]?.seasonType ?? payload.competitions?.[0]?.seasonType;
    const name = typeof type === "object" ? type?.name : "";
    const slug = season?.slug || name || season?.name || "";
    if (/^pre[ -]?season$/i.test(slug)) return true;
    return numericType && Number(typeof type === "object" ? type?.id ?? type?.type : type) === 1;
  }

  // ESPN summaries and scoreboards embed both closing and explicitly live markets.
  function espnOdds(payload = {}) {
    const competition = payload.header?.competitions?.[0] ?? payload.competitions?.[0] ?? payload;
    const sources = [payload.pickcenter, payload.odds, competition.odds]
      .map(items => Array.isArray(items) ? items.filter(item => item && typeof item === "object" && !Array.isArray(item)) : [])
      .find(items => items.length) ?? [];
    const source = sources.find(item => item.provider?.priority === 1) ?? sources[0];
    if (!source) return null;
    const number = value => (typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value);
    const market = (name, field, legacy) => {
      const result = { pregame: {}, live: {} };
      for (const side of ["away", "home", "draw"]) {
        const structured = source[name]?.[side];
        result.live[side] = number(structured?.live?.[field]);
        result.pregame[side] = number(structured?.close?.[field] ?? source[`${side}TeamOdds`]?.[legacy]
          ?? (side === "draw" && name === "moneyline" ? source.drawOdds?.moneyLine : null));
      }
      return result;
    };
    const spread = market("pointSpread", "line", "spread");
    const spreadPrices = market("pointSpread", "odds", "spreadOdds");
    if (Object.values(spreadPrices.pregame).concat(Object.values(spreadPrices.live)).some(value => value !== null)) {
      spread.prices = spreadPrices;
    }
    // Legacy spread signs are inconsistent across sports. Only use a named team line.
    if (spread.pregame.away === null && spread.pregame.home === null) {
      const match = String(source.details || "").match(/^(.+?)\s+([+-]\d+(?:\.\d+)?)$/);
      if (match && number(source.spread) !== null && Math.abs(Number(match[2])) === Math.abs(Number(source.spread))) {
        for (const side of ["away", "home"]) {
          const team = competition.competitors?.find(item => item.homeAway === side)?.team;
          if (team && [team.abbreviation, team.displayName, team.shortDisplayName].includes(match[1])) {
            spread.pregame[side] = Number(match[2]);
            spread.pregame[side === "away" ? "home" : "away"] = -Number(match[2]);
          }
        }
      }
    }
    const moneyline = market("moneyline", "odds", "moneyLine");
    return [spread, moneyline].some(item => Object.values(item.pregame).concat(Object.values(item.live)).some(value => value !== null))
      ? { spread, moneyline } : null;
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

  function formatFinalStatus(isoDate, label = "FINAL", now = new Date(), timeZone = selectedTimeZone()) {
    const date = new Date(isoDate || "invalid");
    if (Number.isNaN(date.getTime())) return label;
    // Compare calendar days in the display zone, including 23/25-hour DST days.
    const calendar = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" });
    const dayNumber = value => {
      const parts = Object.fromEntries(calendar.formatToParts(value).map(part => [part.type, part.value]));
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86400000;
    };
    const age = dayNumber(now) - dayNumber(date);
    if (age <= 0) return label;
    const day = age === 1 ? "YESTERDAY" : new Intl.DateTimeFormat("en-US", {
      timeZone, month: "short", day: "numeric",
      ...(calendar.formatToParts(date).find(part => part.type === "year").value
        !== calendar.formatToParts(now).find(part => part.type === "year").value ? { year: "numeric" } : {}),
    }).format(date).toUpperCase();
    return `${label} · ${day}`;
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.model = Object.freeze({ EVENT_STATES, createEvent, validateEvent, espnPreseason, espnOdds, formatPregameStart, formatGameTime, formatFinalStatus });
})(typeof window === "undefined" ? globalThis : window);
