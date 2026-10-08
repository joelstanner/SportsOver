"use strict";

(async function initializeAdmin(global) {
  await global.SportsOverlay.config.ready;
  const configApi = global.SportsOverlay.config;
  const selectionApi = global.SportsOverlay.selection;
  const registryApi = global.SportsOverlay.registry;
  const oddsApi = global.SportsOverlay.odds;
  const gameOddsTracker = oddsApi.createTracker();
  let workingConfig = configApi.loadConfig();
  const shared = global.SportsOverlay.shared;
  const providerRefresh = global.SportsOverlay.providerRefresh.create({ config: () => workingConfig });
  const disclosureKey = "sportsover.settings.collapsedSports";
  let collapsedSports;
  try {
    const stored = JSON.parse(global.localStorage.getItem(disclosureKey));
    collapsedSports = new Set(Array.isArray(stored) ? stored.filter(value => typeof value === "string") : []);
  } catch (_) { collapsedSports = new Set(); }
  const chessSession = global.SportsOverlay.lichess.createSession();
  const pdgaSession = global.SportsOverlay.pdga.createSession();
  let baseline = structuredClone(workingConfig);
  let baseRevision = shared?.snapshot()?.revision;
  let baseInstance = shared?.snapshot()?.instance;
  let saving = false;
  let saveQueue = Promise.resolve();
  const pendingSettings = new Set();
  let settingsSaveTimer;
  let settingsSaveRunning = false;
  let settingsSavePaused = false;
  function acknowledge() {
    baseline = structuredClone(configApi.loadConfig());
    baseRevision = shared?.snapshot()?.revision;
    baseInstance = shared?.snapshot()?.instance;
  }
  function persist(config, fields) {
    const submitted = structuredClone(config);
    const operation = saveQueue.then(async () => {
      const expectedConfig = structuredClone(baseline), expectedInstance = baseInstance;
      saving = true;
      try {
        const result = await configApi.saveConfig(submitted, shared ? {
          fields, revision: baseRevision, instance: baseInstance,
        } : undefined);
        acknowledge();
        return result;
      } catch (error) {
        if (error.conflict) {
          baseRevision = shared.snapshot().revision;
          baseInstance = shared.snapshot().instance;
          const incoming = configApi.loadConfig();
          // Discovery owns a separate field. Its intervening update must not
          // interrupt a player choice or another manual Settings edit.
          const discoveryOnly = expectedInstance === baseInstance && !fields.includes("automaticWatchLists")
            && Object.keys(expectedConfig).every(key => key === "automaticWatchLists"
              || JSON.stringify(expectedConfig[key]) === JSON.stringify(incoming[key]));
          if (discoveryOnly) {
            const result = await configApi.saveConfig(submitted, { fields, revision: baseRevision, instance: baseInstance });
            acknowledge();
            return result;
          }
        }
        throw error;
      } finally { saving = false; }
    });
    saveQueue = operation.catch(() => {});
    return operation;
  }
  const sportsList = document.querySelector("#sports-list");
  const status = document.querySelector("#save-status");
  const teamPicker = document.querySelector("#team-picker");
  const teamSportPicker = document.querySelector("#team-sport-picker");
  const addTeamButton = document.querySelector("#add-team");
  const refreshCatalogButton = document.querySelector("#refresh-team-catalog");
  const catalogRefreshStatus = document.querySelector("#catalog-refresh-status");
  const catalogRefreshSport = document.querySelector("#catalog-refresh-sport");
  const catalogRefreshDialog = document.querySelector("#refresh-team-catalog-dialog");
  let pendingCatalogSport = null;
  let refreshingCatalog = false;
  const undoLiveButton = document.querySelector("#undo-live-change");
  const resetDialog = document.querySelector("#reset-settings-dialog");
  const liveConfigKeys = ["rotationMode", "bannerSportFilter", "includedGames", "excludedGames", "rotationOrder", "gameDurations", "defaultGameDurations", "lockedGameKeys"];
  let undoLiveConfig = null;
  let recentlyAddedTeamKey = null;
  let availableRotationEntries = [];
  let automaticRotationEntries = [];
  let gameDiscoveryRevision = 0;
  let gameDiscoveryTimer = null;
  let refreshingGames = false;
  const localLiveMode = global.SportsOverlay.liveMode.create();
  const pendingLiveAdditions = new Map();
  let engineRotationState = null;
  let engineLoading = Boolean(global.sportsDesktop);
  let bannerGameKey = null;
  let changingLiveMode = false;
  let pinnedOnly = false;
  const pinnedOnlyButton = document.querySelector("#pinned-only");
  const liveModeButton = document.querySelector("#live-mode");
  const liveModeFinalMinutes = document.querySelector("#live-mode-final-minutes");

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  });
  document.querySelector("#save-settings").addEventListener("click", saveSettings);
  document.querySelector("#reset-settings").addEventListener("click", () => resetDialog.showModal());
  document.querySelector("#cancel-reset-settings").addEventListener("click", () => resetDialog.close());
  document.querySelector("#confirm-reset-settings").addEventListener("click", resetSettings);
  teamPicker.addEventListener("change", updateAddTeamButton);
  for (const sport of configApi.SPORT_CATALOG) {
    if (sport.competitionType === "individual") continue;
    const option = document.createElement("option");
    option.value = sport.key;
    option.textContent = `${sport.name} · ${sport.league}`;
    teamSportPicker.append(option);
  }
  teamSportPicker.addEventListener("change", renderTeamPicker);
  addTeamButton.addEventListener("click", addTeam);
  refreshCatalogButton.addEventListener("click", () => {
    if (refreshCatalogButton.disabled || catalogRefreshDialog.open) return;
    pendingCatalogSport = catalogRefreshSport.value;
    const scope = pendingCatalogSport === "all" ? workingConfig.sports
      .filter(group => group.enabled !== false && configApi.findSport(group.sport)?.competitionType !== "individual")
      .map(group => configApi.findSport(group.sport).league).join(", ")
      : catalogRefreshSport.selectedOptions[0].textContent;
    document.querySelector("#catalog-refresh-dialog-description").textContent =
      `Download current team names, IDs, logos, and colors from MLB/ESPN for ${scope}, replacing the saved directory for that selection.`;
    catalogRefreshDialog.showModal();
  });
  document.querySelector("#cancel-refresh-team-catalog").addEventListener("click", () => catalogRefreshDialog.close());
  catalogRefreshDialog.addEventListener("close", () => { pendingCatalogSport = null; });
  document.querySelector("#confirm-refresh-team-catalog").addEventListener("click", () => {
    if (!catalogRefreshDialog.open || !pendingCatalogSport || refreshCatalogButton.disabled) return;
    const sport = pendingCatalogSport;
    pendingCatalogSport = null;
    catalogRefreshDialog.close();
    refreshTeamCatalog(sport);
  });
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
  document.querySelector("#refresh-games").addEventListener("click", refreshGames);
  liveModeButton.addEventListener("click", toggleLiveMode);
  liveModeFinalMinutes.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (liveModeFinalMinutes.reportValidity()) liveModeFinalMinutes.blur();
    }
  });
  liveModeFinalMinutes.addEventListener("change", () => {
    if (!liveModeFinalMinutes.reportValidity()) return;
    workingConfig.liveModeFinalMinutes = Number(liveModeFinalMinutes.value);
    scheduleSettingsSave("liveModeFinalMinutes");
    renderRotationControls();
  });
  document.querySelectorAll(".discovery-info, .display-mode-info").forEach(info => {
    const button = info.querySelector(".info-button");
    const tooltip = info.querySelector(".info-tooltip");
    const show = visible => {
      tooltip.hidden = !visible;
      button.setAttribute("aria-expanded", String(visible));
    };
    info.addEventListener("mouseenter", () => show(true));
    info.addEventListener("mouseleave", () => show(false));
    button.addEventListener("focus", () => show(true));
    button.addEventListener("click", () => show(true));
    info.addEventListener("focusout", () => show(false));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") show(false);
    });
    document.addEventListener("click", event => {
      if (!info.contains(event.target)) show(false);
    });
  });
  document.querySelector("#queue-sport-filter").addEventListener("change", () => {
    if (workingConfig.bannerSportFilter) applyBannerSportFilter(document.querySelector("#queue-sport-filter").value);
    else renderRotationControls();
  });
  document.querySelector("#apply-banner-sport-filter").addEventListener("click", () => {
    applyBannerSportFilter(workingConfig.bannerSportFilter ? "" : document.querySelector("#queue-sport-filter").value);
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
  document.querySelector("#unlock-all-games").addEventListener("click", unlockAllGames);
  pinnedOnlyButton.addEventListener("click", () => {
    pinnedOnly = !pinnedOnly;
    renderRotationControls();
  });
  document.querySelector("#live-sport").addEventListener("change", updateLive);
  document.querySelector("#refresh-live").addEventListener("click", updateLive);
  document.querySelector("#demo-sport").addEventListener("change", updateDemo);
  document.querySelector("#demo-state").addEventListener("change", updateDemo);
  document.querySelector("#refresh-demo").addEventListener("click", updateDemo);

  const connection = document.createElement("p");
  connection.className = "settings-connection";
  connection.setAttribute("role", "status");
  const migration = document.createElement("section");
  migration.className = "settings-backup";
  migration.setAttribute("aria-labelledby", "settings-backup-heading");
  migration.innerHTML = `<h3 id="settings-backup-heading">Settings backup</h3>
    <p id="settings-backup-help">${shared
      ? "Export a backup, or choose a previously exported settings file to import and apply it."
      : "Export a backup of your settings to import into shared control."}</p>`;
  const backupActions = document.createElement("div");
  backupActions.className = "settings-backup-actions";
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Export settings";
  exportButton.className = "button button--secondary";
  exportButton.onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(workingConfig, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "sports-settings.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  backupActions.append(exportButton);
  migration.append(backupActions);
  if (shared) {
    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className = "button button--secondary";
    importButton.textContent = "Import settings…";
    importButton.setAttribute("aria-describedby", "settings-backup-help");
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json,.json";
    input.hidden = true;
    input.setAttribute("aria-label", "Settings backup file");
    importButton.onclick = () => input.click();
    const importStatus = document.createElement("p");
    importStatus.className = "settings-import-status";
    importStatus.setAttribute("role", "status");
    let importing = false;
    const defaults = document.createElement("button");
    defaults.type = "button";
    defaults.textContent = "Start with defaults";
    defaults.className = "button button--secondary";
    async function initialize(config) {
      try {
        workingConfig = await configApi.saveConfig(config, { initialize: true });
        acknowledge(); renderSettings();
        status.textContent = global.sportsDesktop ? "Imported. Banner updates automatically." : "Shared settings initialized.";
        refreshConnection();
        return true;
      } catch (error) { status.textContent = error.message; return false; }
    }
    input.onchange = async () => {
      const file = input.files[0];
      if (!file || importing) return;
      importing = true;
      importButton.textContent = "Importing…";
      importStatus.className = "settings-import-status";
      importStatus.textContent = `Importing ${file.name}…`;
      refreshConnection();
      try {
        if (file.size > 262144) throw new Error("Choose a settings backup smaller than 256 KB.");
        let imported;
        try { imported = JSON.parse(await file.text()); }
        catch (_) { throw new Error("Could not read this backup. Choose a JSON file created with Export settings."); }
        if (!imported || (!Array.isArray(imported.sports) && !Array.isArray(imported.favorites))) throw new Error("This file is not an exported sports configuration.");
        if (!await initialize(imported)) throw new Error(status.textContent);
        importStatus.classList.add("is-saved");
        importStatus.textContent = `Imported ${file.name}. Your settings are now applied.`;
      } catch (error) {
        importStatus.classList.add("is-error");
        importStatus.textContent = error.message;
      } finally {
        input.value = "";
        importing = false;
        importButton.textContent = "Import settings…";
        refreshConnection();
      }
    };
    defaults.onclick = () => initialize(configApi.DEFAULT_CONFIG);
    backupActions.append(importButton, input, defaults);
    migration.append(importStatus);
    function refreshConnection() {
      const snapshot = shared.snapshot();
      const initialized = snapshot?.initialized;
      const connected = shared.connected();
      connection.textContent = !connected ? "Disconnected — changes cannot be saved."
        : !initialized ? "Import your previous settings or start with defaults."
        : "Connected — controlling the desktop banner.";
      if (snapshot?.recovery) connection.textContent += ` ${snapshot.recovery}`;
      input.disabled = importButton.disabled = importing || !connected || (initialized && !global.sportsDesktop);
      defaults.disabled = importing || !connected || initialized;
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
      const incoming = configApi.loadConfig();
      const edited = Object.keys(workingConfig).filter(key => JSON.stringify(workingConfig[key]) !== JSON.stringify(baseline[key]));
      const overlap = edited.some(key => pendingSettings.has(key) && JSON.stringify(incoming[key]) !== JSON.stringify(baseline[key]));
      for (const key of Object.keys(incoming)) {
        if (!edited.includes(key)) workingConfig[key] = structuredClone(incoming[key]);
      }
      acknowledge();
      if (overlap) {
        settingsSavePaused = true;
        clearTimeout(settingsSaveTimer);
        showSettingsError("Settings changed elsewhere. Your changes are preserved; retry to apply them.");
      }
      renderSettings();
    });
    refreshConnection();
  } else connection.textContent = "Local preview — settings here do not control the desktop banner. Export them to import into shared control.";
  migration.append(connection);
  status.closest(".actions").before(migration);
  if (global.sportsDesktop) global.addEventListener("sports-settings-backup", ({ detail: action }) => {
    document.querySelector('[data-tab="settings"]').click();
    migration.scrollIntoView({ block: "center" });
    if (action === "export") exportButton.click();
    else if (action === "import") backupActions.querySelector('input[type="file"]').click();
  });
  renderSettings();
  updateDemo();
  if (global.sportsDesktop || shared) pollBannerGame();

  async function pollBannerGame() {
    let connected = false;
    let nextGameKey = null;
    try {
      const response = await fetch("/api/output", { cache: "no-store", signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error("Banner unavailable");
      const frame = await response.json();
      connected = frame.ready === true;
      // Follow the rendered frame, not the next game selected during a transition.
      nextGameKey = connected ? frame.gameKey || null : null;
    } catch (_) { /* Clear the glow while disconnected. */ }
    if (bannerGameKey !== nextGameKey) {
      bannerGameKey = nextGameKey;
      highlightBannerGame();
    }
    setTimeout(pollBannerGame, connected ? 200 : 1000);
  }

  function highlightBannerGame() {
    document.querySelectorAll("#rotation-queue .game-card").forEach(card => {
      const showing = Boolean(bannerGameKey && card.dataset.gameKey === bannerGameKey);
      card.classList.toggle("is-on-banner", showing);
      if (showing) card.setAttribute("aria-current", "true");
      else card.removeAttribute("aria-current");
    });
  }

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

  function renderAutomaticWatchList(container, group) {
    global.SportsOverlay.automaticWatchSettings.render(container, group, workingConfig, key => {
      scheduleSettingsSave(key);
      if (key === "sports") renderSettings();
    });
  }

  function renderSettings() {
    const refreshFields = document.querySelector("#provider-refresh-fields");
    // Keep number inputs mounted so background saves never interrupt typing.
    if (!refreshFields.children.length) for (const sport of configApi.SPORT_CATALOG) {
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
        input.addEventListener("keydown", event => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (input.reportValidity()) input.blur();
          }
        });
        input.addEventListener("change", () => {
          if (!input.reportValidity()) return;
          workingConfig.providerRefreshSeconds[sport.key][state] = Number(input.value);
          scheduleSettingsSave("providerRefreshSeconds");
        });
        label.append(input); row.append(label);
      }
      refreshFields.append(row);
    }
    refreshFields.querySelectorAll("input").forEach(input => {
      if (document.activeElement !== input) input.value = workingConfig.providerRefreshSeconds[input.dataset.sport][input.dataset.state];
    });
    sportsList.replaceChildren();
    workingConfig.sports.forEach((group, sportIndex) => {
      const sport = configApi.findSport(group.sport);
      if (!sport) return;
      const section = document.querySelector("#sport-template").content.firstElementChild.cloneNode(true);
      section.dataset.sport = sport.key;
      section.querySelector(".sport-rank").textContent = `#${sportIndex + 1}`;
      section.querySelector(".sport-icon").textContent = { baseball: "⚾", football: "🏈", "college-football": "🏈", hockey: "🏒", soccer: "⚽", basketball: "🏀", "college-basketball": "🏀", "disc-golf": "🥏", chess: "♟" }[sport.key] || "";
      section.querySelector(".sport-name").textContent = sport.name;
      section.querySelector(".sport-league").textContent = sport.league;
      const details = section.querySelector(".sport-details");
      details.id = `sport-details-${sport.key}`;
      const disclosure = section.querySelector(".sport-disclosure");
      disclosure.setAttribute("aria-controls", details.id);
      const updateDisclosure = () => {
        const expanded = !collapsedSports.has(sport.key);
        details.hidden = !expanded;
        disclosure.setAttribute("aria-expanded", String(expanded));
        disclosure.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${sport.name}`);
        disclosure.querySelector("span").textContent = expanded ? "▾" : "▸";
      };
      disclosure.addEventListener("click", () => {
        if (collapsedSports.has(sport.key)) collapsedSports.delete(sport.key);
        else collapsedSports.add(sport.key);
        try { global.localStorage.setItem(disclosureKey, JSON.stringify([...collapsedSports])); } catch (_) { /* Session-only fallback. */ }
        updateDisclosure();
      });
      updateDisclosure();
      const enabled = section.querySelector(".sport-enabled");
      enabled.checked = group.enabled !== false;
      enabled.setAttribute("aria-label", `Show ${sport.name}`);
      enabled.addEventListener("change", () => {
        group.enabled = enabled.checked;
        scheduleSettingsSave("sports");
        renderSettings();
      });
      section.querySelector(".sport-disabled-note").hidden = enabled.checked;
      section.querySelector(".move-sport-up").disabled = sportIndex === 0;
      section.querySelector(".move-sport-down").disabled = sportIndex === workingConfig.sports.length - 1;
      section.querySelector(".move-sport-up").addEventListener("click", () => moveSport(sportIndex, -1));
      section.querySelector(".move-sport-down").addEventListener("click", () => moveSport(sportIndex, 1));

      const favoriteList = section.querySelector(".sport-favorites");
      favoriteList.hidden = !enabled.checked;
      if (!enabled.checked) { sportsList.append(section); return; }
      if (sport.competitionType === "individual") {
        const renderAutomaticWatches = () => renderAutomaticWatchList(favoriteList, group);
        global.SportsOverlay[sport.key === "chess" ? "chessSettings" : "pdgaSettings"].render(favoriteList, group, removedWatch => {
          if (removedWatch) {
            const key = `${sport.key}:${configApi.watchId(removedWatch)}`;
            workingConfig.includedGames = workingConfig.includedGames.filter(item => item !== key);
            scheduleSettingsSave("includedGames");
          }
          scheduleSettingsSave("sports");
          renderAutomaticWatches();
        }, providerRefresh.fetchFor(sport.key, global.SportsOverlay[sport.key === "chess" ? "lichess" : "pdga"]), sport.key === "chess" ? chessSession : undefined);
        renderAutomaticWatches();
        sportsList.append(section);
        return;
      }
      group.favorites.forEach((favorite, index) => renderFavorite(group, favorite, index, favoriteList));
      if (!group.favorites.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = `No ${sport.name.toLowerCase()} teams watched.`;
        favoriteList.append(empty);
      }
      sportsList.append(section);
    });
    catalogRefreshSport.querySelectorAll("option").forEach(option => {
      option.disabled = option.value !== "all" && workingConfig.sports.find(group => group.sport === option.value)?.enabled === false;
    });
    if (catalogRefreshSport.selectedOptions[0]?.disabled) catalogRefreshSport.value = "all";
    refreshCatalogButton.disabled = refreshingCatalog || !workingConfig.sports.some(group => group.enabled !== false
      && configApi.findSport(group.sport)?.competitionType !== "individual");
    renderTeamPicker();
    timeZonePicker.value = workingConfig.timeZone;
    document.querySelector("#display-mode").value = workingConfig.displayMode;
    document.querySelector("#rotation-mode").value = workingConfig.rotationMode;
    document.querySelector("#fallback-mode").value = workingConfig.fallbackMode;
    if (document.activeElement !== liveModeFinalMinutes) liveModeFinalMinutes.value = workingConfig.liveModeFinalMinutes;
    renderLiveSportPicker();
    renderRotationControls();
    if (recentlyAddedTeamKey) {
      const newCard = [...document.querySelectorAll(".favorite-card")]
        .find(card => card.dataset.teamKey === recentlyAddedTeamKey);
      const sportCard = newCard?.closest(".sport-card");
      if (sportCard?.querySelector(".sport-details").hidden) sportCard.querySelector(".sport-disclosure").click();
      newCard?.classList.add("is-new");
      newCard?.scrollIntoView({ behavior: "smooth", block: "center" });
      recentlyAddedTeamKey = null;
    }
  }

  function renderTeamPicker() {
    const selected = new Set(workingConfig.sports.flatMap(group => group.favorites.map(team => team.teamKey)));
    const previousValue = teamPicker.value;
    teamPicker.replaceChildren();

    const sportTeams = configApi.TEAM_CATALOG.filter(team => team.sport === teamSportPicker.value);
    const availableTeams = sportTeams.filter(team => !selected.has(team.key));
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = !teamSportPicker.value ? "Choose a sport first…"
      : availableTeams.length ? "Select a team…"
      : sportTeams.length ? "All teams in this sport are watched" : "No teams available for this sport";
    teamPicker.append(placeholder);

    availableTeams.forEach(team => {
      const option = document.createElement("option");
      option.value = team.key;
      option.textContent = team.name;
      teamPicker.append(option);
    });

    if (availableTeams.some(team => team.key === previousValue)) teamPicker.value = previousValue;
    teamPicker.disabled = !availableTeams.length;
    updateAddTeamButton();
  }

  function updateAddTeamButton() {
    addTeamButton.disabled = !teamPicker.value;
  }

  async function refreshTeamCatalog(sport) {
    const enabledSports = workingConfig.sports.filter(group => group.enabled !== false).map(group => group.sport);
    if (sport !== "all" && !enabledSports.includes(sport)) return;
    refreshingCatalog = true;
    refreshCatalogButton.disabled = true;
    catalogRefreshSport.disabled = true;
    catalogRefreshStatus.textContent = sport === "all" ? "Refreshing enabled team directories…" : "Refreshing team directory…";
    catalogRefreshStatus.className = "catalog-refresh-status";
    try {
      const response = await fetch("../api/team-catalog/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport, enabledSports }),
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
      refreshingCatalog = false;
      refreshCatalogButton.disabled = !workingConfig.sports.some(group => group.enabled !== false
        && configApi.findSport(group.sport)?.competitionType !== "individual");
      catalogRefreshSport.disabled = false;
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
    card.querySelector(".team-enabled").checked = favorite.enabled;
    card.querySelector(".team-enabled").addEventListener("change", event => {
      favorite.enabled = event.target.checked;
      scheduleSettingsSave("sports");
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
    const filters = [...document.querySelectorAll("#available-sport-filter, #queue-sport-filter")];
    const selectedSport = picker.value;
    const selectedFilters = filters.map(filter => filter.value);
    const enabledSports = workingConfig.sports.filter(group => group.enabled !== false);
    picker.replaceChildren();
    filters.forEach(filter => filter.replaceChildren(new Option("All sports", "")));
    enabledSports.forEach(group => {
      const sport = configApi.findSport(group.sport);
      const topFavorite = group.favorites
        .filter(favorite => favorite.enabled)
        .map(favorite => configApi.findTeam(favorite.teamKey))
        .find(Boolean);
      const option = document.createElement("option");
      option.value = group.sport;
      option.textContent = `${sport.name} · ${sport.competitionType === "individual" ? `${group.events.filter(event => event.enabled).length} watched ${sport.key === "chess" ? "broadcasts" : "divisions"}` : topFavorite?.name || "no included team"}`;
      picker.append(option);
      filters.forEach(filter => filter.append(new Option(sport.key === "chess" ? sport.name : sport.league, group.sport)));
    });
    if (enabledSports.some(group => group.sport === selectedSport)) picker.value = selectedSport;
    filters.forEach((filter, index) => {
      filter.value = enabledSports.some(group => group.sport === selectedFilters[index]) ? selectedFilters[index] : "";
      filter.disabled = !enabledSports.length;
    });
    if (workingConfig.bannerSportFilter) document.querySelector("#queue-sport-filter").value = workingConfig.bannerSportFilter;
    picker.disabled = !enabledSports.length;
    if (!enabledSports.length) picker.append(new Option("No sports enabled", ""));
    if (picker.value !== selectedSport) updateLive();
  }

  function addTeam() {
    const team = configApi.findTeam(teamPicker.value);
    if (!team) return;
    const group = workingConfig.sports.find(candidate => candidate.sport === team.sport);
    if (!group || group.favorites.some(favorite => favorite.teamKey === team.key)) return;
    group.favorites.push({ teamKey: team.key, enabled: true });
    recentlyAddedTeamKey = team.key;
    scheduleSettingsSave("sports");
    renderSettings();
    status.textContent = `${team.name} added · saving automatically…`;
  }

  function removeTeam(group, teamKey) {
    group.favorites = group.favorites.filter(favorite => favorite.teamKey !== teamKey);
    scheduleSettingsSave("sports");
    renderSettings();
  }

  function moveTeam(group, index, offset) {
    const [favorite] = group.favorites.splice(index, 1);
    group.favorites.splice(index + offset, 0, favorite);
    scheduleSettingsSave("sports");
    renderSettings();
  }

  function moveSport(index, offset) {
    const [sport] = workingConfig.sports.splice(index, 1);
    workingConfig.sports.splice(index + offset, 0, sport);
    scheduleSettingsSave("sports");
    renderSettings();
  }

  function readBehaviorFields(event) {
    const key = { "time-zone": "timeZone", "display-mode": "displayMode", "fallback-mode": "fallbackMode" }[event.target.id];
    workingConfig[key] = event.target.value;
    scheduleSettingsSave(key);
  }

  function updateRotationControls() {
    const previousLiveConfig = savedLiveConfig();
    workingConfig.rotationMode = document.querySelector("#rotation-mode").value;
    autoApplyLiveChange(previousLiveConfig, "Rotation source applied");
  }

  function liveModeActive() {
    return global.sportsDesktop ? engineRotationState?.liveMode?.active === true : localLiveMode.isActive();
  }

  async function toggleLiveMode() {
    if (changingLiveMode) return;
    changingLiveMode = true;
    liveModeButton.disabled = true;
    try {
      const active = !liveModeActive();
      if (global.sportsDesktop) {
        await global.sportsDesktop.action("live-mode", active);
        await discoverRotationGames();
      } else localLiveMode.setActive(active, normalRotationQueue());
      renderRotationControls();
    } catch (error) {
      document.querySelector("#rotation-status").textContent = error.message;
    } finally { changingLiveMode = false; renderRotationControls(); }
  }

  function gameListSnapshot() {
    return JSON.stringify({ available: availableRotationEntries, automatic: automaticRotationEntries,
      queue: currentRotationQueue().map(rotationEntryKey) });
  }

  async function refreshGames() {
    if (refreshingGames) return;
    refreshingGames = true;
    const button = document.querySelector("#refresh-games");
    const message = document.querySelector("#refresh-games-status");
    const before = gameListSnapshot();
    button.disabled = true;
    button.textContent = "Refreshing…";
    button.setAttribute("aria-busy", "true");
    message.textContent = "Checking for game updates…";
    message.className = "save-status";
    try {
      const result = await discoverRotationGames(true);
      const changed = before !== gameListSnapshot();
      message.textContent = result.failures
        ? changed ? "Game lists updated. Some feeds are unavailable; updates may be incomplete."
          : "Some feeds are unavailable. Could not check for all updates."
        : changed ? "Game lists updated." : "No updates available. Game lists are already up to date.";
      message.className = result.failures ? "save-status is-error" : "save-status is-saved";
    } catch (error) {
      const reason = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
      message.textContent = `Could not refresh games. ${reason}`;
      message.className = "save-status is-error";
    } finally {
      refreshingGames = false;
      button.disabled = false;
      button.textContent = "Refresh games";
      button.removeAttribute("aria-busy");
    }
  }

  async function discoverRotationGames(manual = false) {
    if (refreshingGames && !manual) return;
    if (global.sportsDesktop) {
      clearTimeout(gameDiscoveryTimer);
      const revision = ++gameDiscoveryRevision;
      try {
        const state = manual ? (await global.sportsDesktop.action('refresh')).engine : await global.sportsDesktop.engine();
        if (revision !== gameDiscoveryRevision) return;
        if (manual && !state?.ready) throw Error('Sports engine is not ready. Try again.');
        engineLoading = !state.ready || state.discoveryComplete === false;
        if (!engineLoading) {
          engineRotationState = state;
          automaticRotationEntries = state.automaticEntries;
          availableRotationEntries = state.availableEntries;
        }
        renderRotationControls();
        const status = document.querySelector('#rotation-status');
        const pendingSports = (state.loadingSports || []).map(sport => configApi.findSport(sport)?.name || sport).join(', ');
        status.textContent = pendingSports ? `Loading ${pendingSports}… ${availableRotationEntries.length ? 'Showing available games.' : 'Waiting for score feeds.'}`
          : engineLoading ? availableRotationEntries.length
          ? 'Loading game updates… Showing last received games.' : 'Loading games… Waiting for score feeds.'
          : state.discoveryPending ? 'Loading game updates… Showing last received games.' : state.discoveryFailures
          ? 'Some score feeds are unavailable. Keeping received games and retrying automatically.' : 'Shared engine games';
        status.className = state.discoveryFailures ? 'save-status is-error' : 'save-status is-saved';
        for (const id of ['rotation-queue', 'available-games']) document.getElementById(id).setAttribute('aria-busy', String(engineLoading || state.discoveryPending === true));
        return { failures: state.discoveryFailures || 0 };
      } catch (error) {
        document.querySelector('#rotation-status').textContent = error.message;
        if (manual) throw error;
      } finally {
        if (revision === gameDiscoveryRevision) gameDiscoveryTimer = setTimeout(discoverRotationGames, 2000);
      }
      return;
    }
    clearTimeout(gameDiscoveryTimer);
    gameDiscoveryTimer = setTimeout(discoverRotationGames, workingConfig.sports.some(group => group.enabled && (group.autoFollow || group.discoverSecondTier)) ? 15 * 60_000 : 60 * 60_000);
    const revision = ++gameDiscoveryRevision;
    const rotationStatus = document.querySelector("#rotation-status");
    rotationStatus.textContent = "Loading games…";
    rotationStatus.className = "save-status";
    document.querySelector("#refresh-games").disabled = true;

    const results = await Promise.allSettled(workingConfig.sports.map(discoverSportGames));
    if (revision !== gameDiscoveryRevision) return;
    const synchronized = await global.SportsOverlay.automaticWatches.sync(results.flatMap((result, index) => result.status === "fulfilled"
      ? [{ sport: workingConfig.sports[index].sport, ...result.value }] : []));
    if (revision !== gameDiscoveryRevision) return;
    if (synchronized) {
      workingConfig.automaticWatchLists = synchronized.automaticWatchLists;
      baseline.automaticWatchLists = structuredClone(synchronized.automaticWatchLists);
      // Discovery updates its own list without replacing an active player picker.
      workingConfig.sports.filter(group => group.enabled !== false && ["chess", "disc-golf"].includes(group.sport)).forEach(group => {
        const container = sportsList.querySelector(`.sport-card[data-sport="${group.sport}"] .sport-favorites`);
        if (container) renderAutomaticWatchList(container, group);
      });
    }
    const discoveredAutomaticEntries = results.flatMap(result => result.status === "fulfilled" ? result.value.automaticEntries : []);
    availableRotationEntries = results.flatMap(result => result.status === "fulfilled" ? result.value.availableEntries : []);
    automaticRotationEntries = selectionApi.retainAutoFinals(
      automaticRotationEntries,
      discoveredAutomaticEntries,
      availableRotationEntries,
      { keyOf: rotationEntryKey, watchedTeams: workingConfig.sports.filter(group => group.enabled !== false)
        .flatMap(group => {
          const teams = group.favorites.filter(favorite => favorite.enabled).map(favorite => configApi.findTeam(favorite.teamKey)).filter(Boolean);
          return workingConfig.displayMode === "top-favorite" ? teams.slice(0, 1) : teams;
        }) },
    );
    const failed = results.filter(result => result.status === "rejected").length;
    const partial = results.filter(result => result.status === "fulfilled" && result.value.failures).length;
    document.querySelector("#refresh-games").disabled = false;
    rotationStatus.textContent = failed || partial
      ? `${failed} sports unavailable · ${partial} sports partially loaded. Refresh to retry.` : "Games refreshed";
    rotationStatus.className = failed || partial ? "save-status is-error" : "save-status is-saved";
    renderRotationControls();
    return { failures: failed + partial };
  }

  async function discoverSportGames(group) {
    if (group.enabled === false) return { automaticEntries: [], availableEntries: [] };
    if (group.sport === "disc-golf") return global.SportsOverlay.pdga.createClient({ watches: configApi.eventWatches(workingConfig, group.sport), autoFollow: group.autoFollow, discoverSecondTier: group.discoverSecondTier, autoDivisions: group.autoDivisions, session: pdgaSession,
      fetchImpl: providerRefresh.fetchFor("disc-golf", global.SportsOverlay.pdga),
    }).discover({ topFavoriteOnly: workingConfig.displayMode === "top-favorite", fallbackMode: workingConfig.fallbackMode,
      excludedKeys: workingConfig.excludedGames, retentionMs: liveModeActive() ? workingConfig.liveModeFinalMinutes * 60_000 : 60 * 60_000 });
    if (group.sport === "chess") return global.SportsOverlay.lichess.createClient({ watches: configApi.eventWatches(workingConfig, group.sport), autoFollow: group.autoFollow, discoverSecondTier: group.discoverSecondTier, session: chessSession,
      fetchImpl: providerRefresh.fetchFor("chess", global.SportsOverlay.lichess),
    }).discover({ topFavoriteOnly: workingConfig.displayMode === "top-favorite", fallbackMode: workingConfig.fallbackMode, excludedKeys: workingConfig.excludedGames, retentionMs: liveModeActive() ? workingConfig.liveModeFinalMinutes * 60_000 : 60 * 60_000 });
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
      topFavoriteOnly: workingConfig.displayMode === "top-favorite",
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
    document.querySelector("#rotation-source-description").textContent = {
      automatic: "Uses Automatic game selection in Settings, skipping games you remove. Adding a game switches to Automatic selections + my games.",
      hybrid: "Combines Automatic game selection in Settings with games you add here, leaving out games you remove.",
      curated: "Uses only games you add here. Automatic game selection in Settings does not add games to this rotation.",
    }[workingConfig.rotationMode];
    document.querySelectorAll("[data-default-duration]").forEach(input => {
      // Desktop engine refreshes must not replace a value being typed.
      if (document.activeElement !== input) {
        input.value = workingConfig.defaultGameDurations[input.dataset.defaultDuration];
      }
    });
    document.querySelector("#rotation-mode").value = workingConfig.rotationMode;
    const active = liveModeActive();
    liveModeButton.setAttribute("aria-pressed", String(active));
    const canActivate = global.sportsDesktop ? engineRotationState?.ready && engineRotationState?.liveMode?.canActivate
      : normalRotationQueue().some(global.SportsOverlay.liveMode.isLive);
    liveModeButton.disabled = engineLoading || changingLiveMode || (!active && !canActivate);
    liveModeButton.title = active ? "Turn off Live mode and restore your full rotation."
      : canActivate ? "Show only live games from your rotation." : "No live games in rotation.";
    document.querySelector("#rotation-mode").disabled = active;
    document.querySelector("#reset-rotation").disabled = active;
    const hasPins = workingConfig.lockedGameKeys.length > 0;
    document.querySelector("#unlock-all-games").disabled = !hasPins;
    if (!hasPins) pinnedOnly = false;
    pinnedOnlyButton.disabled = !hasPins;
    pinnedOnlyButton.setAttribute("aria-pressed", String(pinnedOnly));
    pinnedOnlyButton.title = !hasPins ? "Pin a game to filter this list by pinned games."
      : pinnedOnly ? "Show pinned and unpinned games in this list."
      : "Show only pinned games in this list.";
    document.querySelector("#live-mode-note").textContent = active
      ? `Live mode filters the banner to live games from your rotation. Pins apply to eligible games; finished games stay for ${workingConfig.liveModeFinalMinutes} minutes.`
      : "Show only live games from your rotation on the banner. Finished games stay for the time set in Settings.";
    const queue = currentRotationQueue();
    const queueList = document.querySelector("#rotation-queue");
    const availableList = document.querySelector("#available-games");
    // Clearing odds and rebuilding cards can shrink a scrolled list temporarily.
    // Restore its position only after all of its replacement cards are mounted.
    const listPositions = [queueList, availableList].map(list => ({ list, scrollTop: list.scrollTop }));
    for (const { list } of listPositions) {
      list.querySelectorAll(".game-copy").forEach(mount => oddsApi.clear(mount));
    }
    queueList.replaceChildren();
    availableList.replaceChildren();
    const queueSportFilter = document.querySelector("#queue-sport-filter").value;
    const bannerFilterButton = document.querySelector("#apply-banner-sport-filter");
    const filteringBanner = Boolean(workingConfig.bannerSportFilter);
    bannerFilterButton.setAttribute("aria-pressed", String(filteringBanner));
    bannerFilterButton.disabled = !filteringBanner && !queueSportFilter;
    bannerFilterButton.title = filteringBanner ? "Turn off the banner sport filter and restore the full rotation."
      : queueSportFilter ? "Show only this sport on the banner." : "Choose a sport first.";
    document.querySelector("#queue-filter-note").textContent = filteringBanner
      ? "Filters this list and the banner. Turn off Apply to banner to restore the full rotation."
      : "Filters this list only. Turn on Apply to banner to also filter rotation.";
    const matchesListFilters = entry => (!queueSportFilter || entry.candidate.sport === queueSportFilter)
      && (!pinnedOnly || workingConfig.lockedGameKeys.includes(rotationEntryKey(entry)));
    const shownCount = queue.filter(matchesListFilters).length;
    const loadingGames = engineLoading || engineRotationState?.discoveryPending === true;
    document.querySelector("#rotation-count").textContent = engineLoading && !queue.length ? "Loading…"
      : `${queueSportFilter || pinnedOnly ? `${shownCount} of ` : ""}${queue.length} game${queue.length === 1 ? "" : "s"}${loadingGames ? " · loading…" : ""}`;

    if (!queue.length) appendRotationEmpty(queueList, engineLoading ? "Loading games…" : active ? "No live games in rotation. Live mode is still on."
      : availableRotationEntries.length ? "No games selected for the banner." : "Refresh games to build the live queue.");
    else if (!shownCount) appendRotationEmpty(queueList, pinnedOnly
      ? queueSportFilter ? "No pinned games for this sport in rotation." : "No pinned games in rotation."
      : "No games for this sport in rotation.");
    // Filter only the cards; actions retain their positions in the full rotation.
    queue.forEach((entry, index) => {
      if (matchesListFilters(entry)) renderQueueGame(entry, index, queue, queueList);
    });
    highlightBannerGame();

    const queuedKeys = new Set([...normalRotationQueue(), ...queue].map(rotationEntryKey));
    const sportFilter = document.querySelector("#available-sport-filter").value;
    const search = document.querySelector("#game-search").value.trim().toLowerCase();
    const available = availableRotationEntries
      .filter(isSportEnabled)
      .filter(entry => !queuedKeys.has(rotationEntryKey(entry)))
      .filter(entry => isCurrentGame(entry.candidate))
      .filter(entry => !sportFilter || entry.candidate.sport === sportFilter)
      .filter(entry => !search || `${gameName(entry.candidate)} ${gameTournament(entry.candidate)}`.toLowerCase().includes(search))
      .sort((a, b) => gameStateRank(a.candidate.state) - gameStateRank(b.candidate.state)
        || new Date(a.candidate.startTime || 0) - new Date(b.candidate.startTime || 0));
    if (!available.length) appendRotationEmpty(availableList, engineLoading && !availableRotationEntries.length ? "Loading games…" : sportFilter === "disc-golf" && !search
      ? "No additional PDGA divisions available. Divisions already in rotation are listed above."
      : availableRotationEntries.length ? "No matching current games." : "No games loaded yet.");
    available.forEach(entry => renderAvailableGame(entry, availableList));
    for (const { list, scrollTop } of listPositions) list.scrollTop = scrollTop;
    if (!global.sportsDesktop && active) {
      const expiry = localLiveMode.nextExpiry(workingConfig.liveModeFinalMinutes);
      if (Number.isFinite(expiry)) {
        clearTimeout(gameDiscoveryTimer);
        gameDiscoveryTimer = setTimeout(renderRotationControls, Math.max(1, expiry - Date.now()));
      }
    }
  }

  function isSportEnabled(entry) {
    return configApi.isCandidateEnabled(workingConfig, entry.candidate);
  }

  function currentRotationQueue() {
    if (global.sportsDesktop && liveModeActive()) {
      // Settings saves and engine publications arrive independently. Keep a new
      // live card visible until the engine has applied the same selection.
      const acknowledged = engineRotationState?.rotationSelection
        && Object.entries(engineRotationState.rotationSelection)
          .every(([key, value]) => JSON.stringify(value) === JSON.stringify(workingConfig[key]));
      for (const key of pendingLiveAdditions.keys()) {
        if (acknowledged || !workingConfig.includedGames.includes(key)
          || workingConfig.excludedGames.includes(key)) pendingLiveAdditions.delete(key);
      }
      const entries = new Map((engineRotationState?.liveQueue || engineRotationState?.queue || [])
        .map(entry => [rotationEntryKey(entry), entry]));
      for (const [key, entry] of pendingLiveAdditions) if (!entries.has(key)) entries.set(key, entry);
      const order = new Map(workingConfig.rotationOrder.map((key, index) => [key, index]));
      return [...entries.values()].filter(isSportEnabled)
        .filter(entry => !workingConfig.excludedGames.includes(rotationEntryKey(entry)))
        .sort((a, b) => (order.get(rotationEntryKey(a)) ?? Number.MAX_SAFE_INTEGER)
          - (order.get(rotationEntryKey(b)) ?? Number.MAX_SAFE_INTEGER));
    }
    pendingLiveAdditions.clear();
    return localLiveMode.update({
      rotation: normalRotationQueue(), available: availableRotationEntries,
      excludedKeys: workingConfig.excludedGames,
      enabledSports: workingConfig.sports.filter(group => group.enabled !== false).map(group => group.sport),
      rotationOrder: workingConfig.rotationOrder, retentionMinutes: workingConfig.liveModeFinalMinutes,
      allows: isSportEnabled,
    });
  }

  function normalRotationQueue() {
    return selectionApi.applyRotationControls({
      automaticEntries: automaticRotationEntries.filter(isSportEnabled),
      availableEntries: availableRotationEntries.filter(isSportEnabled),
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
    lockButton.textContent = locked ? "Pinned" : "Pin";
    lockButton.classList.toggle("is-locked", locked);
    lockButton.setAttribute("aria-pressed", String(locked));
    lockButton.title = locked ? "Unpin this game. When no games are pinned, the full rotation resumes."
      : "Pin this game to show only pinned games that are eligible in the current mode.";
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
    card.querySelector(".game-sport").textContent = `${sport?.league || entry.candidate.sport.toUpperCase()}${entry.candidate.raw?.discoveryTier === "second" ? " · Second tier" : entry.candidate.raw?.automatic ? " · Automatic" : ""}`;
    if (entry.candidate.raw?.automatic) {
      const watch = document.createElement("button");
      watch.type = "button"; watch.className = `lock-game ${entry.candidate.sport === "chess" ? "chess-watch-automatic" : "pdga-watch-automatic"}`; watch.textContent = entry.candidate.sport === "chess" ? "Watch tournament" : "Watch division";
      watch.title = entry.candidate.sport === "chess"
        ? "Save this tournament to your watch list and follow its current round automatically. It stays watched until you remove it."
        : "Save this tournament division (such as MPO or FPO) to your watch list and follow its leaderboard across rounds. It stays watched until you remove it.";
      watch.onclick = () => {
        const group = workingConfig.sports.find(item => item.sport === entry.candidate.sport);
        if (group.events.length >= 30) { showSettingsError("Remove a watched division before adding another (limit 30)."); return; }
        if (entry.candidate.sport === "chess") {
          const tournamentId = entry.candidate.id.split(":")[0];
          if (!group.events.some(item => item.tournamentId === tournamentId && !item.roundId && !item.bannerId)) {
            group.events.push({ tournamentId, roundId: "", name: entry.candidate.raw.name, enabled: true, view: "overview", playerId: "" });
            scheduleSettingsSave("sports"); renderSettings();
          }
          return;
        }
        const [tournamentId, division] = entry.candidate.id.split(":");
        if (!group.events.some(item => item.tournamentId === tournamentId && item.division === division && !item.bannerId)) {
          group.events.push({ tournamentId, division, name: entry.candidate.raw.name, enabled: true, view: "leaderboard", playerId: "" });
          scheduleSettingsSave("sports"); renderSettings();
        }
      };
      let actions = card.querySelector(".game-actions");
      if (!actions) {
        actions = document.createElement("div"); actions.className = "game-actions";
        const add = card.querySelector(".add-game");
        add.replaceWith(actions); actions.append(add);
      }
      actions.append(watch);
      const remove = card.querySelector(".remove-game");
      if (remove) remove.textContent = "Exclude";
    }
    renderGameLogos(card.querySelector(".game-logos"), entry.candidate);
    const name = card.querySelector(".game-name");
    card.classList.toggle("is-player-card", ["chess", "disc-golf"].includes(entry.candidate.sport) && entry.candidate.raw?.view === "player");
    name.textContent = gameName(entry.candidate);
    if (card.classList.contains("is-player-card")) {
      const tournament = document.createElement("span");
      tournament.className = "game-tournament";
      tournament.textContent = gameTournament(entry.candidate);
      name.after(tournament);
    }
    name.addEventListener("pointerenter", () => {
      if (name.scrollWidth > name.clientWidth) name.title = card.classList.contains("is-player-card")
        ? [name.textContent, entry.candidate.raw.fullName || entry.candidate.raw.name, entry.candidate.raw.division || entry.candidate.raw.roundName].filter(Boolean).join(" · ")
        : entry.candidate.raw?.fullName || name.textContent;
      else name.removeAttribute("title");
    });
    card.querySelector(".game-meta").textContent = [gameMeta(entry.candidate), entry.candidate.raw?.discoveryReason].filter(Boolean).join(" · ");
    if (entry.candidate.state === "pregame") {
      global.SportsOverlay.countdown.replace(card.querySelector(".game-meta"), entry.candidate.startTime,
        workingConfig.timeZone === "local" ? undefined : workingConfig.timeZone);
    }
    const candidate = entry.candidate;
    const odds = global.SportsOverlay.model.espnOdds(candidate.raw || {});
    const teams = gameTeams(candidate);
    if (odds && teams.length === 2) {
      oddsApi.render(card.querySelector(".game-copy"), {
        id: candidate.id, sport: candidate.sport, state: candidate.state, startTime: candidate.startTime,
        teams: { away: { ...teams[0], abbreviation: teams[0].abbreviation || catalogTeam(candidate.sport, teams[0])?.abbreviation || teams[0].name },
          home: { ...teams[1], abbreviation: teams[1].abbreviation || catalogTeam(candidate.sport, teams[1])?.abbreviation || teams[1].name } },
        details: { odds, inPlay: (candidate.raw?.competitions?.[0]?.status ?? candidate.raw?.status)?.type?.state === "in" },
      }, gameOddsTracker);
    }
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
      return ["away", "home"].filter(side => teams[side]?.team).map(side => ({
        id: teams[side].team.id,
        name: teams[side].team.name,
        abbreviation: teams[side].team.abbreviation,
        logoUrl: teams[side].team.logoUrl,
        score: teams[side].score ?? candidate.raw?.linescore?.teams?.[side]?.runs,
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
      score: competitor.score?.value ?? competitor.score,
    }));
  }

  function catalogTeam(sport, team) {
    const values = [team.id, team.abbreviation, team.name].map(value => String(value || "").toUpperCase());
    return configApi.TEAM_CATALOG.find(candidate => candidate.sport === sport
      && [candidate.teamId, candidate.abbreviation, candidate.name]
        .some(value => values.includes(String(value || "").toUpperCase())));
  }

  function gameName(candidate) {
    if (["chess", "disc-golf"].includes(candidate.sport) && candidate.raw?.view === "player") return candidate.raw.bannerLabel;
    if (candidate.sport === "chess") return `${candidate.raw?.name || "Chess tournament"} · ${candidate.raw?.roundName || "Round"}${candidate.raw?.bannerLabel ? ` · ${candidate.raw.bannerLabel}` : ""}`;
    if (candidate.sport === "disc-golf") {
      const tournament = `${candidate.raw?.name || "PDGA tournament"} · ${candidate.raw?.division || ""}`;
      return `${tournament}${candidate.raw?.bannerLabel ? ` · ${candidate.raw.bannerLabel}` : ""}`;
    }
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

  function gameTournament(candidate) {
    if (candidate.sport === "chess") return [candidate.raw?.name, candidate.raw?.roundName].filter(Boolean).join(" · ");
    if (candidate.sport === "disc-golf") return [candidate.raw?.name, candidate.raw?.division].filter(Boolean).join(" · ");
    return "";
  }

  function gameMeta(candidate) {
    if (candidate.sport === "chess") return `${candidate.raw?.stale ? "Last received · " : ""}${candidate.state === "live" ? "Live" : candidate.state === "interrupted" ? candidate.raw?.detailedState || "Break" : candidate.state === "final" ? "Final" : "Upcoming"}${candidate.state === "pregame" && candidate.startTime ? ` · ${global.SportsOverlay.model.formatPregameStart(candidate.startTime, new Date(), workingConfig.timeZone === "local" ? undefined : workingConfig.timeZone)}` : ""}`;
    if (candidate.sport === "disc-golf") {
      const state = `${candidate.raw?.stale ? "Last received · " : ""}${candidate.state === "final" ? "Final" : candidate.state === "live" ? "Live" : candidate.state === "interrupted" ? candidate.raw?.detailedState || "Break" : "Upcoming"}`;
      const player = candidate.raw?.view === "player" && candidate.raw.player;
      const signed = value => value == null ? "—" : value === 0 ? "E" : value > 0 ? `+${value}` : String(value).replace("-", "−");
      const stats = !player ? [] : player.status ? [player.status] : [
        `Pos ${player.place == null ? "—" : `${player.tied ? "T" : ""}${player.place}`}`,
        `Total ${signed(player.total)}`, `Round ${signed(player.roundToPar)}`,
        player.completed ? "Thru F" : player.started ? `Thru ${player.played ?? "—"}` : player.teeTime ? `Tee ${global.SportsOverlay.pdga.formatTeeTime(player, workingConfig.timeZone === "local" ? undefined : workingConfig.timeZone)}` : "Awaiting tee time",
      ];
      return [state, `R${candidate.raw?.round || 1}`, ...stats, candidate.raw?.dateRange].filter(Boolean).join(" · ");
    }
    const preseason = candidate.sport === "baseball"
      ? ["S", "E"].includes(candidate.raw?.gameType)
      : global.SportsOverlay.model.espnPreseason(candidate.raw || {}, candidate.sport !== "soccer");
    const status = candidate.raw?.competitions?.[0]?.status ?? candidate.raw?.status;
    const gameState = candidate.state === "live" ? "Live" : candidate.state === "final" ? "Final"
      : candidate.state === "interrupted" ? candidate.detailedState || status?.type?.description
        || status?.type?.detail || status?.detailedState || "Interrupted" : "Upcoming";
    let state = preseason ? `PRESEASON · ${gameState}` : gameState;
    if (["final", "live", "interrupted"].includes(candidate.state)) {
      const teams = gameTeams(candidate);
      if (teams.length === 2 && teams.every(team =>
        ["number", "string"].includes(typeof team.score)
        && String(team.score).trim() !== "" && Number.isFinite(Number(team.score)))) {
        const scores = teams.map(team => `${team.abbreviation || catalogTeam(candidate.sport, team)?.abbreviation || team.name || "Team"} ${Number(team.score)}`);
        state += ` · ${scores.join(" – ")}`;
      }
    }
    if (candidate.state === "live") {
      if (candidate.sport === "baseball") {
        const linescore = candidate.raw?.linescore || {};
        const inning = linescore.currentInningOrdinal || (Number(linescore.currentInning) > 0 ? String(linescore.currentInning) : "");
        const inningState = String(linescore.inningState || linescore.inningHalf || "").toLowerCase();
        const half = { top: "Top", bottom: "Bottom", middle: "Mid", end: "End" }[inningState]
          || (typeof linescore.isTopInning === "boolean" ? linescore.isTopInning ? "Top" : "Bottom" : "Inning");
        if (inning) state += ` · ${half} ${inning}`;
        return state;
      }
      const clock = String(status?.displayClock ?? "").trim();
      const providerName = configApi.TEAM_CATALOG.find(team => team.sport === candidate.sport)?.provider;
      const provider = providerName ? registryApi.getProvider(providerName) : null;
      const period = provider?.periodLabel?.(status?.period, status?.type?.description || status?.type?.detail) || "";
      const progress = [period, clock].filter(Boolean).join(" · ");
      if (progress) state += ` · ${progress}`;
      return state;
    }
    if (candidate.state === "interrupted" || !candidate.startTime) return state;
    return `${state} · ${global.SportsOverlay.model.formatPregameStart(candidate.startTime, new Date(), workingConfig.timeZone === "local" ? undefined : workingConfig.timeZone)}`;
  }

  function addRotationGame(entry) {
    const previousLiveConfig = savedLiveConfig();
    const key = rotationEntryKey(entry);
    const currentKeys = normalRotationQueue().map(rotationEntryKey);
    workingConfig.includedGames = [...new Set([...workingConfig.includedGames, key])];
    workingConfig.excludedGames = workingConfig.excludedGames.filter(item => item !== key);
    workingConfig.rotationOrder = [...currentKeys.filter(item => item !== key), key];
    if (workingConfig.rotationMode === "automatic") workingConfig.rotationMode = "hybrid";
    if (global.sportsDesktop && liveModeActive() && global.SportsOverlay.liveMode.isLive(entry)) {
      pendingLiveAdditions.set(key, entry);
    }
    renderRotationControls();
    autoApplyLiveChange(previousLiveConfig, `${gameName(entry.candidate)} added to live banner`);
  }

  function removeRotationGame(entry) {
    const previousLiveConfig = savedLiveConfig();
    const key = rotationEntryKey(entry);
    const isAutomatic = automaticRotationEntries.some(candidate => rotationEntryKey(candidate) === key);
    workingConfig.includedGames = workingConfig.includedGames.filter(item => item !== key);
    workingConfig.excludedGames = isAutomatic || liveModeActive()
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
    const keys = [...new Set([...normalRotationQueue(), ...queue].map(rotationEntryKey))];
    const first = keys.indexOf(rotationEntryKey(queue[index]));
    const second = keys.indexOf(rotationEntryKey(queue[index + offset]));
    [keys[first], keys[second]] = [keys[second], keys[first]];
    workingConfig.rotationOrder = keys;
    autoApplyLiveChange(previousLiveConfig, "Rotation order applied");
  }

  function resetRotation() {
    const previousLiveConfig = savedLiveConfig();
    workingConfig.rotationMode = "automatic";
    workingConfig.bannerSportFilter = "";
    workingConfig.includedGames = [];
    workingConfig.excludedGames = [];
    workingConfig.rotationOrder = [];
    workingConfig.gameDurations = {};
    workingConfig.lockedGameKeys = [];
    autoApplyLiveChange(previousLiveConfig, "Automatic rotation restored");
  }

  function unlockAllGames() {
    const previousLiveConfig = savedLiveConfig();
    workingConfig.lockedGameKeys = [];
    pinnedOnly = false;
    renderRotationControls();
    autoApplyLiveChange(previousLiveConfig, "All games unpinned · rotation resumed");
  }

  function applyBannerSportFilter(sport) {
    const previousLiveConfig = savedLiveConfig();
    workingConfig.bannerSportFilter = sport;
    autoApplyLiveChange(previousLiveConfig, sport
      ? `${configApi.findSport(sport).name} filter applied to banner` : "Banner sport filter off · full rotation restored");
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
      ? `${gameName(entry.candidate)} pinned · ${lockCount} pinned`
      : `${gameName(entry.candidate)} unpinned${lockCount ? ` · ${lockCount} pinned` : " · full rotation resumed"}`);
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
    const submittedLive = cloneLiveConfig(workingConfig);
    try {
      const savedConfig = configApi.loadConfig();
      copyLiveConfig(savedConfig, submittedLive);
      const normalizedConfig = await persist(savedConfig, liveConfigKeys);
      for (const key of liveConfigKeys) {
        if (JSON.stringify(workingConfig[key]) === JSON.stringify(submittedLive[key])) workingConfig[key] = structuredClone(normalizedConfig[key]);
      }
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
    if (["disc-golf", "chess"].includes(candidate.sport)) return true;
    if (candidate.state === "live") return true;
    const start = new Date(candidate.startTime || 0).getTime();
    if (!Number.isFinite(start)) return false;
    const age = start - Date.now();
    if (candidate.state === "final") return age >= -24 * 60 * 60 * 1_000;
    return age >= -2 * 60 * 60 * 1_000 && age <= 7 * 24 * 60 * 60 * 1_000;
  }

  function showSettingsError(message) {
    status.textContent = message;
    status.className = "save-status is-error";
    document.querySelector("#save-settings").hidden = false;
  }

  async function saveSettings() {
    if (settingsSaveRunning) return;
    settingsSavePaused = false;
    clearTimeout(settingsSaveTimer);
    settingsSaveRunning = true;
    try {
      while (pendingSettings.size && !settingsSavePaused) {
        const fields = [...pendingSettings];
        fields.forEach(key => pendingSettings.delete(key));
        const submitted = structuredClone(workingConfig);
        status.textContent = "Saving…";
        status.className = "save-status";
        try {
          const result = await persist(submitted, fields);
          let refreshed = false;
          for (const key of Object.keys(result)) {
            if (JSON.stringify(workingConfig[key]) === JSON.stringify(submitted[key])
              && JSON.stringify(workingConfig[key]) !== JSON.stringify(result[key])) {
              workingConfig[key] = structuredClone(result[key]);
              refreshed = true;
            }
          }
          if (refreshed) renderSettings();
        } catch (error) {
          fields.forEach(key => pendingSettings.add(key));
          settingsSavePaused = true;
          clearTimeout(settingsSaveTimer);
          showSettingsError(error.conflict
            ? "Settings changed elsewhere. Your changes are preserved; retry to apply them."
            : `${error.message} Your changes are preserved; retry to save.`);
          return;
        }
      }
      if (settingsSavePaused) return;
      document.querySelector("#save-settings").hidden = true;
      status.textContent = shared ? "Saved automatically. Banner updated." : "Saved automatically locally (preview only).";
      status.className = "save-status is-saved";
      discoverRotationGames();
    } finally { settingsSaveRunning = false; }
  }

  function resetSettings() {
    if (!resetDialog.open) return;
    resetDialog.close();
    clearTimeout(settingsSaveTimer);
    settingsSavePaused = false;
    workingConfig = configApi.normalizeConfig(configApi.DEFAULT_CONFIG);
    Object.keys(workingConfig).forEach(key => pendingSettings.add(key));
    undoLiveConfig = null;
    undoLiveButton.hidden = true;
    renderSettings();
    saveSettings();
  }

  function scheduleSettingsSave(key) {
    pendingSettings.add(key);
    if (settingsSavePaused) return;
    status.textContent = "Saving automatically…";
    status.className = "save-status";
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(saveSettings, 150);
  }

  function updateDemo() {
    const sportPicker = document.querySelector("#demo-sport");
    const sport = sportPicker.value;
    const statePicker = document.querySelector("#demo-state");
    const playerOption = statePicker.querySelector('option[value="player"]');
    playerOption.hidden = playerOption.disabled = sport !== "chess";
    if (sport !== "chess" && statePicker.value === "player") statePicker.value = "live";
    const state = statePicker.value;
    const isRotation = state === "rotation";
    sportPicker.disabled = isRotation;
    const params = new URLSearchParams(isRotation ? {} : { sport });
    if (["pregame", "live", "interrupted", "final", "player"].includes(state)) params.set("demo", state);
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
