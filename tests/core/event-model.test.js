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

test("selected Pacific time has stable daylight/standard labels and DST boundaries", () => {
  const format = global.SportsOverlay.model.formatGameTime;
  assert.equal(format("2026-07-01T19:00:00Z", "America/Los_Angeles"), "12:00 PM PDT");
  assert.equal(format("2026-12-01T20:00:00Z", "America/Los_Angeles"), "12:00 PM PST");
  assert.equal(format("2026-03-08T09:59:00Z", "America/Los_Angeles"), "1:59 AM PST");
  assert.equal(format("2026-03-08T10:00:00Z", "America/Los_Angeles"), "3:00 AM PDT");
  assert.equal(format("2026-07-01T19:00:00Z", "Asia/Kolkata"), "12:30 AM UTC+5:30");
});

test("today is determined in the chosen zone, not the machine zone", () => {
  const format = global.SportsOverlay.model.formatPregameStart;
  const now = new Date("2026-07-02T00:15:00Z");
  assert.equal(format("2026-07-01T23:00:00Z", now, "America/Los_Angeles"), "4:00 PM PDT");
  assert.equal(format("2026-07-02T08:00:00Z", now, "America/Los_Angeles"), "Thu, Jul 2 · 1:00 AM PDT");
});
