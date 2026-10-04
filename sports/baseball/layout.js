"use strict";

(function initializeBaseballLayout(global) {
  const { EVENT_STATES } = global.SportsOverlay.model;

  function createLayout(root = document) {
    const mount = root.querySelector("#sports-overlay");
    if (!mount) throw new Error("Baseball layout requires the sports overlay mount point.");
    global.SportsOverlay.odds?.clear(mount);
    mount.className = "scorebug is-loading";
    mount.setAttribute("aria-label", "Baseball game score");
    mount.innerHTML = `
      <section id="game-view" class="game-view">
        <div id="away-team" class="team">
          <a id="away-mark" class="team-logo-link"><img id="away-logo" class="team__logo" alt="" hidden></a>
          <a id="away-abbr" class="team__abbr team-name-label">SEA</a>
          <span id="away-score" class="team__score">–</span>
        </div>
        <div id="home-team" class="team">
          <a id="home-mark" class="team-logo-link"><img id="home-logo" class="team__logo" alt="" hidden></a>
          <a id="home-abbr" class="team__abbr team-name-label">OPP</a>
          <span id="home-score" class="team__score">–</span>
        </div>
        <div class="divider" aria-hidden="true"></div>
        <div id="live-panel" class="live-panel">
          <div id="live-details" class="live-details">
            <span id="inning" class="inning">—</span>
            <span id="count" class="count" aria-label="Ball-strike count">—</span>
            <span id="outs" class="outs" aria-label="No outs">
              <span class="out-dot"></span>
              <span class="out-dot"></span>
            </span>
            <div class="diamond" aria-label="Bases empty">
              <span id="base-second" class="base base--second"></span>
              <span id="base-third" class="base base--third"></span>
              <span id="base-first" class="base base--first"></span>
            </div>
          </div>
          <section id="last-play" class="last-play" hidden>
            <span class="last-play__label">Last play</span>
            <span id="last-play-viewport" class="last-play__viewport">
              <span id="last-play-text" class="last-play__text">—</span>
            </span>
          </section>
        </div>
        <div id="status-details" class="status-details" hidden>
          <span id="matchup" class="matchup"></span>
          <span id="status" class="status"></span>
        </div>
      </section>
      <section id="player-details" class="player-details" hidden>
        <div class="player-line player-line--pitcher">
          <span class="player-role">P</span>
          <span id="pitcher-name" class="player-name">—</span>
          <span id="pitcher-stat" class="player-stat">— PITCHES</span>
        </div>
        <div class="player-line player-line--batter">
          <span class="player-role">AB</span>
          <span id="batter-name" class="player-name">—</span>
          <span id="batter-stat" class="player-stat">— FOR —</span>
        </div>
      </section>
      <section id="series-details" class="series-details" hidden aria-live="off"><span id="series-text" class="scorebug-scroll-text"></span></section>
      <section id="no-game" class="no-game" hidden>No selected baseball game today</section>`;

    const els = {
      bug: mount,
      seriesDetails: root.querySelector("#series-details"),
      seriesText: root.querySelector("#series-text"),
      gameView: root.querySelector("#game-view"),
      noGame: root.querySelector("#no-game"),
      awayTeam: root.querySelector("#away-team"),
      homeTeam: root.querySelector("#home-team"),
      awayMark: root.querySelector("#away-mark"), homeMark: root.querySelector("#home-mark"),
      awayLogo: root.querySelector("#away-logo"),
      homeLogo: root.querySelector("#home-logo"),
      awayAbbr: root.querySelector("#away-abbr"),
      homeAbbr: root.querySelector("#home-abbr"),
      awayScore: root.querySelector("#away-score"),
      homeScore: root.querySelector("#home-score"),
      livePanel: root.querySelector("#live-panel"),
      liveDetails: root.querySelector("#live-details"),
      statusDetails: root.querySelector("#status-details"),
      matchup: root.querySelector("#matchup"),
      status: root.querySelector("#status"),
      count: root.querySelector("#count"),
      outDots: [...root.querySelectorAll(".out-dot")],
      playerDetails: root.querySelector("#player-details"),
      pitcherName: root.querySelector("#pitcher-name"),
      pitcherStat: root.querySelector("#pitcher-stat"),
      batterName: root.querySelector("#batter-name"),
      batterStat: root.querySelector("#batter-stat"),
      lastPlay: root.querySelector("#last-play"),
      lastPlayViewport: root.querySelector("#last-play-viewport"),
      lastPlayText: root.querySelector("#last-play-text"),
      inning: root.querySelector("#inning"),
      outs: root.querySelector("#outs"),
      first: root.querySelector("#base-first"),
      second: root.querySelector("#base-second"),
      third: root.querySelector("#base-third"),
      diamond: root.querySelector(".diamond"),
    };

    let footerTimer = null;
    let footerGame = null;
    let footerPhase = 0;
    let footerEvent = null;

    function dispose() {
      clearTimeout(footerTimer);
      footerTimer = null;
      footerGame = null;
      footerEvent = null;
      footerPhase = 0;
    }

    function updateFooter(event) {
      if (footerGame !== event.id) { dispose(); footerGame = event.id; }
      footerEvent = event;
      paintFooter();
    }

    function paintFooter() {
      const event = footerEvent;
      if (!event) return;
      const series = event.details.series;
      const players = event.state === EVENT_STATES.LIVE
        && !["middle", "end"].includes(String(event.details.inningState || "").toLowerCase());
      const phases = series ? [series.identity, series.standing, players ? "players" : ""].filter(Boolean) : [];
      if (!phases.length) {
        clearTimeout(footerTimer); footerTimer = null; footerPhase = 0;
        showElement(els.seriesDetails, false);
        return;
      }
      const phase = phases[footerPhase % phases.length];
      showElement(els.playerDetails, phase === "players");
      showElement(els.seriesDetails, phase !== "players");
      if (phase !== "players") {
        global.SportsOverlay.scrolling.render(els.seriesDetails, els.seriesText, phase);
      }
      if (phases.length > 1 && footerTimer === null) footerTimer = setTimeout(() => {
        footerTimer = null;
        if (!mount.isConnected) { dispose(); return; }
        footerPhase += 1;
        paintFooter();
      }, phase !== "players" && els.seriesText.scrollWidth > els.seriesDetails.clientWidth
        ? Math.max(20, phase.length / 3.5) * 1000 : 8000);
      if (phases.length === 1) { clearTimeout(footerTimer); footerTimer = null; }
    }

    function render(event) {
      const { away, home } = event.teams;
      showElement(els.gameView, true);
      showElement(els.noGame, false);
      els.bug.classList.remove("is-hidden", "is-loading");
      els.bug.dataset.sport = event.sport;
      els.bug.dataset.state = event.state;
      els.bug.dataset.preseason = String(event.details.preseason === true);
      global.SportsOverlay.teamTheme.apply(els.bug, event);
      els.bug.setAttribute("aria-label", `${away.name} at ${home.name} ${event.league}${event.details.preseason ? " preseason" : ""} game`);
      setTeam(els.awayTeam, els.awayLogo, els.awayAbbr, away);
      setTeam(els.homeTeam, els.homeLogo, els.homeAbbr, home);

      if (event.state === EVENT_STATES.INTERRUPTED) {
        hideExtendedDetails();
        setScores(event);
        renderStatus(event, event.detailedState);
      } else if (event.state === EVENT_STATES.LIVE) {
        renderLive(event);
      } else if (event.state === EVENT_STATES.FINAL) {
        hideExtendedDetails();
        setScores(event);
        renderStatus(event, global.SportsOverlay.model.formatFinalStatus(event.startTime), false);
      } else {
        hideExtendedDetails();
        els.awayScore.textContent = "";
        els.homeScore.textContent = "";
        renderStatus(event, formatLocalTime(event.startTime) || event.detailedState);
      }
      updateFooter(event);
      global.SportsOverlay.teamNames.render(event, els.awayAbbr, els.homeAbbr, els.awayMark, els.homeMark);
      if (event.state === EVENT_STATES.PREGAME) {
        global.SportsOverlay.countdown?.render(els.status, event.startTime, { fallback: event.detailedState });
      } else global.SportsOverlay.countdown?.clear(els.status);
      return event.state;
    }

    function renderLive(event) {
      const details = event.details;
      showElement(els.livePanel, true);
      showElement(els.liveDetails, true);
      showElement(els.statusDetails, false);
      setScores(event);

      const ordinal = details.inningOrdinal || (details.inningNumber ? String(details.inningNumber) : "—");
      const inningState = String(details.inningState || "").toLowerCase();
      const hasActiveMatchup = !["middle", "end"].includes(inningState);
      showElement(els.playerDetails, hasActiveMatchup);
      if (inningState === "middle") {
        els.inning.textContent = `MID ${ordinal}`;
      } else if (inningState === "end") {
        els.inning.textContent = `END ${ordinal}`;
      } else {
        els.inning.textContent = `${details.isTopInning ? "▲" : "▼"} ${ordinal}`;
      }

      const hasCount = hasActiveMatchup && details.balls !== null && details.strikes !== null;
      els.count.textContent = hasCount ? `${details.balls}-${details.strikes}` : "—";
      els.count.setAttribute("aria-label", hasCount
        ? `${details.balls} balls, ${details.strikes} strikes`
        : "No active count");

      const outs = hasActiveMatchup ? Math.min(details.outs ?? 0, 2) : 0;
      els.outDots.forEach((dot, index) => dot.classList.toggle("is-recorded", index < outs));
      els.outs.setAttribute("aria-label", `${outs} ${outs === 1 ? "out" : "outs"}`);
      setBase(els.first, details.bases.first);
      setBase(els.second, details.bases.second);
      setBase(els.third, details.bases.third);
      const occupied = Object.entries(details.bases).filter(([, value]) => value).map(([base]) => base);
      els.diamond.setAttribute("aria-label", occupied.length ? `${occupied.join(", ")} occupied` : "Bases empty");
      if (hasActiveMatchup) renderPlayers(details);
      renderLastPlay(details.lastPlay);
    }

    function renderPlayers(details) {
      els.pitcherName.textContent = details.pitcher.name;
      els.pitcherStat.textContent = details.pitcher.pitchCount !== null
        ? `${details.pitcher.pitchCount} PITCHES`
        : "PITCHING";
      els.batterName.textContent = details.batter.name;
      els.batterStat.textContent = details.batter.hits !== null && details.batter.atBats !== null
        ? `${details.batter.hits} FOR ${details.batter.atBats}`
        : "AT BAT";
    }

    function renderLastPlay(description) {
      if (description && !els.lastPlay.hidden && els.lastPlayText.textContent === description) return;
      showElement(els.lastPlay, Boolean(description));
      els.lastPlayText.textContent = description || "";
      els.lastPlayText.title = description || "";
      els.lastPlay.classList.remove("is-scrolling");
      if (description) {
        // Finish initializing before the engine publishes this card; deferring
        // the overflow check exposes a left-aligned frame during fast browsing.
        const overflows = els.lastPlayText.scrollWidth > els.lastPlayViewport.clientWidth;
        els.lastPlay.style.setProperty("--scroll-duration", `${Math.max(20, description.length / 3.5)}s`);
        els.lastPlay.classList.toggle("is-scrolling", overflows);
      }
    }

    function renderStatus(event, text, showMatchup = true) {
      showElement(els.livePanel, false);
      showElement(els.liveDetails, false);
      showElement(els.statusDetails, true);
      els.matchup.textContent = showMatchup
        ? `${event.teams.away.abbreviation} vs ${event.teams.home.abbreviation}`
        : "";
      els.status.textContent = text;
    }

    function renderNoEvent(message = "No selected game today", visible = true) {
      global.SportsOverlay.countdown?.clear(els.status);
      global.SportsOverlay.teamNames.clearLinks(els.awayAbbr, els.homeAbbr, els.awayMark, els.homeMark);
      delete els.bug.dataset.preseason;
      dispose();
      showElement(els.seriesDetails, false);
      hideExtendedDetails();
      els.bug.classList.remove("is-loading");
      els.bug.classList.toggle("is-hidden", !visible);
      if (!visible) return;
      showElement(els.gameView, false);
      showElement(els.noGame, true);
      els.noGame.textContent = message;
    }

    function handleError(message, error) {
      console.warn(`[Sports overlay] ${message}. Keeping the last good display.`, error);
      els.bug.classList.remove("is-loading");
    }

    function hideExtendedDetails() {
      showElement(els.playerDetails, false);
      showElement(els.lastPlay, false);
    }

    function setScores(event) {
      els.awayScore.textContent = event.teams.away.score ?? 0;
      els.homeScore.textContent = event.teams.home.score ?? 0;
    }

    return Object.freeze({ render, renderNoEvent, handleError, dispose });
  }

  function setTeam(container, logo, abbreviation, team) {
    logo.title = team.name?.trim() || team.abbreviation;
    abbreviation.textContent = team.abbreviation;
    container.classList.toggle("is-featured", team.featured);
    if (!team.logoUrl) {
      logo.hidden = true;
      logo.removeAttribute("src");
      return;
    }
    logo.alt = `${team.name} logo`;
    logo.hidden = false;
    logo.onerror = () => {
      logo.hidden = true;
      console.warn(`[Sports overlay] Logo unavailable for ${team.name}.`);
    };
    logo.src = team.logoUrl;
  }

  function setBase(element, occupied) {
    element.classList.toggle("is-occupied", occupied);
  }

  function formatLocalTime(isoDate) {
    return window.SportsOverlay.model.formatPregameStart(isoDate);
  }

  function showElement(element, visible) {
    element.hidden = !visible;
  }

  const layout = Object.freeze({ createLayout, formatLocalTime });
  global.SportsOverlay.baseballLayout = layout;
  global.SportsOverlay.registry?.registerLayout("baseball", layout);
})(typeof window === "undefined" ? globalThis : window);
