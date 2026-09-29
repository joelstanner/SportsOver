"use strict";

(function initializeFootballLayout(global) {
  const { EVENT_STATES, formatPregameStart } = global.SportsOverlay.model;

  function createLayout(root = document) {
    const mount = root.querySelector("#sports-overlay");
    if (!mount) throw new Error("Football layout requires the sports overlay mount point.");
    mount.className = "football-scorebug is-loading";
    mount.setAttribute("aria-label", "Football game score");
    mount.innerHTML = `
      <section class="football-main">
        <div class="football-team">
          <span id="football-away-mark" class="football-mark"><img alt="" hidden><span>DET</span></span>
          <div><span class="football-team-name"><span id="football-away-abbr" class="football-abbr">DET</span><span id="football-away-possession" class="football-possession" aria-label="Possession" hidden>🏈</span></span><span id="football-away-record" class="football-record"></span></div>
          <strong id="football-away-score" class="football-score">—</strong>
        </div>
        <div class="football-center"><span id="football-clock" class="football-clock">—</span><span id="football-quarter" class="football-quarter">—</span></div>
        <div class="football-team football-team--home">
          <strong id="football-home-score" class="football-score">—</strong>
          <div><span class="football-team-name"><span id="football-home-abbr" class="football-abbr">SEA</span><span id="football-home-possession" class="football-possession" aria-label="Possession" hidden>🏈</span></span><span id="football-home-record" class="football-record"></span></div>
          <span id="football-home-mark" class="football-mark football-mark--home"><img alt="" hidden><span>SEA</span></span>
        </div>
      </section>
      <section id="football-status" class="football-status" hidden><span id="football-matchup"></span><strong id="football-status-text"></strong></section>
      <section id="football-live-detail" class="football-live-detail" hidden>
        <div><span>DOWN</span><strong id="football-down"></strong></div>
        <div id="football-field-detail"><span>FIELD</span><strong id="football-field"></strong></div>
      </section>
      <section id="football-last-play" class="football-last-play" hidden></section>`;

    const find = selector => mount.querySelector(selector);
    const els = {
      bug: mount,
      awayMark: find("#football-away-mark"), homeMark: find("#football-home-mark"),
      awayAbbr: find("#football-away-abbr"), homeAbbr: find("#football-home-abbr"),
      awayRecord: find("#football-away-record"), homeRecord: find("#football-home-record"),
      awayPossession: find("#football-away-possession"), homePossession: find("#football-home-possession"),
      awayScore: find("#football-away-score"), homeScore: find("#football-home-score"),
      clock: find("#football-clock"), quarter: find("#football-quarter"),
      status: find("#football-status"), matchup: find("#football-matchup"), statusText: find("#football-status-text"),
      detail: find("#football-live-detail"), down: find("#football-down"), field: find("#football-field"),
      fieldDetail: find("#football-field-detail"), lastPlay: find("#football-last-play"),
    };

    function render(event) {
      const { away, home } = event.teams;
      els.bug.classList.remove("is-loading", "is-hidden");
      els.bug.dataset.sport = event.sport;
      els.bug.dataset.state = event.state;
      els.bug.setAttribute("aria-label", `${away.name} at ${home.name} ${event.league} game`);
      setTeam(els.awayMark, els.awayAbbr, els.awayRecord, away);
      setTeam(els.homeMark, els.homeAbbr, els.homeRecord, home);
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
        els.down.textContent = `${ordinal(details.down)} & ${details.distance}`;
        els.field.textContent = details.yardLine;
        const possession = String(details.possessionTeam || "").toUpperCase();
        if (possession === away.abbreviation.toUpperCase()) show(els.awayPossession);
        if (possession === home.abbreviation.toUpperCase()) show(els.homePossession);
        els.fieldDetail.classList.toggle("is-red-zone", isRedZone(event));
        show(els.detail);
        if (details.lastPlay) {
          els.lastPlay.textContent = details.lastPlay;
          show(els.lastPlay);
        }
      } else {
        els.clock.textContent = "";
        els.quarter.textContent = "";
        els.matchup.textContent = `${away.abbreviation} at ${home.abbreviation}`;
        els.statusText.textContent = statusText(event);
        show(els.status);
      }
      return event.state;
    }

    function renderNoEvent(message = "No selected football game", visible = true) {
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
    if (event.state === EVENT_STATES.FINAL) return "FINAL";
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

  function show(element) { element.hidden = false; }
  function hide(element) { element.hidden = true; }

  const layout = Object.freeze({ createLayout, isRedZone });
  global.SportsOverlay.footballLayout = layout;
  global.SportsOverlay.registry?.registerLayout("football", layout);
  global.SportsOverlay.registry?.registerLayout("college-football", layout);
})(typeof window === "undefined" ? globalThis : window);
