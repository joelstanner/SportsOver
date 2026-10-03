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

test('vertical leaderboard keeps elapsed time on refresh and resets for a different banner', () => {
  require('../../core/config.js');
  require('../../core/game-selection.js');
  const styles = {}, track = {children:Array(10),style:{setProperty(k,v){styles[k]=v;}},classList:{add(){}}};
  const viewport = {firstElementChild:track,setAttribute(){}};
  const event = {sport:'chess',id:'Tour1234:auto',state:'live'};
  const scrolling = global.SportsOverlay.scrolling;
  const state = scrolling.vertical(viewport,event,null);
  state.started -= 5000;
  assert.equal(scrolling.vertical(viewport,event,state),state);
  assert.ok(parseFloat(styles['--vertical-delay']) <= -5);
  assert.equal(styles['--vertical-distance'],'-105px');
  assert.equal(styles['--vertical-duration'],'20s');
  assert.notEqual(scrolling.vertical(viewport,{...event,id:'Other123:auto'},state),state);
  viewport.dataset = {scrollKey:'matchups:Round006',scrollLabel:'10 round matchups. Scroll to see all boards.'};
  let label;
  viewport.setAttribute = (name, value) => { if (name === 'aria-label') label = value; };
  const matchups = scrolling.vertical(viewport,event,state);
  assert.notEqual(matchups,state,'switching from standings resets the scroll');
  assert.equal(label,viewport.dataset.scrollLabel);
  assert.equal(scrolling.vertical(viewport,event,matchups),matchups);
  viewport.dataset.scrollKey = 'matchups:Round007';
  assert.notEqual(scrolling.vertical(viewport,event,matchups),matchups,'a new round starts at its first board');
  track.children=Array(3);
  assert.equal(scrolling.vertical(viewport,event,state),null);
});
