"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../core/event-model.js");

test("shared pregame formatter includes the date unless the game is today", () => {
  const now = new Date("2026-10-24T19:00:00Z");
  const today = "2026-10-25T00:15:00Z";
  const nextWeek = "2026-11-01T00:15:00Z";
  const zone = "America/Los_Angeles";
  const format = global.SportsOverlay.model.formatPregameStart;

  assert.equal(format(today, now, zone), "5:15 PM PDT");
  assert.equal(format(nextWeek, now, zone), "Sat, Oct 31 · 5:15 PM PDT");
  assert.equal(format("invalid", now, zone), "");
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

test("finals identify yesterday in the selected zone and date older games", () => {
  const format = global.SportsOverlay.model.formatFinalStatus;
  const now = new Date("2026-10-01T08:00:00Z");
  const zone = "America/Los_Angeles";
  assert.equal(format("2026-10-01T02:00:00Z", "FINAL", now, zone), "FINAL · YESTERDAY");
  assert.equal(format("2026-10-01T07:30:00Z", "FINAL", now, zone), "FINAL");
  assert.equal(format("2026-10-01T02:00:00Z", "FINAL", now, "UTC"), "FINAL");
  assert.equal(format("2026-09-29T02:00:00Z", "FINAL", now, zone), "FINAL · SEP 28");
  assert.equal(format("2025-09-29T02:00:00Z", "FINAL", now, zone), "FINAL · SEP 28, 2025");
  assert.equal(format("2026-10-01T02:00:00Z", "FINAL / OT", now, zone), "FINAL / OT · YESTERDAY");
  for (const date of [null, undefined, "invalid"]) assert.equal(format(date, "FULL TIME", now, zone), "FULL TIME");
});

test("yesterday follows calendar boundaries across DST and the new year", () => {
  const format = global.SportsOverlay.model.formatFinalStatus;
  for (const [start, now] of [
    ["2026-03-08T08:30:00Z", "2026-03-09T07:15:00Z"],
    ["2026-11-01T07:30:00Z", "2026-11-02T08:15:00Z"],
    ["2026-12-31T20:00:00Z", "2027-01-01T09:00:00Z"],
  ]) {
    assert.equal(format(start, "FINAL", new Date(now), "America/Los_Angeles"), "FINAL · YESTERDAY");
  }
});
