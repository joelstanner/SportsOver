"use strict";

(async function initializeAdmin(global) {
  await global.SportsOverlay.config.ready;
  const configApi = global.SportsOverlay.config;
  const selectionApi = global.SportsOverlay.selection;
  const registryApi = global.SportsOverlay.registry;
  let workingConfig = configApi.loadConfig();
  const shared = global.SportsOverlay.shared;
  const providerRefresh = global.SportsOverlay.providerRefresh.create({ config: () => configApi.loadConfig() });
  let baseline = structuredClone(workingConfig);
  let baseRevision = shared?.snapshot()?.revision;
  let baseInstance = shared?.snapshot()?.instance;
  let saving = false;
  function acknowledge() {
    baseline = structuredClone(configApi.loadConfig());
    baseRevision = shared?.snapshot()?.revision;
    baseInstance = shared?.snapshot()?.instance;
  }
  async function persist(config, fields) {
    if (saving) throw new Error("A save is already in progress.");
    saving = true;
    try {
      const result = await configApi.saveConfig(config, {
        fields, revision: baseRevision, instance: baseInstance,
      });
      acknowledge();
      return result;
    } catch (error) {
      if (error.conflict) {
        baseRevision = shared.snapshot().revision;
        baseInstance = shared.snapshot().instance;
      }
      throw error;
    } finally { saving = false; }
  }
  const sportsList = document.querySelector("#sports-list");
  const status = document.querySelector("#save-status");
  const teamPicker = document.querySelector("#team-picker");
  const addTeamButton = document.querySelector("#add-team");
  const refreshCatalogButton = document.querySelector("#refresh-team-catalog");
  const catalogRefreshStatus = document.querySelector("#catalog-refresh-status");
  const undoLiveButton = document.querySelector("#undo-live-change");
  const liveConfigKeys = ["rotationMode", "includedGames", "excludedGames", "rotationOrder", "gameDurations", "defaultGameDurations", "lockedGameKeys"];
  let undoLiveConfig = null;
  let recentlyAddedTeamKey = null;
  let availableRotationEntries = [];
  let automaticRotationEntries = [];
  let gameDiscoveryRevision = 0;
  let gameDiscoveryTimer = null;

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  });
  document.querySelector("#save-settings").addEventListener("click", saveSettings);
  document.querySelector("#reset-settings").addEventListener("click", resetSettings);
  teamPicker.addEventListener("change", updateAddTeamButton);
  addTeamButton.addEventListener("click", addTeam);
  refreshCatalogButton.addEventListener("click", refreshTeamCatalog);
  const timeZonePicker = document.querySelector("#time-zone");
  const commonZones = {
    local: "Device time zone (automatic)",
    "America/Los_Angeles": "Pacific — Los Angeles (PST/PDT)",
    "America/Denver": "Mountain — Denver (MST/MDT)",
    "America/Phoenix": "Arizona — Phoenix (MST)",
    "America/Chicago": "Central — Chicago (CST/CDT)",
    "America/New_York": "Eastern — New York (EST/EDT)",
    "America/Anchorage": "Alaska — Anchorage (AKST/AKDT)",
    "Pacific/Honolulu": "Hawaii — Honolulu (HST)",
    UTC: "UTC",
  };
  const zones = new Set([...Object.keys(commonZones), workingConfig.timeZone,
    ...(Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : ["Europe/London", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney"])]);
  for (const zone of zones) {
    const option = document.createElement("option");
    option.value = zone; option.textContent = commonZones[zone] || zone.replaceAll("_", " ");
    timeZonePicker.append(option);
  }
  timeZonePicker.addEventListener("change", readBehaviorFields);
  document.querySelector("#display-mode").addEventListener("change", readBehaviorFields);
  document.querySelector("#fallback-mode").addEventListener("change", readBehaviorFields);
  document.querySelector("#rotation-mode").addEventListener("change", updateRotationControls);
  document.querySelector("#refresh-games").addEventListener("click", discoverRotationGames);
  const discoveryInfo = document.querySelector(".discovery-info");
  const discoveryInfoButton = document.querySelector("#discovery-info-button");
  const discoveryInfoTooltip = document.querySelector("#discovery-info-tooltip");
  function showDiscoveryInfo(show) {
    discoveryInfoTooltip.hidden = !show;
    discoveryInfoButton.setAttribute("aria-expanded", String(show));
  }
  discoveryInfo.addEventListener("mouseenter", () => showDiscoveryInfo(true));
  discoveryInfo.addEventListener("mouseleave", () => showDiscoveryInfo(false));
  discoveryInfoButton.addEventListener("focus", () => showDiscoveryInfo(true));
  discoveryInfoButton.addEventListener("click", () => showDiscoveryInfo(true));
  discoveryInfo.addEventListener("focusout", () => showDiscoveryInfo(false));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") showDiscoveryInfo(false);
  });
  document.addEventListener("click", event => {
    if (!discoveryInfo.contains(event.target)) showDiscoveryInfo(false);
  });
  document.querySelector("#available-sport-filter").addEventListener("change", renderRotationControls);
  document.querySelector("#game-search").addEventListener("input", renderRotationControls);
  document.querySelectorAll("[data-default-duration]").forEach(input => {
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (input.reportValidity()) input.blur();
      }
    });
    input.addEventListener("change", () => {
      if (!input.reportValidity()) return;
      const previousLiveConfig = savedLiveConfig();
      workingConfig.defaultGameDurations[input.dataset.defaultDuration] = Number(input.value);
      autoApplyLiveChange(previousLiveConfig, "Default timing applied");
    });
  });
  undoLiveButton.addEventListener("click", undoLastLiveChange);
  document.querySelector("#reset-rotation").addEventListener("click", resetRotation);
  document.querySelector("#live-sport").addEventListener("change", updateLive);
  document.querySelector("#refresh-live").addEventListener("click", updateLive);
  document.querySelector("#demo-sport").addEventListener("change", updateDemo);
  document.querySelector("#demo-state").addEventListener("change", updateDemo);
  document.querySelector("#refresh-demo").addEventListener("click", updateDemo);

  const connection = document.createElement("p");
  connection.setAttribute("role", "status");
  status.before(connection);
  const migration = document.createElement("div");
  const exportButton = document.createElement("button");
  exportButton.textContent = "Export settings";
  exportButton.className = "button button--secondary";
  exportButton.onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(workingConfig, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "sports-settings.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  migration.append(exportButton);
  if (shared) {
    const importLabel = document.createElement("label");
    importLabel.textContent = "Import exported settings ";
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json,.json";
    const defaults = document.createElement("button");
    defaults.textContent = "Start with defaults";
    defaults.className = "button button--secondary";
    async function initialize(config) {
      try {
        workingConfig = await configApi.saveConfig(config, { initialize: true });
        acknowledge(); renderSettings();
        status.textContent = global.sportsDesktop ? "Imported. Banner updates automatically." : "Shared settings initialized.";
        refreshConnection();
      } catch (error) { status.textContent = error.message; }
    }
    input.onchange = async () => {
      try {
        const file = input.files[0];
        if (!file || file.size > 262144) throw new Error("Select a settings JSON file smaller than 256 KB.");
        const imported = JSON.parse(await file.text());
        if (!imported || (!Array.isArray(imported.sports) && !Array.isArray(imported.favorites))) throw new Error("This file is not an exported sports configuration.");
        await initialize(imported);
      } catch (error) { status.textContent = error.message; }
    };
    defaults.onclick = () => initialize(configApi.DEFAULT_CONFIG);
    importLabel.append(input); migration.append(importLabel, defaults);
    function refreshConnection() {
      const snapshot = shared.snapshot();
      const initialized = snapshot?.initialized;
      const connected = shared.connected();
      connection.textContent = !connected ? "Disconnected — changes cannot be saved."
        : !initialized ? "Import your previous settings or start with defaults."
        : "Connected — controlling the desktop banner.";
      if (snapshot?.recovery) connection.textContent += ` ${snapshot.recovery}`;
      input.disabled = !connected || (initialized && !global.sportsDesktop);
      defaults.disabled = !connected || initialized;
      if (global.sportsDesktop) defaults.hidden = true;
      document.querySelector("#save-settings").disabled = !connected || !initialized;
      document.querySelector("#reset-settings").disabled = !connected || !initialized;
    }
    let catalogRevision = shared.snapshot()?.catalogRevision;
    shared.subscribe(async snapshot => {
      refreshConnection();
      if (snapshot && catalogRevision !== snapshot.catalogRevision) {
        catalogRevision = snapshot.catalogRevision;
        try { await configApi.reloadTeamCatalog(); renderSettings(); }
        catch (_) { connection.textContent = "Team catalog reload failed; retry refresh."; }
      }
      if (!snapshot?.initialized || saving) return;
      if (snapshot.revision === baseRevision && snapshot.instance === baseInstance) return;
      const dirty = JSON.stringify(workingConfig) !== JSON.stringify(baseline);
      if (dirty) {
        status.textContent = "Settings changed elsewhere. Your unsaved draft is preserved.";
        return;
      }
      workingConfig = configApi.loadConfig(); acknowledge(); renderSettings();
    });
    refreshConnection();
  } else connection.textContent = "Local preview — settings here do not control the desktop banner. Export them to import into shared control.";
  status.before(migration);
  renderSettings();
  updateDemo();

  function selectTab(name) {
    document.querySelectorAll(".tab").forEach(tab => {
      const selected = tab.dataset.tab === name;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll("[data-panel]").forEach(panel => {
      panel.hidden = panel.dataset.panel !== name;
    });
    if (name === "live") {
      updateLive();
      discoverRotationGames();
    }
    if (name === "demo") updateDemo();
  }

  function renderSettings() {
    const refreshFields = document.querySelector("#provider-refresh-fields");
    refreshFields.replaceChildren();
    for (const sport of configApi.SPORT_CATALOG) {
      const row = document.createElement("fieldset");
      row.className = "provider-refresh-row";
      const legend = document.createElement("legend");
      legend.textContent = sport.league;
      row.append(legend);
      for (const [state, seconds] of Object.entries(workingConfig.providerRefreshSeconds[sport.key])) {
        const label = document.createElement("label");
        label.className = "field";
        label.textContent = state === "idle" ? "Idle / no game" : state[0].toUpperCase() + state.slice(1);
        const input = document.createElement("input");
        input.type = "number"; input.min = "5"; input.max = "3600"; input.step = "1";
        input.required = true; input.value = seconds;
        input.dataset.sport = sport.key; input.dataset.state = state;
        input.addEventListener("input", () => {
          if (input.checkValidity()) workingConfig.providerRefreshSeconds[sport.key][state] = Number(input.value);
          markUnsaved();
        });
        label.append(input); row.append(label);
      }
      refreshFields.append(row);
    }
    sportsList.replaceChildren();
    workingConfig.sports.forEach((group, sportIndex) => {
      const sport = configApi.findSport(group.sport);
      if (!sport) return;
      const section = document.querySelector("#sport-template").content.firstElementChild.cloneNode(true);
      section.dataset.sport = sport.key;
      section.querySelector(".sport-rank").textContent = `#${sportIndex + 1}`;
      section.querySelector(".sport-name").textContent = sport.name;
      section.querySelector(".sport-league").textContent = sport.league;
      section.querySelector(".move-sport-up").disabled = sportIndex === 0;
      section.querySelector(".move-sport-down").disabled = sportIndex === workingConfig.sports.length - 1;
      section.querySelector(".move-sport-up").addEventListener("click", () => moveSport(sportIndex, -1));
      section.querySelector(".move-sport-down").addEventListener("click", () => moveSport(sportIndex, 1));

      const favoriteList = section.querySelector(".sport-favorites");
      group.favorites.forEach((favorite, index) => renderFavorite(group, favorite, index, favoriteList));
      if (!group.favorites.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = `No ${sport.name.toLowerCase()} teams watched.`;
        favoriteList.append(empty);
      }
      sportsList.append(section);
    });
    renderTeamPicker();
    timeZonePicker.value = workingConfig.timeZone;
    document.querySelector("#display-mode").value = workingConfig.displayMode;
    document.querySelector("#rotation-mode").value = workingConfig.rotationMode;
    document.querySelector("#fallback-mode").value = workingConfig.fallbackMode;
    renderLiveSportPicker();
    renderRotationControls();
    if (recentlyAddedTeamKey) {
      const newCard = [...document.querySelectorAll(".favorite-card")]
        .find(card => card.dataset.teamKey === recentlyAddedTeamKey);
      newCard?.classList.add("is-new");
      newCard?.scrollIntoView({ behavior: "smooth", block: "center" });
      recentlyAddedTeamKey = null;
    }
  }

  function renderTeamPicker() {
    const selected = new Set(workingConfig.sports.flatMap(group => group.favorites.map(team => team.teamKey)));
    const previousValue = teamPicker.value;
    teamPicker.replaceChildren();

    const availableTeams = configApi.TEAM_CATALOG.filter(team => !selected.has(team.key));
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = availableTeams.length ? "Select a team…" : "All supported teams are watched";
    teamPicker.append(placeholder);

    workingConfig.sports.forEach(group => {
      const teams = availableTeams.filter(team => team.sport === group.sport);
      if (!teams.length) return;
      const sport = configApi.findSport(group.sport);
      const optionGroup = document.createElement("optgroup");
      optionGroup.label = `${sport.name} · ${sport.league}`;
      teams.forEach(team => {
        const option = document.createElement("option");
        option.value = team.key;
        option.textContent = team.name;
        optionGroup.append(option);
      });
      teamPicker.append(optionGroup);
    });

    if (availableTeams.some(team => team.key === previousValue)) teamPicker.value = previousValue;
    teamPicker.disabled = !availableTeams.length;
    updateAddTeamButton();
  }

  function updateAddTeamButton() {
    addTeamButton.disabled = !teamPicker.value;
  }

  async function refreshTeamCatalog() {
    const sport = document.querySelector("#catalog-refresh-sport").value;
    refreshCatalogButton.disabled = true;
    catalogRefreshStatus.textContent = sport === "all" ? "Refreshing all team directories…" : "Refreshing team directory…";
    catalogRefreshStatus.className = "catalog-refresh-status";
    try {
      const response = await fetch("../api/team-catalog/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Refresh returned HTTP ${response.status}`);
      await configApi.reloadTeamCatalog();
      renderSettings();
      const total = payload.results.reduce((sum, result) => sum + result.count, 0);
      catalogRefreshStatus.textContent = `${payload.results.length} ${payload.results.length === 1 ? "directory" : "directories"} refreshed · ${total} teams`;
      catalogRefreshStatus.className = "catalog-refresh-status is-saved";
    } catch (error) {
      const serverHint = /404|405|501|Unexpected token/i.test(error.message)
        ? " Start with: node scripts/serve.mjs"
        : "";
      catalogRefreshStatus.textContent = `${error.message}.${serverHint}`;
      catalogRefreshStatus.className = "catalog-refresh-status is-error";
    } finally {
      refreshCatalogButton.disabled = false;
    }
  }

  function renderFavorite(group, favorite, index, favoriteList) {
    const team = configApi.findTeam(favorite.teamKey);
    if (!team) return;
    const card = document.querySelector("#favorite-template").content.firstElementChild.cloneNode(true);
    card.dataset.teamKey = team.key;
    setTeamMark(card.querySelector(".team-mark"), team);
    card.querySelector(".team-name").textContent = team.name;
    card.querySelector(".team-meta").textContent = `${team.league} · watched #${index + 1}`;
    const providerBadge = card.querySelector(".provider-badge");
    providerBadge.textContent = team.providerStatus === "live" ? "LIVE PROVIDER" : "DEMO READY";
    providerBadge.classList.toggle("is-demo", team.providerStatus !== "live");
    card.querySelector(".team-enabled").checked = favorite.enabled;
    card.querySelector(".team-enabled").addEventListener("change", event => {
      favorite.enabled = event.target.checked;
      markUnsaved();
    });
    card.querySelector(".move-up").disabled = index === 0;
    card.querySelector(".move-down").disabled = index === group.favorites.length - 1;
    card.querySelector(".move-up").addEventListener("click", () => moveTeam(group, index, -1));
    card.querySelector(".move-down").addEventListener("click", () => moveTeam(group, index, 1));
    card.querySelector(".remove-team").addEventListener("click", () => removeTeam(group, team.key));
    favoriteList.append(card);
  }

  function setTeamMark(mark, team) {
    mark.textContent = team.abbreviation;
    if (!team.logoUrl) return;
    const logo = document.createElement("img");
    logo.src = team.logoUrl;
    logo.alt = `${team.name} logo`;
    logo.addEventListener("error", () => { mark.textContent = team.abbreviation; }, { once: true });
    mark.replaceChildren(logo);
  }

  function renderLiveSportPicker() {
    const picker = document.querySelector("#live-sport");
    const selectedSport = picker.value;
    picker.replaceChildren();
    workingConfig.sports.forEach(group => {
      const sport = configApi.findSport(group.sport);
      const topFavorite = group.favorites
        .filter(favorite => favorite.enabled)
        .map(favorite => configApi.findTeam(favorite.teamKey))
        .find(Boolean);
      const option = document.createElement("option");
      option.value = group.sport;
      option.textContent = `${sport.name} · ${topFavorite?.name || "no included team"}`;
      picker.append(option);
    });
    if (workingConfig.sports.some(group => group.sport === selectedSport)) picker.value = selectedSport;
  }

  function addTeam() {
    const team = configApi.findTeam(teamPicker.value);
    if (!team) return;
    const group = workingConfig.sports.find(candidate => candidate.sport === team.sport);
    if (!group || group.favorites.some(favorite => favorite.teamKey === team.key)) return;
    group.favorites.push({ teamKey: team.key, enabled: true });
    recentlyAddedTeamKey = team.key;
    markUnsaved();
    renderSettings();
    status.textContent = `${team.name} added · unsaved changes`;
  }

  function removeTeam(group, teamKey) {
    group.favorites = group.favorites.filter(favorite => favorite.teamKey !== teamKey);
    markUnsaved();
    renderSettings();
  }

  function moveTeam(group, index, offset) {
    const [favorite] = group.favorites.splice(index, 1);
    group.favorites.splice(index + offset, 0, favorite);
    markUnsaved();
    renderSettings();
  }

  function moveSport(index, offset) {
    const [sport] = workingConfig.sports.splice(index, 1);
    workingConfig.sports.splice(index + offset, 0, sport);
    markUnsaved();
    renderSettings();
  }

  function readBehaviorFields() {
    workingConfig.timeZone = timeZonePicker.value;
    workingConfig.displayMode = document.querySelector("#display-mode").value;
    workingConfig.rotationMode = document.querySelector("#rotation-mode").value;
    workingConfig.fallbackMode = document.querySelector("#fallback-mode").value;
    markUnsaved();
  }

  function updateRotationControls() {
    const previousLiveConfig = savedLiveConfig();
    workingConfig.rotationMode = document.querySelector("#rotation-mode").value;
    autoApplyLiveChange(previousLiveConfig, "Queue mode applied");
  }

  async function discoverRotationGames(event) {
    if (global.sportsDesktop) {
      clearTimeout(gameDiscoveryTimer);
      try {
        if (event?.type === 'click') await global.sportsDesktop.action('refresh');
        const state = await global.sportsDesktop.engine();
        automaticRotationEntries = state.automaticEntries;
        availableRotationEntries = state.availableEntries;
        renderRotationControls();
        document.querySelector('#rotation-status').textContent = state.ready ? 'Shared engine games' : 'Sports engine starting…';
      } catch (error) { document.querySelector('#rotation-status').textContent = error.message; }
      gameDiscoveryTimer = setTimeout(discoverRotationGames, 2000);
      return;
    }
    clearTimeout(gameDiscoveryTimer);
    gameDiscoveryTimer = setTimeout(discoverRotationGames, 60 * 60 * 1_000);
    const revision = ++gameDiscoveryRevision;
    const rotationStatus = document.querySelector("#rotation-status");
    rotationStatus.textContent = "Loading games…";
    rotationStatus.className = "save-status";
    document.querySelector("#refresh-games").disabled = true;

    const results = await Promise.allSettled(workingConfig.sports.map(discoverSportGames));
    if (revision !== gameDiscoveryRevision) return;
    const discoveredAutomaticEntries = results.flatMap(result => result.status === "fulfilled" ? result.value.automaticEntries : []);
    availableRotationEntries = results.flatMap(result => result.status === "fulfilled" ? result.value.availableEntries : []);
    automaticRotationEntries = selectionApi.retainAutoFinals(
      automaticRotationEntries,
      discoveredAutomaticEntries,
      availableRotationEntries,
      { keyOf: rotationEntryKey },
    );
    const failed = results.filter(result => result.status === "rejected").length;
    const partial = results.filter(result => result.status === "fulfilled" && result.value.failures).length;
    document.querySelector("#refresh-games").disabled = false;
    rotationStatus.textContent = failed || partial
      ? `${failed} sports unavailable · ${partial} sports partially loaded. Refresh to retry.` : "Games refreshed";
    rotationStatus.className = failed || partial ? "save-status is-error" : "save-status is-saved";
    renderRotationControls();
  }

  async function discoverSportGames(group) {
    const watchedTeams = group.favorites
      .filter(favorite => favorite.enabled)
      .map(favorite => configApi.findTeam(favorite.teamKey))
      .filter(Boolean);
    const bootstrapTeam = watchedTeams[0] || configApi.TEAM_CATALOG.find(team => team.sport === group.sport);
    if (!bootstrapTeam) return { automaticEntries: [], availableEntries: [] };
    const providerModule = registryApi.getProvider(bootstrapTeam.provider);
    const createClient = team => providerModule.createClient({ teamId: team.teamId, requestTimeoutMs: 8_000,
      fetchImpl: providerRefresh.fetchFor(group.sport, providerModule) });
    const { favoriteGames: watchedGames, leagueGames, failures } = await global.SportsOverlay.providerDiscovery.discover({
      teams: watchedTeams, provider: createClient(bootstrapTeam), createClient,
      toCandidate: providerModule.toCandidate,
    });
    const favoriteTeamIds = watchedTeams.map(team => team.teamId);
    const automaticEntries = watchedTeams.length ? selectionApi.buildRotationQueue({
      favoriteGames: watchedGames,
      leagueGames,
      favoriteTeamIds,
      toCandidate: providerModule.toCandidate,
      fallbackMode: workingConfig.fallbackMode,
      includeSpotlight: workingConfig.displayMode !== "top-favorite",
    }) : [];
    const seen = new Set();
    const availableEntries = [...leagueGames, ...watchedGames]
      .map(providerModule.toCandidate)
      .filter(candidate => candidate.id)
      .filter(candidate => {
        const key = `${group.sport}:${candidate.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(candidate => ({ kind: "manual", candidate }));
    return { automaticEntries, availableEntries, failures };
  }

  function renderRotationControls() {
    document.querySelectorAll("[data-default-duration]").forEach(input => {
      // Desktop engine refreshes must not replace a value being typed.
      if (document.activeElement !== input) {
        input.value = workingConfig.defaultGameDurations[input.dataset.defaultDuration];
      }
    });
    document.querySelector("#rotation-mode").value = workingConfig.rotationMode;
    const queue = currentRotationQueue();
    const queueList = document.querySelector("#rotation-queue");
    const availableList = document.querySelector("#available-games");
    queueList.replaceChildren();
    availableList.replaceChildren();
    document.querySelector("#rotation-count").textContent = `${queue.length} game${queue.length === 1 ? "" : "s"}`;

    if (!queue.length) appendRotationEmpty(queueList, availableRotationEntries.length ? "No games selected for the banner." : "Refresh games to build the live queue.");
    queue.forEach((entry, index) => renderQueueGame(entry, index, queue, queueList));

    const queuedKeys = new Set(queue.map(rotationEntryKey));
    const sportFilter = document.querySelector("#available-sport-filter").value;
    const search = document.querySelector("#game-search").value.trim().toLowerCase();
    const available = availableRotationEntries
      .filter(entry => !queuedKeys.has(rotationEntryKey(entry)))
      .filter(entry => isCurrentGame(entry.candidate))
      .filter(entry => !sportFilter || entry.candidate.sport === sportFilter)
      .filter(entry => !search || gameName(entry.candidate).toLowerCase().includes(search))
      .sort((a, b) => gameStateRank(a.candidate.state) - gameStateRank(b.candidate.state)
        || new Date(a.candidate.startTime || 0) - new Date(b.candidate.startTime || 0));
    if (!available.length) appendRotationEmpty(availableList, availableRotationEntries.length ? "No matching current games." : "No games loaded yet.");
    available.forEach(entry => renderAvailableGame(entry, availableList));
  }

  function currentRotationQueue() {
    return selectionApi.applyRotationControls({
      automaticEntries: automaticRotationEntries,
      availableEntries: availableRotationEntries,
      mode: workingConfig.rotationMode,
      includedGameKeys: workingConfig.includedGames,
      excludedGameKeys: workingConfig.excludedGames,
      rotationOrder: workingConfig.rotationOrder,
      keyOf: rotationEntryKey,
    });
  }

  function renderQueueGame(entry, index, queue, list) {
    const card = document.querySelector("#queue-game-template").content.firstElementChild.cloneNode(true);
    fillGameCard(card, entry);
    const key = rotationEntryKey(entry);
    const automaticKeys = new Set(automaticRotationEntries.map(rotationEntryKey));
    card.querySelector(".game-source").textContent = automaticKeys.has(key) ? "AUTO" : "ADDED";
    const duration = selectionApi.gameDurationSeconds(entry, workingConfig.gameDurations, rotationEntryKey, workingConfig.defaultGameDurations);
    card.querySelector(".game-time").textContent = `${duration}s`;
    card.querySelector(".game-time-down").disabled = duration <= 5;
    card.querySelector(".game-time-up").disabled = duration >= 300;
    card.querySelector(".game-time-down").addEventListener("click", () => adjustGameDuration(entry, -5));
    card.querySelector(".game-time-up").addEventListener("click", () => adjustGameDuration(entry, 5));
    card.querySelector(".game-up").disabled = index === 0;
    card.querySelector(".game-down").disabled = index === queue.length - 1;
    card.querySelector(".game-up").addEventListener("click", () => moveRotationGame(queue, index, -1));
    card.querySelector(".game-down").addEventListener("click", () => moveRotationGame(queue, index, 1));
    const lockButton = card.querySelector(".lock-game");
    const locked = workingConfig.lockedGameKeys.includes(key);
    lockButton.textContent = locked ? "Locked" : "Lock";
    lockButton.classList.toggle("is-locked", locked);
    lockButton.setAttribute("aria-pressed", String(locked));
    lockButton.addEventListener("click", () => toggleGameLock(entry));
    card.querySelector(".remove-game").addEventListener("click", () => removeRotationGame(entry));
    list.append(card);
  }

  function renderAvailableGame(entry, list) {
    const card = document.querySelector("#available-game-template").content.firstElementChild.cloneNode(true);
    fillGameCard(card, entry);
    card.querySelector(".add-game").addEventListener("click", () => addRotationGame(entry));
    list.append(card);
  }

  function fillGameCard(card, entry) {
    const sport = configApi.findSport(entry.candidate.sport);
    card.dataset.gameKey = rotationEntryKey(entry);
    card.classList.toggle("is-live", entry.candidate.state === "live");
    card.querySelector(".game-sport").textContent = sport?.league || entry.candidate.sport.toUpperCase();
    renderGameLogos(card.querySelector(".game-logos"), entry.candidate);
    card.querySelector(".game-name").textContent = gameName(entry.candidate);
    card.querySelector(".game-meta").textContent = gameMeta(entry.candidate);
    card.classList.toggle("is-final", entry.candidate.state === "final");
    if (entry.candidate.state === "final") {
      const label = document.createElement("span");
      label.className = "game-final-label";
      label.textContent = "Final";
      const meta = gameMeta(entry.candidate);
      const finalIndex = meta.indexOf(label.textContent);
      card.querySelector(".game-meta").replaceChildren(meta.slice(0, finalIndex), label, meta.slice(finalIndex + label.textContent.length));
    }
  }

  function renderGameLogos(container, candidate) {
    gameTeams(candidate).forEach(team => {
      const mark = document.createElement("span");
      mark.className = "game-logo";
      const logoUrl = team.logoUrl || catalogTeam(candidate.sport, team)?.logoUrl;
      if (logoUrl) {
        const logo = document.createElement("img");
        logo.src = logoUrl;
        logo.alt = "";
        logo.addEventListener("error", () => {
          mark.textContent = team.abbreviation || "—";
          logo.remove();
        }, { once: true });
        mark.append(logo);
      } else {
        mark.textContent = team.abbreviation || "—";
      }
      container.append(mark);
    });
  }

  function gameTeams(candidate) {
    if (candidate.sport === "baseball") {
      const teams = candidate.raw?.teams || {};
      return [teams.away?.team, teams.home?.team].filter(Boolean).map(team => ({
        id: team.id,
        name: team.name,
        abbreviation: team.abbreviation,
        logoUrl: team.logoUrl,
      }));
    }
    const competitors = candidate.raw?.competitions?.[0]?.competitors ?? [];
    const away = competitors.find(competitor => competitor.homeAway === "away");
    const home = competitors.find(competitor => competitor.homeAway === "home");
    return (away && home ? [away, home] : competitors).map(competitor => ({
      id: competitor.team?.id ?? competitor.id,
      name: competitor.team?.displayName || competitor.team?.name,
      abbreviation: competitor.team?.abbreviation,
      logoUrl: competitor.team?.logo || competitor.team?.logos?.[0]?.href,
    }));
  }

  function catalogTeam(sport, team) {
    const values = [team.id, team.abbreviation, team.name].map(value => String(value || "").toUpperCase());
    return configApi.TEAM_CATALOG.find(candidate => candidate.sport === sport
      && [candidate.teamId, candidate.abbreviation, candidate.name]
        .some(value => values.includes(String(value || "").toUpperCase())));
  }

  function gameName(candidate) {
    if (candidate.sport === "baseball") {
      const teams = candidate.raw?.teams;
      return [teams?.away?.team?.name, teams?.home?.team?.name].filter(Boolean).join(" at ") || `Game ${candidate.id}`;
    }
    const competitors = candidate.raw?.competitions?.[0]?.competitors ?? [];
    const away = competitors.find(competitor => competitor.homeAway === "away");
    const home = competitors.find(competitor => competitor.homeAway === "home");
    const ordered = away && home ? [away, home] : competitors;
    const names = ordered.map(competitor => competitor.team?.shortDisplayName || competitor.team?.displayName || competitor.team?.name).filter(Boolean);
    return names.join(" at ") || candidate.raw?.shortName || candidate.raw?.name || `Game ${candidate.id}`;
  }

  function gameMeta(candidate) {
    const preseason = candidate.sport === "baseball"
      ? ["S", "E"].includes(candidate.raw?.gameType)
      : global.SportsOverlay.model.espnPreseason(candidate.raw || {}, candidate.sport !== "soccer");
    const gameState = candidate.state === "live" ? "Live now" : candidate.state === "final" ? "Final" : "Upcoming";
    const state = preseason ? `PRESEASON · ${gameState}` : gameState;
    if (candidate.state === "live" || !candidate.startTime) return state;
    return `${state} · ${global.SportsOverlay.model.formatPregameStart(candidate.startTime, new Date(), workingConfig.timeZone === "local" ? undefined : workingConfig.timeZone)}`;
  }

  function addRotationGame(entry) {
    const previousLiveConfig = savedLiveConfig();
    const key = rotationEntryKey(entry);
    const currentKeys = currentRotationQueue().map(rotationEntryKey);
    workingConfig.includedGames = [...new Set([...workingConfig.includedGames, key])];
    workingConfig.excludedGames = workingConfig.excludedGames.filter(item => item !== key);
    workingConfig.rotationOrder = [...currentKeys.filter(item => item !== key), key];
    if (workingConfig.rotationMode === "automatic") workingConfig.rotationMode = "hybrid";
    autoApplyLiveChange(previousLiveConfig, `${gameName(entry.candidate)} added to live banner`);
  }

  function removeRotationGame(entry) {
    const previousLiveConfig = savedLiveConfig();
    const key = rotationEntryKey(entry);
    const isAutomatic = automaticRotationEntries.some(candidate => rotationEntryKey(candidate) === key);
    workingConfig.includedGames = workingConfig.includedGames.filter(item => item !== key);
    workingConfig.excludedGames = isAutomatic
      ? [...new Set([...workingConfig.excludedGames, key])]
      : workingConfig.excludedGames.filter(item => item !== key);
    workingConfig.rotationOrder = workingConfig.rotationOrder.filter(item => item !== key);
    workingConfig.lockedGameKeys = workingConfig.lockedGameKeys.filter(item => item !== key);
    if (workingConfig.rotationMode === "hybrid" && !workingConfig.includedGames.length && !workingConfig.excludedGames.length) {
      workingConfig.rotationMode = "automatic";
    }
    autoApplyLiveChange(previousLiveConfig, `${gameName(entry.candidate)} removed from live banner`);
  }

  function moveRotationGame(queue, index, offset) {
    const previousLiveConfig = savedLiveConfig();
    const keys = queue.map(rotationEntryKey);
    [keys[index], keys[index + offset]] = [keys[index + offset], keys[index]];
    workingConfig.rotationOrder = keys;
    autoApplyLiveChange(previousLiveConfig, "Rotation order applied");
  }

  function resetRotation() {
    const previousLiveConfig = savedLiveConfig();
    workingConfig.rotationMode = "automatic";
    workingConfig.includedGames = [];
    workingConfig.excludedGames = [];
    workingConfig.rotationOrder = [];
    workingConfig.gameDurations = {};
    workingConfig.lockedGameKeys = [];
    autoApplyLiveChange(previousLiveConfig, "Automatic rotation restored");
  }

  function toggleGameLock(entry) {
    const previousLiveConfig = savedLiveConfig();
    const key = rotationEntryKey(entry);
    const locking = !workingConfig.lockedGameKeys.includes(key);
    workingConfig.lockedGameKeys = locking
      ? [...workingConfig.lockedGameKeys, key]
      : workingConfig.lockedGameKeys.filter(item => item !== key);
    const lockCount = workingConfig.lockedGameKeys.length;
    autoApplyLiveChange(previousLiveConfig, locking
      ? `${gameName(entry.candidate)} locked · ${lockCount} selected`
      : `${gameName(entry.candidate)} unlocked${lockCount ? ` · ${lockCount} selected` : " · full rotation resumed"}`);
  }

  function adjustGameDuration(entry, offset) {
    const previousLiveConfig = savedLiveConfig();
    const key = rotationEntryKey(entry);
    const defaultSeconds = selectionApi.gameDurationSeconds(entry, {}, rotationEntryKey, workingConfig.defaultGameDurations);
    const currentSeconds = selectionApi.gameDurationSeconds(entry, workingConfig.gameDurations, rotationEntryKey, workingConfig.defaultGameDurations);
    const nextSeconds = Math.min(300, Math.max(5, currentSeconds + offset));
    const durations = { ...workingConfig.gameDurations };
    if (nextSeconds === defaultSeconds) delete durations[key];
    else durations[key] = nextSeconds;
    workingConfig.gameDurations = durations;

    autoApplyLiveChange(previousLiveConfig, `${gameName(entry.candidate)} timing applied`);
  }

  async function autoApplyLiveChange(previousLiveConfig, message) {
    if (JSON.stringify(previousLiveConfig) === JSON.stringify(cloneLiveConfig(workingConfig))) {
      renderRotationControls();
      return;
    }
    try {
      const savedConfig = configApi.loadConfig();
      copyLiveConfig(savedConfig, workingConfig);
      const normalizedConfig = await persist(savedConfig, liveConfigKeys);
      copyLiveConfig(workingConfig, normalizedConfig);
      undoLiveConfig = previousLiveConfig;
      undoLiveButton.hidden = false;
      renderSettings();
      const rotationStatus = document.querySelector("#rotation-status");
      rotationStatus.textContent = message;
      rotationStatus.className = "save-status is-saved";
    } catch (error) {
      if (!error.conflict) copyLiveConfig(workingConfig, previousLiveConfig);
      renderSettings();
      const rotationStatus = document.querySelector("#rotation-status");
      rotationStatus.textContent = error.message;
      rotationStatus.className = "save-status is-error";
    }
  }

  async function undoLastLiveChange() {
    if (!undoLiveConfig) return;
    try {
      const savedConfig = configApi.loadConfig();
      copyLiveConfig(savedConfig, undoLiveConfig);
      const normalizedConfig = await persist(savedConfig, liveConfigKeys);
      copyLiveConfig(workingConfig, normalizedConfig);
      undoLiveConfig = null;
      undoLiveButton.hidden = true;
      renderSettings();
      const rotationStatus = document.querySelector("#rotation-status");
      rotationStatus.textContent = "Last live change undone";
      rotationStatus.className = "save-status is-saved";
    } catch (error) {
      const rotationStatus = document.querySelector("#rotation-status");
      rotationStatus.textContent = error.message;
      rotationStatus.className = "save-status is-error";
    }
  }

  function savedLiveConfig() {
    return cloneLiveConfig(configApi.loadConfig());
  }

  function cloneLiveConfig(config) {
    const clone = {};
    copyLiveConfig(clone, config);
    return clone;
  }

  function copyLiveConfig(target, source) {
    liveConfigKeys.forEach(key => {
      target[key] = source[key] === undefined ? undefined : JSON.parse(JSON.stringify(source[key]));
    });
  }

  function appendRotationEmpty(list, message) {
    const empty = document.createElement("p");
    empty.className = "rotation-empty";
    empty.textContent = message;
    list.append(empty);
  }

  function rotationEntryKey(entry) {
    return entry?.candidate?.sport && entry?.candidate?.id ? `${entry.candidate.sport}:${entry.candidate.id}` : "";
  }

  function gameStateRank(state) {
    return state === "live" ? 0 : state === "pregame" ? 1 : 2;
  }

  function isCurrentGame(candidate) {
    if (candidate.state === "live") return true;
    const start = new Date(candidate.startTime || 0).getTime();
    if (!Number.isFinite(start)) return false;
    const age = start - Date.now();
    if (candidate.state === "final") return age >= -24 * 60 * 60 * 1_000;
    return age >= -2 * 60 * 60 * 1_000 && age <= 7 * 24 * 60 * 60 * 1_000;
  }

  async function saveSettings() {
    for (const input of document.querySelectorAll("#provider-refresh-fields input")) {
      if (!input.reportValidity()) return;
    }
    readBehaviorFields();
    try {
      const fields = Object.keys(workingConfig).filter(key => JSON.stringify(workingConfig[key]) !== JSON.stringify(baseline[key]));
      workingConfig = await persist(workingConfig, fields);
      renderSettings();
      status.textContent = shared ? "Saved. Banner updates automatically." : "Saved locally (preview only).";
      status.className = "save-status is-saved";
    } catch (error) {
      status.textContent = error.message;
      status.className = "save-status is-error";
    }
  }

  async function resetSettings() {
    try {
      workingConfig = await persist(configApi.DEFAULT_CONFIG);
      undoLiveConfig = null;
      undoLiveButton.hidden = true;
      renderSettings();
      status.textContent = "Defaults restored.";
      status.className = "save-status is-saved";
    } catch (error) {
      status.textContent = error.message;
      status.className = "save-status is-error";
    }
  }

  function markUnsaved() {
    status.textContent = "Unsaved changes";
    status.className = "save-status";
  }

  function updateDemo() {
    const sportPicker = document.querySelector("#demo-sport");
    const sport = sportPicker.value;
    const state = document.querySelector("#demo-state").value;
    const isRotation = state === "rotation";
    sportPicker.disabled = isRotation;
    const params = new URLSearchParams(isRotation ? {} : { sport });
    if (["pregame", "live", "interrupted", "final"].includes(state)) params.set("demo", state);
    else params.set("scenario", state);
    document.querySelector("#demo-preview").src = `../index.html?${params}`;
  }

  function updateLive() {
    const sport = document.querySelector("#live-sport").value;
    const url = global.sportsDesktop ? "../display.html" : `../index.html?sport=${encodeURIComponent(sport)}`;
    document.querySelector("#live-preview").src = url;
    document.querySelector("#open-live").href = url;
  }

})(window);
