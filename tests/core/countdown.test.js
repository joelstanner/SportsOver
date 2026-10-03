"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("countdown ticks from wall time, enters the final hour, and stops updating cleared bindings", () => {
  let now = Date.parse("2026-10-03T19:00:00Z"), tick;
  const elements = [];
  const context = vm.createContext({
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }, Intl,
    document: {
      querySelectorAll: () => elements.filter(element => element.dataset.pregameStart),
      createElement() {
        const element = { dataset: {}, textContent: "", hasAttribute: () => false };
        elements.push(element);
        return element;
      },
    },
    setInterval(fn, ms) { assert.equal(ms, 1000); tick = fn; },
  });
  for (const file of ["event-model.js", "countdown.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../core", file), "utf8"), context);
  }
  const api = context.SportsOverlay.countdown;
  const element = { dataset: {}, textContent: "", title: "", hasAttribute: () => true };
  elements.push(element);
  const start = new Date(now + 3_600_000).toISOString();
  api.render(element, start, { prefix: "Upcoming · ", suffix: " · Favorite", timeZone: "UTC" });
  assert.equal(element.textContent, "Upcoming · 8:00 PM UTC · Favorite");
  now += 1000; tick();
  assert.equal(element.textContent, "Upcoming · Starts in 59:59 · Favorite");
  now += 15_000; tick(); // A delayed tick must catch up without accumulating drift.
  assert.equal(element.textContent, "Upcoming · Starts in 59:44 · Favorite");
  assert.equal(element.title, element.textContent);
  now += 3_584_000; tick();
  assert.equal(element.textContent, "Upcoming · Starting soon · Favorite");
  api.clear(element);
  element.textContent = "FINAL";
  tick();
  assert.equal(element.textContent, "FINAL");
  api.render(element, "invalid");
  tick();
  assert.equal(element.textContent, "FINAL");

  now -= 65_000;
  const card = {
    textContent: "Upcoming · 8:00 PM UTC · Automatic",
    replaceChildren(...children) {
      Object.defineProperty(this, "textContent", { get: () => children.map(child =>
        typeof child === "string" ? child : child.textContent).join("") });
    },
  };
  api.replace(card, start, "UTC");
  assert.equal(card.textContent, "Upcoming · Starts in 1:05 · Automatic");
  now += 1000; tick();
  assert.equal(card.textContent, "Upcoming · Starts in 1:04 · Automatic");
});
