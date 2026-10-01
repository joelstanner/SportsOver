"use strict";

(function initializeTeamNames(global) {
  // Measure the actual name slot after the layout has set scores and visibility.
  // The chosen text is included in the engine's HTML snapshot for every output.
  function render(event, awayLabel, homeLabel) {
    const expand = event.state === "pregame" || event.state === "final";
    for (const [side, label] of [["away", awayLabel], ["home", homeLabel]]) {
      const team = event.teams[side];
      const name = team.name?.trim() || team.abbreviation;
      label.title = name;
      label.textContent = expand ? name : team.abbreviation;
      if (expand && (label.clientWidth === 0 || label.scrollWidth > label.clientWidth)) {
        label.textContent = team.abbreviation;
      }
    }
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.teamNames = Object.freeze({ render });
})(typeof window === "undefined" ? globalThis : window);
