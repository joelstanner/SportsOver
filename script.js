"use strict";

const CONFIG = Object.freeze({
  teamId: 136,
  pollIntervalMs: 12_000,
  scheduleRetryMs: 5 * 60_000,
  showNoGameMessage: true, // Set false to make the overlay disappear on off days.
  requestTimeoutMs: 8_000,
});

const SCHEDULE_URL = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${CONFIG.teamId}`;
const FALLBACK_ABBREVIATIONS = Object.freeze({
  "Arizona Diamondbacks": "AZ", "Athletics": "ATH", "Atlanta Braves": "ATL",
  "Baltimore Orioles": "BAL", "Boston Red Sox": "BOS", "Chicago Cubs": "CHC",
  "Chicago White Sox": "CWS", "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE",
  "Colorado Rockies": "COL", "Detroit Tigers": "DET", "Houston Astros": "HOU",
  "Kansas City Royals": "KC", "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD",
  "Miami Marlins": "MIA", "Milwaukee Brewers": "MIL", "Minnesota Twins": "MIN",
  "New York Mets": "NYM", "New York Yankees": "NYY", "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD", "San Francisco Giants": "SF",
  "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL", "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR", "Washington Nationals": "WSH",
});

const els = {
  bug: document.querySelector("#scorebug"),
  gameView: document.querySelector("#game-view"),
  noGame: document.querySelector("#no-game"),
  awayTeam: document.querySelector("#away-team"),
  homeTeam: document.querySelector("#home-team"),
  awayLogo: document.querySelector("#away-logo"),
  homeLogo: document.querySelector("#home-logo"),
  awayAbbr: document.querySelector("#away-abbr"),
  homeAbbr: document.querySelector("#home-abbr"),
  awayScore: document.querySelector("#away-score"),
  homeScore: document.querySelector("#home-score"),
  livePanel: document.querySelector("#live-panel"),
  liveDetails: document.querySelector("#live-details"),
  statusDetails: document.querySelector("#status-details"),
  matchup: document.querySelector("#matchup"),
  status: document.querySelector("#status"),
  count: document.querySelector("#count"),
  outDots: [...document.querySelectorAll(".out-dot")],
  playerDetails: document.querySelector("#player-details"),
  pitcherName: document.querySelector("#pitcher-name"),
  pitcherStat: document.querySelector("#pitcher-stat"),
  batterName: document.querySelector("#batter-name"),
  batterStat: document.querySelector("#batter-stat"),
  lastPlay: document.querySelector("#last-play"),
  lastPlayViewport: document.querySelector("#last-play-viewport"),
  lastPlayText: document.querySelector("#last-play-text"),
  inning: document.querySelector("#inning"),
  outs: document.querySelector("#outs"),
  first: document.querySelector("#base-first"),
  second: document.querySelector("#base-second"),
  third: document.querySelector("#base-third"),
  diamond: document.querySelector(".diamond"),
};

let activeGamePk = null;
let refreshTimer = null;

function renderDemoFromUrl() {
  const demoName = new URLSearchParams(window.location.search).get("demo");
  if (!demoName) return false;

  const feed = window.MARINERS_DEMO_FEEDS?.[demoName];
  if (!feed) {
    console.warn(`[Mariners overlay] Unknown demo "${demoName}". Available demos: live.`);
    return false;
  }

  console.info(`[Mariners overlay] Rendering the "${demoName}" demo.`);
  renderGame(feed);
  return true;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`MLB API returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function chooseGame(games) {
  const rank = { Live: 0, Preview: 1, Final: 2 };
  return [...games].sort((a, b) => {
    const aState = a.status?.abstractGameState;
    const bState = b.status?.abstractGameState;
    const stateDifference = (rank[aState] ?? 3) - (rank[bState] ?? 3);
    if (stateDifference) return stateDifference;
    // Pick the upcoming game before first pitch, but the latest game once all are final.
    return aState === "Final"
      ? new Date(b.gameDate) - new Date(a.gameDate)
      : new Date(a.gameDate) - new Date(b.gameDate);
  })[0];
}

async function findTodaysGame() {
  try {
    const schedule = await fetchJson(SCHEDULE_URL);
    const games = schedule.dates?.flatMap(date => date.games ?? []) ?? [];
    const game = chooseGame(games);
    if (!game?.gamePk) {
      activeGamePk = null;
      renderNoGame();
      scheduleNext(CONFIG.scheduleRetryMs, findTodaysGame);
      return;
    }

    if (game.status?.abstractGameState === "Final" && game.gamePk === activeGamePk) {
      scheduleNext(CONFIG.scheduleRetryMs, findTodaysGame);
      return;
    }

    activeGamePk = game.gamePk;
    console.info(`[Mariners overlay] Found game ${activeGamePk}.`);
    await updateGame();
  } catch (error) {
    handleError("Schedule lookup failed", error);
    scheduleNext(CONFIG.scheduleRetryMs, findTodaysGame);
  }
}

