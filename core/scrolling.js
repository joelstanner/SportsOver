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
    textElement.classList.remove("is-scrolling");
    if (!text) return;
    requestAnimationFrame(() => {
      const overflow = textElement.scrollWidth - viewport.clientWidth;
      const shouldScroll = overflow > 1;
      textElement.dataset.scrollViewportWidth = String(viewport.clientWidth);
      textElement.classList.toggle("is-scrolling", shouldScroll);
    });
  }
  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.scrolling = Object.freeze({ render });
})(typeof window === "undefined" ? globalThis : window);
