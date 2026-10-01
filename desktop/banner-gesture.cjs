// Screen coordinates are independent of banner zoom and its changing position.
function createBannerGesture({ bounds, move, next, previous, resize,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const doubleClickMs = 400;
  let gesture = null;
  let pendingClick = null;
  const validCoordinate = value => Number.isFinite(value) && value >= -2147483648 && value <= 2147483647;
  function cancel() {
    gesture = null;
    if (pendingClick) clearTimer(pendingClick.timer);
    pendingClick = null;
  }
  function navigate() {
    const click = pendingClick;
    if (!click) return;
    clearTimer(click.timer);
    pendingClick = null;
    if (click.backwards) previous();
    else next();
  }
  return value => {
    if (value?.phase === 'cancel') { cancel(); return; }
    if (!value || !['start', 'move', 'end'].includes(value.phase)) return;
    if (!validCoordinate(value.x) || !validCoordinate(value.y)) { cancel(); return; }
    if (value.phase === 'start') {
      const origin = bounds();
      if (!validCoordinate(origin?.x) || !validCoordinate(origin?.y)) { cancel(); return; }
      const backwards = Number.isFinite(origin.width) && origin.width > 0
        && value.x >= origin.x && value.x < origin.x + origin.width * 0.2;
      const direction = value.x < origin.x + origin.width / 2 ? -1 : 1;
      const doubleClick = pendingClick && now() - pendingClick.time <= doubleClickMs
        && Math.hypot(value.x - pendingClick.x, value.y - pendingClick.y) <= 5
        && direction === pendingClick.direction;
      if (doubleClick) {
        clearTimer(pendingClick.timer);
        pendingClick = null;
      } else navigate();
      gesture = { x: value.x, y: value.y, bounds: origin, dragging: false, backwards, direction, doubleClick };
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
      if (!validCoordinate(x) || !validCoordinate(y)) { cancel(); return; }
      move(x, y);
    }
    if (value.phase === 'end') {
      const skip = !gesture.dragging;
      const click = gesture;
      gesture = null;
      if (skip) {
        if (click.doubleClick) resize(click.direction);
        else {
          pendingClick = { ...click, time: now(), timer: setTimer(navigate, doubleClickMs) };
        }
      }
    }
  };
}
module.exports = { createBannerGesture };
