"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("unchanged live polling does not restart an active scroll", () => {
  global.SportsOverlay = {};
  global.requestAnimationFrame = callback => callback();
  delete require.cache[require.resolve("../../core/scrolling.js")];
  require("../../core/scrolling.js");

  const classes = new Set();
  let removals = 0;
  const styles = {};
  const textElement = {
    style: { setProperty(name, value) { styles[name] = value; } },
    textContent: "",
    scrollWidth: 180,
    dataset: {},
    classList: {
      remove(name) { removals += 1; classes.delete(name); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
    },
  };
  const viewport = { clientWidth: 100 };

  global.SportsOverlay.scrolling.render(viewport, textElement, "Long unchanged play description");
  global.SportsOverlay.scrolling.render(viewport, textElement, "Long unchanged play description");

  assert.equal(removals, 1);
  assert.equal(classes.has("is-scrolling"), true);
  assert.equal(styles["--scroll-duration"], "20s");
  global.SportsOverlay.scrolling.render(viewport, textElement, "x".repeat(140));
  assert.equal(styles["--scroll-duration"], "40s");
  textElement.scrollWidth = 40;
  global.SportsOverlay.scrolling.render(viewport, textElement, "Short play");
  assert.equal(classes.has("is-scrolling"), false);
  delete global.requestAnimationFrame;
});
