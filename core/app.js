"use strict";

const savedConfig = window.SportsOverlay.config.loadConfig();
const query = new URLSearchParams(window.location.search);
const requestedSport = query.get("sport");
const CONFIG = Object.freeze({
  pollIntervalMs: 12_000,
  scheduleRetryMs: 5 * 60_000,
  rotationIntervalMs: savedConfig.rotationSeconds * 1_000,
  includeSpotlight: savedConfig.displayMode !== "top-favorite",
  showNoGameMessage: savedConfig.fallbackMode !== "hide",
  requestTimeoutMs: 8_000,
  transitionOutMs: 180,
  transitionInMs: 260,
});

const sportContexts = savedConfig.sports
  .filter(group => !requestedSport || group.sport === requestedSport)
  .map(group => createSportContext(group))
  .filter(Boolean);
const initialSport = requestedSport || sportContexts[0]?.sport || savedConfig.sports[0]?.sport || "baseball";
let activeLayoutSport = null;
let layout = null;
layout = activateLayout(initialSport);
let rotationQueue = [];
let currentIndex = 0;
let requestRevision = 0;
let pollTimer = null;
let rotationTimer = null;
let discoveryTimer = null;
let transitionCleanupTimer = null;
let renderChain = Promise.resolve();

function createSportContext(group) {
  const favoriteTeams = group.favorites
    .filter(favorite => favorite.enabled)
    .map(favorite => window.SportsOverlay.config.findTeam(favorite.teamKey))
    .filter(Boolean);
  const selectedTeam = favoriteTeams[0];
  if (!selectedTeam) return null;
  const providerModule = window.SportsOverlay.registry.getProvider(selectedTeam.provider);
  const provider = providerModule.createClient({
    teamId: selectedTeam.teamId,
    requestTimeoutMs: CONFIG.requestTimeoutMs,
  });
  return Object.freeze({
    sport: group.sport,
    favoriteTeams,
    selectedTeam,
    providerModule,
    provider,
  });
}

function activateLayout(sport) {
  if (activeLayoutSport === sport && layout) return layout;
  activeLayoutSport = sport;
  layout = window.SportsOverlay.registry.getLayout(sport).createLayout();
  return layout;
}

function renderDemoFromUrl() {
  const demoName = query.get("demo");
  if (!demoName) return false;
  const event = window.SportsOverlay.registry.getDemo(initialSport, demoName);
  if (!event) {
    const available = window.SportsOverlay.registry.listDemos(initialSport).join(", ");
    console.warn(`[Sports overlay] Unknown ${initialSport} demo "${demoName}". Available demos: ${available}.`);
    return false;
  }
  console.info(`[Sports overlay] Rendering the "${demoName}" ${initialSport} demo.`);
  layout.render(event);
  return true;
}

function renderScenarioFromUrl() {
  const scenario = query.get("scenario");
  if (!scenario) return false;
  const messages = {
    "no-event": `No selected ${initialSport} game`,
    offline: "Sports data offline",
    error: "Provider error · keeping last known score",
  };
  if (!messages[scenario]) return false;
  layout.renderNoEvent(messages[scenario], true);
  return true;
}

async function discoverGames() {
  clearTimeout(discoveryTimer);
  clearTimeout(pollTimer);
  clearTimeout(rotationTimer);
  if (!sportContexts.length) {
    layout.renderNoEvent(`No enabled ${initialSport} favorite configured`, CONFIG.showNoGameMessage);
    return;
  }

  const queues = await Promise.all(sportContexts.map(discoverSport));
  const previousKey = entryKey(rotationQueue[currentIndex]);
  rotationQueue = queues.flat();
  currentIndex = Math.max(0, rotationQueue.findIndex(entry => entryKey(entry) === previousKey));
  const changedGame = Boolean(previousKey && entryKey(rotationQueue[currentIndex]) !== previousKey);

  if (!rotationQueue.length) {
    requestRevision += 1;
    layout.renderNoEvent("No favorite or live spotlight games found", CONFIG.showNoGameMessage);
    scheduleDiscovery();
    return;
  }

  scheduleDiscovery();
  await renderCurrentGame({ animate: changedGame });
  schedulePoll();
  scheduleRotation();
}

