"use strict";
(function initializeDiscGolfLayout(global) {
  const signed = value => value === null || value === undefined ? "—" : value === 0 ? "E" : value > 0 ? `+${value}` : String(value).replace("-", "−");
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const place = player => player.place === null ? "—" : `${player.tied ? "T" : ""}${player.place}`;
  const teeLabel = player => global.SportsOverlay.pdga.formatTeeTime(player);
  const teeClock = player => player.teeTimeUtc ? teeLabel(player).replace(/ [^ ]+$/, "") : player.teeTime.slice(0, 5);
  const through = player => player.status || (player.completed ? "F" : player.started ? player.played ?? "—" : player.teeTime ? teeClock(player) : "—");
  const playerName = player => player.pdgaNumber
    ? `<a href="https://www.pdga.com/player/${encodeURIComponent(player.pdgaNumber)}" target="_blank" rel="noopener">${escape(player.name)}</a>` : escape(player.name);
  const brand = `<span class="pdga-brand"><svg class="pdga-brand-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(-18 12 12)"><ellipse cx="12" cy="10" rx="9" ry="3.5"/><path d="M3 10v3c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5v-3"/><ellipse cx="12" cy="10" rx="5" ry="1.5"/></g></svg>PDGA</span>`;
  function createLayout(root = document) {
    const mount = root.querySelector("#sports-overlay");
    global.SportsOverlay.odds?.clear(mount);
    mount.className = "pdga-scorebug is-loading";
    delete mount.dataset.preseason;
    let lastEvent = null, scrollState = null;
    function render(event) {
      const scrollSnapshot = global.SportsOverlay.scrolling?.capture(mount);
      lastEvent = event;
      const { details, competitors } = event;
      const stale = details.stale && event.state !== "pregame";
      const leaders = competitors.filter(player => !player.status).slice(0, details.leaderboardSize === 3 ? 3 : 10);
      const showRatings = event.state === "pregame" && competitors.some(player => player.rating > 0);
      const featured = details.view === "player" && competitors.find(player => player.pdgaNumber === details.playerId);
      const teePlayers = (featured ? [featured] : leaders).filter(player => !player.status && !player.completed && !player.started && player.teeTime);
      const teeZones = [...new Set(teePlayers.filter(player => player.teeTimeUtc).map(player => teeLabel(player).split(" ").pop()))];
      const mixedLocal = teeZones.length > 0 && teePlayers.some(player => !player.teeTimeUtc);
      const teeZone = teeZones.length === 1 ? teeZones[0] : teeZones.length > 1 ? "TZ*" : "LOCAL";
      const teeHeader = `${event.state === "pregame" ? "TEE" : "THRU / TEE"}${teePlayers.length ? ` (${teeZone})` : ""}`;
      const displayThrough = player => `${through(player)}${mixedLocal && teePlayers.includes(player) && !player.teeTimeUtc ? "*" : ""}`;
      mount.classList.toggle("has-tee-times", teePlayers.length > 0);
      const roundLabel = `R${details.round}`;
      const state = event.state === "final" ? "FINAL" : event.state === "interrupted" ? "BREAK" : event.state === "live" ? "LIVE" : "UPCOMING";
      const winner = competitors.find(player => player.wonPlayoff);
      let footer = `${competitors.length} players · ${details.dateRange}`;
      if (winner) footer = `${winner.shortName} wins playoff · ${details.dateRange}`;
      if (event.state === "pregame") footer = [showRatings ? "By PDGA rating" : "", details.dateRange,
        !teeZones.length ? "Tee times are course local" : ""].filter(Boolean).join(" · ");
      if (details.view === "player" && !featured) footer = "Followed player unavailable · showing leaders";
      if (featured) {
        const course = details.layouts.find(layout => Number(layout.LayoutID) === featured.layoutId)?.CourseName;
        footer = [course, featured.status || (featured.started ? `${featured.roundScore ?? "—"} strokes · ${featured.holes ?? "—"} holes` : featured.teeTime ? `Tee ${teeClock(featured)}` : "Awaiting tee time")].filter(Boolean).join(" · ");
      }
      if (event.state === "interrupted") footer = event.detailedState === "Round complete"
        ? `Round ${details.round} complete · awaiting next round` : event.detailedState;
      if (stale) footer = event.state === "live"
        ? "STALE · Last received scores · retrying automatically"
        : "Last received scores · awaiting scheduled update";
      if (mixedLocal) footer += " · * course local";
      if (teeZones.length > 1) footer += ` · * Tee time zones: ${teeZones.join(", ")} · hover times for details`;
      mount.classList.remove("is-loading", "is-hidden");
      mount.dataset.sport = "disc-golf"; mount.dataset.state = event.state; mount.dataset.stale = String(stale);
      mount.setAttribute("aria-label", `${details.name}, ${details.division}, round ${details.round}, ${event.detailedState}${stale ? ", stale scores" : ""}`);
      mount.innerHTML = `<div class="pdga-bar">${brand}<a class="pdga-event" href="https://www.pdga.com/tour/event/${encodeURIComponent(details.tournamentId)}" target="_blank" rel="noopener" title="${escape(details.name)}">${escape(details.name)}</a><span class="pdga-state">${escape(details.division)} · ${roundLabel} · ${state}</span></div>
        ${featured ? `<div class="pdga-focus"><span class="pdga-place">${place(featured)}</span><div class="pdga-person"><strong class="pdga-name">${playerName(featured)}</strong><span class="pdga-sub">${featured.wonPlayoff ? "Playoff winner" : `PDGA #${escape(featured.pdgaNumber)}`} · ${roundLabel}</span></div>${metric("TOTAL", signed(featured.total), "pdga-total")}${metric("ROUND", signed(featured.roundToPar))}${metric(!featured.started && featured.teeTime ? `TEE (${teeZone})` : "THRU", through(featured))}</div><div class="pdga-chase"><span>LEADERS</span>${leaders.slice(0, 3).map(player => `<span>${place(player)} ${escape(player.shortName)} <b>${signed(player.total)}</b></span>`).join("")}</div>`
        : `<div class="pdga-board"><div class="pdga-labels"><span>POS</span><span>PLAYER</span><span>${showRatings ? "RATING" : "TOTAL"}</span><span>ROUND</span><span>${escape(teeHeader)}</span></div><div class="scorebug-vertical-viewport"><div class="scorebug-vertical-track">${leaders.length ? leaders.map(player => `<div class="pdga-entry"><span class="pdga-place">${place(player)}</span><strong class="pdga-name">${playerName(player)}${player.wonPlayoff ? '<span class="pdga-playoff">PLAYOFF</span>' : ""}</strong><strong class="pdga-total">${showRatings ? player.rating ?? "—" : signed(player.total)}</strong><span>${signed(player.roundToPar)}</span><span class="pdga-thru" title="${escape(!player.started && player.teeTime ? `Tee ${teeLabel(player)}` : through(player))}">${escape(displayThrough(player))}</span></div>`).join("") : '<div class="pdga-empty">Awaiting player scores</div>'}</div></div></div>`}
        <div class="pdga-footer"><span class="scorebug-scroll-viewport"><span class="scorebug-scroll-text">${escape(footer)}</span></span><a href="https://www.pdga.com/live/event/${encodeURIComponent(details.tournamentId)}/${encodeURIComponent(details.division)}/scores?round=${encodeURIComponent(details.round)}" target="_blank" rel="noopener">Scores: PDGA ↗</a></div>`;
      global.SportsOverlay.scrolling?.render(mount.querySelector(".scorebug-scroll-viewport"), mount.querySelector(".scorebug-scroll-text"), footer);
      scrollState = global.SportsOverlay.scrolling?.vertical(mount.querySelector(".scorebug-vertical-viewport"), event, scrollState);
      global.SportsOverlay.scrolling?.restore(mount, scrollSnapshot);
      return event.state;
    }
    function renderNoEvent(message = "Choose a PDGA tournament in Settings", visible = true) {
      global.SportsOverlay.scrolling?.capture(mount);
      lastEvent = null; scrollState = null;
      mount.setAttribute("aria-label", `PDGA · ${message}`);
      delete mount.dataset.stale;
      mount.classList.remove("is-loading"); mount.classList.toggle("is-hidden", !visible);
      mount.innerHTML = `<div class="pdga-bar">${brand}<span>DISC GOLF</span></div><div class="pdga-empty">${escape(message)}</div>`;
    }
    function handleError(message, error) {
      console.warn(`[SportsOver] ${message}`, error);
      if (lastEvent) render({ ...lastEvent, details: { ...lastEvent.details, stale: true } });
      else renderNoEvent("PDGA unavailable · awaiting scheduled update");
    }
    function dispose() { global.SportsOverlay.scrolling?.capture(mount); }
    return { render, renderNoEvent, handleError, dispose };
  }
  function metric(label, value, className = "") { return `<div class="pdga-metric"><small>${label}</small><strong class="${className}">${escape(value)}</strong></div>`; }
  global.SportsOverlay.registry.registerLayout("disc-golf", { createLayout });
})(typeof window === "undefined" ? globalThis : window);