async function updateGame() {
  if (!activeGamePk) return findTodaysGame();

  try {
    const feed = await fetchJson(`https://statsapi.mlb.com/api/v1.1/game/${activeGamePk}/feed/live`);
    const state = renderGame(feed);
    if (state === "Final") {
      // Revisit the schedule so a later game in a doubleheader can take over.
      scheduleNext(CONFIG.pollIntervalMs, findTodaysGame);
      return;
    }
  } catch (error) {
    handleError(`Update failed for game ${activeGamePk}`, error);
  }
  scheduleNext(CONFIG.pollIntervalMs, updateGame);
}

function renderGame(feed) {
  const gameData = feed.gameData ?? {};
  const linescore = feed.liveData?.linescore ?? {};
  const status = gameData.status ?? {};
  const away = gameData.teams?.away ?? {};
  const home = gameData.teams?.home ?? {};
  const awayAbbr = teamAbbreviation(away);
  const homeAbbr = teamAbbreviation(home);
  const abstractState = status.abstractGameState ?? "Preview";
  const detailedState = status.detailedState ?? abstractState;
  const isInterrupted = /delay|postpon|suspend|cancel/i.test(detailedState);

  showElement(els.gameView, true);
  showElement(els.noGame, false);
  els.bug.classList.remove("is-hidden", "is-loading");
  els.awayAbbr.textContent = awayAbbr;
  els.homeAbbr.textContent = homeAbbr;
  setTeamLogo(els.awayLogo, away);
  setTeamLogo(els.homeLogo, home);
  els.awayTeam.classList.toggle("is-seattle", Number(away.id) === CONFIG.teamId);
  els.homeTeam.classList.toggle("is-seattle", Number(home.id) === CONFIG.teamId);

  if (isInterrupted) {
    showElement(els.playerDetails, false);
    showElement(els.lastPlay, false);
    setScores(linescore);
    renderStatus(awayAbbr, homeAbbr, detailedState);
  } else if (abstractState === "Live") {
    renderLive(linescore, feed.liveData);
  } else if (abstractState === "Final") {
    showElement(els.playerDetails, false);
    showElement(els.lastPlay, false);
    setScores(linescore);
    renderStatus(awayAbbr, homeAbbr, "FINAL", false);
  } else {
    showElement(els.playerDetails, false);
    showElement(els.lastPlay, false);
    const startTime = formatLocalTime(gameData.datetime?.dateTime);
    els.awayScore.textContent = "";
    els.homeScore.textContent = "";
    renderStatus(awayAbbr, homeAbbr, startTime || detailedState);
  }
  return abstractState;
}

function renderLive(linescore, liveData = {}) {
  showElement(els.livePanel, true);
  showElement(els.liveDetails, true);
  showElement(els.statusDetails, false);
  setScores(linescore);

  const inningNumber = linescore.currentInning;
  const ordinal = linescore.currentInningOrdinal || (inningNumber ? String(inningNumber) : "—");
  const inningState = String(linescore.inningState || "").toLowerCase();
  const hasActiveMatchup = !["middle", "end"].includes(inningState);
  showElement(els.playerDetails, hasActiveMatchup);
  if (inningState === "middle") {
    els.inning.textContent = `MID ${ordinal}`;
  } else if (inningState === "end") {
    els.inning.textContent = `END ${ordinal}`;
  } else {
    const indicator = linescore.isTopInning ? "▲" : "▼";
    els.inning.textContent = `${indicator} ${ordinal}`;
  }

  const balls = Number(linescore.balls);
  const strikes = Number(linescore.strikes);
  const hasCount = hasActiveMatchup && Number.isInteger(balls) && Number.isInteger(strikes);
  els.count.textContent = hasCount ? `${balls}-${strikes}` : "—";
  els.count.setAttribute("aria-label", hasCount ? `${balls} balls, ${strikes} strikes` : "No active count");

  const reportedOuts = Number.isInteger(linescore.outs) ? linescore.outs : 0;
  const outs = hasActiveMatchup ? Math.min(reportedOuts, 2) : 0;
  els.outDots.forEach((dot, index) => dot.classList.toggle("is-recorded", index < outs));
  els.outs.setAttribute("aria-label", `${outs} ${outs === 1 ? "out" : "outs"}`);
  setBase(els.first, Boolean(linescore.offense?.first));
  setBase(els.second, Boolean(linescore.offense?.second));
  setBase(els.third, Boolean(linescore.offense?.third));
  const occupied = ["first", "second", "third"].filter(base => linescore.offense?.[base]);
  els.diamond.setAttribute("aria-label", occupied.length ? `${occupied.join(", ")} occupied` : "Bases empty");
  if (hasActiveMatchup) renderPlayers(linescore, liveData);
  renderLastPlay(liveData.plays);
}

