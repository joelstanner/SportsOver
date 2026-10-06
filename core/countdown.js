"use strict";

(function initializeCountdown(global) {
  const attributes = ["pregameStart", "pregamePrefix", "pregameSuffix", "pregameFallback", "pregameZone", "compactDate", "compactTime"];

  function clear(element) {
    for (const attribute of attributes) delete element.dataset[attribute];
  }

  function paint(element, now) {
    const data = element.dataset;
    const start = new Date(data.pregameStart || "invalid");
    const model = global.SportsOverlay.model;
    const time = model.formatPregameCountdown(data.pregameStart, now)
      || (start.getTime() <= now.getTime() ? "Starting soon"
        : model.formatPregameStart(data.pregameStart, now, data.pregameZone || undefined))
      || data.pregameFallback;
    const text = `${data.pregamePrefix}${time}${data.pregameSuffix}`;
    if (element.textContent !== text) element.textContent = text;
    if (element.hasAttribute("title")) element.title = text;
  }

  function render(element, startTime, { prefix = "", suffix = "", fallback = "", timeZone = "" } = {}) {
    clear(element);
    if (!Number.isFinite(new Date(startTime || "invalid").getTime())) return;
    const configured = global.SportsOverlay.config?.loadConfig()?.timeZone;
    timeZone = timeZone || (configured && configured !== "local" ? configured
      : new Intl.DateTimeFormat().resolvedOptions().timeZone);
    Object.assign(element.dataset, { pregameStart: startTime, pregamePrefix: prefix,
      pregameSuffix: suffix, pregameFallback: fallback, pregameZone: timeZone });
    const start = new Date(startTime);
    element.dataset.compactDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(start);
    element.dataset.compactTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(start);
    paint(element, new Date());
  }

  // Preserve surrounding metadata while replacing only the scheduled start time.
  function replace(element, startTime, timeZone) {
    const scheduled = global.SportsOverlay.model.formatPregameStart(startTime, new Date(), timeZone);
    const index = scheduled ? element.textContent.indexOf(scheduled) : -1;
    if (index < 0) return;
    const prefix = element.textContent.slice(0, index);
    const suffix = element.textContent.slice(index + scheduled.length);
    const timer = global.document.createElement("span");
    render(timer, startTime, { timeZone });
    // Keep the surrounding marquee mounted when only the seconds change.
    element.replaceChildren(prefix, timer, suffix);
  }

  function refresh(root = global.document, now = new Date()) {
    root.querySelectorAll("[data-pregame-start]").forEach(element => paint(element, now));
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.countdown = Object.freeze({ render, replace, clear, refresh });
  // Serialized bindings also let desktop/OBS outputs tick between engine frames.
  if (global.document) global.setInterval(refresh, 1000);
})(typeof window === "undefined" ? globalThis : window);
