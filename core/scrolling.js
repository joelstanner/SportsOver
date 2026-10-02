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
    if (count <= 3) return null;
    const config = global.SportsOverlay.config?.loadConfig();
    const seconds = global.SportsOverlay.selection?.gameDurationSeconds({ candidate: event }, config?.gameDurations, undefined, config?.defaultGameDurations) || 20;
    const key = `${event.sport}:${event.id}:${count}:${seconds}`;
    const state = previous?.key === key ? previous : { key, started: performance.now() };
    track.style.setProperty("--vertical-distance", `${-(count - 3) * 15}px`);
    track.style.setProperty("--vertical-duration", `${seconds}s`);
    track.style.setProperty("--vertical-delay", `${-(performance.now() - state.started) / 1000}s`);
    track.classList.add("is-scrolling-vertically");
    viewport.tabIndex = 0;
    viewport.setAttribute("aria-label", `Top ${count} players. Scroll to see all players.`);
    return state;
  }
  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.scrolling = Object.freeze({ render, vertical });
})(typeof window === "undefined" ? globalThis : window);
