"use strict";

(function initializeTimeouts(global) {
  function remaining(source = {}, maximum) {
    const limit = finiteInteger(maximum);
    if (limit === null || limit < 1) return null;
    const explicit = finiteInteger(source.timeoutsRemaining);
    if (explicit !== null) return clamp(explicit, limit);
    const used = finiteInteger(source.timeoutsUsed);
    return used === null ? null : clamp(limit - used, limit);
  }

  function renderMarkers(element, count, maximum, teamName = "Team") {
    if (!element) return;
    const limit = finiteInteger(maximum);
    const value = finiteInteger(count);
    const visible = limit !== null && limit > 0 && value !== null;
    element.hidden = !visible;
    element.replaceChildren();
    if (!visible) {
      element.removeAttribute("aria-label");
      return;
    }
    const normalized = clamp(value, limit);
    element.setAttribute("aria-label", `${teamName}: ${normalized} timeout${normalized === 1 ? "" : "s"} remaining`);
    for (let index = 0; index < limit; index += 1) {
      const marker = element.ownerDocument.createElement("span");
      marker.className = `timeout-marker ${index < normalized ? "is-remaining" : "is-used"}`;
      marker.setAttribute("aria-hidden", "true");
      element.append(marker);
    }
  }

  function finiteInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  function clamp(value, maximum) {
    return Math.min(maximum, Math.max(0, value));
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.timeouts = Object.freeze({ remaining, renderMarkers });
})(typeof window === "undefined" ? globalThis : window);
