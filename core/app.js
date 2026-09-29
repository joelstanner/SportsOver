"use strict";

const savedConfig = window.SportsOverlay.config.loadConfig();
const query = new URLSearchParams(window.location.search);
const enabledTeams = window.SportsOverlay.config.enabledTeams(savedConfig);
const selectedSport = query.get("sport") || enabledTeams[0]?.sport || savedConfig.sports[0]?.sport || "baseball";
const selectedTeam = enabledTeams
  .find(team => team.sport === selectedSport);
const CONFIG = Object.freeze({
  teamId: selectedTeam?.teamId ?? null,
  pollIntervalMs: 12_000,
  scheduleRetryMs: 5 * 60_000,
  showNoGameMessage: savedConfig.fallbackMode !== "hide",
  requestTimeoutMs: 8_000,
});

const layout = window.SportsOverlay.registry.getLayout(selectedSport).createLayout();
const providerModule = selectedTeam ? window.SportsOverlay.registry.getProvider(selectedTeam.provider) : null;
const provider = providerModule?.createClient(CONFIG) ?? null;
let activeGameId = null;
let refreshTimer = null;

function renderDemoFromUrl() {
  const demoName = query.get("demo");
  if (!demoName) return false;

  const event = window.SportsOverlay.registry.getDemo(selectedSport, demoName);
  if (!event) {
    const available = window.SportsOverlay.registry.listDemos(selectedSport).join(", ");
    console.warn(`[Sports overlay] Unknown ${selectedSport} demo "${demoName}". Available demos: ${available}.`);
    return false;
  }

  console.info(`[Sports overlay] Rendering the "${demoName}" ${selectedSport} demo.`);
  layout.render(event);
  return true;
}

function renderScenarioFromUrl() {
  const scenario = query.get("scenario");
  if (!scenario) return false;
  const messages = {
    "no-event": `No selected ${selectedSport} game`,
    offline: "Sports data offline",
    error: "Provider error · keeping last known score",
  };
  if (!messages[scenario]) return false;
  layout.renderNoEvent(messages[scenario], true);
  return true;
}

async function findTodaysGame() {
  if (!CONFIG.teamId) {
    layout.renderNoEvent(`No enabled ${selectedSport} favorite configured`, CONFIG.showNoGameMessage);
    return;
  }
  try {
    const game = providerModule.chooseGame(await provider.findGames(), CONFIG.teamId);
    const gameId = game?.gamePk ?? game?.id;
    if (!gameId) {
      activeGameId = null;
      layout.renderNoEvent(`No ${selectedTeam.name} game found`, CONFIG.showNoGameMessage);
      scheduleNext(CONFIG.scheduleRetryMs, findTodaysGame);
      return;
    }

    activeGameId = gameId;
    console.info(`[Sports overlay] Found ${selectedTeam.league} game ${activeGameId}.`);
    await updateGame();
  } catch (error) {
    layout.handleError(`${selectedTeam.league} schedule lookup failed`, error);
    scheduleNext(CONFIG.scheduleRetryMs, findTodaysGame);
  }
}

async function updateGame() {
  if (!activeGameId) return findTodaysGame();

  try {
    const event = await provider.getEvent(activeGameId);
    layout.render(event);
    if (event.state === window.SportsOverlay.model.EVENT_STATES.FINAL) {
      scheduleNext(CONFIG.pollIntervalMs, findTodaysGame);
      return;
    }
  } catch (error) {
    layout.handleError(`${selectedTeam.league} update failed for game ${activeGameId}`, error);
  }
  scheduleNext(CONFIG.pollIntervalMs, updateGame);
}

function scheduleNext(delay, callback) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(callback, delay);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    clearTimeout(refreshTimer);
    activeGameId ? updateGame() : findTodaysGame();
  }
});

if (!renderDemoFromUrl() && !renderScenarioFromUrl()) {
  if (provider) {
    findTodaysGame();
  } else {
    layout.renderNoEvent(`No live ${selectedSport} provider configured`, true);
  }
}
