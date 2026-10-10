"use strict";

(function initializeTeamNames(global) {
  function displayName(team, sport) {
    const name = team.name?.trim() || team.abbreviation;
    return sport === "basketball" && /^Oklahoma City Thunder$/i.test(name)
      ? "Oklahoma City Plunder" : name;
  }

  // Measure the actual name slot after the layout has set scores and visibility.
  // The chosen text is included in the engine's HTML snapshot for every output.
  function render(event, awayLabel, homeLabel, awayMark, homeMark) {
    const href = global.SportsOverlay.model.gameUrl(event.details?.gameUrl);
    for (const [label, mark, team] of [[awayLabel, awayMark, event.teams.away], [homeLabel, homeMark, event.teams.home]]) {
      const rank = ["college-football", "college-basketball"].includes(event.sport)
        ? global.SportsOverlay.model.espnTeamRank(team) : null;
      const rankedName = `${rank ? `#${rank} ` : ""}${displayName(team, event.sport)}`;
      if (mark) {
        let badge = mark.querySelector(".team-rank");
        if (rank) {
          if (!badge) {
            badge = mark.ownerDocument.createElement("span");
            badge.className = "team-rank";
            mark.append(badge);
          }
          badge.textContent = rank;
          badge.setAttribute("aria-label", `Rank ${rank}`);
        } else badge?.remove();
        mark.title = rankedName;
      }
      for (const element of [label, mark].filter(Boolean)) {
        clearLinks(element);
        if (href) {
          element.setAttribute("href", href);
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noopener noreferrer");
          element.setAttribute("aria-label", `${rankedName} · Open game on ${event.sport === "baseball" ? "MLB" : "ESPN"}`);
          element.classList.add("team-game-link");
        }
      }
    }
    const hasHalftime = ["football", "college-football", "basketball", "college-basketball", "soccer"].includes(event.sport);
    const halftime = hasHalftime && /\bhalf[\s-]?time\b|^HT$/i.test(event.detailedState || "");
    const intermission = event.sport === "hockey" && event.state === "interrupted"
      && /\bintermission\b|\bend of (?:\d+(?:st|nd|rd|th)\s+)?period\b/i.test(event.detailedState || "");
    awayLabel.closest("#sports-overlay").dataset.halftime = String(halftime && ["live", "interrupted"].includes(event.state));
    const expand = event.state === "pregame" || event.state === "final" || halftime || intermission;
    awayLabel.closest("#sports-overlay").dataset.teamNames = expand ? "full" : "short";
    for (const [side, label] of [["away", awayLabel], ["home", homeLabel]]) {
      const team = event.teams[side];
      const name = displayName(team, event.sport);
      // Clear the previous matchup's adjustments before measuring this name.
      label.style.removeProperty("font-size");
      label.style.removeProperty("letter-spacing");
      label.title = href ? `${name} · Open game on ${event.sport === "baseball" ? "MLB" : "ESPN"}` : name;
      label.textContent = expand ? name : team.abbreviation;
      if (expand && label.clientWidth > 0 && label.scrollWidth > label.clientWidth) {
        const fontSize = parseFloat(global.getComputedStyle(label).fontSize);
        // Full names need less tracking than short abbreviations. Give longer
        // names a modest size adjustment before falling back to initials.
        label.style.letterSpacing = "0";
        for (const scale of [0.95, 0.9, 0.85, 0.8]) {
          if (label.scrollWidth <= label.clientWidth) break;
          label.style.fontSize = `${fontSize * scale}px`;
        }
      }
      if (expand && (label.clientWidth === 0 || label.scrollWidth > label.clientWidth)) {
        label.textContent = team.abbreviation;
        label.style.removeProperty("font-size");
        label.style.removeProperty("letter-spacing");
      }
    }
  }

  function clearLinks(...elements) {
    for (const element of elements.filter(Boolean)) {
      for (const attribute of ["href", "target", "rel", "aria-label"]) element.removeAttribute(attribute);
      element.classList.remove("team-game-link");
    }
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.teamNames = Object.freeze({ render, clearLinks, displayName });
})(typeof window === "undefined" ? globalThis : window);
