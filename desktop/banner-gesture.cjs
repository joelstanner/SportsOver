// Screen coordinates are independent of banner zoom and its changing position.
function createBannerGesture({ bounds, move, next }) {
  let gesture = null;
  return value => {
    if (value?.phase === 'cancel') { gesture = null; return; }
    if (!value || !['start', 'move', 'end'].includes(value.phase)
      || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
    if (value.phase === 'start') {
      gesture = { x: value.x, y: value.y, bounds: bounds(), dragging: false };
      return;
    }
    if (!gesture) return;
    const dx = value.x - gesture.x, dy = value.y - gesture.y;
    if (Math.hypot(dx, dy) > 5) gesture.dragging = true;
    if (gesture.dragging) move(Math.round(gesture.bounds.x + dx), Math.round(gesture.bounds.y + dy));
    if (value.phase === 'end') {
      const skip = !gesture.dragging;
      gesture = null;
      if (skip) next();
    }
  };
}
module.exports = { createBannerGesture };
