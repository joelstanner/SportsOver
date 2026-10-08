"use strict";
(function initializeFormula1Layout(global) {
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const time = value => value && !["--", "0.000", "0:00.000"].includes(value) ? value : "—";
  const flag = driver => global.SportsOverlay.formula1.flagUrl(driver.flag)
    ? `<img class="f1-flag" src="${escape(driver.flag)}" alt="${escape(driver.country || "Driver nationality")}" loading="eager">` : '<span class="f1-flag f1-flag-empty" aria-hidden="true">—</span>';
  function timing(driver, details) {
    if (driver.status) return driver.status;
    return time(details.qualifying ? driver.bestTime : driver.gap || driver.time);
  }
  function createLayout(root = document) {
    const mount = root.querySelector("#sports-overlay");
    global.SportsOverlay.odds?.clear(mount);
    mount.className = "f1-scorebug is-loading";
    delete mount.dataset.preseason;
    let lastEvent, scrollState;
    function render(event) {
      const snapshot = global.SportsOverlay.scrolling?.capture(mount);
      lastEvent = event;
      const d = event.details, player = event.competitors.find(driver => driver.id === d.playerId);
      const count = d.leaderboardSize === "all" ? event.competitors.length : d.leaderboardSize === 3 ? 3 : 10;
      const drivers = event.competitors.slice(0, count);
      const href = `https://www.espn.com/f1/results/_/id/${encodeURIComponent(d.weekendId)}`;
      const driverLink = driver => `<a href="https://www.espn.com/racing/driver/_/id/${encodeURIComponent(driver.id)}" target="_blank" rel="noopener">${escape(driver.name)}</a>`;
      const next = d.nextSession?.date ? `Next: ${d.nextSession.name} · ${global.SportsOverlay.model.formatPregameStart(d.nextSession.date)}` : "";
      const footer = d.stale ? "Last received timing · retrying automatically"
        : d.missingTiming ? "Awaiting timing for this session" : next || (event.state === "final" ? "Session results · ESPN" : `${d.sessionName} · ESPN timing`);
      mount.classList.remove("is-loading", "is-hidden");
      mount.dataset.sport = "formula-1"; mount.dataset.state = event.state; mount.dataset.stale = String(d.stale);
      mount.setAttribute("aria-label", `${d.name}, ${d.sessionName}, ${event.detailedState}`);
      mount.innerHTML = `<div class="f1-bar"><strong class="f1-brand">F1</strong><a class="f1-event" href="${href}" target="_blank" rel="noopener" title="${escape(d.name)}">${escape(d.name)}</a><span class="f1-state">${escape(event.detailedState)}</span></div>`
        + (d.view === "player" ? `<div class="f1-focus"><strong class="f1-position">${player?.position ? `P${player.position}` : "—"}</strong>${flag(player || { flag: d.playerFlag })}<div class="f1-person"><strong class="f1-name">${player ? driverLink(player) : escape(d.playerName)}</strong><span class="f1-sub">${escape(player ? [player.team, d.sessionName].filter(Boolean).join(" · ") : d.missingTiming || event.state === "pregame" ? "Awaiting session timing" : "Not listed in this session")}</span></div><div class="f1-metric"><small>${d.qualifying ? "LAP TIME" : "TIME / GAP"}</small><strong>${escape(player ? timing(player, d) : "—")}</strong><span>${player?.laps != null ? `${player.laps} laps` : ""}</span></div></div>`
          : `<div class="f1-board"><div class="f1-labels"><span>POS</span><span></span><span>${escape(d.sessionName.toUpperCase())}</span><span>${d.qualifying ? "LAP TIME" : "TIME / GAP"}</span><span>LAPS</span></div><div class="scorebug-vertical-viewport" data-scroll-label="Formula 1 drivers. Scroll to see the field."><div class="scorebug-vertical-track">${drivers.length ? drivers.map(driver => `<div class="f1-entry"><span class="f1-position">${driver.position || "—"}</span>${flag(driver)}<strong class="f1-name" title="${escape(driver.team)}">${driverLink(driver)}</strong><strong class="f1-time">${escape(timing(driver, d))}</strong><span class="f1-laps">${driver.laps ?? "—"}</span></div>`).join("") : '<div class="f1-empty">Awaiting session timing</div>'}</div></div></div>`)
        + `<div class="f1-footer"><span class="scorebug-scroll-viewport"><span class="scorebug-scroll-text">${escape(footer)}</span></span><a href="${href}" target="_blank" rel="noopener">ESPN ↗</a></div>`;
      mount.querySelectorAll(".f1-flag").forEach(img => img.addEventListener("error", () => { img.hidden = true; }, { once: true }));
      global.SportsOverlay.scrolling?.render(mount.querySelector(".scorebug-scroll-viewport"), mount.querySelector(".scorebug-scroll-text"), footer);
      scrollState = global.SportsOverlay.scrolling?.vertical(mount.querySelector(".scorebug-vertical-viewport"), event, scrollState);
      global.SportsOverlay.scrolling?.restore(mount, snapshot);
      return event.state;
    }
    function renderNoEvent(message = "Choose Formula 1 drivers or a leaderboard in Settings", visible = true) {
      global.SportsOverlay.scrolling?.capture(mount); lastEvent = null; scrollState = null;
      mount.classList.remove("is-loading"); mount.classList.toggle("is-hidden", !visible);
      mount.innerHTML = `<div class="f1-bar"><strong class="f1-brand">F1</strong><span>FORMULA 1</span></div><div class="f1-empty">${escape(message)}</div>`;
    }
    function handleError(message, error) {
      console.warn(`[SportsOver] ${message}`, error);
      if (lastEvent) render({ ...lastEvent, details: { ...lastEvent.details, stale: true } });
      else renderNoEvent("Formula 1 unavailable · retrying automatically");
    }
    return { render, renderNoEvent, handleError, dispose: () => global.SportsOverlay.scrolling?.capture(mount) };
  }
  global.SportsOverlay.registry.registerLayout("formula-1", { createLayout });
})(typeof window === "undefined" ? globalThis : window);