async function discoverSport(context) {
  const [favoriteResult, leagueResult] = await Promise.allSettled([
    context.provider.findGames(),
    context.provider.findLeagueGames?.() ?? Promise.resolve([]),
  ]);
  const favoriteGames = favoriteResult.status === "fulfilled" ? favoriteResult.value : [];
  const leagueGames = leagueResult.status === "fulfilled" ? leagueResult.value : [];
  if (favoriteResult.status === "rejected") console.warn(`[Sports overlay] ${context.selectedTeam.league} favorite schedule lookup failed.`, favoriteResult.reason);
  if (leagueResult.status === "rejected") console.warn(`[Sports overlay] ${context.selectedTeam.league} league scoreboard lookup failed.`, leagueResult.reason);
  return window.SportsOverlay.selection.buildRotationQueue({
    favoriteGames,
    leagueGames,
    favoriteTeamIds: context.favoriteTeams.map(team => team.teamId),
    toCandidate: context.providerModule.toCandidate,
    fallbackMode: savedConfig.fallbackMode,
    includeSpotlight: CONFIG.includeSpotlight,
  }).map(entry => ({ ...entry, context }));
}

function renderCurrentGame(options = {}) {
  const entry = rotationQueue[currentIndex];
  if (!entry) return Promise.resolve();
  const revision = ++requestRevision;
  const render = () => renderGame(entry, revision, options);
  renderChain = renderChain.then(render, render);
  return renderChain;
}

async function renderGame(entry, revision, { animate = false } = {}) {
  if (revision !== requestRevision) return;
  try {
    const event = await entry.context.provider.getEvent(entry.candidate.id, entry.featuredTeamId);
    if (revision !== requestRevision) return;
    if (animate && !await transitionOut(revision)) return;
    if (!animate) clearTransitionClasses();
    const currentLayout = activateLayout(entry.context.sport);
    currentLayout.render(event);
    if (animate) transitionIn();
    const activeGame = isActiveGame(event);
    if ((entry.kind === "spotlight" && !activeGame)
      || (entry.kind === "favorite" && activeGame)
      || (entry.kind === "favorite-live" && !activeGame)) {
      scheduleDiscovery(0);
    }
  } catch (error) {
    if (revision === requestRevision) {
      clearTransitionClasses();
      layout.handleError(`${entry.context.selectedTeam.league} update failed for game ${entry.candidate.id}`, error);
    }
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await renderCurrentGame();
    schedulePoll();
  }, CONFIG.pollIntervalMs);
}

function scheduleRotation() {
  clearTimeout(rotationTimer);
  if (rotationQueue.length < 2) return;
  rotationTimer = setTimeout(async () => {
    currentIndex = (currentIndex + 1) % rotationQueue.length;
    await renderCurrentGame({ animate: true });
    scheduleRotation();
  }, CONFIG.rotationIntervalMs);
}

async function transitionOut(revision) {
  const mount = document.querySelector("#sports-overlay");
  if (!mount || prefersReducedMotion()) return revision === requestRevision;
  clearTimeout(transitionCleanupTimer);
  mount.classList.remove("is-rotating-in", "is-rotating-out");
  void mount.offsetWidth;
  mount.classList.add("is-rotating-out");
  await waitForAnimation(mount, CONFIG.transitionOutMs);
  const current = revision === requestRevision;
  if (!current) clearTransitionClasses();
  return current;
}

function transitionIn() {
  const mount = document.querySelector("#sports-overlay");
  if (!mount || prefersReducedMotion()) return;
  mount.classList.remove("is-rotating-out", "is-rotating-in");
  void mount.offsetWidth;
  mount.classList.add("is-rotating-in");
  transitionCleanupTimer = setTimeout(() => mount.classList.remove("is-rotating-in"), CONFIG.transitionInMs + 50);
}

function clearTransitionClasses() {
  clearTimeout(transitionCleanupTimer);
  document.querySelector("#sports-overlay")?.classList.remove("is-rotating-out", "is-rotating-in");
}

function waitForAnimation(element, durationMs) {
  return new Promise(resolve => {
    let settled = false;
    const finish = event => {
      if (settled || (event && event.target !== element)) return;
      settled = true;
      element.removeEventListener("animationend", finish);
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, durationMs + 50);
    element.addEventListener("animationend", finish);
  });
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function isActiveGame(event) {
  return event.state === window.SportsOverlay.model.EVENT_STATES.LIVE
    || event.state === window.SportsOverlay.model.EVENT_STATES.INTERRUPTED;
}

function scheduleDiscovery(delay = CONFIG.scheduleRetryMs) {
  clearTimeout(discoveryTimer);
  discoveryTimer = setTimeout(discoverGames, delay);
}

function entryKey(entry) {
  return entry ? `${entry.context.sport}:${entry.candidate.id}` : "";
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) discoverGames();
});

if (!renderDemoFromUrl() && !renderScenarioFromUrl()) discoverGames();
