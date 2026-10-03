"use strict";

(function initializeScrolling(global) {
  function render(viewport, textElement, value) {
    const text = value || "";
    const viewportWidth = viewport.clientWidth;
    if (textElement.dataset.scrollValue === text
      && Number(textElement.dataset.scrollViewportWidth) === viewportWidth) return;
    textElement.dataset.scrollValue = text;
    textElement.dataset.scrollViewportWidth = String(viewportWidth);
    textElement.textContent = text;
    textElement.style.setProperty("--scroll-duration", `${Math.max(20, text.length / 3.5)}s`);
    textElement.classList.remove("is-scrolling");
    if (!text) return;
    requestAnimationFrame(() => {
      const overflow = textElement.scrollWidth - viewport.clientWidth;
      const shouldScroll = overflow > 1;
      textElement.dataset.scrollViewportWidth = String(viewport.clientWidth);
      textElement.classList.toggle("is-scrolling", shouldScroll);
    });
  }
  function vertical(viewport, event, previous) {
    if (!viewport) return null;
    const track = viewport.firstElementChild, count = track.children.length;
    // Identity excludes row count and duration so a refresh can clamp the user's
    // position instead of resetting it. Round/view changes start a new list.
    if (viewport.dataset) viewport.dataset.scrollIdentity = JSON.stringify([
      event.sport, event.id, event.details?.roundId ?? event.details?.round,
      event.details?.view, viewport.dataset.scrollKey || "",
    ]);
    if (count <= 3) return null;
    const config = global.SportsOverlay.config?.loadConfig();
    const seconds = global.SportsOverlay.selection?.gameDurationSeconds({ candidate: event }, config?.gameDurations, undefined, config?.defaultGameDurations) || 20;
    const key = `${viewport.dataset?.scrollIdentity || `${event.sport}:${event.id}`}:${count}:${seconds}`;
    const state = previous?.key === key ? previous : { key, started: performance.now() };
    track.style.setProperty("--vertical-distance", `${-(count - 3) * 15}px`);
    track.style.setProperty("--vertical-duration", `${seconds}s`);
    track.style.setProperty("--vertical-delay", `${-(performance.now() - state.started) / 1000}s`);
    track.classList.add("is-scrolling-vertically");
    viewport.tabIndex = 0;
    viewport.setAttribute("aria-label", viewport.dataset?.scrollLabel || `Top ${count} players. Scroll to see all players.`);
    return state;
  }
  const controllers = new WeakMap();
  const selector = ".scorebug-vertical-viewport";
  const reducedMotion = () => global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function offset(viewport) {
    const transform = getComputedStyle(viewport.firstElementChild).transform;
    return viewport.scrollTop - (transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42);
  }
  function held(viewport) {
    return viewport.matches(":hover, :focus-within");
  }
  // Call before replacing rows. The desktop mirror uses the same handoff as
  // the source layouts; interaction state stays local to each display.
  function capture(root) {
    const viewport = root?.querySelector(selector);
    const controller = viewport && controllers.get(viewport);
    if (!controller) return null;
    const snapshot = controller.snapshot();
    controller.dispose();
    return snapshot;
  }
  function restore(root, snapshot) {
    const viewport = root?.querySelector(selector), track = viewport?.firstElementChild;
    if (!track) return;
    controllers.get(viewport)?.dispose();
    const saved = snapshot?.key === viewport.dataset.scrollIdentity ? snapshot : null;
    const abort = new AbortController();
    const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: abort.signal });
    const maximum = () => Math.max(0, track.offsetHeight - viewport.clientHeight);
    const clamp = value => Math.max(0, Math.min(maximum(), value));
    let manual = false, local = false, touching = saved?.touching || false, timer, restoredPosition;
    let lastInput = saved?.lastInput || 0;
    viewport.classList.remove("is-manual-scrolling");
    viewport.scrollTop = 0;
    function begin(position = offset(viewport)) {
      if (manual || maximum() <= 0) return;
      manual = local = true;
      viewport.classList.add("is-manual-scrolling");
      viewport.scrollTop = clamp(position);
      restoredPosition = viewport.scrollTop;
    }
    function resume() {
      clearTimeout(timer);
      if (!manual || held(viewport) || touching || reducedMotion()) return;
      const remaining = 180 - (performance.now() - lastInput);
      if (remaining > 0) { timer = setTimeout(resume, remaining); return; }
      // Match the existing animation's 25%-85% travelling segment exactly.
      const distance = maximum(), position = clamp(viewport.scrollTop);
      const seconds = parseFloat(track.style.getPropertyValue("--vertical-duration")) || 20;
      const phase = distance ? .25 + .6 * position / distance : 0;
      track.style.setProperty("--vertical-delay", `${-phase * seconds}s`);
      manual = false;
      viewport.scrollTop = 0;
      viewport.classList.remove("is-manual-scrolling");
    }
    function input() { lastInput = performance.now(); clearTimeout(timer); timer = setTimeout(resume, 180); }
    listen(viewport, "wheel", event => {
      if (event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      begin(); input();
    }, { passive: false });
    listen(viewport, "touchstart", () => { touching = true; begin(); input(); }, { passive: true });
    for (const type of ["touchend", "touchcancel"]) listen(global.document, type, () => { touching = false; input(); }, { passive: true });
    listen(viewport, "scroll", () => {
      // Restoring a snapshot is not new input and must not postpone resume on
      // every output refresh. Native wheel/touch movement still extends it.
      if (viewport.scrollTop === restoredPosition) { restoredPosition = undefined; return; }
      restoredPosition = undefined;
      if (manual || reducedMotion()) { local = true; input(); }
    }, { passive: true });
    listen(viewport, "pointerleave", resume);
    listen(viewport, "focusout", () => { clearTimeout(timer); timer = setTimeout(resume, 0); });
    listen(viewport, "keydown", event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || maximum() <= 0) return;
      const steps = { ArrowUp: -15, ArrowDown: 15, PageUp: -viewport.clientHeight, PageDown: viewport.clientHeight, Home: -Infinity, End: Infinity };
      if (!(event.key in steps)) return;
      event.preventDefault(); begin();
      viewport.scrollTop = clamp(viewport.scrollTop + steps[event.key]); input();
    });
    const media = global.matchMedia("(prefers-reduced-motion: reduce)");
    listen(media, "change", () => { if (!media.matches) resume(); });
    if (saved?.position !== undefined) {
      local = true;
      if (saved.phase !== undefined && saved.distance === maximum() && !reducedMotion()) {
        const seconds = parseFloat(track.style.getPropertyValue("--vertical-duration")) || 20;
        track.style.setProperty("--vertical-delay", `${-saved.phase * seconds}s`);
        // An unchanged mirrored track may still have a running animation.
        const animation = track.getAnimations()[0];
        if (animation) animation.currentTime = 0;
      } else begin(saved.position);
      if (saved.focused) {
        const link = saved.focusHref && [...viewport.querySelectorAll("a[href]")].find(a => a.href === saved.focusHref);
        (link || viewport).focus({ preventScroll: true });
      }
      resume();
    }
    controllers.set(viewport, {
      snapshot() {
        const focused = viewport.contains(document.activeElement);
        const animation = track.getAnimations()[0];
        const duration = (parseFloat(track.style.getPropertyValue("--vertical-duration")) || 20) * 1000;
        const delay = (parseFloat(getComputedStyle(track).animationDelay) || 0) * 1000;
        const phase = animation ? ((Number(animation.currentTime) - delay) % duration) / duration : undefined;
        return { key: viewport.dataset.scrollIdentity, lastInput, focused, touching,
          focusHref: focused ? document.activeElement.href : null,
          ...((manual || local || held(viewport) || reducedMotion()) ? { position: offset(viewport), distance: maximum(), phase } : {}),
        };
      },
      dispose() { clearTimeout(timer); abort.abort(); controllers.delete(viewport); },
    });
  }
  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.scrolling = Object.freeze({ render, vertical, capture, restore });
})(typeof window === "undefined" ? globalThis : window);
