require('../../scripts/offline-network.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBannerResize } = require('../../desktop/banner-resize.cjs');

function fixture(workArea = { x: 0, y: 30, width: 1920, height: 1050 }) {
  let bounds = { x: 700, y: 30, width: 472, height: 100 }, time = 0, id = 0, completions = 0;
  const timers = new Map(), frames = [];
  const resize = createBannerResize({
    bounds: () => bounds, display: () => ({ workArea }),
    apply: next => { bounds = next; frames.push(next); },
    settled: () => completions++, now: () => time,
    setTimer: fn => { timers.set(++id, fn); return id; },
    clearTimer: id => timers.delete(id),
  });
  return { resize, frames, bounds: () => bounds, completions: () => completions,
    tick() { time += 16; const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    finish() { for (let i = 0; i < 20 && timers.size; i++) this.tick(); assert.equal(timers.size, 0); },
  };
}

function assertAnchor(frames) {
  for (const frame of frames) {
    assert.equal(frame.y, 30);
    assert.ok(Math.abs(frame.x + frame.width / 2 - 936) <= 0.5);
  }
}

test('one arrow press interpolates monotonically to the exact 10% destination', () => {
  const f = fixture();
  f.resize.step(-1);
  assert.equal(f.resize.targetWidth(), 425);
  assert.equal(f.bounds().width, 472, 'does not jump before the first frame');
  f.finish();
  assert.ok(f.frames.length > 2, 'uses multiple intermediate sizes');
  assert.equal(f.bounds().width, 425);
  assertAnchor(f.frames);
  for (let i = 1; i < f.frames.length; i++) assert.ok(f.frames[i].width <= f.frames[i - 1].width);
  assert.equal(f.resize.targetWidth(), undefined);
  assert.equal(f.completions(), 1);
});

test('rapid repeats count every press from the target and preserve one anchor', () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) { f.resize.step(-1); f.tick(); }
  assert.equal(f.resize.targetWidth(), 94, 'eight presses request 20% despite intermediate widths');
  f.finish();
  assert.equal(f.bounds().width, 94);
  assertAnchor(f.frames);
  for (let i = 1; i < f.frames.length; i++) assert.ok(f.frames[i].width <= f.frames[i - 1].width);
  for (let i = 0; i < 8; i++) { f.resize.step(1); f.tick(); }
  f.finish();
  assert.deepEqual(f.bounds(), { x: 700, y: 30, width: 472, height: 100 });
  assert.equal(f.completions(), 2);
});

test('reversing an in-flight resize keeps the final target and anchor without overshooting', () => {
  const f = fixture();
  f.resize.step(-1); f.tick();
  f.resize.step(1); f.finish();
  assert.deepEqual(f.bounds(), { x: 700, y: 30, width: 472, height: 100 });
  assertAnchor(f.frames);
  assert.ok(f.frames.every(frame => frame.width >= 425 && frame.width <= 472));
});

test('cancellation prevents stale frames from moving a dragged, locked, or fullscreen banner', () => {
  const f = fixture();
  f.resize.step(-1); f.tick();
  f.resize.cancel();
  const before = f.bounds();
  f.finish();
  assert.deepEqual(f.bounds(), before);
  assert.equal(f.completions(), 0);
  assert.equal(f.resize.targetWidth(), undefined);
});

test('rapid requests stop at 10% and at the available monitor space without target backlog', () => {
  const f = fixture();
  for (let i = 0; i < 30; i++) f.resize.step(-1);
  f.finish();
  assert.equal(f.bounds().width, 47);
  f.resize.step(1); f.finish();
  assert.equal(f.bounds().width, 94);
  const constrained = fixture({ x: 0, y: 30, width: 1920, height: 100 });
  for (let i = 0; i < 30; i++) constrained.resize.step(1);
  constrained.finish();
  assert.equal(constrained.bounds().width, 472);
  constrained.resize.step(-1); constrained.finish();
  assert.equal(constrained.bounds().width, 425);
});