function renderLastPlay(plays = {}) {
  const completedPlay = [...(plays.allPlays ?? [])].reverse().find(play =>
    play.about?.isComplete && play.result?.description
  );
  const description = completedPlay?.result?.description?.trim();

  // Polls often return the same play. Preserve the existing DOM and animation
  // timeline so the ticker does not jump back to its starting position.
  if (description && !els.lastPlay.hidden && els.lastPlayText.textContent === description) return;

  showElement(els.lastPlay, Boolean(description));
  els.lastPlayText.textContent = description || "";
  els.lastPlayText.title = description || "";
  els.lastPlay.classList.remove("is-scrolling");
  if (description) {
    requestAnimationFrame(() => {
      const overflows = els.lastPlayText.scrollWidth > els.lastPlayViewport.clientWidth;
      els.lastPlay.classList.toggle("is-scrolling", overflows);
      els.lastPlay.style.setProperty("--scroll-duration", `${Math.max(20, description.length / 3.5)}s`);
    });
  }
}

function renderPlayers(linescore, liveData) {
  const matchup = liveData.plays?.currentPlay?.matchup ?? {};
  const pitcher = linescore.defense?.pitcher ?? matchup.pitcher ?? {};
  const batter = linescore.offense?.batter ?? matchup.batter ?? {};
  const pitchingSide = linescore.isTopInning ? "home" : "away";
  const battingSide = linescore.isTopInning ? "away" : "home";
  const pitcherStats = findPlayerStats(liveData.boxscore, pitchingSide, pitcher.id)?.pitching ?? {};
  const batterStats = findPlayerStats(liveData.boxscore, battingSide, batter.id)?.batting ?? {};
  const pitchCount = pitcherStats.numberOfPitches ?? pitcherStats.pitchesThrown;

  els.pitcherName.textContent = displayName(pitcher);
  els.pitcherStat.textContent = Number.isFinite(Number(pitchCount)) ? `${pitchCount} PITCHES` : "PITCHING";
  els.batterName.textContent = displayName(batter);
  els.batterStat.textContent = Number.isFinite(Number(batterStats.hits)) && Number.isFinite(Number(batterStats.atBats))
    ? `${batterStats.hits} FOR ${batterStats.atBats}`
    : "AT BAT";
}

function findPlayerStats(boxscore, side, playerId) {
  if (!playerId) return null;
  return boxscore?.teams?.[side]?.players?.[`ID${playerId}`]?.stats ?? null;
}

function displayName(person) {
  return person.fullName || person.lastName || "—";
}

function renderStatus(awayAbbr, homeAbbr, text, showMatchup = true) {
  showElement(els.livePanel, false);
  showElement(els.liveDetails, false);
  showElement(els.statusDetails, true);
  els.matchup.textContent = showMatchup ? `${awayAbbr} vs ${homeAbbr}` : "";
  els.status.textContent = text;
}

function renderNoGame() {
  showElement(els.playerDetails, false);
  showElement(els.lastPlay, false);
  els.bug.classList.remove("is-loading");
  if (!CONFIG.showNoGameMessage) {
    els.bug.classList.add("is-hidden");
    return;
  }
  els.bug.classList.remove("is-hidden");
  showElement(els.gameView, false);
  showElement(els.noGame, true);
}

function setScores(linescore) {
  els.awayScore.textContent = linescore.teams?.away?.runs ?? 0;
  els.homeScore.textContent = linescore.teams?.home?.runs ?? 0;
}

function setBase(element, occupied) {
  element.classList.toggle("is-occupied", occupied);
}

function setTeamLogo(element, team) {
  const teamId = Number(team.id);
  if (!Number.isInteger(teamId)) {
    element.hidden = true;
    element.removeAttribute("src");
    return;
  }

  element.alt = `${team.name || team.teamName || "Team"} logo`;
  element.hidden = false;
  element.onerror = () => {
    element.hidden = true;
    console.warn(`[Mariners overlay] Logo unavailable for team ${teamId}.`);
  };
  element.src = `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

function teamAbbreviation(team) {
  if (Number(team.id) === CONFIG.teamId) return "SEA";
  if (team.abbreviation) return String(team.abbreviation).toUpperCase();
  if (FALLBACK_ABBREVIATIONS[team.name]) return FALLBACK_ABBREVIATIONS[team.name];
  return String(team.teamName || team.name || "OPP").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
}

function formatLocalTime(isoDate) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function showElement(element, visible) {
  element.hidden = !visible;
}

function scheduleNext(delay, callback) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(callback, delay);
}

function handleError(message, error) {
  console.warn(`[Mariners overlay] ${message}. Keeping the last good display.`, error);
  els.bug.classList.remove("is-loading");
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    clearTimeout(refreshTimer);
    activeGamePk ? updateGame() : findTodaysGame();
  }
});

if (!renderDemoFromUrl()) findTodaysGame();
