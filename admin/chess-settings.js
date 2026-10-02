"use strict";
(function initializeChessSettings(global) {
  function render(container, group, changed, fetchImpl, session) {
    const api = global.SportsOverlay.lichess, client = api.createClient({ fetchImpl, session });
    const list = document.createElement("div"), builder = document.createElement("div");
    builder.className = "pdga-watch-builder chess-watch-builder";
    builder.innerHTML = `<p>Watch a public Lichess broadcast. Follow its current round automatically, or keep a specific round. Watched broadcasts stay in rotation until removed, including finals. Up to 30 watches.</p>
      <div class="pdga-watch-controls"><label class="field">Lichess broadcast URL or ID<input class="chess-input" type="text" placeholder="Paste a lichess.org/broadcast link"></label><button class="button button--secondary chess-load" type="button">Load broadcast</button><button class="button button--quiet chess-browse" type="button">Browse current broadcasts</button></div>
      <label class="field chess-current-label" hidden>Current broadcasts<select class="chess-current"></select></label>
      <div class="pdga-watch-controls chess-round-controls" hidden><label class="field">Round<select class="chess-round"></select></label><button class="button button--secondary chess-watch" type="button">Watch broadcast</button></div>
      <p class="chess-status" role="status"></p>`;
    const q = selector => builder.querySelector(selector), note = q(".chess-status");
    let metadata = null, revision = 0;
    async function load() {
      const request = ++revision;
      metadata = null; q(".chess-round-controls").hidden = true;
      note.textContent = "Loading broadcast…";
      try {
        const result = await client.resolve(q(".chess-input").value);
        if (request !== revision || !builder.isConnected) return;
        metadata = result.metadata;
        q(".chess-round").replaceChildren(new Option("Current round · follow automatically", ""), ...metadata.rounds.map(round => new Option(round.name, round.id)));
        q(".chess-round").value = result.roundId;
        q(".chess-round-controls").hidden = !metadata.rounds.length;
        note.textContent = metadata.rounds.length ? metadata.tour.name : "No rounds have been posted yet. Try again later.";
      } catch (error) { if (request === revision && builder.isConnected) note.textContent = `${error.message}. Try again.`; }
    }
    q(".chess-load").onclick = load;
    q(".chess-input").oninput = () => { revision++; metadata = null; q(".chess-round-controls").hidden = true; };
    q(".chess-input").onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); load(); } };
    q(".chess-browse").onclick = async event => {
      event.target.disabled = true; note.textContent = "Loading current broadcasts…";
      try {
        const events = await client.listCurrentEvents();
        if (!builder.isConnected) return;
        q(".chess-current").replaceChildren(new Option("Choose a broadcast…", ""), ...events.map(tour => new Option(tour.name, tour.id)));
        q(".chess-current-label").hidden = false;
        note.textContent = `${events.length} broadcasts available. You can also paste an older broadcast link.`;
      } catch (error) { note.textContent = `${error.message}. You can still paste a broadcast link.`; }
      finally { event.target.disabled = false; }
    };
    q(".chess-current").onchange = event => { if (event.target.value) { q(".chess-input").value = event.target.value; load(); } };
    q(".chess-watch").onclick = () => {
      if (!metadata) return;
      const watch = { tournamentId: metadata.tour.id, roundId: q(".chess-round").value, name: metadata.tour.name, enabled: true, view: "overview", playerId: "" };
      if (group.events.some(item => api.watchId(item) === api.watchId(watch))) { note.textContent = "That broadcast and round are already watched."; return; }
      if (group.events.length >= 30) { note.textContent = "Remove a watch before adding another (limit 30)."; return; }
      group.events.push(watch); changed(); renderList(); note.textContent = "Broadcast added to the banner rotation.";
    };
    function renderList() {
      list.replaceChildren();
      if (!group.events.length) {
        const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No chess broadcasts watched. Add one below."; list.append(empty);
      }
      group.events.forEach((watch, index) => {
        const row = document.createElement("article"); row.className = "pdga-watch-card chess-watch-card";
        row.innerHTML = `<div class="pdga-watch-heading"><a class="chess-watch-name" target="_blank" rel="noopener"></a><label class="toggle"><input class="chess-enabled" type="checkbox">Included</label><button class="icon-button chess-up" type="button" aria-label="Move broadcast up">↑</button><button class="icon-button chess-down" type="button" aria-label="Move broadcast down">↓</button><button class="remove-team chess-remove" type="button">Remove</button></div>
          <div class="pdga-watch-controls"><label class="field">Banner view<select class="chess-view"><option value="overview">Round overview · three boards</option><option value="player">Followed player · matchup and clocks</option></select></label><label class="field chess-player-label" hidden>Player<select class="chess-player"></select></label><button class="button button--quiet chess-players" type="button" hidden>Load players</button></div><p class="chess-row-status" role="status"></p>`;
        const r = selector => row.querySelector(selector);
        r(".chess-watch-name").textContent = `${watch.name} · ${watch.roundId ? "Pinned round" : "Current round"}`;
        r(".chess-watch-name").href = watch.roundId ? `https://lichess.org/broadcast/-/-/${watch.roundId}` : `https://lichess.org/broadcast/-/${watch.tournamentId}`;
        r(".chess-enabled").checked = watch.enabled;
        r(".chess-enabled").onchange = event => { watch.enabled = event.target.checked; changed(); };
        r(".chess-up").disabled = index === 0; r(".chess-down").disabled = index === group.events.length - 1;
        const move = direction => { [group.events[index], group.events[index + direction]] = [group.events[index + direction], group.events[index]]; changed(); renderList(); };
        r(".chess-up").onclick = () => move(-1); r(".chess-down").onclick = () => move(1);
        r(".chess-remove").onclick = () => { group.events.splice(index, 1); changed(); renderList(); };
        r(".chess-view").value = watch.view;
        const picker = r(".chess-player");
        picker.append(new Option(watch.playerId ? watch.playerId.replace(/^name:/, "").replace(/^fide:/, "FIDE #") : "Choose a player…", watch.playerId));
        picker.onchange = () => { watch.playerId = picker.value; changed(); };
        async function loadPlayers() {
          r(".chess-players").disabled = true; r(".chess-row-status").textContent = "Loading players…";
          try {
            const metadata = await client.getMetadata(watch.tournamentId), round = api.selectRound(metadata, watch.roundId);
            if (!round) throw Error("Round unavailable");
            const payload = await client.getRound(round.id), players = new Map();
            payload.games.forEach(game => (game.players || []).forEach(raw => { const person = api.normalizePlayer(raw); players.set(person.id, person); }));
            if (!row.isConnected) return;
            picker.replaceChildren(new Option("Choose a player…", ""), ...[...players.values()].sort((a, b) => a.name.localeCompare(b.name)).map(person => new Option(`${person.title ? `${person.title} ` : ""}${person.name}`, person.id)));
            if (watch.playerId && !players.has(watch.playerId)) picker.add(new Option(`${watch.playerId.replace(/^name:/, "").replace(/^fide:/, "FIDE #")} · absent this round`, watch.playerId));
            picker.value = watch.playerId;
            r(".chess-row-status").textContent = "If your player is absent in a later round, the banner shows the round overview. Clocks show the last broadcast update.";
          } catch (_) { if (row.isConnected) r(".chess-row-status").textContent = "Player list unavailable. Saved selection is retained; retry Load players."; }
          finally { r(".chess-players").disabled = false; }
        }
        function updateView() { r(".chess-player-label").hidden = watch.view !== "player"; r(".chess-players").hidden = watch.view !== "player"; }
        r(".chess-view").onchange = event => { watch.view = event.target.value; changed(); updateView(); if (watch.view === "player") loadPlayers(); };
        r(".chess-players").onclick = loadPlayers;
        updateView(); list.append(row);
      });
    }
    const automatic = document.createElement("div"); automatic.className = "pdga-watch-card";
    automatic.innerHTML = `<label class="toggle"><input class="chess-auto-follow" type="checkbox">Automatically follow elite tournaments</label><p>Find Lichess best-tier and high-tier events every 15 minutes while SportsOver is running. Follow live rounds and breaks, with your fallback setting when nothing is live. Discovered events appear in the automatic watch list below.</p>`;
    const toggle = automatic.querySelector(".chess-auto-follow"); toggle.checked = group.autoFollow;
    toggle.onchange = () => { group.autoFollow = toggle.checked; changed(); };
    container.replaceChildren(automatic, list, builder); renderList();
  }
  global.SportsOverlay.chessSettings = { render };
})(typeof window === "undefined" ? globalThis : window);
