"use strict";
(function initializeDiscGolfLayout(global) {
  const signed = value => value === null || value === undefined ? "—" : value === 0 ? "E" : value > 0 ? `+${value}` : String(value).replace("-", "−");
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const place = player => player.place === null ? "—" : `${player.tied ? "T" : ""}${player.place}`;
  const through = player => player.status || (player.completed ? "F" : player.started ? player.played ?? "—" : player.teeTime ? player.teeTime.slice(0, 5) : "—");
  const playerName = player => player.pdgaNumber
    ? `<a href="https://www.pdga.com/player/${encodeURIComponent(player.pdgaNumber)}" target="_blank" rel="noopener">${escape(player.name)}</a>` : escape(player.name);
  function createLayout(root = document) {
    const mount = root.querySelector("#sports-overlay");
    global.SportsOverlay.odds?.clear(mount);
    mount.className = "pdga-scorebug is-loading";
    delete mount.dataset.preseason;
    let lastEvent = null, scrollState = null;
    function render(event) {
      lastEvent = event;
      const { details, competitors } = event;
      const stale = details.stale && event.state !== "pregame";
      const leaders = competitors.filter(player => !player.status).slice(0, details.leaderboardSize === 3 ? 3 : 10);
      const featured = details.view === "player" && competitors.find(player => player.pdgaNumber === details.playerId);
      const roundLabel = `R${details.round}`;
      const state = event.state === "final" ? "FINAL" : event.state === "interrupted" ? "BREAK" : event.state === "live" ? "LIVE" : "UPCOMING";
      const winner = competitors.find(player => player.wonPlayoff);
      let footer = `${competitors.length} players · ${details.dateRange}`;
      if (winner) footer = `${winner.shortName} wins playoff · ${details.dateRange}`;
      if (event.state === "interrupted") footer = `Round ${details.round} complete · awaiting next round`;
      if (event.state === "pregame") footer = `${details.dateRange} · Tee times are course local`;
      if (details.view === "player" && !featured) footer = "Followed player unavailable · showing leaders";
      if (featured) {
        const course = details.layouts.find(layout => Number(layout.LayoutID) === featured.layoutId)?.CourseName;
        footer = [course, featured.status || (featured.started ? `${featured.roundScore ?? "—"} strokes · ${featured.holes ?? "—"} holes` : featured.teeTime ? `Tee ${featured.teeTime} (course local)` : "Awaiting tee time")].filter(Boolean).join(" · ");
      }
      if (stale) footer = event.state === "live"
        ? "STALE · Last received scores · retrying automatically"
        : "Last received scores · awaiting scheduled update";
      mount.classList.remove("is-loading", "is-hidden");
      mount.dataset.sport = "disc-golf"; mount.dataset.state = event.state; mount.dataset.stale = String(stale);
      mount.setAttribute("aria-label", `${details.name}, ${details.division}, round ${details.round}, ${event.detailedState}${stale ? ", stale scores" : ""}`);
      mount.innerHTML = `<div class="pdga-bar"><span class="pdga-brand">PDGA</span><a class="pdga-event" href="https://www.pdga.com/tour/event/${encodeURIComponent(details.tournamentId)}" target="_blank" rel="noopener" title="${escape(details.name)}">${escape(details.name)}</a><span class="pdga-state">${escape(details.division)} · ${roundLabel} · ${state}</span></div>
        ${featured ? `<div class="pdga-focus"><span class="pdga-place">${place(featured)}</span><div class="pdga-person"><strong class="pdga-name">${playerName(featured)}</strong><span class="pdga-sub">${featured.wonPlayoff ? "Playoff winner" : `PDGA #${escape(featured.pdgaNumber)}`} · ${roundLabel}</span></div>${metric("TOTAL", signed(featured.total), "pdga-total")}${metric("ROUND", signed(featured.roundToPar))}${metric(!featured.started && featured.teeTime ? "TEE" : "THRU", through(featured))}</div><div class="pdga-chase"><span>LEADERS</span>${leaders.slice(0, 3).map(player => `<span>${place(player)} ${escape(player.shortName)} <b>${signed(player.total)}</b></span>`).join("")}</div>`
        : `<div class="pdga-board"><div class="pdga-labels"><span>POS</span><span>PLAYER</span><span>TOTAL</span><span>ROUND</span><span>${event.state === "pregame" ? "TEE" : "THRU"}</span></div><div class="scorebug-vertical-viewport"><div class="scorebug-vertical-track">${leaders.length ? leaders.map(player => `<div class="pdga-entry"><span class="pdga-place">${place(player)}</span><strong class="pdga-name">${playerName(player)}${player.wonPlayoff ? '<span class="pdga-playoff">PLAYOFF</span>' : ""}</strong><strong class="pdga-total">${signed(player.total)}</strong><span>${signed(player.roundToPar)}</span><span class="pdga-thru" title="${escape(!player.started && player.teeTime ? `Tee ${player.teeTime} (course local)` : through(player))}">${through(player)}</span></div>`).join("") : '<div class="pdga-empty">Awaiting player scores</div>'}</div></div></div>`}
        <div class="pdga-footer"><span class="scorebug-scroll-viewport"><span class="scorebug-scroll-text">${escape(footer)}</span></span><a href="https://www.pdga.com/live/event/${encodeURIComponent(details.tournamentId)}/${encodeURIComponent(details.division)}/scores?round=${encodeURIComponent(details.round)}" target="_blank" rel="noopener">Scores: PDGA ↗</a></div>`;
      global.SportsOverlay.scrolling?.render(mount.querySelector(".scorebug-scroll-viewport"), mount.querySelector(".scorebug-scroll-text"), footer);
      scrollState = global.SportsOverlay.scrolling?.vertical(mount.querySelector(".scorebug-vertical-viewport"), event, scrollState);
      return event.state;
    }
    function renderNoEvent(message = "Choose a PDGA tournament in Settings", visible = true) {
      lastEvent = null; scrollState = null;
      mount.setAttribute("aria-label", `PDGA · ${message}`);
      delete mount.dataset.stale;
      mount.classList.remove("is-loading"); mount.classList.toggle("is-hidden", !visible);
      mount.innerHTML = `<div class="pdga-bar"><span class="pdga-brand">PDGA</span><span>DISC GOLF</span></div><div class="pdga-empty">${escape(message)}</div>`;
    }
    function handleError(message, error) {
      console.warn(`[SportsOver] ${message}`, error);
      if (lastEvent) render({ ...lastEvent, details: { ...lastEvent.details, stale: true } });
      else renderNoEvent("PDGA unavailable · awaiting scheduled update");
    }
    return { render, renderNoEvent, handleError };
  }
  function metric(label, value, className = "") { return `<div class="pdga-metric"><small>${label}</small><strong class="${className}">${escape(value)}</strong></div>`; }
  global.SportsOverlay.registry.registerLayout("disc-golf", { createLayout });
})(typeof window === "undefined" ? globalThis : window);
