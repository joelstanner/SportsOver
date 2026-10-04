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

const chessSession = window.SportsOverlay.lichess?.createSession();
const pdgaSession = window.SportsOverlay.pdga?.createSession();
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
let bannerHovered = false;
let pendingRotation = null;
let discoveryTimer = null;
let transitionCleanupTimer = null;
let renderChain = Promise.resolve();
let discoveryGeneration = 0;
let cachedDiscoveries = null;
let renderedGameKey = null;
let rotationTransition = "normal";
const renderedEvents = new Map();
let automaticRotationEntries = [];
let overrideEntry = null;
let discoveryPending = null;
let loadingSports = new Set();
let rediscover = false;
let normalRotationQueue = [];
let liveRotationQueue = [];
const liveMode = window.SportsOverlay.liveMode.create();

// The desktop host is the sole live engine. Outputs receive rendered snapshots.
window.SportsOverlay.engine = {
  describe: () => ({
    discoveryComplete: cachedDiscoveries !== null,
    discoveryPending: Boolean(discoveryPending),
    loadingSports: [...loadingSports],
    discoveryFailures: (cachedDiscoveries || []).reduce((total, result) => total + (result.failures || 0), 0),
    availableEntries: (cachedDiscoveries || []).flatMap(result => result.availableEntries).map(publicEntry),
    automaticEntries: automaticRotationEntries.map(publicEntry),
    queue: rotationQueue.map(publicEntry),
    normalQueue: normalRotationQueue.map(publicEntry),
    liveQueue: liveRotationQueue.map(publicEntry),
    liveMode: { active: liveMode.isActive(), canActivate: normalRotationQueue.some(window.SportsOverlay.liveMode.isLive) },
    currentGameKey: entryKey(overrideEntry || rotationQueue[currentIndex]) || null,
    renderedGameKey,
    rotationTransition,
    overrideGameKey: entryKey(overrideEntry) || null,
  }),
  refresh: () => discoverGames(),
  next: options => stepRotation(1, options),
  previous: options => stepRotation(-1, options),
  setHovered(value) {
    bannerHovered = value === true;
    if (!bannerHovered && pendingRotation) {
      const advance = pendingRotation;
      pendingRotation = null;
      return advance();
    }
  },
  setLiveMode(active) {
    if (typeof active !== "boolean") return;
    liveMode.setActive(active, normalRotationQueue);
    requestRevision++;
    clearTimeout(rotationTimer); rotationTimer = null; rotationGeneration++;
    // Publish the latch and its filtered queue together, even during discovery.
    const previousKey = entryKey(rotationQueue[currentIndex]);
    rotationQueue = selectedRotationQueue((cachedDiscoveries || []).flatMap(result => result.availableEntries));
    currentIndex = Math.max(0, rotationQueue.findIndex(entry => entryKey(entry) === previousKey));
    return discoverGames(sportContexts.some(context => ["disc-golf", "chess"].includes(context.sport)));
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
async function stepRotation(direction, { fast = false } = {}) {
  if (overrideEntry || rotationQueue.length < 2) return;
  pendingRotation = null;
  clearTimeout(rotationTimer); rotationTimer = null;
  const generation = ++rotationGeneration;
  clearTimeout(pollTimer); pollGeneration++;
  currentIndex = (currentIndex + direction + rotationQueue.length) % rotationQueue.length;
  const cached = fast && renderedEvents.has(entryKey(rotationQueue[currentIndex]));
  await renderCurrentGame({ animate: !fast, fast });
  if (generation === rotationGeneration) {
    schedulePoll(); scheduleRotation();
    if (cached) void renderCurrentGame();
  }
}

function publicEntry(entry) {
  const { context, ...value } = entry;
  return value;
}

function createSportContext(group) {
  if (group.enabled === false) return null;
  if (group.sport === "disc-golf") {
    const providerModule = window.SportsOverlay.registry.getProvider("pdga");
    return { sport: group.sport, league: "PDGA", providerModule,
      provider: providerModule.createClient({ watches: window.SportsOverlay.config.eventWatches(savedConfig, group.sport), autoFollow: group.autoFollow, discoverSecondTier: group.discoverSecondTier, autoDivisions: group.autoDivisions, session: pdgaSession, requestTimeoutMs: CONFIG.requestTimeoutMs,
        fetchImpl: refresh.fetchFor(group.sport, providerModule) }) };
  }
  if (group.sport === "chess") {
    const providerModule = window.SportsOverlay.registry.getProvider("lichess");
    return { sport: group.sport, league: "Lichess", providerModule,
      provider: providerModule.createClient({ watches: window.SportsOverlay.config.eventWatches(savedConfig, group.sport), autoFollow: group.autoFollow, discoverSecondTier: group.discoverSecondTier, session: chessSession, requestTimeoutMs: CONFIG.requestTimeoutMs,
        fetchImpl: refresh.fetchFor(group.sport, providerModule) }) };
  }
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
  document.querySelector("#sports-overlay").dataset.rotationActive = String(demos.length > 1);
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
  if (!sportContexts.length) {
    loadingSports.clear();
    clearTimeout(pollTimer); pollGeneration++;
    rotationQueue = []; normalRotationQueue = []; liveRotationQueue = []; automaticRotationEntries = []; cachedDiscoveries = [];
    liveMode.update({ enabledSports: [] });
    overrideEntry = null; currentIndex = 0;
    requestRevision++; rotationGeneration++;
    clearTimeout(rotationTimer); rotationTimer = null;
    renderedGameKey = null;
    layout.renderNoEvent("No sports enabled", CONFIG.showNoGameMessage);
    return;
  }

  const contexts = [...sportContexts];
  if (refresh || !cachedDiscoveries) {
    loadingSports = new Set(contexts.map(context => context.sport));
    await Promise.all(contexts.map(async context => {
      const result = await discoverSport(context);
      if (generation !== discoveryGeneration) return;
      loadingSports.delete(context.sport);
      const received = new Map((cachedDiscoveries || []).map(item => [item.sport, item]));
      received.set(context.sport, result);
      cachedDiscoveries = contexts.flatMap(item => received.has(item.sport) ? [received.get(item.sport)] : []);
      await applyDiscoveries(cachedDiscoveries, generation, true);
    }));
  }
  if (generation !== discoveryGeneration) return;
  await applyDiscoveries(cachedDiscoveries || [], generation);
  if (generation !== discoveryGeneration) return;
  const synchronized = await window.SportsOverlay.automaticWatches?.sync(cachedDiscoveries || []);
  if (generation !== discoveryGeneration) return;
  if (synchronized) savedConfig.automaticWatchLists = synchronized.automaticWatchLists;
}

async function applyDiscoveries(discoveries, generation, partial = false) {
  const availableEntries = discoveries.flatMap(result => result.availableEntries);
  const watchedTeams = sportContexts.flatMap(context => {
    const teams = context.favoriteTeams || [];
    return (savedConfig.displayMode === "top-favorite" ? teams.slice(0, 1) : teams)
      .map(team => ({ sport: context.sport, teamId: team.teamId }));
  });
  automaticRotationEntries = window.SportsOverlay.selection.retainAutoFinals(
    automaticRotationEntries,
    discoveries.flatMap(result => result.automaticEntries),
    availableEntries,
    { keyOf: entryKey, watchedTeams },
  );
  const previousKey = entryKey(rotationQueue[currentIndex]);
  const previousState = rotationQueue[currentIndex]?.candidate.state;
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
    layout.renderNoEvent(loadingSports.size ? "Loading games…" : liveMode.isActive() ? "No live games in rotation" : discoveries.some(result => result.failures) ? "Scores unavailable · retrying automatically" : "No watched or live spotlight games found", liveMode.isActive() || CONFIG.showNoGameMessage);
    if (!partial) scheduleDiscovery();
    return;
  }

  if (!partial) scheduleDiscovery();
  // New sports can join the queue without interrupting an already displayed
  // game or waiting for its next score request. Existing polling keeps running.
  if (!partial || changedGame || !renderedGameKey) {
    await renderCurrentGame({ animate: changedGame });
    if (generation !== discoveryGeneration) return;
    schedulePoll();
  }
  const tournamentStateChanged = rotationQueue[currentIndex]?.candidate.competitionType === "individual"
    && rotationQueue[currentIndex].candidate.state !== previousState;
  if (!rotationTimer || changedGame || tournamentStateChanged || rotationQueue.length < 2) scheduleRotation();
}

function selectedRotationQueue(availableEntries) {
  liveRotationQueue = liveMode.isActive() ? liveMode.update({
    rotation: normalRotationQueue, available: availableEntries,
    excludedKeys: savedConfig.excludedGames,
    enabledSports: sportContexts.map(context => context.sport),
    rotationOrder: savedConfig.rotationOrder, retentionMinutes: savedConfig.liveModeFinalMinutes,
    allows: entry => window.SportsOverlay.config.isCandidateEnabled(savedConfig, entry.candidate),
  }) : [];
  // Filter for live eligibility before applying locks, so a paused tournament
  // or expired final cannot be kept on screen by its saved lock.
  return window.SportsOverlay.selection.applyGameLocks(liveMode.isActive() ? liveRotationQueue : normalRotationQueue,
    savedConfig.lockedGameKeys, entryKey);
}

async function discoverSport(context) {
  let result;
  try { result = await discoverSportOnce(context); }
  catch (error) {
    console.warn(`[Sports overlay] ${context.sport} discovery failed.`, error);
    result = { sport: context.sport, automaticEntries: [], availableEntries: [], failures: 1 };
  }
  if (!result.failures || result.availableEntries.length) return result;
  const previous = cachedDiscoveries?.find(item => item.sport === context.sport);
  if (!previous) return result;
  // A failed refresh is not evidence that the previously found games vanished.
  // Still respect watches or sports disabled while the request was in flight.
  const retained = entries => entries.filter(entry => window.SportsOverlay.config.isCandidateEnabled(savedConfig, entry.candidate))
    .map(entry => ({ ...entry, context, candidate: { ...entry.candidate, raw: { ...entry.candidate.raw, stale: true } } }));
  return { ...result, automaticEntries: retained(previous.automaticEntries), availableEntries: retained(previous.availableEntries),
    automaticWatches: null, automaticWatchesComplete: false };
}

async function discoverSportOnce(context) {
  if (["disc-golf", "chess"].includes(context.sport)) {
    const result = await context.provider.discover({ topFavoriteOnly: savedConfig.displayMode === "top-favorite",
      fallbackMode: savedConfig.fallbackMode, excludedKeys: savedConfig.excludedGames,
      retentionMs: liveMode.isActive() ? savedConfig.liveModeFinalMinutes * 60_000 : 60 * 60_000 });
    return { sport: context.sport, automaticWatches: result.automaticWatches, automaticWatchesComplete: result.automaticWatchesComplete, failures: result.failures, automaticEntries: result.automaticEntries.map(entry => ({ ...entry, context })),
      availableEntries: result.availableEntries.map(entry => ({ ...entry, context })) };
  }
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
  return { sport: context.sport, automaticEntries, availableEntries, failures };
}

function renderCurrentGame(options = {}) {
  const entry = overrideEntry || rotationQueue[currentIndex];
  if (!entry) return Promise.resolve();
  const revision = ++requestRevision;
  const cached = options.fast && renderedEvents.get(entryKey(entry));
  if (cached) {
    clearTransitionClasses();
    activateLayout(entry.context.sport).render(cached);
    renderedGameKey = entryKey(entry);
    rotationTransition = "quick";
    lastEventState = cached.state;
    return Promise.resolve();
  }
  const render = () => renderGame(entry, revision, options);
  // Arrow navigation must not queue behind a slow request for another game.
  if (options.fast) return render();
  renderChain = renderChain.then(render, render);
  return renderChain;
}

async function renderGame(entry, revision, { animate = false, fast = false } = {}) {
  if (revision !== requestRevision) return;
  try {
    let event = await entry.context.provider.getEvent(entry.candidate.id, entry.featuredTeamId, { priority: 'display' });
    const discovered = cachedDiscoveries?.flatMap(result => result.availableEntries)
      .find(candidate => entryKey(candidate) === entryKey(entry));
    if (entry.context.providerModule.withSchedule) {
      event = entry.context.providerModule.withSchedule(event, discovered?.candidate.raw);
    }
    if (event.competitionType !== "individual" && entry.context.sport !== "baseball") {
      event.details.odds ??= window.SportsOverlay.model.espnOdds(discovered?.candidate.raw ?? entry.candidate.raw);
    }
    if (revision !== requestRevision) return;
    const watchedTeams = savedConfig.displayMode === "top-favorite" ? entry.context.favoriteTeams?.slice(0, 1) : entry.context.favoriteTeams;
    const watchedGame = watchedTeams?.some(team => entry.candidate.teamKeys
      ?.some(id => String(id).toUpperCase() === String(team.teamId).toUpperCase()));
    if (!overrideEntry && (liveMode.isActive() || watchedGame || event.competitionType === "individual")) {
      const observed = { ...entry, candidate: { ...entry.candidate, state: event.state,
        competitionType: event.competitionType || entry.candidate.competitionType },
        ...(event.state === "final" ? { autoFinalDetectedAt: entry.autoFinalDetectedAt ?? Date.now() } : {}) };
      if (liveMode.isActive()) liveMode.observe(observed);
      // Keep metadata and queue timing in step with the freshly polled score.
      for (const result of cachedDiscoveries || []) {
        result.availableEntries = result.availableEntries.map(item => entryKey(item) === entryKey(entry) ? observed : item);
        result.automaticEntries = result.automaticEntries.map(item => entryKey(item) === entryKey(entry) ? observed : item);
      }
      normalRotationQueue = normalRotationQueue.map(item => entryKey(item) === entryKey(entry) ? observed : item);
      automaticRotationEntries = automaticRotationEntries.map(item => entryKey(item) === entryKey(entry) ? observed : item);
      rotationQueue[currentIndex] = observed;
      if (liveMode.isActive() || entry.candidate.state !== event.state
        || event.state === "final" && !Number.isFinite(entry.autoFinalDetectedAt)) scheduleDiscovery();
      if (liveMode.isActive() && ((!window.SportsOverlay.liveMode.isLive(observed) && event.state !== "final")
        || (event.state === "final" && savedConfig.liveModeFinalMinutes === 0))) {
        setTimeout(() => discoverGames(false), 0);
        return;
      }
    }
    if (animate && !await transitionOut(revision)) return;
    if (!animate) clearTransitionClasses();
    const currentLayout = activateLayout(entry.context.sport);
    currentLayout.render(event);
    renderedEvents.delete(entryKey(entry));
    renderedEvents.set(entryKey(entry), event);
    if (renderedEvents.size > 200) renderedEvents.delete(renderedEvents.keys().next().value);
    // Publish the displayed game, not the next queue entry while it is loading.
    if (renderedGameKey !== entryKey(entry)) rotationTransition = fast ? "quick" : "normal";
    renderedGameKey = entryKey(entry);
    if (animate) transitionIn();
    lastEventState = event.state;
    if (!overrideEntry && event.competitionType === "individual" && entry.candidate.state !== event.state) scheduleRotation();
  } catch (error) {
    if (revision === requestRevision) {
      clearTransitionClasses();
      layout.handleError(`${entry.context.league || entry.context.selectedTeam.league} update failed for game ${entry.candidate.id}`, error);
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
  pendingRotation = null;
  const generation = ++rotationGeneration;
  const mount = document.querySelector("#sports-overlay");
  if (mount) mount.dataset.rotationActive = String(!overrideEntry && rotationQueue.length > 1);
  if (overrideEntry || rotationQueue.length < 2) return;
  const advance = async () => {
    if (generation !== rotationGeneration) return;
    pendingRotation = null;
    currentIndex = (currentIndex + 1) % rotationQueue.length;
    await renderCurrentGame({ animate: true });
    if (generation === rotationGeneration) { schedulePoll(); scheduleRotation(); }
  };
  rotationTimer = setTimeout(() => {
    // Keep the elapsed timer registered so discovery does not start a new dwell.
    if (bannerHovered) pendingRotation = advance;
    else void advance();
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
  const directoryDelay = Math.min(...sportContexts.map(context => context.provider.discoveryIntervalMs ?? Infinity));
  const delay = Math.min(providerDelay, expiryDelay, directoryDelay);
  clearTimeout(discoveryTimer);
  discoveryTimer = setTimeout(() => discoverGames(expiryDelay > providerDelay || sportContexts.some(context => ["disc-golf", "chess"].includes(context.sport))), delay);
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
    const locksChanged = JSON.stringify(savedConfig.lockedGameKeys) !== JSON.stringify(snapshot.config.lockedGameKeys);
    const teamsChanged = JSON.stringify(savedConfig.sports) !== JSON.stringify(snapshot.config.sports)
      || JSON.stringify(savedConfig.includedGames) !== JSON.stringify(snapshot.config.includedGames);
    const pdgaSelectionChanged = savedConfig.liveModeFinalMinutes !== snapshot.config.liveModeFinalMinutes
      || JSON.stringify(savedConfig.excludedGames) !== JSON.stringify(snapshot.config.excludedGames);
    const selectionChanged = pdgaSelectionChanged || savedConfig.fallbackMode !== snapshot.config.fallbackMode || savedConfig.displayMode !== snapshot.config.displayMode;
    Object.assign(savedConfig, window.SportsOverlay.config.normalizeConfig(snapshot.config));
    CONFIG.includeSpotlight = savedConfig.displayMode !== "top-favorite";
    CONFIG.showNoGameMessage = savedConfig.fallbackMode !== "hide";
    if (teamsChanged || catalogChanged) sportContexts = savedConfig.sports
      .filter(group => !requestedSport || group.sport === requestedSport)
      .map(createSportContext).filter(Boolean);
    if (overrideEntry) {
      const context = sportContexts.find(context => context.sport === overrideEntry.context.sport);
      overrideEntry = context && window.SportsOverlay.config.isCandidateEnabled(savedConfig, overrideEntry.candidate)
        ? { ...overrideEntry, context } : null;
    }
    if (teamsChanged || catalogChanged) {
      renderedEvents.clear();
      // Invalidate in-flight discovery and remove disabled sports immediately,
      // including manual games, locks, and temporary overrides.
      discoveryGeneration++;
      const allowed = entry => window.SportsOverlay.config.isCandidateEnabled(savedConfig, entry.candidate);
      const previousKey = entryKey(rotationQueue[currentIndex]);
      rotationQueue = rotationQueue.filter(allowed);
      normalRotationQueue = normalRotationQueue.filter(allowed);
      liveRotationQueue = liveRotationQueue.filter(allowed);
      automaticRotationEntries = automaticRotationEntries.filter(allowed);
      cachedDiscoveries = cachedDiscoveries?.map(result => ({ ...result,
        automaticEntries: result.automaticEntries.filter(allowed), availableEntries: result.availableEntries.filter(allowed),
      })) || null;
      currentIndex = Math.max(0, rotationQueue.findIndex(entry => entryKey(entry) === previousKey));
      clearTimeout(rotationTimer); rotationTimer = null; rotationGeneration++;
      clearTimeout(pollTimer); pollGeneration++;
      const separator = renderedGameKey?.indexOf(":");
      if (renderedGameKey && !window.SportsOverlay.config.isCandidateEnabled(savedConfig,
        (cachedDiscoveries || []).flatMap(result => result.availableEntries).find(entry => entryKey(entry) === renderedGameKey)?.candidate
          || { sport: renderedGameKey.slice(0, separator), id: renderedGameKey.slice(separator + 1) })) {
        renderedGameKey = null;
        layout.renderNoEvent(sportContexts.length ? "Updating selected sports…" : "No sports enabled", CONFIG.showNoGameMessage);
      }
    }
    requestRevision += 1;
    if (locksChanged) {
      // A slow discovery must not leave the old queue or hover-delayed advance
      // active after a lock changes. Apply locks to the games already received.
      const previousKey = entryKey(rotationQueue[currentIndex]);
      rotationQueue = selectedRotationQueue((cachedDiscoveries || []).flatMap(result => result.availableEntries));
      currentIndex = Math.max(0, rotationQueue.findIndex(entry => entryKey(entry) === previousKey));
      clearTimeout(pollTimer); pollGeneration++;
      scheduleRotation();
      const generation = rotationGeneration;
      // Show cached scores immediately and bypass unrelated in-flight renders.
      void renderCurrentGame({ fast: true }).then(() => {
        if (generation === rotationGeneration) schedulePoll();
      });
    } else if (timingChanged) scheduleRotation();
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
