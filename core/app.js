"use strict";

const CONFIG = Object.freeze({
  teamId: 136,
  pollIntervalMs: 12_000,
  scheduleRetryMs: 5 * 60_000,
  showNoGameMessage: true,
  requestTimeoutMs: 8_000,
});

const query = new URLSearchParams(window.location.search);
const selectedSport = query.get("sport") || "baseball";
const layout = window.SportsOverlay.registry.getLayout(selectedSport).createLayout();
const mlb = selectedSport === "baseball" ? window.SportsOverlay.registry.getProvider("mlb") : null;
const provider = mlb?.createClient(CONFIG) ?? null;
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

async function findTodaysGame() {
  try {
    const game = mlb.chooseGame(await provider.findGames());
    if (!game?.gamePk) {
      activeGameId = null;
      layout.renderNoEvent("No Mariners game today", CONFIG.showNoGameMessage);
      scheduleNext(CONFIG.scheduleRetryMs, findTodaysGame);
      return;
    }

    if (game.status?.abstractGameState === "Final" && game.gamePk === activeGameId) {
      scheduleNext(CONFIG.scheduleRetryMs, findTodaysGame);
      return;
    }

    activeGameId = game.gamePk;
    console.info(`[Sports overlay] Found MLB game ${activeGameId}.`);
    await updateGame();
  } catch (error) {
    layout.handleError("MLB schedule lookup failed", error);
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
    layout.handleError(`MLB update failed for game ${activeGameId}`, error);
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

if (!renderDemoFromUrl()) {
  if (selectedSport === "baseball") {
    findTodaysGame();
  } else {
    layout.renderNoEvent(`No live ${selectedSport} provider configured`, true);
  }
}
