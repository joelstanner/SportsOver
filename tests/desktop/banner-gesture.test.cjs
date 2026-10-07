require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBannerGesture } = require('../../desktop/banner-gesture.cjs');

function createTestGesture(options) {
  let time = 0, timerId = 0;
  const timers = new Map();
  const gesture = createBannerGesture({ ...options,
    now: () => time,
    setTimer(fn, delay) { timers.set(++timerId, { fn, at: time + delay }); return timerId; },
    clearTimer(id) { timers.delete(id); },
  });
  gesture.advance = ms => {
    const end = time + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = end;
  };
  return gesture;
}

function fixture() {
  const moves = [], skips = [];
  const gesture = createTestGesture({ bounds: () => ({ x: -100, y: 200 }),
    move: (x, y) => moves.push([x, y]), next: () => skips.push(true) });
  return { moves, skips, advance: gesture.advance, send: (phase, x = 20, y = 30) => gesture({ phase, x, y }) };
}
test('click tolerates slight motion and waits after release to distinguish a double-click', () => {
  const f = fixture();
  f.send('start'); f.send('move', 23, 32);
  assert.equal(f.skips.length, 0);
  f.send('end', 23, 32);
  f.advance(399);
  assert.equal(f.skips.length, 0);
  f.advance(1);
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
test('drag keeps the press-time bounds for every native move', () => {
  const origin = { x: 100, y: 200, width: 472, height: 100 };
  const moves = [];
  const gesture = createTestGesture({ bounds: () => origin,
    move: (x, y, bounds) => moves.push({ x, y, bounds }), next() {} });
  gesture({ phase: 'start', x: 120, y: 220 });
  gesture({ phase: 'move', x: 140, y: 230 });
  gesture({ phase: 'move', x: 150, y: 240 });
  assert.deepEqual(moves, [
    { x: 120, y: 210, bounds: origin },
    { x: 130, y: 220, bounds: origin },
  ]);
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
  f.advance(400);
  assert.equal(f.skips.length, 1);
});

test('invalid pointer coordinates cancel the gesture without a native move or skip', () => {
  for (const invalid of [NaN, Infinity, -Infinity, Number.MAX_VALUE, 2147483648, -2147483649, '10', null]) {
    for (const axis of ['x', 'y']) {
      const moves = [], skips = [];
      const gesture = createTestGesture({ bounds: () => ({ x: 0, y: 0 }),
        move: (x, y) => moves.push([x, y]), next: () => skips.push(true) });
      gesture({ phase: 'start', x: 0, y: 0 });
      gesture({ phase: 'move', x: 10, y: 10, [axis]: invalid });
      gesture({ phase: 'end', x: 0, y: 0 });
      assert.deepEqual(moves, []);
      assert.deepEqual(skips, []);
      gesture({ phase: 'start', x: 0, y: 0 });
      gesture({ phase: 'end', x: 0, y: 0 });
      gesture.advance(400);
      assert.equal(skips.length, 1);
    }
  }
});

test('derived coordinates cannot overflow the native integer range', () => {
  for (const origin of [{ x: 2147483640, y: 0 }, { x: 0, y: -2147483640 }, { x: undefined, y: 0 }]) {
    const moves = [], skips = [];
    const gesture = createTestGesture({ bounds: () => origin, move: (x, y) => moves.push([x, y]), next: () => skips.push(true) });
    gesture({ phase: 'start', x: 0, y: 0 });
    gesture({ phase: 'move', x: 20, y: -20 });
    gesture({ phase: 'end', x: 0, y: 0 });
    assert.deepEqual(moves, []);
    assert.deepEqual(skips, []);
  }
});

test('fractional drag coordinates round to integers and canonicalize negative zero', () => {
  const moves = [];
  const gesture = createTestGesture({ bounds: () => ({ x: -10, y: -10 }), move: (x, y) => moves.push([x, y]), next() {} });
  gesture({ phase: 'start', x: 0, y: 0 });
  gesture({ phase: 'move', x: 9.8, y: 9.6 });
  assert.deepEqual(moves, [[0, 0]]);
});

test('leftmost 20 percent goes backwards and the boundary or remainder goes forwards at every size', () => {
  for (const width of [236, 472, 708, 1416]) {
    for (const [offset, expected] of [[0, 'previous'], [width * 0.1, 'previous'], [width * 0.2 - 0.01, 'previous'], [width * 0.2, 'next'], [width * 0.8, 'next']]) {
      const calls = [], moves = [];
      const gesture = createTestGesture({ bounds: () => ({ x: -900, y: 100, width }),
        move: (x, y) => moves.push([x, y]), next: () => calls.push('next'), previous: () => calls.push('previous') });
      gesture({ phase: 'start', x: -900 + offset, y: 110 });
      assert.deepEqual(calls, []);
      gesture({ phase: 'end', x: -900 + offset, y: 110 });
      gesture.advance(400);
      assert.deepEqual(calls, [expected]);
      assert.deepEqual(moves, []);
    }
  }
});

test('left-side drags and cancellations never navigate', () => {
  const calls = [], moves = [];
  const gesture = createTestGesture({ bounds: () => ({ x: 100, y: 200, width: 472 }),
    move: (x, y) => moves.push([x, y]), next: () => calls.push('next'), previous: () => calls.push('previous') });
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

function resizingFixture(width = 472, options = {}) {
  const calls = [], moves = [];
  const gesture = createTestGesture({ bounds: () => ({ x: -900, y: 100, width }),
    move: (x, y) => moves.push([x, y]), next: () => calls.push('next'), previous: () => calls.push('previous'),
    resize: direction => calls.push(direction > 0 ? 'bigger' : 'smaller'), ...options });
  const send = (phase, offset, y = 110) => gesture({ phase, x: -900 + offset, y });
  const click = offset => { send('start', offset); send('end', offset); };
  return { gesture, calls, moves, send, click, advance: gesture.advance };
}

test('an activation click focuses without browsing in either direction, even when focus changes before release', () => {
  for (const offset of [20, 300]) {
    let focused = false, focusCalls = 0;
    const f = resizingFixture(472, { isFocused: () => focused, focus: () => { focused = true; focusCalls++; } });
    f.send('start', offset);
    assert.equal(focusCalls, 1);
    f.send('move', offset + 2);
    f.send('end', offset);
    f.advance(1000);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.moves, []);
    f.click(offset); f.advance(400);
    assert.deepEqual(f.calls, [offset === 20 ? 'previous' : 'next']);
    assert.equal(focusCalls, 1);
  }
});

test('an activation click clears pending navigation and does not seed a double-click', () => {
  let focused = true;
  const f = resizingFixture(472, { isFocused: () => focused, focus: () => { focused = true; } });
  f.click(300); f.advance(100);
  focused = false;
  f.click(300); f.advance(100);
  assert.deepEqual(f.calls, []);
  f.click(300); f.advance(400);
  assert.deepEqual(f.calls, ['next']);
  f.click(300); f.advance(100); f.click(300);
  assert.deepEqual(f.calls, ['next', 'bigger']);
});

test('blur consumes the next click even when native focus returns before pointerdown', () => {
  for (const offset of [20, 300]) {
    let focused = true;
    const f = resizingFixture(472, { isFocused: () => focused });
    f.click(offset); f.advance(100);
    focused = false;
    f.gesture({ phase: 'blur' });
    focused = true; // Native activation happens before the renderer sends start.
    f.click(offset); f.advance(400);
    assert.deepEqual(f.calls, []);
    f.click(offset); f.advance(400);
    assert.deepEqual(f.calls, [offset === 20 ? 'previous' : 'next']);
  }
});

test('startup activation is consumed even if the native window already reports focus', () => {
  const f = resizingFixture(472, { requireActivation: true });
  f.click(300); f.advance(100); f.click(300); f.advance(400);
  assert.deepEqual(f.calls, ['next'], 'activation neither browses nor seeds a double-click');
});

test('keyboard activation allows browsing and ordinary cancellation preserves it', () => {
  const f = resizingFixture(472);
  f.gesture({ phase: 'blur' });
  f.gesture({ phase: 'activate' });
  f.gesture({ phase: 'cancel' });
  f.click(300); f.advance(400);
  assert.deepEqual(f.calls, ['next']);
});

test('cancellation does not erase the activation required after blur', () => {
  const f = resizingFixture(472);
  f.gesture({ phase: 'blur' });
  f.gesture({ phase: 'cancel' });
  f.click(300); f.advance(400);
  assert.deepEqual(f.calls, []);
});

test('an unfocused banner can still be dragged without navigating or resizing', () => {
  const f = resizingFixture(472, { isFocused: () => false });
  f.send('start', 300); f.send('move', 320, 120); f.send('end', 300);
  f.advance(1000);
  assert.ok(f.moves.length > 0);
  assert.deepEqual(f.calls, []);
});

test('double-click halves resize once without navigation at every banner size', () => {
  for (const width of [236, 472, 708, 1416]) {
    for (const [offset, expected] of [[0, 'smaller'], [width * 0.3, 'smaller'], [width / 2 - 0.01, 'smaller'], [width / 2, 'bigger'], [width * 0.9, 'bigger']]) {
      const f = resizingFixture(width);
      f.click(offset); f.advance(100); f.click(offset);
      assert.deepEqual(f.calls, [expected]);
      f.advance(1000);
      assert.deepEqual(f.calls, [expected]);
      assert.deepEqual(f.moves, []);
    }
  }
});

test('a second press within the double-click interval holds navigation until release', () => {
  const f = resizingFixture();
  f.click(300); f.advance(399); f.send('start', 302, 111);
  f.advance(1000);
  assert.deepEqual(f.calls, []);
  f.send('end', 302, 111);
  assert.deepEqual(f.calls, ['bigger']);
});

test('a slow second click remains two single clicks', () => {
  const f = resizingFixture();
  f.click(20); f.advance(401); f.click(20); f.advance(400);
  assert.deepEqual(f.calls, ['previous', 'previous']);
});

test('spatially separate or opposite-half clicks do not resize', () => {
  for (const [first, second, expected] of [[20, 300, ['previous', 'next']], [235, 237, ['next', 'next']], [300, 306, ['next', 'next']]]) {
    const f = resizingFixture();
    f.click(first); f.advance(100); f.click(second); f.advance(400);
    assert.deepEqual(f.calls, expected);
  }
});

test('dragging on the second press cancels resizing and pending navigation', () => {
  const f = resizingFixture();
  f.click(300); f.advance(100); f.send('start', 300);
  f.send('move', 320, 120); f.send('end', 300);
  f.advance(1000);
  assert.deepEqual(f.calls, []);
  assert.ok(f.moves.length > 0);
});

test('cancellation and invalid coordinates clear pending clicks and double-clicks', () => {
  for (const invalid of [{ phase: 'cancel' }, { phase: 'move', x: Infinity, y: 110 }]) {
    for (const secondPress of [false, true]) {
      const f = resizingFixture();
      f.click(300); f.advance(100);
      if (secondPress) f.send('start', 300);
      f.gesture(invalid); f.send('end', 300); f.advance(1000);
      assert.deepEqual(f.calls, []);
      f.click(300); f.advance(400);
      assert.deepEqual(f.calls, ['next']);
    }
  }
});

test('a completed drag does not seed a double-click', () => {
  const f = resizingFixture();
  f.send('start', 300); f.send('move', 320); f.send('end', 300);
  f.click(300); f.advance(400);
  assert.deepEqual(f.calls, ['next']);
});

test('size steps follow settings presets, bounded at 25 and 300 percent', () => {
  const { BANNER_SCALES, stepBannerScale } = require('../../desktop/bounds.cjs');
  for (const [index, scale] of BANNER_SCALES.entries()) {
    assert.equal(stepBannerScale(scale, 1), BANNER_SCALES[Math.min(index + 1, BANNER_SCALES.length - 1)]);
    assert.equal(stepBannerScale(scale, -1), BANNER_SCALES[Math.max(index - 1, 0)]);
  }
  assert.equal(stepBannerScale(471 / 472, 1), 1.25, 'pixel rounding does not select the current preset again');
  assert.equal(stepBannerScale(473 / 472, -1), 0.75);
  assert.equal(stepBannerScale(1.8, 1), 2, 'monitor-constrained scales use the next preset');
  assert.equal(stepBannerScale(1.8, -1), 1.5);
});
