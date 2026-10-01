"use strict";

(function initializeHockeyLayout(global) {
  const { EVENT_STATES, formatPregameStart } = global.SportsOverlay.model;

  function createLayout(root = document) {
    const mount = root.querySelector("#sports-overlay");
    if (!mount) throw new Error("Hockey layout requires the sports overlay mount point.");
    global.SportsOverlay.odds?.clear(mount);
    mount.className = "hockey-scorebug is-loading";
    mount.setAttribute("aria-label", "Hockey game score");
    mount.innerHTML = `
      <section class="hockey-main">
        <div class="hockey-team">
          <span id="hockey-away-mark" class="hockey-mark"><img alt="" hidden><span>AWY</span></span>
          <div class="team-name-slot"><strong class="team-name-label" id="hockey-away-abbr">AWY</strong><span id="hockey-away-record" class="hockey-record"></span></div>
          <strong id="hockey-away-score" class="hockey-score">—</strong>
        </div>
        <div class="hockey-center"><strong id="hockey-clock">—</strong><span id="hockey-period">—</span></div>
        <div class="hockey-team hockey-team--home">
          <strong id="hockey-home-score" class="hockey-score">—</strong>
          <div class="team-name-slot"><strong class="team-name-label" id="hockey-home-abbr">HME</strong><span id="hockey-home-record" class="hockey-record"></span></div>
          <span id="hockey-home-mark" class="hockey-mark"><img alt="" hidden><span>HME</span></span>
        </div>
      </section>
      <section id="hockey-status" class="hockey-status" hidden><span id="hockey-matchup"></span><strong id="hockey-status-text"></strong></section>
      <section id="hockey-advantage" class="hockey-advantage" hidden>POWER PLAY ACTIVE</section>
      <section id="hockey-live-detail" class="hockey-live-detail" hidden>
        <div><span>SHOTS</span><strong id="hockey-shots"></strong></div>
        <div><span title="Power-play goals / opportunities">PP GOALS / OPP</span><strong id="hockey-power-play"></strong></div>
      </section>
      <section id="hockey-last-play" class="hockey-last-play" hidden><span class="scorebug-scroll-viewport"><span id="hockey-last-play-text" class="scorebug-scroll-text"></span></span></section>`;

    const find = selector => mount.querySelector(selector);
    const els = {
      bug: mount,
      awayMark: find("#hockey-away-mark"), homeMark: find("#hockey-home-mark"),
      awayAbbr: find("#hockey-away-abbr"), homeAbbr: find("#hockey-home-abbr"),
      awayRecord: find("#hockey-away-record"), homeRecord: find("#hockey-home-record"),
      awayScore: find("#hockey-away-score"), homeScore: find("#hockey-home-score"),
      clock: find("#hockey-clock"), period: find("#hockey-period"),
      status: find("#hockey-status"), matchup: find("#hockey-matchup"), statusText: find("#hockey-status-text"),
      detail: find("#hockey-live-detail"), shots: find("#hockey-shots"), powerPlay: find("#hockey-power-play"),
      advantage: find("#hockey-advantage"),
      lastPlay: find("#hockey-last-play"), lastPlayText: find("#hockey-last-play-text"), lastPlayViewport: find("#hockey-last-play .scorebug-scroll-viewport"),
    };

    function render(event) {
      const { away, home } = event.teams;
      els.bug.classList.remove("is-loading", "is-hidden");
      els.bug.dataset.sport = event.sport;
      els.bug.dataset.state = event.state;
      els.bug.dataset.preseason = String(event.details.preseason === true);
      global.SportsOverlay.teamTheme.apply(els.bug, event);
      els.bug.setAttribute("aria-label", `${away.name} at ${home.name} ${event.league}${event.details.preseason ? " preseason" : ""} game`);
      setTeam(els.awayMark, els.awayAbbr, els.awayRecord, away);
      setTeam(els.homeMark, els.homeAbbr, els.homeRecord, home);
      const showScore = event.state !== EVENT_STATES.PREGAME;
      els.awayScore.textContent = showScore ? away.score ?? 0 : "";
      els.homeScore.textContent = showScore ? home.score ?? 0 : "";
      hide(els.status); hide(els.detail); hide(els.lastPlay); hide(els.advantage);

      if (event.state === EVENT_STATES.LIVE) {
        const details = event.details;
        if (details.powerPlayActive === true) {
          const team = [away, home].find(team => team.id === details.powerPlayTeamId);
          els.advantage.textContent = team ? `${team.abbreviation} POWER PLAY` : "POWER PLAY ACTIVE";
          els.advantage.setAttribute("aria-label", team ? `${team.name} power play` : "Power play active");
          show(els.advantage);
        }
        els.clock.textContent = details.clock || "—";
        els.period.textContent = details.period || "—";
        els.shots.textContent = `${away.abbreviation} ${details.awayShots ?? "—"} · ${home.abbreviation} ${details.homeShots ?? "—"}`;
        els.powerPlay.textContent = `${away.abbreviation} ${details.awayPowerPlay || "—"} · ${home.abbreviation} ${details.homePowerPlay || "—"}`;
        show(els.detail);
        if (details.lastPlay) {
          show(els.lastPlay);
          global.SportsOverlay.scrolling.render(els.lastPlayViewport, els.lastPlayText, details.lastPlay);
        }
      } else {
        els.clock.textContent = "";
        els.period.textContent = "";
        els.matchup.textContent = `${away.abbreviation} at ${home.abbreviation}`;
        els.statusText.textContent = statusText(event);
        show(els.status);
      }
      global.SportsOverlay.odds?.render(els.bug, event);
      global.SportsOverlay.teamNames.render(event, els.awayAbbr, els.homeAbbr);
      return event.state;
    }

    function renderNoEvent(message = "No selected hockey game", visible = true) {
      global.SportsOverlay.odds?.clear(els.bug);
      delete els.bug.dataset.preseason;
      hide(els.advantage);
      els.bug.classList.remove("is-loading");
      els.bug.classList.toggle("is-hidden", !visible);
      if (!visible) return;
      els.clock.textContent = "";
      els.period.textContent = "";
      els.matchup.textContent = "Hockey";
      els.statusText.textContent = message;
      hide(els.detail); hide(els.lastPlay); show(els.status);
    }

    function handleError(message, error) {
      console.warn(`[Sports overlay] ${message}. Keeping the last good display.`, error);
      els.bug.classList.remove("is-loading");
    }

    return Object.freeze({ render, renderNoEvent, handleError });
  }

  function setTeam(mark, abbreviation, record, team) {
    const logo = mark.querySelector("img");
    const fallback = mark.querySelector("span");
    fallback.textContent = team.abbreviation;
    fallback.hidden = Boolean(team.logoUrl);
    logo.hidden = !team.logoUrl;
    logo.alt = team.logoUrl ? `${team.name} logo` : "";
    if (team.logoUrl) logo.src = team.logoUrl;
    else logo.removeAttribute("src");
    logo.onerror = () => { logo.hidden = true; fallback.hidden = false; };
    abbreviation.textContent = team.abbreviation;
    record.textContent = team.record || "";
  }

  function statusText(event) {
    if (event.state === EVENT_STATES.FINAL) return global.SportsOverlay.model.formatFinalStatus(event.startTime);
    if (event.state === EVENT_STATES.INTERRUPTED) return event.detailedState;
    return formatPregameStart(event.startTime) || event.detailedState;
  }

  function show(element) { element.hidden = false; }
  function hide(element) { element.hidden = true; }

  const layout = Object.freeze({ createLayout });
  global.SportsOverlay.hockeyLayout = layout;
  global.SportsOverlay.registry?.registerLayout("hockey", layout);
})(typeof window === "undefined" ? globalThis : window);
