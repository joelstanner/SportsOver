"use strict";
(function initializeChessLayout(global) {
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  // Broadcast preview clocks use centiseconds and represent the last source update.
  function clock(value) {
    if (value === null || value === undefined || value < 0) return "—";
    const seconds = Math.floor(value / 100), hours = Math.floor(seconds / 3600);
    return hours ? `${hours}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
      : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  const player = person => `<span class="chess-piece chess-piece--${person.color}" aria-label="${person.color}"></span><span class="chess-name" title="${escape(person.name)}">${person.title ? `<small>${escape(person.title)}</small> ` : ""}${escape(person.name)}</span>`;
  function createLayout(root = document) {
    const mount = root.querySelector("#sports-overlay");
    global.SportsOverlay.odds?.clear(mount);
    mount.className = "chess-scorebug is-loading";
    delete mount.dataset.preseason;
    let lastEvent = null, scrollState = null;
    function render(event) {
      lastEvent = event;
      const d = event.details, games = d.games || [];
      const featured = d.view === "player" && games.find(game => game.players.some(person => person.id === d.playerId));
      const shown = (d.standings || []).slice(0, d.leaderboardSize === 3 ? 3 : 10);
      const state = { live: "LIVE", pregame: "UPCOMING", interrupted: "BREAK", final: "FINAL" }[event.state];
      let footer = `${games.filter(game => game.state === "live").length} live · ${games.filter(game => game.state === "final").length}/${games.length} finished${d.timeControl ? ` · ${d.timeControl}` : ""}`;
      if (event.state === "pregame") footer = event.startTime ? global.SportsOverlay.model.formatPregameStart(event.startTime) : "Awaiting pairings and round start";
      if (featured) footer = featured.result ? `Board ${featured.board} · ${featured.result === "½-½" ? "Draw" : featured.result === "1-0" ? "White wins" : "Black wins"}`
        : `Board ${featured.board} · ${featured.state === "live" ? `${featured.turn ? `${featured.turn === "white" ? "White" : "Black"} to move` : "Live"}${featured.move ? ` · move ${featured.move}` : ""}` : "Awaiting start"} · Clocks: last broadcast update`;
      if (d.view === "player" && !featured) footer = "Followed player absent · showing tournament standings";
      if (!featured && d.view !== "player") footer = "Tournament standings · Points and tiebreak order from Lichess";
      if (!featured && !shown.length) footer = "Tournament scores are not published for this broadcast yet";
      if (!featured && d.standingsUnavailable) footer = shown.length ? "STALE standings · Last received tournament scores" : "Tournament standings unavailable · retrying automatically";
      if (d.lastPlay) footer = d.lastPlay;
      if (event.state === "interrupted") footer = event.detailedState === "Round complete"
        ? "Round complete · awaiting next round" : event.detailedState;
      if (d.delay) footer += ` · ${d.delay}s broadcast delay`;
      if (d.stale) footer = "STALE · Last received broadcast · awaiting scheduled update";
      mount.classList.remove("is-loading", "is-hidden");
      mount.dataset.sport = "chess"; mount.dataset.state = event.state; mount.dataset.stale = String(d.stale);
      mount.setAttribute("aria-label", `${d.name}, ${d.roundName}, ${event.detailedState}${d.stale ? ", stale broadcast" : ""}`);
      const href = `https://lichess.org/broadcast/-/-/${encodeURIComponent(d.roundId)}`;
      mount.innerHTML = `<div class="chess-bar"><span class="chess-brand">♞ CHESS</span><a class="chess-event" href="${href}" target="_blank" rel="noopener" title="${escape(d.name)}">${escape(d.name)}</a><span class="chess-state" title="${escape(d.roundName)}">${escape(d.roundName)} · ${state}</span></div>
        ${featured ? `<div class="chess-focus">${featured.players.map(person => `<div class="chess-player${featured.state === "live" && person.color === featured.turn ? " is-turn" : ""}"><div class="chess-person">${player(person)}<span class="chess-rating">${person.rating ?? "Unrated"}${person.federation ? ` · ${escape(person.federation)}` : ""}</span></div><strong class="chess-clock" title="Last broadcast clock">${clock(person.clock)}</strong><strong class="chess-point">${featured.result ? featured.result === "½-½" ? "½" : featured.result === (person.color === "white" ? "1-0" : "0-1") ? "1" : "0" : ""}</strong></div>`).join("")}</div>`
        : `<div class="chess-board"><div class="chess-labels"><span>POS</span><span>PLAYER</span><span>PLAYED</span><span>POINTS</span></div><div class="scorebug-vertical-viewport"><div class="scorebug-vertical-track">${shown.length ? shown.map(person => `<div class="chess-entry"><span class="chess-board-number">${person.rank ?? "—"}</span><span class="chess-person"><span class="chess-name" title="${escape(person.name)}">${person.title ? `<small>${escape(person.title)}</small> ` : ""}${escape(person.name)}</span></span><span class="chess-played">${person.played ?? "—"}</span><strong class="chess-result">${escape(person.score)}</strong></div>`).join("") : '<div class="chess-empty">Tournament standings unavailable</div>'}</div></div></div>`}
        <div class="chess-footer"><span class="scorebug-scroll-viewport"><span class="scorebug-scroll-text">${escape(footer)}</span></span><a href="${href}" target="_blank" rel="noopener">Lichess ↗</a></div>`;
      global.SportsOverlay.scrolling?.render(mount.querySelector(".scorebug-scroll-viewport"), mount.querySelector(".scorebug-scroll-text"), footer);
      scrollState = global.SportsOverlay.scrolling?.vertical(mount.querySelector(".scorebug-vertical-viewport"), event, scrollState);
      return event.state;
    }
    function renderNoEvent(message = "Choose a chess broadcast in Settings", visible = true) {
      lastEvent = null; scrollState = null;
      mount.classList.remove("is-loading"); mount.classList.toggle("is-hidden", !visible);
      delete mount.dataset.stale;
      mount.setAttribute("aria-label", `Chess · ${message}`);
      mount.innerHTML = `<div class="chess-bar"><span class="chess-brand">♞ CHESS</span><span>LICHESS BROADCASTS</span></div><div class="chess-empty">${escape(message)}</div>`;
    }
    function handleError(message, error) {
      console.warn(`[SportsOver] ${message}`, error);
      if (lastEvent) render({ ...lastEvent, details: { ...lastEvent.details, stale: true } });
      else renderNoEvent("Chess broadcast unavailable · awaiting scheduled update");
    }
    return { render, renderNoEvent, handleError };
  }
  global.SportsOverlay.chessLayout = { clock };
  global.SportsOverlay.registry.registerLayout("chess", { createLayout });
})(typeof window === "undefined" ? globalThis : window);
