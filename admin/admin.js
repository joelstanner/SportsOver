"use strict";

(function initializeAdmin(global) {
  const configApi = global.SportsOverlay.config;
  let workingConfig = configApi.loadConfig();
  const sportsList = document.querySelector("#sports-list");
  const status = document.querySelector("#save-status");

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  });
  document.querySelector("#save-settings").addEventListener("click", saveSettings);
  document.querySelector("#reset-settings").addEventListener("click", resetSettings);
  document.querySelector("#display-mode").addEventListener("change", readBehaviorFields);
  document.querySelector("#rotation-seconds").addEventListener("input", readBehaviorFields);
  document.querySelector("#fallback-mode").addEventListener("change", readBehaviorFields);
  document.querySelector("#live-sport").addEventListener("change", updateLive);
  document.querySelector("#refresh-live").addEventListener("click", updateLive);
  document.querySelector("#demo-sport").addEventListener("change", updateDemo);
  document.querySelector("#demo-state").addEventListener("change", updateDemo);
  document.querySelector("#refresh-demo").addEventListener("click", updateDemo);

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
    if (name === "live") updateLive();
    if (name === "demo") updateDemo();
  }

  function renderSettings() {
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
        empty.textContent = `No ${sport.name.toLowerCase()} favorites selected.`;
        favoriteList.append(empty);
      }

      const selected = new Set(group.favorites.map(favorite => favorite.teamKey));
      const available = configApi.TEAM_CATALOG.filter(team => team.sport === group.sport && !selected.has(team.key));
      const picker = section.querySelector(".team-picker");
      available.forEach(team => {
        const option = document.createElement("option");
        option.value = team.key;
        option.textContent = team.name;
        picker.append(option);
      });
      const addButton = section.querySelector(".add-team");
      addButton.disabled = !available.length;
      if (!available.length) {
        const option = document.createElement("option");
        option.textContent = "All available teams added";
        picker.append(option);
      }
      addButton.addEventListener("click", () => addTeam(group, picker));
      sportsList.append(section);
    });
    document.querySelector("#display-mode").value = workingConfig.displayMode;
    document.querySelector("#rotation-seconds").value = workingConfig.rotationSeconds;
    document.querySelector("#fallback-mode").value = workingConfig.fallbackMode;
    renderLiveSportPicker();
  }

  function renderFavorite(group, favorite, index, favoriteList) {
    const team = configApi.findTeam(favorite.teamKey);
    if (!team) return;
    const card = document.querySelector("#favorite-template").content.firstElementChild.cloneNode(true);
    card.dataset.teamKey = team.key;
    setTeamMark(card.querySelector(".team-mark"), team);
    card.querySelector(".team-name").textContent = team.name;
    card.querySelector(".team-meta").textContent = `${team.league} favorite #${index + 1}`;
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
      option.textContent = `${sport.name} · ${topFavorite?.name || "no enabled favorite"}`;
      picker.append(option);
    });
    if (workingConfig.sports.some(group => group.sport === selectedSport)) picker.value = selectedSport;
  }

  function addTeam(group, picker) {
    const team = configApi.findTeam(picker.value);
    if (!team) return;
    group.favorites.push({ teamKey: team.key, enabled: true });
    markUnsaved();
    renderSettings();
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
    workingConfig.displayMode = document.querySelector("#display-mode").value;
    workingConfig.rotationSeconds = Number(document.querySelector("#rotation-seconds").value);
    workingConfig.fallbackMode = document.querySelector("#fallback-mode").value;
    markUnsaved();
  }

  function saveSettings() {
    readBehaviorFields();
    try {
      workingConfig = configApi.saveConfig(workingConfig);
      renderSettings();
      status.textContent = "Saved locally.";
      status.className = "save-status is-saved";
    } catch (error) {
      status.textContent = error.message;
      status.className = "save-status is-error";
    }
  }

  function resetSettings() {
    workingConfig = configApi.resetConfig();
    renderSettings();
    status.textContent = "Defaults restored.";
    status.className = "save-status is-saved";
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
    const url = `../index.html?sport=${encodeURIComponent(sport)}`;
    document.querySelector("#live-preview").src = url;
    document.querySelector("#open-live").href = url;
  }
})(window);
