const BANNER_SCALES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2, 3]);

function stepBannerScale(scale, direction) {
  if (direction < 0 && scale <= BANNER_SCALES[0]) return Math.max(0.1, scale);
  // Window dimensions are rounded to pixels and may be constrained by a monitor.
  const tolerance = 1 / 472;
  return direction > 0
    ? BANNER_SCALES.find(value => value > scale + tolerance) ?? BANNER_SCALES.at(-1)
    : [...BANNER_SCALES].reverse().find(value => value < scale - tolerance) ?? BANNER_SCALES[0];
}

function stepArrowScale(scale, direction) {
  return Math.max(0.1, Math.min(3, (Math.round(scale * 100) + direction * 10) / 100));
}

function fitBounds(saved = {}, displays) {
  const areas = displays.map(display => display.workArea);
  const initial = areas[0];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const width = finite(saved.width) ? Math.max(47, Math.min(1416, saved.width)) : 472;
  const height = Math.round(width * 100 / 472);
  const x = finite(saved.x) ? saved.x : initial.x + 24;
  const y = finite(saved.y) ? saved.y : initial.y + 24;
  const area = areas.find(a => x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y) || initial;
  const w = Math.round(Math.min(width, area.width, area.height * 472 / 100));
  const h = Math.round(w * 100 / 472);
  return { x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - w))), y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - h))), width: w, height: h };
}
function fullscreenBounds(display) { return { ...display.bounds }; }

function topAnchoredResizeBounds(current, width, display) {
  const area = display.workArea;
  // Limit growth to the space below the fixed top instead of moving it upward.
  const availableHeight = Math.max(current.height, area.y + area.height - current.y);
  const nextWidth = Math.round(Math.min(Math.max(47, Math.min(1416, width)), area.width, availableHeight * 472 / 100));
  // Alternate half-pixel rounding with size parity so grow/shrink cycles cannot drift.
  const origin = (start, size, nextSize) => (nextSize % 2 ? Math.floor : Math.ceil)(start + (size - nextSize) / 2);
  return {
    x: Math.max(area.x, Math.min(origin(current.x, current.width, nextWidth), area.x + area.width - nextWidth)),
    y: current.y,
    width: nextWidth,
    height: Math.round(nextWidth * 100 / 472),
  };
}

module.exports = { fitBounds, fullscreenBounds, topAnchoredResizeBounds, BANNER_SCALES, stepBannerScale, stepArrowScale };
