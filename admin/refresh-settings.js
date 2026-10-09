"use strict";

(function initializeRefreshSettings(global) {
  function create({ config, onChange }) {
    const api = global.SportsOverlay.config;
    const states = { live: "Live", pregame: "Upcoming", final: "Finished", idle: "No games found" };
    const fields = document.querySelector("#provider-refresh-fields");
    const exceptions = document.querySelector("#refresh-exception-fields");
    const summary = document.querySelector("#refresh-exceptions-summary");
    const sportPicker = document.querySelector("#refresh-sport");
    const statePicker = document.querySelector("#refresh-state");
    const add = document.querySelector("#add-refresh-exception");
    const sharedFields = new Map(), customFields = new Map(), sportRows = new Map();
    const duration = seconds => seconds % 60 === 0
      ? `${seconds / 60} ${seconds === 60 ? "minute" : "minutes"}` : `${seconds} seconds`;
    const sportName = sport => ["disc-golf", "chess"].includes(sport.key) ? sport.name : sport.league;

    function commit(state, seconds, sport = null) {
      if (!api.setRefreshInterval(config(), state, seconds, sport)) return;
      render();
      onChange();
    }

    function makeField(state, sport = null) {
      const label = document.createElement("label");
      label.className = "field";
      const title = document.createElement("span");
      title.textContent = `${states[state]} (seconds)`;
      const input = document.createElement("input");
      input.type = "number"; input.min = "5"; input.max = "3600"; input.step = "1"; input.required = true;
      input.dataset.state = state;
      if (sport) input.dataset.sport = sport;
      const hint = document.createElement("small");
      hint.id = `refresh-hint-${sport || "shared"}-${state}`;
      input.setAttribute("aria-describedby", hint.id);
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (input.reportValidity()) input.blur();
        }
      });
      input.addEventListener("change", () => {
        if (input.reportValidity()) commit(state, Number(input.value), sport);
      });
      label.append(title, input, hint);
      return { label, input, hint };
    }

    for (const state of Object.keys(states)) {
      const field = makeField(state);
      sharedFields.set(state, field);
      fields.append(field.label);
      statePicker.append(new Option(states[state], state));
    }
    for (const sport of api.SPORT_CATALOG) sportPicker.append(new Option(`${sport.name} · ${sport.league}`, sport.key));
    function updateAdd() {
      const overrides = config().providerRefreshPolicy.overrides[sportPicker.value] || [];
      for (const option of statePicker.options) option.disabled = overrides.includes(option.value);
      if (!statePicker.selectedOptions.length || statePicker.selectedOptions[0].disabled) statePicker.value = [...statePicker.options].find(option => !option.disabled)?.value || "";
      statePicker.disabled = overrides.length === Object.keys(states).length;
      add.disabled = !statePicker.value;
    }
    sportPicker.addEventListener("change", updateAdd);
    statePicker.addEventListener("change", updateAdd);
    add.addEventListener("click", () => {
      const sport = sportPicker.value, state = statePicker.value;
      if (!state || config().providerRefreshPolicy.overrides[sport]?.includes(state)) return;
      commit(state, config().providerRefreshSeconds[sport][state], sport);
      const input = customFields.get(`${sport}:${state}`).input;
      input.focus(); input.select();
    });
    document.querySelector("#reset-refresh-intervals").addEventListener("click", () => {
      const defaults = api.normalizeConfig(api.DEFAULT_CONFIG);
      for (const key of ["providerRefreshSeconds", "providerRefreshPolicy"]) config()[key] = defaults[key];
      render();
      onChange();
    });

    function render() {
      const current = config(), { shared, overrides } = current.providerRefreshPolicy;
      for (const [state, field] of sharedFields) {
        if (document.activeElement !== field.input) field.input.value = shared[state];
        const count = api.SPORT_CATALOG.filter(({ key }) => !overrides[key]?.includes(state)).length;
        field.hint.textContent = `${duration(shared[state])} · ${count} ${count === 1 ? "sport" : "sports"}`;
      }
      const active = new Set();
      const names = [];
      for (const sport of api.SPORT_CATALOG) {
        if (!overrides[sport.key]?.length) continue;
        names.push(sportName(sport));
        let row = sportRows.get(sport.key);
        if (!row) {
          row = document.createElement("fieldset");
          row.className = "refresh-sport-row";
          const legend = document.createElement("legend");
          legend.textContent = sportName(sport);
          row.append(legend);
          sportRows.set(sport.key, row);
          exceptions.append(row);
        }
        for (const state of Object.keys(states)) {
          if (!overrides[sport.key].includes(state)) continue;
          const key = `${sport.key}:${state}`;
          active.add(key);
          let field = customFields.get(key);
          if (!field) {
            field = makeField(state, sport.key);
            field.wrapper = document.createElement("div");
            field.wrapper.className = "refresh-custom";
            const reset = document.createElement("button");
            reset.type = "button"; reset.className = "button button--quiet";
            reset.textContent = "Use shared interval";
            reset.setAttribute("aria-label", `Use shared interval for ${sportName(sport)} ${states[state].toLowerCase()}`);
            reset.addEventListener("click", () => {
              // Move focus before removing the custom field and its button.
              sharedFields.get(state).input.focus();
              commit(state, null, sport.key);
            });
            field.wrapper.append(field.label, reset);
            row.append(field.wrapper);
            customFields.set(key, field);
          }
          if (document.activeElement !== field.input) field.input.value = current.providerRefreshSeconds[sport.key][state];
          field.hint.textContent = `${duration(current.providerRefreshSeconds[sport.key][state])} · Shared: ${duration(shared[state])}`;
        }
      }
      for (const [key, field] of customFields) {
        if (!active.has(key)) { field.wrapper.remove(); customFields.delete(key); }
      }
      for (const [sport, row] of sportRows) {
        if (!overrides[sport]?.length) { row.remove(); sportRows.delete(sport); }
      }
      summary.textContent = names.length ? `Custom timings: ${names.join(", ")}.` : "All sports use the shared intervals.";
      updateAdd();
    }
    return { render };
  }
  global.SportsOverlay.refreshSettings = { create };
})(window);
