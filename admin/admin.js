"use strict";

(function initializeAdmin(global) {
  const configApi = global.SportsOverlay.config;
  let workingConfig = configApi.loadConfig();
  const favoritesList = document.querySelector("#favorites-list");
  const teamPicker = document.querySelector("#team-picker");
  const status = document.querySelector("#save-status");

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  });
  document.querySelector("#add-team").addEventListener("click", addTeam);
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
    favoritesList.replaceChildren();
    workingConfig.favorites.forEach((favorite, index) => {
      const team = configApi.findTeam(favorite.teamKey);
      if (!team) return;
      const card = document.querySelector("#favorite-template").content.firstElementChild.cloneNode(true);
      card.dataset.teamKey = team.key;
      card.querySelector(".team-mark").textContent = team.abbreviation;
      card.querySelector(".team-name").textContent = team.name;
      card.querySelector(".team-meta").textContent = `${team.league} · ${team.sport}`;
      const providerBadge = card.querySelector(".provider-badge");
      providerBadge.textContent = team.providerStatus === "live" ? "LIVE PROVIDER" : "DEMO READY";
      providerBadge.classList.toggle("is-demo", team.providerStatus !== "live");
      card.querySelector(".team-enabled").checked = favorite.enabled;
      card.querySelector(".team-enabled").addEventListener("change", event => {
        favorite.enabled = event.target.checked;
        markUnsaved();
      });
      card.querySelector(".move-up").disabled = index === 0;
      card.querySelector(".move-down").disabled = index === workingConfig.favorites.length - 1;
      card.querySelector(".move-up").addEventListener("click", () => moveTeam(index, -1));
      card.querySelector(".move-down").addEventListener("click", () => moveTeam(index, 1));
      card.querySelector(".remove-team").addEventListener("click", () => removeTeam(team.key));
      favoritesList.append(card);
    });
    if (!workingConfig.favorites.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No favorites selected. Add a team below.";
      favoritesList.append(empty);
    }
    renderTeamPicker();
    document.querySelector("#display-mode").value = workingConfig.displayMode;
    document.querySelector("#rotation-seconds").value = workingConfig.rotationSeconds;
    document.querySelector("#fallback-mode").value = workingConfig.fallbackMode;
  }

  function renderTeamPicker() {
    const selected = new Set(workingConfig.favorites.map(favorite => favorite.teamKey));
    const available = configApi.TEAM_CATALOG.filter(team => !selected.has(team.key));
    teamPicker.replaceChildren();
    available.forEach(team => {
      const option = document.createElement("option");
      option.value = team.key;
      option.textContent = `${team.name} · ${team.league}`;
      teamPicker.append(option);
    });
    document.querySelector("#add-team").disabled = !available.length;
    if (!available.length) {
      const option = document.createElement("option");
      option.textContent = "All available teams added";
      teamPicker.append(option);
    }
  }

  function addTeam() {
    const team = configApi.findTeam(teamPicker.value);
    if (!team) return;
    workingConfig.favorites.push({ teamKey: team.key, enabled: true });
    markUnsaved();
    renderSettings();
  }

  function removeTeam(teamKey) {
    workingConfig.favorites = workingConfig.favorites.filter(favorite => favorite.teamKey !== teamKey);
    markUnsaved();
    renderSettings();
  }

  function moveTeam(index, offset) {
    const [favorite] = workingConfig.favorites.splice(index, 1);
    workingConfig.favorites.splice(index + offset, 0, favorite);
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
    const sport = document.querySelector("#demo-sport").value;
    const state = document.querySelector("#demo-state").value;
    const params = new URLSearchParams({ sport });
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
