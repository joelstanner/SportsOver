const { topAnchoredResizeBounds, stepArrowScale } = require('./bounds.cjs');

function createBannerResize({ bounds, display, apply, settled = () => {},
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let animation = null, timer = null;
  const duration = 100;
  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    animation = null;
  }
  function frame() {
    timer = null;
    if (!animation) return;
    const progress = Math.min(1, Math.max(0, (now() - animation.started) / duration));
    const eased = 1 - (1 - progress) ** 3;
    const width = Math.round(animation.from + (animation.target.width - animation.from) * eased);
    // Use one anchor for the entire repeat sequence, including reversals.
    const next = topAnchoredResizeBounds(animation.anchor, width, animation.display);
    const current = bounds();
    if (Object.keys(next).some(key => next[key] !== current[key])) apply(next);
    if (progress === 1) {
      animation = null;
      settled();
    } else timer = setTimer(frame, 16);
  }
  return {
    cancel,
    targetWidth: () => animation?.target.width,
    step(direction) {
      const current = bounds();
      const anchor = animation?.anchor || current;
      const monitor = animation?.display || display(current);
      // Count every press from the requested destination, not an in-flight frame.
      const scale = stepArrowScale((animation?.target.width ?? current.width) / 472, direction);
      const target = topAnchoredResizeBounds(anchor, Math.round(472 * scale), monitor);
      if (animation && target.width === animation.target.width) return;
      if (!animation && target.width === current.width) return;
      if (timer !== null) clearTimer(timer);
      animation = { anchor, display: monitor, from: current.width, target, started: now() };
      timer = setTimer(frame, 16);
    },
  };
}

module.exports = { createBannerResize };
