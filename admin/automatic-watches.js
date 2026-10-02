"use strict";
(function initializeAutomaticWatchSettings(global) {
  function render(container, group, config, changed) {
    const sport = group.sport, items = config.automaticWatchLists[sport] || [];
    const list = document.createElement("div"); list.className = "automatic-watch-list";
    const heading = document.createElement("h4"); heading.textContent = "Automatic watch list"; list.append(heading);
    const note = document.createElement("p"); note.className = "empty-state";
    note.textContent = group.autoFollow ? "Elite event search runs every 15 minutes while SportsOver is running. Keep a watch to choose a player or retain it after the event leaves discovery."
      : "Automatic discovery is off. Turn it on to update these saved watches.";
    list.append(note);
    const manual = new Set(group.events.map(watch => global.SportsOverlay.automaticWatches.keyOf(sport, watch)));
    const visible = items.filter(watch => (sport !== "disc-golf" || group.autoDivisions.includes(watch.division)) && !manual.has(global.SportsOverlay.automaticWatches.keyOf(sport, watch)));
    if (!visible.length) {
      const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No automatically watched elite events yet. The search runs on startup and repeats while the app is open."; list.append(empty);
    }
    visible.forEach(watch => {
      const key = `${sport}:${global.SportsOverlay.automaticWatches.keyOf(sport, watch)}`;
      const row = document.createElement("article"); row.className = "pdga-watch-card automatic-watch-card"; row.dataset.watchKey = key;
      row.innerHTML = `<div class="pdga-watch-heading"><a class="automatic-watch-name" target="_blank" rel="noopener"></a><span class="automatic-watch-badge">Automatic</span><label class="toggle"><input class="automatic-watch-enabled" type="checkbox">Included</label><button class="button button--quiet keep-automatic-watch" type="button">Keep watch</button></div>`;
      const name = row.querySelector(".automatic-watch-name");
      name.textContent = `${watch.name}${sport === "disc-golf" ? ` · ${watch.division}` : " · Current round"}`;
      name.href = sport === "disc-golf" ? `https://www.pdga.com/tour/event/${watch.tournamentId}` : `https://lichess.org/broadcast/-/${watch.tournamentId}`;
      const toggle = row.querySelector(".automatic-watch-enabled"); toggle.checked = !config.excludedGames.includes(key); toggle.disabled = !group.autoFollow;
      toggle.onchange = () => { config.excludedGames = config.excludedGames.filter(item => item !== key); if (!toggle.checked) config.excludedGames.push(key); changed("excludedGames"); };
      row.querySelector(".keep-automatic-watch").onclick = () => {
        if (group.events.length >= 30) { note.textContent = "Remove a saved watch before keeping another (limit 30)."; return; }
        group.events.push({ ...watch, enabled: true });
        config.excludedGames = config.excludedGames.filter(item => item !== key);
        changed("sports"); changed("excludedGames"); row.remove();
      };
      list.append(row);
    });
    const previous = container.querySelector(".automatic-watch-list");
    if (previous) previous.replaceWith(list);
    else container.append(list);
  }
  global.SportsOverlay.automaticWatchSettings = { render };
})(typeof window === "undefined" ? globalThis : window);
