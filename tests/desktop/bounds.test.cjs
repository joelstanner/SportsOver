const { test } = require('node:test');
const assert = require('node:assert/strict');
const { topAnchoredResizeBounds, BANNER_SCALES } = require('../../desktop/bounds.cjs');

function assertAnchor(before, after) {
  assert.ok(Math.abs(before.x + before.width / 2 - after.x - after.width / 2) <= 0.5, 'horizontal center stays within half a pixel');
  assert.equal(after.y, before.y, 'top edge stays fixed');
}

test('every banner size grows and shrinks about its horizontal center with a fixed top on either side of the primary monitor', () => {
  for (const x of [0, -2560]) {
    const display = { workArea: { x, y: -200, width: 2560, height: 1400 } };
    for (const from of BANNER_SCALES) {
      const before = { x: x + 1000 - Math.round(472 * from) / 2, y: 400 - Math.round(100 * from) / 2,
        width: Math.round(472 * from), height: Math.round(100 * from) };
      for (const to of BANNER_SCALES) {
        const after = topAnchoredResizeBounds(before, Math.round(472 * to), display);
        assert.equal(after.width, Math.round(472 * to));
        assert.equal(after.height, Math.round(100 * to));
        assertAnchor(before, after);
      }
    }
  }
});

test('monitor-constrained sizes preserve the center using their actual dimensions', () => {
  for (const workArea of [
    { x: -800, y: 40, width: 800, height: 600 },
    { x: 0, y: -100, width: 1800, height: 150 },
  ]) {
    const before = { x: workArea.x + workArea.width / 2 - 236, y: workArea.y + workArea.height / 2 - 50, width: 472, height: 100 };
    const after = topAnchoredResizeBounds(before, 1416, { workArea });
    assert.ok(after.width < 1416);
    assert.ok(after.width <= workArea.width && after.height <= workArea.height);
    assertAnchor(before, after);
  }
});

test('growth at monitor edges clamps horizontally and stops before moving the top', () => {
  const display = { workArea: { x: -1920, y: 30, width: 1920, height: 1050 } };
  const topLeft = topAnchoredResizeBounds({ x: -1920, y: 30, width: 472, height: 100 }, 944, display);
  assert.deepEqual(topLeft, { x: -1920, y: 30, width: 944, height: 200 });
  const bottomRight = topAnchoredResizeBounds({ x: -472, y: 980, width: 472, height: 100 }, 944, display);
  assert.deepEqual(bottomRight, { x: -472, y: 980, width: 472, height: 100 });
  assertAnchor(topLeft, topAnchoredResizeBounds(topLeft, 472, display));
  assertAnchor(bottomRight, topAnchoredResizeBounds(bottomRight, 472, display));
});

test('repeating a size preserves the exact bounds, including odd native dimensions', () => {
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const before = { x: 420, y: 250, width: 707, height: 150 };
  assert.deepEqual(topAnchoredResizeBounds(before, before.width, display), before);
  assertAnchor(before, topAnchoredResizeBounds(before, 590, display));
});

test('repeated grow/shrink cycles do not accumulate pixel rounding drift', () => {
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  for (const original of [
    { x: 600, y: 400, width: 472, height: 100 },
    { x: 600, y: 400, width: 707, height: 150 },
  ]) {
    let bounds = original;
    for (let cycle = 0; cycle < 50; cycle++) {
      for (const width of [354, 590, 944, original.width]) {
        const after = topAnchoredResizeBounds(bounds, width, display);
        assertAnchor(bounds, after);
        bounds = after;
      }
      assert.deepEqual(bounds, original);
    }
  }
});

test('top flush with the screen stays fixed even above the monitor work area', () => {
  const display = { workArea: { x: 0, y: 30, width: 1920, height: 1050 } };
  const before = { x: 600, y: 0, width: 472, height: 100 };
  const after = topAnchoredResizeBounds(before, 944, display);
  assertAnchor(before, after);
  assert.equal(after.height, 200);
});

test('arrows step ten percentage points, reach 10%, and restore small saved sizes', () => {
  const { stepArrowScale, stepBannerScale, fitBounds } = require('../../desktop/bounds.cjs');
  let scale = 1;
  for (let percent = 90; percent >= 10; percent -= 10) {
    scale = stepArrowScale(Math.round(472 * scale) / 472, -1);
    assert.equal(scale, percent / 100);
  }
  assert.equal(stepArrowScale(47 / 472, -1), 0.1);
  assert.equal(stepArrowScale(47 / 472, 1), 0.2);
  assert.equal(stepArrowScale(0.12, -1), 0.1, 'shrinking near the minimum stops at 10%');
  assert.equal(stepArrowScale(2.98, 1), 3, 'growing near the maximum stops at 300%');
  assert.equal(stepArrowScale(3, 1), 3);
  assert.equal(stepBannerScale(47 / 472, -1), 0.1, 'double-click shrink cannot enlarge a small banner');
  assert.equal(stepBannerScale(47 / 472, 1), 0.5);
  const display = { workArea: { x: 0, y: 30, width: 1920, height: 1050 } };
  const tiny = topAnchoredResizeBounds({ x: 600, y: 30, width: 472, height: 100 }, 47, display);
  assert.equal(tiny.width, 47);
  assert.equal(tiny.height, 10);
  assert.deepEqual(fitBounds(tiny, [display]), tiny);
});
