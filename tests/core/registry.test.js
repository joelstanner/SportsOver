"use strict";
require('../../scripts/offline-network.cjs');

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../core/registry.js");

test("registers and resolves providers and layouts case-insensitively", () => {
  const provider = { name: "NFL fixture provider" };
  const layout = { name: "Football layout" };
  global.SportsOverlay.registry.registerProvider("NFL", provider);
  global.SportsOverlay.registry.registerLayout("Football", layout);

  assert.equal(global.SportsOverlay.registry.getProvider("nfl"), provider);
  assert.equal(global.SportsOverlay.registry.getLayout("football"), layout);
});

test("registers, lists, and creates isolated demos", () => {
  global.SportsOverlay.registry.registerDemo("football", "live", () => ({ state: "live" }));

  assert.deepEqual(global.SportsOverlay.registry.listDemos("FOOTBALL"), ["live"]);
  assert.deepEqual(global.SportsOverlay.registry.getDemo("football", "live"), { state: "live" });
  assert.equal(global.SportsOverlay.registry.getDemo("football", "missing"), null);
});

test("reports missing providers and layouts", () => {
  assert.throws(() => global.SportsOverlay.registry.getProvider("missing"), /No provider registered/);
  assert.throws(() => global.SportsOverlay.registry.getLayout("missing"), /No layout registered/);
});
