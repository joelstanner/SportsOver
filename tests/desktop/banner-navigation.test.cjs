const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browseFeedback } = require('../../desktop/banner-navigation.cjs');
const ready = { ready: true, discoveryComplete: true, discoveryPending: false, queue: [], currentGameKey: 'baseball:1' };
test('startup and partial discovery explain why browsing is unavailable', () => {
  assert.match(browseFeedback({}), /loading/);
  assert.match(browseFeedback({ ...ready, discoveryPending: true }), /loading/);
  assert.match(browseFeedback({ ...ready, queue: [{}], loadingSports: ['hockey'] }), /loading/);
});
test('single pinned game explains how to restore browsing', () => {
  assert.match(browseFeedback({ ...ready, queue: [{}] }, ['baseball:1']), /Only one game pinned/);
  assert.match(browseFeedback({ ...ready, queue: [{}] }), /Only one game in rotation/);
  assert.match(browseFeedback(ready), /No games/);
});
test('available rotation remains browsable while other sports load', () => {
  assert.equal(browseFeedback({ ...ready, queue: [{}, {}], discoveryPending: true }), '');
  assert.match(browseFeedback({ ...ready, queue: [{}, {}], overrideGameKey: 'baseball:1' }), /override/);
});
