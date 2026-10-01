"use strict";

(function initializeSoccerLayout(global) {
  const { EVENT_STATES, formatPregameStart } = global.SportsOverlay.model;

  function createLayout(root = document) {
    const mount = root.querySelector("#sports-overlay");
    if (!mount) throw new Error("Soccer layout requires the sports overlay mount point.");
    global.SportsOverlay.odds?.clear(mount);
    mount.className = "soccer-scorebug is-loading";
    mount.setAttribute("aria-label", "Soccer match score");
    mount.innerHTML = `
      <section class="soccer-main">
        <div class="soccer-team">
          <span id="soccer-home-mark" class="soccer-mark"><img alt="" hidden><span>HME</span></span>
          <div><strong id="soccer-home-abbr">HME</strong><span id="soccer-home-record" class="soccer-record"></span></div>
          <strong id="soccer-home-score" class="soccer-score">—</strong>
        </div>
        <div class="soccer-center"><strong id="soccer-clock">—</strong><span id="soccer-period">—</span></div>
        <div class="soccer-team soccer-team--away">
          <strong id="soccer-away-score" class="soccer-score">—</strong>
          <div><strong id="soccer-away-abbr">AWY</strong><span id="soccer-away-record" class="soccer-record"></span></div>
          <span id="soccer-away-mark" class="soccer-mark"><img alt="" hidden><span>AWY</span></span>
        </div>
      </section>
      <section id="soccer-status" class="soccer-status" hidden><span id="soccer-matchup"></span><strong id="soccer-status-text"></strong></section>
      <section id="soccer-live-detail" class="soccer-live-detail" hidden>
        <div><span>POSSESSION</span><strong id="soccer-possession"></strong></div>
        <div><span>SHOTS ON TARGET</span><strong id="soccer-shots"></strong></div>
      </section>
      <section id="soccer-last-event" class="soccer-last-event" hidden><span class="scorebug-scroll-viewport"><span id="soccer-last-event-text" class="scorebug-scroll-text"></span></span></section>`;

    const find = selector => mount.querySelector(selector);
    const els = {
      bug: mount,
      awayMark: find("#soccer-away-mark"), homeMark: find("#soccer-home-mark"),
      awayAbbr: find("#soccer-away-abbr"), homeAbbr: find("#soccer-home-abbr"),
      awayRecord: find("#soccer-away-record"), homeRecord: find("#soccer-home-record"),
      awayScore: find("#soccer-away-score"), homeScore: find("#soccer-home-score"),
      clock: find("#soccer-clock"), period: find("#soccer-period"),
      status: find("#soccer-status"), matchup: find("#soccer-matchup"), statusText: find("#soccer-status-text"),
      detail: find("#soccer-live-detail"), possession: find("#soccer-possession"), shots: find("#soccer-shots"),
      lastEvent: find("#soccer-last-event"), lastEventText: find("#soccer-last-event-text"), lastEventViewport: find("#soccer-last-event .scorebug-scroll-viewport"),
    };

    function render(event) {
      const { away, home } = event.teams;
      els.bug.classList.remove("is-loading", "is-hidden");
      els.bug.dataset.sport = event.sport;
      els.bug.dataset.state = event.state;
      els.bug.dataset.preseason = String(event.details.preseason === true);
      global.SportsOverlay.teamTheme.apply(els.bug, event);
      els.bug.setAttribute("aria-label", `${away.name} at ${home.name} ${event.league}${event.details.preseason ? " preseason" : ""} match`);
      setTeam(els.awayMark, els.awayAbbr, els.awayRecord, away);
      setTeam(els.homeMark, els.homeAbbr, els.homeRecord, home);
      const showScore = event.state !== EVENT_STATES.PREGAME;
      els.awayScore.textContent = showScore ? away.score ?? 0 : "";
      els.homeScore.textContent = showScore ? home.score ?? 0 : "";
      hide(els.status); hide(els.detail); hide(els.lastEvent);

      if (event.state === EVENT_STATES.LIVE) {
        const details = event.details;
        els.clock.textContent = details.clock || "—";
        els.period.textContent = details.period || "—";
        els.possession.textContent = `${home.abbreviation} ${percent(details.homePossession)} · ${away.abbreviation} ${percent(details.awayPossession)}`;
        els.shots.textContent = `${home.abbreviation} ${details.homeShotsOnTarget ?? "—"} · ${away.abbreviation} ${details.awayShotsOnTarget ?? "—"}`;
        show(els.detail);
        if (details.lastEvent) {
          show(els.lastEvent);
          global.SportsOverlay.scrolling.render(els.lastEventViewport, els.lastEventText, details.lastEvent);
        }
      } else {
        els.clock.textContent = "";
        els.period.textContent = "";
        els.matchup.textContent = `${away.abbreviation} at ${home.abbreviation}`;
        els.statusText.textContent = statusText(event);
        show(els.status);
      }
      global.SportsOverlay.odds?.render(els.bug, event);
      return event.state;
    }

    function renderNoEvent(message = "No selected soccer match", visible = true) {
      global.SportsOverlay.odds?.clear(els.bug);
      delete els.bug.dataset.preseason;
      els.bug.classList.remove("is-loading");
      els.bug.classList.toggle("is-hidden", !visible);
      if (!visible) return;
      els.clock.textContent = "";
      els.period.textContent = "";
      els.matchup.textContent = "Soccer";
      els.statusText.textContent = message;
      hide(els.detail); hide(els.lastEvent); show(els.status);
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
    if (event.state === EVENT_STATES.FINAL) return global.SportsOverlay.model.formatFinalStatus(event.startTime, "FULL TIME");
    if (event.state === EVENT_STATES.INTERRUPTED) return event.detailedState;
    return formatPregameStart(event.startTime) || event.detailedState;
  }

  function percent(value) { return value === null || value === undefined ? "—" : `${value}%`; }
  function show(element) { element.hidden = false; }
  function hide(element) { element.hidden = true; }

  const layout = Object.freeze({ createLayout });
  global.SportsOverlay.soccerLayout = layout;
  global.SportsOverlay.registry?.registerLayout("soccer", layout);
})(typeof window === "undefined" ? globalThis : window);
