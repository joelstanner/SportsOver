const { test } = require('node:test');
const assert = require('node:assert/strict');
const { centeredResizeBounds, BANNER_SCALES } = require('../../desktop/bounds.cjs');

function assertSameCenter(before, after) {
  assert.ok(Math.abs(before.x + before.width / 2 - after.x - after.width / 2) <= 0.5, 'horizontal center stays within half a pixel');
  assert.ok(Math.abs(before.y + before.height / 2 - after.y - after.height / 2) <= 0.5, 'vertical center stays within half a pixel');
}

test('every banner size grows and shrinks about its center on either side of the primary monitor', () => {
  for (const x of [0, -2560]) {
    const display = { workArea: { x, y: -200, width: 2560, height: 1400 } };
    for (const from of BANNER_SCALES) {
      const before = { x: x + 1000 - Math.round(472 * from) / 2, y: 400 - Math.round(100 * from) / 2,
        width: Math.round(472 * from), height: Math.round(100 * from) };
      for (const to of BANNER_SCALES) {
        const after = centeredResizeBounds(before, Math.round(472 * to), display);
        assert.equal(after.width, Math.round(472 * to));
        assert.equal(after.height, Math.round(100 * to));
        assertSameCenter(before, after);
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
    const after = centeredResizeBounds(before, 1416, { workArea });
    assert.ok(after.width < 1416);
    assert.ok(after.width <= workArea.width && after.height <= workArea.height);
    assertSameCenter(before, after);
  }
});

test('growth at monitor edges shifts only as needed to keep the whole banner on that monitor', () => {
  const display = { workArea: { x: -1920, y: 30, width: 1920, height: 1050 } };
  const topLeft = centeredResizeBounds({ x: -1920, y: 30, width: 472, height: 100 }, 944, display);
  assert.deepEqual(topLeft, { x: -1920, y: 30, width: 944, height: 200 });
  const bottomRight = centeredResizeBounds({ x: -472, y: 980, width: 472, height: 100 }, 944, display);
  assert.deepEqual(bottomRight, { x: -944, y: 880, width: 944, height: 200 });
  assertSameCenter(topLeft, centeredResizeBounds(topLeft, 472, display));
  assertSameCenter(bottomRight, centeredResizeBounds(bottomRight, 472, display));
});

test('repeating a size preserves the exact bounds, including odd native dimensions', () => {
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const before = { x: 420, y: 250, width: 707, height: 150 };
  assert.deepEqual(centeredResizeBounds(before, before.width, display), before);
  assertSameCenter(before, centeredResizeBounds(before, 590, display));
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
        const after = centeredResizeBounds(bounds, width, display);
        assertSameCenter(bounds, after);
        bounds = after;
      }
      assert.deepEqual(bounds, original);
    }
  }
});
