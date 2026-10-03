"use strict";
(function initializePdgaSettings(global) {
  function tournamentId(value) {
    const text = String(value || "").trim();
    if (/^[1-9]\d{0,8}$/.test(text)) return text;
    try {
      const url = new URL(text);
      if (!["pdga.com", "www.pdga.com", "pdgalive.com", "www.pdgalive.com"].includes(url.hostname)) return "";
      const id = url.pathname.match(/\/(?:event|tour\/event)\/(\d+)/)?.[1]
        || url.searchParams.get("TournID") || url.searchParams.get("EventID");
      return /^[1-9]\d{0,8}$/.test(id || "") ? id : "";
    } catch (_) { return ""; }
  }
  function render(container, group, changed, fetchImpl) {
    const client = global.SportsOverlay.pdga.createClient({ fetchImpl });
    const automatic = document.createElement("div");
    automatic.className = "pdga-watch-card";
    automatic.innerHTML = `<label class="toggle"><input type="checkbox" class="pdga-auto-follow">Automatically follow the pro tour</label>
      <p>Follow one Elite Series or Major tournament through live rounds and round breaks. Manual watches keep their saved views. With nothing live, your fallback setting applies.</p>
      <div class="pdga-watch-controls"><label class="toggle"><input type="checkbox" class="pdga-auto-division" value="MPO">MPO</label><label class="toggle"><input type="checkbox" class="pdga-auto-division" value="FPO">FPO</label></div>
      <p>Elite event search repeats every 15 minutes while SportsOver is running. Discovered divisions appear in the automatic watch list below and are labeled Automatic in Live control. Exclude them there, or choose Watch division to keep them in your watch list.</p>`;
    automatic.insertAdjacentHTML("beforeend", `<label class="toggle"><input type="checkbox" class="pdga-second-tier">Find select second-tier live tournaments</label><p>Live MPO/FPO at pro A-tier events, ranked by the top five player ratings relative to each division. Up to 3 tournaments in Available games. Checked every 15 minutes. Add a suggestion to rotation or watch it to keep following. Prestige and field strength are used; prize pools are not verified.</p>`);
    const secondTier = automatic.querySelector(".pdga-second-tier"); secondTier.checked = group.discoverSecondTier !== false;
    secondTier.onchange = () => { group.discoverSecondTier = secondTier.checked; changed(); };
    const toggle = automatic.querySelector(".pdga-auto-follow");
    toggle.checked = group.autoFollow;
    toggle.onchange = () => { group.autoFollow = toggle.checked; changed(); };
    automatic.querySelectorAll(".pdga-auto-division").forEach(input => {
      input.checked = group.autoDivisions.includes(input.value);
      input.onchange = () => { group.autoDivisions = [...automatic.querySelectorAll(".pdga-auto-division:checked")].map(item => item.value); changed(); };
    });
    const list = document.createElement("div");
    const builder = document.createElement("div");
    builder.className = "pdga-watch-builder";
    builder.innerHTML = `<p>Watch a tournament and division. Watched events stay in rotation until removed, including finished events. Live mode includes live rounds and round breaks. Add a separate player banner to follow someone in the same division. Up to 30 banners.</p>
      <div class="pdga-watch-controls"><label class="field">PDGA tournament URL or ID<input class="pdga-tournament-input" placeholder="e.g. 86076" type="text"></label><button class="button button--secondary pdga-load" type="button">Load tournament</button><button class="button button--secondary pdga-browse" type="button">Browse current events</button></div>
      <label class="field pdga-current-label" hidden>Current events<select class="pdga-current"><option value="">Choose a tournament…</option></select></label>
      <div class="pdga-watch-controls pdga-division-controls" hidden><label class="field">Division<select class="pdga-division"></select></label><button class="button button--secondary pdga-watch" type="button" title="Add the selected tournament division (such as MPO or FPO) to your watch list and follow its leaderboard across rounds. It stays watched until you remove it.">Watch division</button></div>
      <p class="pdga-settings-status" role="status"></p>`;
    const find = selector => builder.querySelector(selector);
    const note = find(".pdga-settings-status");
    let metadata = null, loadedId = "", revision = 0;
    async function loadTournament() {
      const id = tournamentId(find(".pdga-tournament-input").value);
      if (!id) { note.textContent = "Enter a PDGA tournament ID or a pdga.com / pdgalive.com event link."; return; }
      const request = ++revision;
      metadata = null; find(".pdga-division-controls").hidden = true;
      note.textContent = "Loading tournament…";
      try {
        const result = await client.getMetadata(id);
        if (request !== revision || !builder.isConnected) return;
        metadata = result; loadedId = id;
        find(".pdga-division").replaceChildren(...metadata.Divisions.map(item => new Option(`${item.Division} · ${item.DivisionName} (${item.Players})`, item.Division)));
        find(".pdga-division-controls").hidden = !metadata.Divisions.length;
        note.textContent = metadata.Divisions.length ? `${metadata.Name} · ${metadata.DateRange}` : "No divisions have been posted for this tournament yet.";
      } catch (error) { if (request === revision) note.textContent = `${error.message}. Try again.`; }
    }
    find(".pdga-load").onclick = loadTournament;
    find(".pdga-tournament-input").addEventListener("input", () => {
      revision++; metadata = null; find(".pdga-division-controls").hidden = true;
    });
    find(".pdga-tournament-input").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); loadTournament(); } });
    find(".pdga-browse").onclick = async event => {
      event.target.disabled = true; note.textContent = "Loading current PDGA events…";
      try {
        const events = await client.listCurrentEvents();
        find(".pdga-current").replaceChildren(new Option("Choose a tournament…", ""), ...events.map(item => new Option(`${item.officialName} · ${String(item.startDate).slice(0, 10)}`, item.tournId)));
        find(".pdga-current-label").hidden = false;
        note.textContent = `${events.length} tournaments available. You can also paste an older event link.`;
      } catch (error) { note.textContent = `${error.message}. You can still load a tournament by ID.`; }
      finally { event.target.disabled = false; }
    };
    find(".pdga-current").onchange = event => {
      if (!event.target.value) return;
      find(".pdga-tournament-input").value = event.target.value;
      loadTournament();
    };
    find(".pdga-watch").onclick = () => {
      const division = find(".pdga-division").value;
      if (!metadata || !division) return;
      if (group.events.length >= 30) { note.textContent = "Remove a watched division before adding another (limit 30)."; return; }
      if (group.events.some(item => item.tournamentId === loadedId && item.division === division && !item.bannerId)) { note.textContent = "That division is already watched."; return; }
      group.events.push({ tournamentId: loadedId, division, name: metadata.SimpleName || metadata.Name, enabled: true, view: "leaderboard", playerId: "" });
      changed(); renderList(); note.textContent = `${division} added to the banner rotation.`;
    };
    function renderList(addedWatch) {
      list.replaceChildren();
      if (!group.events.length) {
        const empty = document.createElement("p"); empty.className = "empty-state";
        empty.textContent = "No PDGA divisions watched. Add a tournament below."; list.append(empty);
      }
      group.events.forEach((watch, index) => {
        const row = document.createElement("article"); row.className = "pdga-watch-card";
        row.innerHTML = `<div class="pdga-watch-heading"><a class="pdga-watch-name" target="_blank" rel="noopener"></a><label class="toggle"><input type="checkbox" class="pdga-enabled">Included</label><button type="button" class="icon-button pdga-up" aria-label="Move division up">↑</button><button type="button" class="icon-button pdga-down" aria-label="Move division down">↓</button><button type="button" class="remove-team pdga-remove">Remove</button></div><div class="pdga-watch-controls"><label class="field">Banner view<select class="pdga-view"><option value="leaderboard">Tournament leaderboard</option><option value="player">Followed player</option></select></label><label class="field pdga-size-label">Players shown<select class="pdga-size"><option value="10">Top 10 · scroll vertically</option><option value="3">Top 3 · static</option></select></label><button class="button button--secondary pdga-add-banner" type="button">Add player banner</button><span class="pdga-pending" hidden>Select a player to include this banner in rotation.</span><label class="field pdga-player-label" hidden>Player<select class="pdga-player"></select></label><button type="button" class="button button--quiet pdga-players" hidden>Retry loading players</button></div><span class="pdga-row-status" role="status"></span>`;
        const q = selector => row.querySelector(selector);
        q(".pdga-watch-name").textContent = `${watch.name} · ${watch.division}`;
        q(".pdga-watch-name").href = `https://www.pdga.com/tour/event/${watch.tournamentId}`;
        q(".pdga-enabled").checked = watch.enabled;
        q(".pdga-enabled").onchange = event => { watch.enabled = event.target.checked; changed(); };
        q(".pdga-up").disabled = index === 0;
        q(".pdga-down").disabled = index === group.events.length - 1;
        const move = direction => { [group.events[index], group.events[index + direction]] = [group.events[index + direction], group.events[index]]; changed(); renderList(); };
        q(".pdga-up").onclick = () => move(-1); q(".pdga-down").onclick = () => move(1);
        q(".pdga-remove").onclick = () => { group.events.splice(index, 1); changed(watch); renderList(); };
        q(".pdga-view").value = watch.view;
        q(".pdga-size").value = String(watch.leaderboardSize === 3 ? 3 : 10);
        q(".pdga-size").onchange = event => { watch.leaderboardSize = Number(event.target.value); changed(); };
        q(".pdga-add-banner").onclick = () => {
          if (group.events.length >= 30) { q(".pdga-row-status").textContent = "Remove a banner before adding another (limit 30)."; return; }
          const added = { ...watch, bannerId: [...global.crypto.getRandomValues(new Uint32Array(4))].join("-"), enabled: true,
            view: watch.view === "player" ? "leaderboard" : "player", playerId: "" };
          group.events.splice(index + 1, 0, added); changed(); renderList(added);
        };
        const picker = q(".pdga-player");
        picker.append(new Option(watch.playerId ? `PDGA #${watch.playerId}` : "Choose a player…", watch.playerId));
        picker.onchange = () => { watch.playerId = picker.value; changed(); updateView(); };
        let loadingPlayers = false, retryPlayers = false;
        async function loadPlayers() {
          if (loadingPlayers) return;
          loadingPlayers = true; retryPlayers = false; picker.disabled = true;
          updateView();
          q(".pdga-players").disabled = true; q(".pdga-row-status").textContent = "Loading players…";
          try {
            const event = await client.getMetadata(watch.tournamentId);
            const roundNumber = event.Divisions.find(item => item.Division === watch.division)?.LatestRound || event.LatestRound || 1;
            const round = await client.getRound(watch.tournamentId, watch.division, roundNumber);
            if (!row.isConnected) return;
            const players = round.scores.filter(score => score.PDGANum);
            picker.replaceChildren(new Option("Choose a player…", ""), ...players.map(score => new Option(`${score.Name} · #${score.PDGANum}`, String(score.PDGANum))));
            if (watch.playerId && !players.some(score => String(score.PDGANum) === watch.playerId)) picker.add(new Option(`PDGA #${watch.playerId} · not in current round`, watch.playerId));
            picker.value = watch.playerId;
            retryPlayers = players.length === 0;
            q(".pdga-row-status").textContent = players.length ? "If the selected player is absent, the banner shows the leaders." : "No players posted yet. The banner will show the leaderboard until a player is selected.";
          } catch (_) {
            retryPlayers = true;
            if (row.isConnected) q(".pdga-row-status").textContent = "Player list unavailable. Your saved selection is retained. Retry loading players.";
          } finally {
            loadingPlayers = false; picker.disabled = false;
            q(".pdga-players").disabled = false; updateView();
          }
        }
        function updateView() { q(".pdga-pending").hidden = watch.view !== "player" || Boolean(watch.playerId);
          q(".pdga-size-label").hidden = watch.view === "player";
          q(".pdga-add-banner").textContent = watch.view === "player" ? "Add tournament banner" : "Add player banner";
          q(".pdga-player-label").hidden = watch.view !== "player";
          q(".pdga-players").hidden = watch.view !== "player" || !retryPlayers;
        }
        q(".pdga-view").onchange = event => { watch.view = event.target.value; changed(); updateView(); if (watch.view === "player") loadPlayers(); };
        q(".pdga-players").onclick = () => { fetchImpl?.retryFailed?.(); loadPlayers(); };
        updateView(); list.append(row);
        if (watch.view === "player") loadPlayers();
        if (watch === addedWatch) row.querySelector("select").focus();
      });
    }
    container.replaceChildren(automatic, list, builder); renderList();
  }
  global.SportsOverlay.pdgaSettings = { render, tournamentId };
})(typeof window === "undefined" ? globalThis : window);
