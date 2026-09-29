"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../core/event-model.js");

test("shared non-baseball pregame formatter includes the date unless the game is today", () => {
  const now = new Date(2026, 9, 24, 12, 0);
  const today = new Date(2026, 9, 24, 17, 15);
  const nextWeek = new Date(2026, 9, 31, 17, 15);
  const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const date = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(nextWeek);
  const format = global.SportsOverlay.model.formatPregameStart;

  assert.equal(format(today.toISOString(), now), timeFormatter.format(today));
  assert.equal(format(nextWeek.toISOString(), now), `${date} · ${timeFormatter.format(nextWeek)}`);
  assert.equal(format("invalid", now), "");
});
