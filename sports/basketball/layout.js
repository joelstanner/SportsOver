"use strict";

(function initializeBasketballLayout(global) {
  const { EVENT_STATES } = global.SportsOverlay.model;

  function createLayout(root = document) {
    const mount = root.querySelector("#sports-overlay");
    if (!mount) throw new Error("Basketball layout requires the sports overlay mount point.");
    mount.className = "basketball-scorebug is-loading";
    mount.setAttribute("aria-label", "Basketball game score");
    mount.innerHTML = `
      <section class="basketball-main">
        <div class="basketball-team">
          <span id="basketball-away-mark" class="basketball-mark"><img alt="" hidden><span>AWY</span></span>
          <div><strong id="basketball-away-abbr">AWY</strong><span id="basketball-away-record" class="basketball-record"></span></div>
          <strong id="basketball-away-score" class="basketball-score">—</strong>
        </div>
        <div class="basketball-center"><strong id="basketball-clock">—</strong><span id="basketball-period">—</span></div>
        <div class="basketball-team basketball-team--home">
          <strong id="basketball-home-score" class="basketball-score">—</strong>
          <div><strong id="basketball-home-abbr">HME</strong><span id="basketball-home-record" class="basketball-record"></span></div>
          <span id="basketball-home-mark" class="basketball-mark"><img alt="" hidden><span>HME</span></span>
        </div>
      </section>
      <section id="basketball-status" class="basketball-status" hidden><span id="basketball-matchup"></span><strong id="basketball-status-text"></strong></section>
      <section id="basketball-live-detail" class="basketball-live-detail" hidden>
        <div><span>FIELD GOALS</span><strong id="basketball-field-goals"></strong></div>
        <div><span>REBOUNDS</span><strong id="basketball-rebounds"></strong></div>
      </section>
      <section id="basketball-last-play" class="basketball-last-play" hidden></section>`;

    const find = selector => mount.querySelector(selector);
    const els = {
      bug: mount,
      awayMark: find("#basketball-away-mark"), homeMark: find("#basketball-home-mark"),
      awayAbbr: find("#basketball-away-abbr"), homeAbbr: find("#basketball-home-abbr"),
      awayRecord: find("#basketball-away-record"), homeRecord: find("#basketball-home-record"),
      awayScore: find("#basketball-away-score"), homeScore: find("#basketball-home-score"),
      clock: find("#basketball-clock"), period: find("#basketball-period"),
      status: find("#basketball-status"), matchup: find("#basketball-matchup"), statusText: find("#basketball-status-text"),
      detail: find("#basketball-live-detail"), fieldGoals: find("#basketball-field-goals"), rebounds: find("#basketball-rebounds"),
      lastPlay: find("#basketball-last-play"),
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
      hide(els.status); hide(els.detail); hide(els.lastPlay);

      if (event.state === EVENT_STATES.LIVE) {
        const details = event.details;
        els.clock.textContent = details.clock || "—";
        els.period.textContent = details.period || "—";
        els.fieldGoals.textContent = `${away.abbreviation} ${percent(details.awayFieldGoalPct)} · ${home.abbreviation} ${percent(details.homeFieldGoalPct)}`;
        els.rebounds.textContent = `${away.abbreviation} ${details.awayRebounds ?? "—"} · ${home.abbreviation} ${details.homeRebounds ?? "—"}`;
        show(els.detail);
        if (details.lastPlay) {
          els.lastPlay.textContent = details.lastPlay;
          show(els.lastPlay);
        }
      } else {
        els.clock.textContent = "";
        els.period.textContent = "";
        els.matchup.textContent = `${away.abbreviation} at ${home.abbreviation}`;
        els.statusText.textContent = statusText(event);
        show(els.status);
      }
      return event.state;
    }

    function renderNoEvent(message = "No selected basketball game", visible = true) {
      els.bug.classList.remove("is-loading");
      els.bug.classList.toggle("is-hidden", !visible);
      if (!visible) return;
      els.clock.textContent = "";
      els.period.textContent = "";
      els.matchup.textContent = "Basketball";
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
    if (event.state === EVENT_STATES.FINAL) return "FINAL";
    if (event.state === EVENT_STATES.INTERRUPTED) return event.detailedState;
    return formatStart(event.startTime) || event.detailedState;
  }

  function formatStart(isoDate) {
    if (!isoDate) return "";
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
  }

  function percent(value) { return value === null || value === undefined ? "—" : `${value}%`; }
  function show(element) { element.hidden = false; }
  function hide(element) { element.hidden = true; }

  const layout = Object.freeze({ createLayout });
  global.SportsOverlay.basketballLayout = layout;
  global.SportsOverlay.registry?.registerLayout("basketball", layout);
})(typeof window === "undefined" ? globalThis : window);
