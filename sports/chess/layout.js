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
  const roundUrl = roundId => /^[a-zA-Z0-9]{8}$/.test(roundId || "")
    ? `https://lichess.org/broadcast/-/-/${roundId}` : "";
  function playerUrl(person, roundId, gameId) {
    const base = roundUrl(roundId);
    if (!base) return "";
    if (/^[a-zA-Z0-9]{8}$/.test(gameId || "")) return `${base}/${gameId}`;
    const id = /^fide:([1-9]\d*)$/.exec(person.id || "")?.[1] || person.name;
    return id ? `${base}#players/${encodeURIComponent(id)}` : "";
  }
  function playerName(person, roundId, gameId) {
    const href = playerUrl(person, roundId, gameId);
    const text = `${person.title ? `<small>${escape(person.title)}</small> ` : ""}${escape(person.name)}`;
    const title = `${person.name}${href ? href.includes("#players/") ? " · Open player card on Lichess" : " · Open game on Lichess" : ""}`;
    return href ? `<a class="chess-name" href="${escape(href)}" target="_blank" rel="noopener" title="${escape(title)}">${text}</a>`
      : `<span class="chess-name" title="${escape(title)}">${text}</span>`;
  }
  const player = (person, roundId, gameId) => `<span class="chess-piece chess-piece--${person.color}" aria-label="${person.color}"></span>${playerName(person, roundId, gameId)}`;
  function matchup(game, standings, roundId) {
    const status = game.result || (game.state === "live" ? game.move ? `M${game.move}` : "LIVE" : game.state === "final" ? "END" : "NEXT");
    const description = game.result || (game.state === "live" ? `${game.turn ? `${game.turn === "white" ? "White" : "Black"} to move` : "Live"}${game.move ? ` · move ${game.move}` : ""}` : game.state === "final" ? "Complete · result unavailable" : "Awaiting start");
    const side = person => {
      const standing = standings.get(person.id), active = game.state === "live" && game.turn === person.color;
      return `<span class="chess-match-person${active ? " is-turn" : ""}">${player(person, roundId, game.id)}<span class="chess-total" title="${escape(`${person.name}: ${standing?.score ?? "unavailable"} tournament points`)}">${standing?.score ?? "—"}</span></span><span class="chess-match-clock${active ? " is-turn" : ""}" title="Last broadcast clock">${clock(person.clock)}</span>`;
    };
    return `<div class="chess-matchup" data-game-id="${escape(game.id)}"><span class="chess-board-number">${game.board}</span>${side(game.players[0])}<strong class="chess-match-status" title="${escape(description)}" aria-label="${escape(description)}">${escape(status)}</strong>${side(game.players[1])}</div>`;
  }
  const brand = `<span class="chess-brand"><svg class="chess-brand-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18c0-4 2-6 5-8l-5 2-3-3 5-5V2l4 2c5 1 7 5 7 10v4H7Z"/><path d="M7 18h13v3H5v-3h2Z"/><circle cx="11" cy="7" r=".8" fill="currentColor" stroke="none"/></svg>CHESS</span>`;
  function createLayout(root = document) {
    const mount = root.querySelector("#sports-overlay");
    global.SportsOverlay.odds?.clear(mount);
    mount.className = "chess-scorebug is-loading";
    delete mount.dataset.preseason;
    let lastEvent = null, scrollState = null;
    function render(event) {
      const scrollSnapshot = global.SportsOverlay.scrolling?.capture(mount);
      lastEvent = event;
      const d = event.details, games = d.games || [];
      const featured = d.view === "player" && games.find(game => game.players.some(person => person.id === d.playerId));
      const showMatchups = d.view !== "player" && event.state === "live" && games.length > 0;
      const shown = (d.standings || []).slice(0, d.leaderboardSize === 3 ? 3 : 10);
      const standings = new Map((d.standings || []).map(person => [person.id, person]));
      const state = { live: "LIVE", pregame: "UPCOMING", interrupted: "BREAK", final: "FINAL" }[event.state];
      let footer = `${games.filter(game => game.state === "live").length} live · ${games.filter(game => game.state === "final").length}/${games.length} finished${d.timeControl ? ` · ${d.timeControl}` : ""}`;
      if (event.state === "pregame") footer = event.startTime ? global.SportsOverlay.model.formatPregameStart(event.startTime) : "Awaiting pairings and round start";
      if (featured) footer = featured.result ? `Board ${featured.board} · ${featured.result === "½-½" ? "Draw" : featured.result === "1-0" ? "White wins" : "Black wins"}`
        : `Board ${featured.board} · ${featured.state === "live" ? `${featured.turn ? `${featured.turn === "white" ? "White" : "Black"} to move` : "Live"}${featured.move ? ` · move ${featured.move}` : ""}` : "Awaiting start"} · Clocks: last broadcast update`;
      if (d.view === "player" && !featured) footer = "Followed player absent · showing tournament standings";
      if (showMatchups) footer += ` · Clocks: last broadcast update · ${d.standingsUnavailable ? shown.length ? "STALE tournament points" : "Tournament points unavailable" : shown.length ? "Points: tournament totals" : "Tournament points not published"}`;
      if (!featured && !showMatchups && d.view !== "player") footer = "Tournament standings · Points and tiebreak order from Lichess";
      if (!featured && !showMatchups && !shown.length) footer = "Tournament scores are not published for this broadcast yet";
      if (!featured && !showMatchups && d.standingsUnavailable) footer = shown.length ? "STALE standings · Last received tournament scores" : "Tournament standings unavailable · retrying automatically";
      if (event.state === "pregame" && event.startTime) footer = `${global.SportsOverlay.model.formatPregameStart(event.startTime)} · ${footer}`;
      if (d.lastPlay) footer = d.lastPlay;
      if (event.state === "interrupted") footer = event.detailedState === "Round complete"
        ? "Round complete · awaiting next round" : event.detailedState;
      if (d.delay) footer += ` · ${d.delay}s broadcast delay`;
      if (d.stale) footer = "STALE · Last received broadcast · awaiting scheduled update";
      mount.classList.remove("is-loading", "is-hidden");
      mount.dataset.sport = "chess"; mount.dataset.state = event.state; mount.dataset.stale = String(d.stale);
      mount.setAttribute("aria-label", `${d.name}, ${d.roundName}, ${event.detailedState}${d.stale ? ", stale broadcast" : ""}`);
      const href = `https://lichess.org/broadcast/-/-/${encodeURIComponent(d.roundId)}`;
      mount.innerHTML = `<div class="chess-bar">${brand}<a class="chess-event" href="${href}" target="_blank" rel="noopener" title="${escape(d.name)}">${escape(d.name)}</a><span class="chess-state" title="${escape(d.roundName)}">${escape(d.roundName)} · ${state}</span></div>
        ${featured ? `<div class="chess-focus">${featured.players.map(person => `<div class="chess-player${featured.state === "live" && person.color === featured.turn ? " is-turn" : ""}"><div class="chess-person">${player(person, d.roundId, featured.id)}<span class="chess-rating">${person.rating ?? "Unrated"}${person.federation ? ` · ${escape(person.federation)}` : ""}</span></div><strong class="chess-clock" title="Last broadcast clock">${clock(person.clock)}</strong><strong class="chess-point">${featured.result ? featured.result === "½-½" ? "½" : featured.result === (person.color === "white" ? "1-0" : "0-1") ? "1" : "0" : ""}</strong></div>`).join("")}</div>`
        : showMatchups ? `<div class="chess-board chess-matchups"><div class="chess-match-labels"><span>BD</span><span class="chess-match-side-label"><span>WHITE</span><span>PTS</span></span><span>CLOCK</span><span title="Move number or result">MOVE/RES</span><span class="chess-match-side-label"><span>BLACK</span><span>PTS</span></span><span>CLOCK</span></div><div class="scorebug-vertical-viewport" data-scroll-key="matchups:${escape(d.roundId)}" data-scroll-label="${games.length} round matchups. Scroll to see all boards."><div class="scorebug-vertical-track">${games.map(game => matchup(game, standings, d.roundId)).join("")}</div></div></div>`
        : `<div class="chess-board"><div class="chess-labels"><span>POS</span><span>PLAYER</span><span>PLAYED</span><span>POINTS</span></div><div class="scorebug-vertical-viewport"><div class="scorebug-vertical-track">${shown.length ? shown.map(person => `<div class="chess-entry"><span class="chess-board-number">${person.rank ?? "—"}</span><span class="chess-person">${playerName(person, d.roundId)}</span><span class="chess-played">${person.played ?? "—"}</span><strong class="chess-result">${escape(person.score)}</strong></div>`).join("") : '<div class="chess-empty">Tournament standings unavailable</div>'}</div></div></div>`}
        <div class="chess-footer"><span class="scorebug-scroll-viewport"><span class="scorebug-scroll-text">${escape(footer)}</span></span><a href="${href}" target="_blank" rel="noopener">Lichess ↗</a></div>`;
      global.SportsOverlay.scrolling?.render(mount.querySelector(".scorebug-scroll-viewport"), mount.querySelector(".scorebug-scroll-text"), footer);
      scrollState = global.SportsOverlay.scrolling?.vertical(mount.querySelector(".scorebug-vertical-viewport"), event, scrollState);
      global.SportsOverlay.scrolling?.restore(mount, scrollSnapshot);
      return event.state;
    }
    function renderNoEvent(message = "Choose a chess broadcast in Settings", visible = true) {
      global.SportsOverlay.scrolling?.capture(mount);
      lastEvent = null; scrollState = null;
      mount.classList.remove("is-loading"); mount.classList.toggle("is-hidden", !visible);
      delete mount.dataset.stale;
      mount.setAttribute("aria-label", `Chess · ${message}`);
      mount.innerHTML = `<div class="chess-bar">${brand}<span>LICHESS BROADCASTS</span></div><div class="chess-empty">${escape(message)}</div>`;
    }
    function handleError(message, error) {
      console.warn(`[SportsOver] ${message}`, error);
      if (lastEvent) render({ ...lastEvent, details: { ...lastEvent.details, stale: true } });
      else renderNoEvent("Chess broadcast unavailable · awaiting scheduled update");
    }
    function dispose() { global.SportsOverlay.scrolling?.capture(mount); }
    return { render, renderNoEvent, handleError, dispose };
  }
  global.SportsOverlay.chessLayout = { clock, playerUrl };
  global.SportsOverlay.registry.registerLayout("chess", { createLayout });
})(typeof window === "undefined" ? globalThis : window);
