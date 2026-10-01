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

test('invalid pointer coordinates cancel the gesture without a native move or skip', () => {
  for (const invalid of [NaN, Infinity, -Infinity, Number.MAX_VALUE, 2147483648, -2147483649, '10', null]) {
    for (const axis of ['x', 'y']) {
      const moves = [], skips = [];
      const gesture = createBannerGesture({ bounds: () => ({ x: 0, y: 0 }),
        move: (...point) => moves.push(point), next: () => skips.push(true) });
      gesture({ phase: 'start', x: 0, y: 0 });
      gesture({ phase: 'move', x: 10, y: 10, [axis]: invalid });
      gesture({ phase: 'end', x: 0, y: 0 });
      assert.deepEqual(moves, []);
      assert.deepEqual(skips, []);
      gesture({ phase: 'start', x: 0, y: 0 });
      gesture({ phase: 'end', x: 0, y: 0 });
      assert.equal(skips.length, 1);
    }
  }
});

test('derived coordinates cannot overflow the native integer range', () => {
  for (const origin of [{ x: 2147483640, y: 0 }, { x: 0, y: -2147483640 }, { x: undefined, y: 0 }]) {
    const moves = [], skips = [];
    const gesture = createBannerGesture({ bounds: () => origin, move: (...point) => moves.push(point), next: () => skips.push(true) });
    gesture({ phase: 'start', x: 0, y: 0 });
    gesture({ phase: 'move', x: 20, y: -20 });
    gesture({ phase: 'end', x: 0, y: 0 });
    assert.deepEqual(moves, []);
    assert.deepEqual(skips, []);
  }
});

test('fractional drag coordinates round to integers and canonicalize negative zero', () => {
  const moves = [];
  const gesture = createBannerGesture({ bounds: () => ({ x: -10, y: -10 }), move: (...point) => moves.push(point), next() {} });
  gesture({ phase: 'start', x: 0, y: 0 });
  gesture({ phase: 'move', x: 9.8, y: 9.6 });
  assert.deepEqual(moves, [[0, 0]]);
});

test('leftmost 20 percent goes backwards and the boundary or remainder goes forwards at every size', () => {
  for (const width of [236, 472, 708, 1416]) {
    for (const [offset, expected] of [[0, 'previous'], [width * 0.1, 'previous'], [width * 0.2 - 0.01, 'previous'], [width * 0.2, 'next'], [width * 0.8, 'next']]) {
      const calls = [], moves = [];
      const gesture = createBannerGesture({ bounds: () => ({ x: -900, y: 100, width }),
        move: (...point) => moves.push(point), next: () => calls.push('next'), previous: () => calls.push('previous') });
      gesture({ phase: 'start', x: -900 + offset, y: 110 });
      assert.deepEqual(calls, []);
      gesture({ phase: 'end', x: -900 + offset, y: 110 });
      assert.deepEqual(calls, [expected]);
      assert.deepEqual(moves, []);
    }
  }
});

test('left-side drags and cancellations never navigate', () => {
  const calls = [], moves = [];
  const gesture = createBannerGesture({ bounds: () => ({ x: 100, y: 200, width: 472 }),
    move: (...point) => moves.push(point), next: () => calls.push('next'), previous: () => calls.push('previous') });
  gesture({ phase: 'start', x: 110, y: 220 });
  gesture({ phase: 'move', x: 125, y: 230 });
  gesture({ phase: 'end', x: 110, y: 220 });
  assert.deepEqual(calls, []);
  assert.ok(moves.length > 0);
  gesture({ phase: 'start', x: 110, y: 220 });
  gesture({ phase: 'cancel' });
  gesture({ phase: 'end', x: 110, y: 220 });
  assert.deepEqual(calls, []);
});
