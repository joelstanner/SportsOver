const test = require('node:test');
const assert = require('node:assert/strict');
const { createBannerGesture } = require('../../desktop/banner-gesture.cjs');

function fixture() {
  const moves = [], skips = [];
  const gesture = createBannerGesture({ bounds: () => ({ x: -100, y: 200 }),
    move: (...point) => moves.push(point), next: () => skips.push(true) });
  return { moves, skips, send: (phase, x = 20, y = 30) => gesture({ phase, x, y }) };
}
test('click tolerates slight motion and advances only on release', () => {
  const f = fixture();
  f.send('start'); f.send('move', 23, 32);
  assert.equal(f.skips.length, 0);
  f.send('end', 23, 32);
  assert.equal(f.skips.length, 1);
  assert.deepEqual(f.moves, []);
});
test('drag uses screen deltas and never skips even after returning to its origin', () => {
  const f = fixture();
  f.send('start'); f.send('move', 40, 60);
  assert.deepEqual(f.moves, [[-80, 230]]);
  f.send('move'); f.send('end');
  assert.deepEqual(f.moves.at(-1), [-100, 200]);
  assert.equal(f.skips.length, 0);
});
test('release beyond threshold counts as a drag even without a move event', () => {
  const f = fixture(); f.send('start'); f.send('end', 50, 30);
  assert.equal(f.skips.length, 0);
  assert.deepEqual(f.moves, [[-70, 200]]);
});
test('cancellation prevents advancement and a new gesture still works', () => {
  const f = fixture(); f.send('start'); f.send('cancel'); f.send('end');
  assert.equal(f.skips.length, 0);
  f.send('start'); f.send('end');
  assert.equal(f.skips.length, 1);
});
