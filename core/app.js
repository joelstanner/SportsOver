"use strict";

(async function initializeSportsOverlay() {

await window.SportsOverlay.config.ready;
if (window.SportsOverlay.shared) await window.SportsOverlay.shared.waitForConfig();

const savedConfig = window.SportsOverlay.config.loadConfig();
const query = new URLSearchParams(window.location.search);
if (query.get("surface") === "admin") {
  document.documentElement.style.background = "#26373b";
  document.body.style.background = "#26373b";
}
const requestedSport = query.get("sport");
const CONFIG = {
  includeSpotlight: savedConfig.displayMode !== "top-favorite",
  showNoGameMessage: savedConfig.fallbackMode !== "hide",
  requestTimeoutMs: 8_000,
  transitionOutMs: 180,
  transitionInMs: 260,
  demoRotationIntervalMs: 3_000,
};
const SCROLLING_DEMO_TEXT = "Scrolling demo: a deliberately long game update continues well beyond the right edge so the complete marquee animation can be observed before it repeats.";

const refresh = window.SportsOverlay.providerRefresh.create({ config: () => savedConfig });
let lastEventState = "idle";
let pollGeneration = 0;
let rotationGeneration = 0;

let sportContexts = savedConfig.sports
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
let discoveryGeneration = 0;
let cachedDiscoveries = null;
let renderedGameKey = null;
let automaticRotationEntries = [];
let overrideEntry = null;
let discoveryPending = null;
let rediscover = false;
let normalRotationQueue = [];
const liveMode = window.SportsOverlay.liveMode.create();

// The desktop host is the sole live engine. Outputs receive rendered snapshots.
window.SportsOverlay.engine = {
  describe: () => ({
    availableEntries: (cachedDiscoveries || []).flatMap(result => result.availableEntries).map(publicEntry),
    automaticEntries: automaticRotationEntries.map(publicEntry),
    queue: rotationQueue.map(publicEntry),
    normalQueue: normalRotationQueue.map(publicEntry),
    liveMode: { active: liveMode.isActive(), canActivate: normalRotationQueue.some(window.SportsOverlay.liveMode.isLive) },
    currentGameKey: entryKey(overrideEntry || rotationQueue[currentIndex]) || null,
    renderedGameKey,
    overrideGameKey: entryKey(overrideEntry) || null,
  }),
  refresh: () => discoverGames(),
  next: () => stepRotation(1),
  previous: () => stepRotation(-1),
  setLiveMode(active) {
    if (typeof active !== "boolean") return;
    liveMode.setActive(active, normalRotationQueue);
    requestRevision++;
    clearTimeout(rotationTimer); rotationTimer = null; rotationGeneration++;
    // Publish the latch and its filtered queue together, even during discovery.
    const previousKey = entryKey(rotationQueue[currentIndex]);
    rotationQueue = selectedRotationQueue((cachedDiscoveries || []).flatMap(result => result.availableEntries));
    currentIndex = Math.max(0, rotationQueue.findIndex(entry => entryKey(entry) === previousKey));
    return discoverGames(false);
  },
  override(value) {
    overrideEntry = value ? (cachedDiscoveries || []).flatMap(result => result.availableEntries)
      .find(entry => entryKey(entry) === value.gameKey) || null : null;
    requestRevision++;
    clearTimeout(rotationTimer); rotationTimer = null; rotationGeneration++;
    clearTimeout(pollTimer); pollGeneration++;
    if (overrideEntry || rotationQueue.length) renderCurrentGame().then(() => { schedulePoll(); scheduleRotation(); });
    else discoverGames(false);
  },
};
async function stepRotation(direction) {
  if (overrideEntry || rotationQueue.length < 2) return;
  clearTimeout(rotationTimer); rotationTimer = null;
  const generation = ++rotationGeneration;
  clearTimeout(pollTimer); pollGeneration++;
  currentIndex = (currentIndex + direction + rotationQueue.length) % rotationQueue.length;
  await renderCurrentGame({ animate: true });
  if (generation === rotationGeneration) { schedulePoll(); scheduleRotation(); }
}

function publicEntry(entry) {
  const { context, ...value } = entry;
  return value;
}

function createSportContext(group) {
  if (group.enabled === false) return null;
  const favoriteTeams = group.favorites
    .filter(favorite => favorite.enabled)
    .map(favorite => window.SportsOverlay.config.findTeam(favorite.teamKey))
    .filter(Boolean);
  const selectedTeam = favoriteTeams[0]
    || window.SportsOverlay.config.TEAM_CATALOG.find(team => team.sport === group.sport);
  if (!selectedTeam) return null;
  const providerModule = window.SportsOverlay.registry.getProvider(selectedTeam.provider);
  const createClient = team => providerModule.createClient({
    teamId: team.teamId,
    requestTimeoutMs: CONFIG.requestTimeoutMs,
    fetchImpl: refresh.fetchFor(group.sport, providerModule),
  });
  return Object.freeze({
    sport: group.sport,
    favoriteTeams,
    selectedTeam,
    providerModule,
    createClient,
    provider: createClient(selectedTeam),
  });
}

function activateLayout(sport) {
  if (activeLayoutSport === sport && layout) return layout;
  layout?.dispose?.();
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
  if (scenario === "rotation") {
    startDemoRotation();
    return true;
  }
  if (scenario === "scrolling") {
    renderScrollingDemo();
    return true;
  }
  const messages = {
    "no-event": `No selected ${initialSport} game`,
    offline: "Sports data offline",
    error: "Provider error · keeping last known score",
  };
  if (!messages[scenario]) return false;
  layout.renderNoEvent(messages[scenario], true);
  return true;
}

function renderScrollingDemo() {
  const event = window.SportsOverlay.registry.getDemo(initialSport, "live");
  if (!event) {
    layout.renderNoEvent("No scrolling demo registered", true);
    return;
  }
  const detailName = initialSport === "soccer" ? "lastEvent" : "lastPlay";
  layout.render({
    ...event,
    details: { ...event.details, [detailName]: SCROLLING_DEMO_TEXT },
  });
}

async function startDemoRotation() {
  const demos = savedConfig.sports
    .filter(group => group.enabled !== false)
    .map(group => window.SportsOverlay.registry.getDemo(group.sport, "live"))
    .filter(Boolean);
  if (!demos.length) {
    layout.renderNoEvent("No rotation demos registered", true);
    return;
  }

  let demoIndex = 0;
  await renderDemoEvent(demos[demoIndex]);
  const advance = async () => {
    demoIndex = (demoIndex + 1) % demos.length;
    await renderDemoEvent(demos[demoIndex], true);
    rotationTimer = setTimeout(advance, CONFIG.demoRotationIntervalMs);
  };
  rotationTimer = setTimeout(advance, CONFIG.demoRotationIntervalMs);
}

async function renderDemoEvent(event, animate = false) {
  const revision = ++requestRevision;
  if (animate && !await transitionOut(revision)) return;
  const currentLayout = activateLayout(event.sport);
  currentLayout.render(event);
  renderedGameKey = `${event.sport}:${event.id}`;
  if (animate) transitionIn();
}

function discoverGames(refresh = true) {
  // Coalesce requests from timers, settings, and integration commands.
  if (discoveryPending) { rediscover = true; return discoveryPending; }
  discoveryPending = discoverGamesOnce(refresh).finally(() => {
    discoveryPending = null;
    if (rediscover) { rediscover = false; discoverGames(); }
  });
  return discoveryPending;
}
async function discoverGamesOnce(refresh = true) {
  const generation = ++discoveryGeneration;
  clearTimeout(discoveryTimer);
  clearTimeout(pollTimer);
  pollGeneration += 1;
  if (!sportContexts.length) {
    rotationQueue = []; normalRotationQueue = []; automaticRotationEntries = []; cachedDiscoveries = [];
    liveMode.update({ enabledSports: [] });
    overrideEntry = null; currentIndex = 0;
    requestRevision++; rotationGeneration++;
    clearTimeout(rotationTimer); rotationTimer = null;
    renderedGameKey = null;
    layout.renderNoEvent("No sports enabled", CONFIG.showNoGameMessage);
    return;
  }

  const discoveries = !refresh && cachedDiscoveries ? cachedDiscoveries : await Promise.all(sportContexts.map(discoverSport));
  if (generation !== discoveryGeneration) return;
  cachedDiscoveries = discoveries;
  const availableEntries = discoveries.flatMap(result => result.availableEntries);
  automaticRotationEntries = window.SportsOverlay.selection.retainAutoFinals(
    automaticRotationEntries,
    discoveries.flatMap(result => result.automaticEntries),
    availableEntries,
    { keyOf: entryKey },
  );
  const previousKey = entryKey(rotationQueue[currentIndex]);
  normalRotationQueue = window.SportsOverlay.selection.applyRotationControls({
    automaticEntries: automaticRotationEntries,
    availableEntries,
    mode: savedConfig.rotationMode,
    includedGameKeys: savedConfig.includedGames,
    excludedGameKeys: savedConfig.excludedGames,
    rotationOrder: savedConfig.rotationOrder,
    keyOf: entryKey,
  });
  rotationQueue = selectedRotationQueue(availableEntries);
  currentIndex = Math.max(0, rotationQueue.findIndex(entry => entryKey(entry) === previousKey));
  const changedGame = Boolean(previousKey && entryKey(rotationQueue[currentIndex]) !== previousKey);

  if (!rotationQueue.length && !overrideEntry) {
    requestRevision += 1;
    clearTimeout(rotationTimer);
    rotationTimer = null;
    rotationGeneration += 1;
    renderedGameKey = null;
    layout.renderNoEvent(liveMode.isActive() ? "No live games in rotation" : "No watched or live spotlight games found", liveMode.isActive() || CONFIG.showNoGameMessage);
    scheduleDiscovery();
    return;
  }

  scheduleDiscovery();
  await renderCurrentGame({ animate: changedGame });
  schedulePoll();
  if (!rotationTimer || changedGame || rotationQueue.length < 2) scheduleRotation();
}

function selectedRotationQueue(availableEntries) {
  return liveMode.isActive() ? liveMode.update({
    rotation: normalRotationQueue, available: availableEntries,
    excludedKeys: savedConfig.excludedGames,
    enabledSports: sportContexts.map(context => context.sport),
    rotationOrder: savedConfig.rotationOrder, retentionMinutes: savedConfig.liveModeFinalMinutes,
  }) : window.SportsOverlay.selection.applyGameLocks(normalRotationQueue, savedConfig.lockedGameKeys, entryKey);
}

async function discoverSport(context) {
  let discovery;
  try {
    discovery = await window.SportsOverlay.providerDiscovery.discover({
      teams: context.favoriteTeams, provider: context.provider,
      createClient: context.createClient, toCandidate: context.providerModule.toCandidate,
    });
  } catch (error) {
    console.warn(`[Sports overlay] ${context.selectedTeam.league} discovery failed.`, error);
    discovery = { favoriteGames: [], leagueGames: [], failures: 1 };
  }
  const { favoriteGames, leagueGames, failures } = discovery;
  if (failures) console.warn(`[Sports overlay] ${context.selectedTeam.league}: ${failures} discovery feed(s) unavailable.`);
  const automaticEntries = context.favoriteTeams.length ? window.SportsOverlay.selection.buildRotationQueue({
    favoriteGames,
    leagueGames,
    favoriteTeamIds: context.favoriteTeams.map(team => team.teamId),
    toCandidate: context.providerModule.toCandidate,
    fallbackMode: savedConfig.fallbackMode,
    includeSpotlight: CONFIG.includeSpotlight,
    topFavoriteOnly: savedConfig.displayMode === "top-favorite",
  }).map(entry => ({ ...entry, context })) : [];
  const favoriteIds = context.favoriteTeams.map(team => String(team.teamId).toUpperCase());
  const candidates = [...leagueGames, ...favoriteGames]
    .map(context.providerModule.toCandidate)
    .filter(candidate => candidate.id);
  const seen = new Set();
  const availableEntries = candidates.filter(candidate => {
    const key = `${context.sport}:${candidate.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(candidate => ({
    kind: "manual",
    candidate,
    featuredTeamId: candidate.teamKeys.find(teamId => favoriteIds.includes(String(teamId).toUpperCase())) ?? null,
    context,
  }));
  return { automaticEntries, availableEntries };
}

function renderCurrentGame(options = {}) {
  const entry = overrideEntry || rotationQueue[currentIndex];
  if (!entry) return Promise.resolve();
  const revision = ++requestRevision;
  const render = () => renderGame(entry, revision, options);
  renderChain = renderChain.then(render, render);
  return renderChain;
}

async function renderGame(entry, revision, { animate = false } = {}) {
  if (revision !== requestRevision) return;
  try {
    let event = await entry.context.provider.getEvent(entry.candidate.id, entry.featuredTeamId);
    const discovered = cachedDiscoveries?.flatMap(result => result.availableEntries)
      .find(candidate => entryKey(candidate) === entryKey(entry));
    if (entry.context.providerModule.withSchedule) {
      event = entry.context.providerModule.withSchedule(event, discovered?.candidate.raw);
    }
    if (entry.context.sport !== "baseball") {
      event.details.odds ??= window.SportsOverlay.model.espnOdds(discovered?.candidate.raw ?? entry.candidate.raw);
    }
    if (revision !== requestRevision) return;
    if (liveMode.isActive() && !overrideEntry) {
      const observed = { ...entry, candidate: { ...entry.candidate, state: event.state } };
      liveMode.observe(observed);
      // Keep metadata and queue timing in step with the freshly polled score.
      for (const result of cachedDiscoveries || []) {
        result.availableEntries = result.availableEntries.map(item => entryKey(item) === entryKey(entry) ? observed : item);
        result.automaticEntries = result.automaticEntries.map(item => entryKey(item) === entryKey(entry) ? observed : item);
      }
      normalRotationQueue = normalRotationQueue.map(item => entryKey(item) === entryKey(entry) ? observed : item);
      rotationQueue[currentIndex] = observed;
      scheduleDiscovery();
      if (!["live", "interrupted", "final"].includes(event.state)
        || (event.state === "final" && savedConfig.liveModeFinalMinutes === 0)) {
        setTimeout(() => discoverGames(false), 0);
        return;
      }
    }
    if (animate && !await transitionOut(revision)) return;
    if (!animate) clearTransitionClasses();
    const currentLayout = activateLayout(entry.context.sport);
    currentLayout.render(event);
    // Publish the displayed game, not the next queue entry while it is loading.
    renderedGameKey = entryKey(entry);
    if (animate) transitionIn();
    lastEventState = event.state;
  } catch (error) {
    if (revision === requestRevision) {
      clearTransitionClasses();
      layout.handleError(`${entry.context.selectedTeam.league} update failed for game ${entry.candidate.id}`, error);
    }
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const generation = ++pollGeneration;
  const sport = (overrideEntry || rotationQueue[currentIndex])?.context.sport;
  if (!sport) return;
  pollTimer = setTimeout(async () => {
    await renderCurrentGame();
    if (generation === pollGeneration) schedulePoll();
  }, refresh.interval(sport, lastEventState));
}

function scheduleRotation() {
  clearTimeout(rotationTimer);
  rotationTimer = null;
  const generation = ++rotationGeneration;
  if (overrideEntry || rotationQueue.length < 2) return;
  rotationTimer = setTimeout(async () => {
    currentIndex = (currentIndex + 1) % rotationQueue.length;
    await renderCurrentGame({ animate: true });
    if (generation === rotationGeneration) { schedulePoll(); scheduleRotation(); }
  }, window.SportsOverlay.selection.gameDurationSeconds(rotationQueue[currentIndex], savedConfig.gameDurations, entryKey, savedConfig.defaultGameDurations) * 1_000);
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

function scheduleDiscovery() {
  const providerDelay = Math.min(...sportContexts.map(context => {
    const entries = cachedDiscoveries?.flatMap(result => result.availableEntries)
      .filter(entry => entry.context.sport === context.sport) || [];
    const states = entries.map(entry => entry.candidate.state);
    const state = ["live", "interrupted", "pregame", "final"].find(value => states.includes(value)) || "idle";
    return refresh.interval(context.sport, state);
  }));
  const expiryDelay = Math.min(liveMode.nextExpiry(savedConfig.liveModeFinalMinutes) - Date.now(), ...automaticRotationEntries
    .map(entry => entry.autoRetainUntil - Date.now())
    .filter(delay => Number.isFinite(delay) && delay > 0), Infinity);
  const delay = Math.min(providerDelay, expiryDelay);
  clearTimeout(discoveryTimer);
  discoveryTimer = setTimeout(() => discoverGames(expiryDelay > providerDelay), delay);
}

function entryKey(entry) {
  return entry ? `${entry.context.sport}:${entry.candidate.id}` : "";
}

const staticPreview = renderDemoFromUrl() || renderScenarioFromUrl();
if (!staticPreview) {
  let lastCatalogRevision = window.SportsOverlay.shared?.snapshot()?.catalogRevision;
  let lastInstance = window.SportsOverlay.shared?.snapshot()?.instance;
  window.SportsOverlay.shared?.subscribe(async snapshot => {
    if (!snapshot?.initialized) return;
    const catalogChanged = lastCatalogRevision !== snapshot.catalogRevision || lastInstance !== snapshot.instance;
    if (JSON.stringify(savedConfig) === JSON.stringify(window.SportsOverlay.config.normalizeConfig(snapshot.config)) && !catalogChanged) return;
    if (catalogChanged) await window.SportsOverlay.config.reloadTeamCatalog();
    lastCatalogRevision = snapshot.catalogRevision;
    lastInstance = snapshot.instance;
    const timingChanged = JSON.stringify(savedConfig.gameDurations) !== JSON.stringify(snapshot.config.gameDurations)
      || JSON.stringify(savedConfig.defaultGameDurations) !== JSON.stringify(snapshot.config.defaultGameDurations);
    const teamsChanged = JSON.stringify(savedConfig.sports) !== JSON.stringify(snapshot.config.sports);
    const selectionChanged = savedConfig.fallbackMode !== snapshot.config.fallbackMode || savedConfig.displayMode !== snapshot.config.displayMode;
    Object.assign(savedConfig, window.SportsOverlay.config.normalizeConfig(snapshot.config));
    CONFIG.includeSpotlight = savedConfig.displayMode !== "top-favorite";
    CONFIG.showNoGameMessage = savedConfig.fallbackMode !== "hide";
    if (teamsChanged || catalogChanged) sportContexts = savedConfig.sports
      .filter(group => !requestedSport || group.sport === requestedSport)
      .map(createSportContext).filter(Boolean);
    if (overrideEntry) {
      const context = sportContexts.find(context => context.sport === overrideEntry.context.sport);
      overrideEntry = context ? { ...overrideEntry, context } : null;
    }
    if (teamsChanged || catalogChanged) {
      // Invalidate in-flight discovery and remove disabled sports immediately,
      // including manual games, locks, and temporary overrides.
      discoveryGeneration++;
      const allowed = entry => sportContexts.some(context => context.sport === entry.context.sport);
      const previousKey = entryKey(rotationQueue[currentIndex]);
      rotationQueue = rotationQueue.filter(allowed);
      automaticRotationEntries = automaticRotationEntries.filter(allowed);
      cachedDiscoveries = cachedDiscoveries?.map(result => ({ ...result,
        automaticEntries: result.automaticEntries.filter(allowed), availableEntries: result.availableEntries.filter(allowed),
      })) || null;
      currentIndex = Math.max(0, rotationQueue.findIndex(entry => entryKey(entry) === previousKey));
      clearTimeout(rotationTimer); rotationTimer = null; rotationGeneration++;
      clearTimeout(pollTimer); pollGeneration++;
      if (renderedGameKey && !sportContexts.some(context => renderedGameKey.startsWith(`${context.sport}:`))) {
        renderedGameKey = null;
        layout.renderNoEvent(sportContexts.length ? "Updating selected sports…" : "No sports enabled", CONFIG.showNoGameMessage);
      }
    }
    requestRevision += 1;
    if (timingChanged) scheduleRotation();
    discoverGames(teamsChanged || catalogChanged || selectionChanged);
  });
  window.addEventListener("storage", event => {
    if (event.key === window.SportsOverlay.config.STORAGE_KEY) window.location.reload();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) discoverGames();
  });
  discoverGames();
}

})();
