// Screen coordinates are independent of banner zoom and its changing position.
function createBannerGesture({ bounds, move, next, previous }) {
  let gesture = null;
  const validCoordinate = value => Number.isFinite(value) && value >= -2147483648 && value <= 2147483647;
  return value => {
    if (value?.phase === 'cancel') { gesture = null; return; }
    if (!value || !['start', 'move', 'end'].includes(value.phase)) return;
    if (!validCoordinate(value.x) || !validCoordinate(value.y)) { gesture = null; return; }
    if (value.phase === 'start') {
      const origin = bounds();
      if (!validCoordinate(origin?.x) || !validCoordinate(origin?.y)) { gesture = null; return; }
      const backwards = Number.isFinite(origin.width) && origin.width > 0
        && value.x >= origin.x && value.x < origin.x + origin.width * 0.2;
      gesture = { x: value.x, y: value.y, bounds: origin, dragging: false, backwards };
      return;
    }
    if (!gesture) return;
    const dx = value.x - gesture.x, dy = value.y - gesture.y;
    if (Math.hypot(dx, dy) > 5) gesture.dragging = true;
    if (gesture.dragging) {
      // Electron's native coordinates are signed 32-bit integers. Adding zero
      // canonicalizes Math.round(-0.x), which otherwise produces negative zero.
      const x = Math.round(gesture.bounds.x + dx) + 0;
      const y = Math.round(gesture.bounds.y + dy) + 0;
      if (!validCoordinate(x) || !validCoordinate(y)) { gesture = null; return; }
      move(x, y);
    }
    if (value.phase === 'end') {
      const skip = !gesture.dragging;
      const backwards = gesture.backwards;
      gesture = null;
      if (skip) {
        if (backwards) previous();
        else next();
      }
    }
  };
}
module.exports = { createBannerGesture };
