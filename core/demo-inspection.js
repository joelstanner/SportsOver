'use strict';
(function (global) {
  const states = ['live', 'pregame', 'interrupted', 'final'];
  const messages = { 'no-event': 'No selected game · demo', offline: 'Sports data offline · demo', error: 'Provider error · demo' };
  const modes = ['mixed', ...states, ...Object.keys(messages)];
  function fixtures({ registry, sports, mode, now = Date.now() }) {
    return sports.flatMap(sport => (mode === 'mixed' ? states : [mode]).map(state => {
      const event = registry.getDemo(sport, states.includes(state) ? state : 'live');
      if (!event) return null;
      event.id = `inspection:${sport}:${state}`;
      if (states.includes(state)) event.state = state;
      if (state === 'pregame') {
        // Keep upcoming samples useful even after the original fixture dates pass.
        event.startTime = new Date(now + 3600000).toISOString();
        if (event.competitionType !== 'individual') {
          for (const team of Object.values(event.teams)) team.score = null;
        }
      }
      return { event, state, message: messages[state] || '' };
    }).filter(Boolean));
  }
  function create({ registry, catalog, mount, options, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let items = [], index = 0, timer = null, layout = null, currentSport = null;
    let settings, hovered = false;
    const labels = { live: 'Live', pregame: 'Upcoming', interrupted: 'Interrupted', final: 'Final', 'no-event': 'No event', offline: 'Offline', error: 'Provider error' };
    function schedule() {
      clearTimer(timer);
      if (settings.playing && items.length > 1 && !hovered) timer = setTimer(() => step(1), 4000);
    }
    function render() {
      const item = items[index];
      if (!item) return;
      if (currentSport !== item.event.sport) {
        layout?.dispose?.();
        currentSport = item.event.sport;
        layout = registry.getLayout(currentSport).createLayout();
      }
      if (item.message) layout.renderNoEvent(item.message, true);
      else layout.render(item.event);
      mount.dataset.demoInspection = 'true';
      mount.dataset.fixtureState = item.state;
      mount.dataset.sport = currentSport;
      mount.dataset.rotationActive = String(settings.playing && items.length > 1);
      for (const link of mount.querySelectorAll('a[href]')) link.removeAttribute('href');
      mount.querySelector('.demo-mark')?.remove();
      const mark = mount.ownerDocument.createElement('span');
      mark.className = 'demo-mark';
      mark.textContent = 'DEMO';
      mark.setAttribute('aria-label', 'Demo data');
      mount.append(mark);
      schedule();
    }
    function configure(value) {
      if (!modes.includes(value.mode) || (value.sport !== 'all' && !catalog.some(s => s.key === value.sport))) throw Error('Unknown inspection fixture');
      settings = { mode: value.mode, sport: value.sport, playing: value.playing === true, revision: value.revision };
      items = fixtures({ registry, sports: catalog.filter(s => value.sport === 'all' || s.key === value.sport).map(s => s.key), mode: value.mode });
      index = 0;
      render();
    }
    function step(direction) { index = (index + direction + items.length) % items.length; render(); }
    function describe() {
      const item = items[index];
      const entry = value => ({ candidate: { ...value.event, fixtureState: value.state } });
      const gameKey = item ? `${item.event.sport}:${item.event.id}` : null;
      const sport = catalog.find(s => s.key === item?.event.sport);
      const sportLabel = sport ? `${sport.name} · ${sport.league}` : '';
      return { availableEntries: items.map(entry), queue: items.map(entry), automaticEntries: [],
        currentGameKey: gameKey, renderedGameKey: gameKey, rotationTransition: 'quick',
        inspection: { ...settings, index, count: items.length, label: `${sportLabel} · ${labels[item?.state] || ''}` } };
    }
    configure(options);
    return { describe, configure, next: () => step(1), previous: () => step(-1),
      setPlaying(value) { settings.playing = value === true; render(); },
      setHovered(value) { if (hovered !== (value === true)) { hovered = value === true; schedule(); } },
      refresh() {}, override() {}, setLiveMode() {},
    };
  }
  const api = { modes, fixtures, create };
  if (typeof module !== 'undefined') module.exports = api;
  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.demoInspection = api;
})(typeof window === 'undefined' ? globalThis : window);
