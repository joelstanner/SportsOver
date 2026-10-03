"use strict";

(function initializeFootballLayout(global) {
  const { EVENT_STATES, formatPregameStart } = global.SportsOverlay.model;

  function createLayout(root = document) {
    const mount = root.querySelector("#sports-overlay");
    if (!mount) throw new Error("Football layout requires the sports overlay mount point.");
    global.SportsOverlay.odds?.clear(mount);
    mount.className = "football-scorebug is-loading";
    mount.setAttribute("aria-label", "Football game score");
    mount.innerHTML = `
      <section class="football-main">
        <div class="football-team">
          <span id="football-away-mark" class="football-mark"><img alt="" hidden><span>DET</span></span>
          <div class="team-name-slot"><span class="football-team-name"><span id="football-away-abbr" class="football-abbr team-name-label">DET</span><span id="football-away-possession" class="football-possession" aria-label="Possession" hidden>🏈</span></span><span id="football-away-record" class="football-record"></span><span id="football-away-timeouts" class="timeout-markers football-timeouts" hidden></span></div>
          <strong id="football-away-score" class="football-score">—</strong>
        </div>
        <div class="football-center"><span id="football-clock" class="football-clock">—</span><span id="football-quarter" class="football-quarter">—</span></div>
        <div class="football-team football-team--home">
          <strong id="football-home-score" class="football-score">—</strong>
          <div class="team-name-slot"><span class="football-team-name"><span id="football-home-abbr" class="football-abbr team-name-label">SEA</span><span id="football-home-possession" class="football-possession" aria-label="Possession" hidden>🏈</span></span><span id="football-home-record" class="football-record"></span><span id="football-home-timeouts" class="timeout-markers timeout-markers--home football-timeouts" hidden></span></div>
          <span id="football-home-mark" class="football-mark football-mark--home"><img alt="" hidden><span>SEA</span></span>
        </div>
      </section>
      <section id="football-status" class="football-status" hidden><span id="football-matchup"></span><strong id="football-status-text"></strong></section>
      <section id="football-live-detail" class="football-live-detail" hidden>
        <div id="football-down-detail"><span>DOWN</span><strong id="football-down"></strong></div>
        <div id="football-field-detail"><span>FIELD</span><strong id="football-field"></strong></div>
      </section>
      <section id="football-last-play" class="football-last-play" hidden><span class="scorebug-scroll-viewport"><span id="football-last-play-text" class="scorebug-scroll-text"></span></span></section>`;

    const find = selector => mount.querySelector(selector);
    const els = {
      bug: mount,
      awayMark: find("#football-away-mark"), homeMark: find("#football-home-mark"),
      awayAbbr: find("#football-away-abbr"), homeAbbr: find("#football-home-abbr"),
      awayRecord: find("#football-away-record"), homeRecord: find("#football-home-record"),
      awayTimeouts: find("#football-away-timeouts"), homeTimeouts: find("#football-home-timeouts"),
      awayPossession: find("#football-away-possession"), homePossession: find("#football-home-possession"),
      awayScore: find("#football-away-score"), homeScore: find("#football-home-score"),
      clock: find("#football-clock"), quarter: find("#football-quarter"),
      status: find("#football-status"), matchup: find("#football-matchup"), statusText: find("#football-status-text"),
      detail: find("#football-live-detail"), downDetail: find("#football-down-detail"), down: find("#football-down"), field: find("#football-field"),
      fieldDetail: find("#football-field-detail"), lastPlay: find("#football-last-play"), lastPlayText: find("#football-last-play-text"), lastPlayViewport: find("#football-last-play .scorebug-scroll-viewport"),
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
      const showTimeouts = event.state === EVENT_STATES.LIVE || event.state === EVENT_STATES.INTERRUPTED;
      const timeoutMaximum = event.sport === "college-football" ? event.details.timeoutMaximum ?? 3 : 3;
      global.SportsOverlay.timeouts.renderMarkers(els.awayTimeouts, showTimeouts ? away.timeoutsRemaining : null, timeoutMaximum, away.name);
      global.SportsOverlay.timeouts.renderMarkers(els.homeTimeouts, showTimeouts ? home.timeoutsRemaining : null, timeoutMaximum, home.name);
      const showScore = event.state !== EVENT_STATES.PREGAME;
      els.awayScore.textContent = showScore ? away.score ?? 0 : "";
      els.homeScore.textContent = showScore ? home.score ?? 0 : "";
      hide(els.awayPossession); hide(els.homePossession);
      els.fieldDetail.classList.remove("is-red-zone");
      hide(els.status); hide(els.detail); hide(els.lastPlay);

      if (event.state === EVENT_STATES.LIVE) {
        const details = event.details;
        els.clock.textContent = details.clock || "—";
        els.quarter.textContent = details.quarter || "—";
        const downText = formatDown(details);
        els.down.textContent = downText;
        els.field.textContent = details.yardLine || "";
        els.downDetail.hidden = !downText;
        els.fieldDetail.hidden = !details.yardLine;
        els.detail.classList.toggle("is-single", !downText || !details.yardLine);
        const possession = String(details.possessionTeam || "").toUpperCase();
        if (possession === away.abbreviation.toUpperCase()) show(els.awayPossession);
        if (possession === home.abbreviation.toUpperCase()) show(els.homePossession);
        els.fieldDetail.classList.toggle("is-red-zone", isRedZone(event));
        if (downText || details.yardLine) show(els.detail);
        if (details.lastPlay) {
          show(els.lastPlay);
          global.SportsOverlay.scrolling.render(els.lastPlayViewport, els.lastPlayText, details.lastPlay);
        }
      } else {
        els.clock.textContent = "";
        els.quarter.textContent = "";
        els.matchup.textContent = `${away.abbreviation} at ${home.abbreviation}`;
        els.statusText.textContent = statusText(event);
        show(els.status);
      }
      global.SportsOverlay.odds?.render(els.bug, event);
      global.SportsOverlay.teamNames.render(event, els.awayAbbr, els.homeAbbr);
      return event.state;
    }

    function renderNoEvent(message = "No selected football game", visible = true) {
      global.SportsOverlay.odds?.clear(els.bug);
      delete els.bug.dataset.preseason;
      els.bug.classList.remove("is-loading");
      els.bug.classList.toggle("is-hidden", !visible);
      if (!visible) return;
      els.clock.textContent = "";
      els.quarter.textContent = "";
      els.matchup.textContent = "Football";
      els.statusText.textContent = message;
      hide(els.awayPossession); hide(els.homePossession);
      els.fieldDetail.classList.remove("is-red-zone");
      hide(els.detail); hide(els.lastPlay); show(els.status);
    }

    function handleError(message, error) {
      console.warn(`[Sports overlay] ${message}. Keeping the last good display.`, error);
      els.bug.classList.remove("is-loading");
    }

    return Object.freeze({ render, renderNoEvent, handleError });
  }

  function setTeam(mark, abbreviation, record, team) {
    mark.title = team.name?.trim() || team.abbreviation;
    const logo = mark.querySelector("img");
    const fallback = mark.querySelector("span");
    fallback.textContent = team.abbreviation;
    fallback.hidden = Boolean(team.logoUrl);
    logo.hidden = !team.logoUrl;
    logo.alt = team.logoUrl ? `${team.name} logo` : "";
    if (team.logoUrl) logo.src = team.logoUrl;
    else logo.removeAttribute("src");
    logo.onerror = () => {
      logo.hidden = true;
      fallback.hidden = false;
    };
    abbreviation.textContent = team.abbreviation;
    record.textContent = team.record || "";
  }

  function statusText(event) {
    if (event.state === EVENT_STATES.FINAL) return global.SportsOverlay.model.formatFinalStatus(event.startTime);
    if (event.state === EVENT_STATES.INTERRUPTED) return event.detailedState;
    return formatPregameStart(event.startTime) || event.detailedState;
  }

  function isRedZone(event) {
    if (typeof event.details.redZone === "boolean") return event.details.redZone;
    const possession = String(event.details.possessionTeam || "").toUpperCase();
    const match = String(event.details.yardLine || "").toUpperCase().match(/^([A-Z]+)\s+(\d{1,2})$/);
    return Boolean(match && match[1] !== possession && Number(match[2]) <= 20);
  }

  function ordinal(value) {
    return value === 1 ? "1ST" : value === 2 ? "2ND" : value === 3 ? "3RD" : `${value}TH`;
  }

  function formatDown(details) {
    if (!Number.isFinite(details.down) || details.down < 1 || !Number.isFinite(details.distance)) return "";
    return `${ordinal(details.down)} & ${details.distance}`;
  }

  function show(element) { element.hidden = false; }
  function hide(element) { element.hidden = true; }

  const layout = Object.freeze({ createLayout, isRedZone, formatDown });
  global.SportsOverlay.footballLayout = layout;
  global.SportsOverlay.registry?.registerLayout("football", layout);
  global.SportsOverlay.registry?.registerLayout("college-football", layout);
})(typeof window === "undefined" ? globalThis : window);
