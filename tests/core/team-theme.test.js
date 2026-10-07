"use strict";
require('../../scripts/offline-network.cjs');

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../core/config.js");
require("../../core/team-theme.js");

function fakeElement() {
  const properties = new Map();
  return {
    dataset: {},
    style: { setProperty: (name, value) => properties.set(name, value) },
    properties,
  };
}

test("applies the selected team's catalog colors to banner variables", () => {
  const element = fakeElement();
  const theme = global.SportsOverlay.teamTheme.apply(element, {
    sport: "football",
    teams: {
      away: { id: "DET", abbreviation: "DET", featured: false },
      home: { id: "SEA", abbreviation: "SEA", featured: true },
    },
  });

  assert.deepEqual(theme, { primary: "#002244", accent: "#69be28" });
  assert.equal(element.dataset.featuredTeam, "SEA");
  assert.equal(element.properties.get("--team-accent-rgb"), "105, 190, 40");
  assert.match(element.properties.get("--team-primary-deep"), /^#[0-9a-f]{6}$/);
  assert.match(element.properties.get("--team-accent-text"), /^#[0-9a-f]{6}$/);
});

test("keeps college teams distinct even when they share a layout", () => {
  const theme = global.SportsOverlay.teamTheme.resolve("college-football", {
    id: "264",
    abbreviation: "WASH",
  });
  assert.deepEqual(theme, { primary: "#4b2e83", accent: "#b7a57a" });
});
