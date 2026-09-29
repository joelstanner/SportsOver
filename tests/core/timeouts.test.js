"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = globalThis;
require("../../core/timeouts.js");

const timeouts = global.SportsOverlay.timeouts;

test("uses explicit remaining timeouts before deriving them from used timeouts", () => {
  assert.equal(timeouts.remaining({ timeoutsRemaining: 2, timeoutsUsed: 2 }, 3), 2);
  assert.equal(timeouts.remaining({ timeoutsUsed: 1 }, 3), 2);
});

test("clamps timeout counts and preserves unavailable data", () => {
  assert.equal(timeouts.remaining({ timeoutsUsed: 9 }, 3), 0);
  assert.equal(timeouts.remaining({ timeoutsRemaining: 12 }, 7), 7);
  assert.equal(timeouts.remaining({}, 3), null);
});
