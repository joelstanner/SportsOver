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
          <a id="hockey-away-mark" class="hockey-mark"><img alt="" hidden><span>AWY</span></a>
          <div class="team-name-slot"><div class="hockey-team-heading"><a class="team-name-label" id="hockey-away-abbr">AWY</a><span id="hockey-away-pp" class="hockey-pp" hidden>PP</span></div><span id="hockey-away-record" class="hockey-record"></span></div>
          <strong id="hockey-away-score" class="hockey-score">—</strong>
        </div>
        <div class="hockey-center"><strong id="hockey-clock">—</strong><span id="hockey-period">—</span></div>
        <div class="hockey-team hockey-team--home">
          <strong id="hockey-home-score" class="hockey-score">—</strong>
          <div class="team-name-slot"><div class="hockey-team-heading"><a class="team-name-label" id="hockey-home-abbr">HME</a><span id="hockey-home-pp" class="hockey-pp" hidden>PP</span></div><span id="hockey-home-record" class="hockey-record"></span></div>
          <a id="hockey-home-mark" class="hockey-mark"><img alt="" hidden><span>HME</span></a>
        </div>
      </section>
      <section id="hockey-status" class="hockey-status" hidden><span id="hockey-matchup"></span><strong id="hockey-status-text"></strong></section>
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
      awayPp: find("#hockey-away-pp"), homePp: find("#hockey-home-pp"),
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
      hide(els.status); hide(els.detail); hide(els.lastPlay);
      clearPowerPlay();

      if (event.state === EVENT_STATES.LIVE) {
        const details = event.details;
        if (details.powerPlayActive === true) {
          for (const [team, indicator] of [[away, els.awayPp], [home, els.homePp]]) {
            if (team.id !== details.powerPlayTeamId) continue;
            indicator.title = `${team.name} power play`;
            indicator.setAttribute("aria-label", indicator.title);
            show(indicator);
          }
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
      global.SportsOverlay.teamNames.render(event, els.awayAbbr, els.homeAbbr, els.awayMark, els.homeMark);
      if (event.state === EVENT_STATES.PREGAME) {
        global.SportsOverlay.countdown?.render(els.statusText, event.startTime, { fallback: event.detailedState });
      } else global.SportsOverlay.countdown?.clear(els.statusText);
      return event.state;
    }

    function renderNoEvent(message = "No selected hockey game", visible = true) {
      global.SportsOverlay.countdown?.clear(els.statusText);
      global.SportsOverlay.teamNames.clearLinks(els.awayAbbr, els.homeAbbr, els.awayMark, els.homeMark);
      global.SportsOverlay.odds?.clear(els.bug);
      delete els.bug.dataset.preseason;
      clearPowerPlay();
      els.bug.classList.remove("is-loading");
      els.bug.classList.toggle("is-hidden", !visible);
      if (!visible) return;
      els.clock.textContent = "";
      els.period.textContent = "";
      els.matchup.textContent = "Hockey";
      els.statusText.textContent = message;
      hide(els.detail); hide(els.lastPlay); show(els.status);
    }

    function clearPowerPlay() {
      for (const indicator of [els.awayPp, els.homePp]) {
        hide(indicator);
        indicator.removeAttribute("title");
        indicator.removeAttribute("aria-label");
      }
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
