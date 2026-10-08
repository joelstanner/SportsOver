"use strict";
(function initializeFormula1Settings(global) {
  function render(container, group, changed, fetchImpl, session) {
    const client = global.SportsOverlay.formula1.createClient({ fetchImpl, session });
    const intro = document.createElement("p");
    intro.textContent = "Follow drivers across every weekend and session. Cards use national flags. Between sessions, keep the last result and the next start time. Up to 30 banners.";
    const list = document.createElement("div"), builder = document.createElement("div");
    builder.className = "pdga-watch-builder";
    builder.innerHTML = `<div class="pdga-watch-controls"><button type="button" class="button button--secondary f1-add-board">Add leaderboard</button><button type="button" class="button button--secondary f1-load-drivers">Load drivers</button><label class="field">Driver<select class="f1-driver"><option value="">Load drivers first…</option></select></label><button type="button" class="button button--secondary f1-add-driver" disabled>Follow driver</button></div><p class="f1-settings-status" role="status"></p>`;
    const q = selector => builder.querySelector(selector), note = q(".f1-settings-status");
    let drivers = [];
    function add(watch) {
      if (group.events.length >= 30) { note.textContent = "Remove a banner before adding another (limit 30)."; return; }
      if (group.events.some(item => item.bannerId === watch.bannerId)) { note.textContent = "That driver is already followed."; return; }
      group.events.push({ tournamentId: "season", enabled: true, leaderboardSize: 10, ...watch });
      changed(); renderList();
    }
    q(".f1-add-board").onclick = () => add({ name: "Formula 1 leaderboard", view: "leaderboard", playerId: "", bannerId: [...global.crypto.getRandomValues(new Uint32Array(4))].join("-") });
    q(".f1-load-drivers").onclick = async () => {
      q(".f1-load-drivers").disabled = true; note.textContent = "Loading the latest available Formula 1 field…";
      fetchImpl.retryFailed?.();
      try {
        drivers = await client.listDrivers();
        if (!builder.isConnected) return;
        q(".f1-driver").replaceChildren(new Option("Choose a driver…", ""), ...drivers.map(driver => new Option(`${driver.name}${driver.team ? ` · ${driver.team}` : ""}`, driver.id)));
        q(".f1-add-driver").disabled = true;
        note.textContent = drivers.length ? "Drivers come from the latest available weekend. New entries appear once ESPN posts them." : "No drivers posted yet. Try again when session entries are available.";
      } catch (error) { note.textContent = `${error.message}. Your saved drivers are retained.`; }
      finally { q(".f1-load-drivers").disabled = false; }
    };
    q(".f1-driver").onchange = () => { q(".f1-add-driver").disabled = !q(".f1-driver").value; };
    q(".f1-add-driver").onclick = () => {
      const driver = drivers.find(item => item.id === q(".f1-driver").value);
      if (driver) add({ name: driver.name, flag: driver.flag, view: "player", playerId: driver.id, bannerId: `driver-${driver.id}` });
    };
    function renderList() {
      list.replaceChildren();
      for (const [index, watch] of group.events.entries()) {
        const row = document.createElement("article"); row.className = "pdga-watch-card f1-watch-card";
        row.innerHTML = `<div class="pdga-watch-heading"><strong class="f1-watch-name"></strong><label class="toggle"><input type="checkbox" class="f1-enabled">Included</label><button type="button" class="icon-button f1-up" aria-label="Move banner up">↑</button><button type="button" class="icon-button f1-down" aria-label="Move banner down">↓</button><button type="button" class="remove-team f1-remove">Remove</button></div><label class="field f1-size-label">Drivers shown<select class="f1-size"><option value="3">Top 3 · static</option><option value="10">Top 10 · scroll vertically</option><option value="all">Full field · scroll vertically</option></select></label>`;
        const find = selector => row.querySelector(selector);
        find(".f1-watch-name").textContent = watch.name;
        find(".f1-enabled").checked = watch.enabled;
        find(".f1-enabled").onchange = event => { watch.enabled = event.target.checked; changed(); };
        find(".f1-remove").onclick = () => { group.events.splice(index, 1); changed(watch); renderList(); };
        find(".f1-size-label").hidden = watch.view === "player";
        find(".f1-size").value = String(watch.leaderboardSize);
        find(".f1-size").onchange = event => { watch.leaderboardSize = event.target.value === "all" ? "all" : Number(event.target.value); changed(); };
        find(".f1-up").disabled = index === 0; find(".f1-down").disabled = index === group.events.length - 1;
        const move = direction => { [group.events[index], group.events[index + direction]] = [group.events[index + direction], group.events[index]]; changed(); renderList(); };
        find(".f1-up").onclick = () => move(-1); find(".f1-down").onclick = () => move(1);
        list.append(row);
      }
    }
    container.replaceChildren(intro, list, builder); renderList();
  }
  global.SportsOverlay.formula1Settings = { render };
})(typeof window === "undefined" ? globalThis : window);
