'use strict';
(function initializeOdds(global) {
  const GRACE_MS = 5 * 60 * 1000;
  function createTracker() {
    const starts = new Map();
    const seenPregame = new Set();
    return function rows(event, now = Date.now()) {
      const key = `${event.sport}:${event.id}`;
      if (event.state === 'final') return [];
      if (event.state === 'pregame' && !starts.has(key)) seenPregame.add(key);
      const inPlay = event.state === 'live' || (event.state === 'interrupted' && (event.details.inPlay === true || starts.has(key) || Number(event.teams.away.score) > 0 || Number(event.teams.home.score) > 0));
      if (inPlay && !starts.has(key)) {
        const scheduled = Date.parse(event.startTime);
        starts.set(key, seenPregame.has(key) ? now : Number.isFinite(scheduled) ? Math.min(now, scheduled) : now);
      }
      const begun = starts.has(key);
      const grace = !begun || now < starts.get(key) + GRACE_MS;
      const odds = event.details.odds;
      if (!odds) return [];
      const result = [];
      for (const [market, label] of [['spread', event.sport === 'hockey' ? 'PUCK LINE' : 'SPREAD'], ['moneyline', 'ML']]) {
        for (const live of [false, true]) {
          const values = ['away', 'home', ...(market === 'moneyline' ? ['draw'] : [])].flatMap(side => {
            const value = odds[market]?.[live ? 'live' : 'pregame']?.[side];
            const hasLive = begun && Number.isFinite(odds[market]?.live?.[side]);
            if (!Number.isFinite(value) || (live ? !begun : !grace || hasLive)) return [];
            const team = side === 'draw' ? 'DRAW' : event.teams[side].abbreviation;
            return [`${team} ${value > 0 ? '+' : ''}${value === 0 && market === 'spread' ? 'PK' : value}`];
          });
          if (values.length) result.push({ label: `${live ? 'LIVE ' : begun ? 'PRE ' : ''}${label}`, text: values.join(' · ') });
        }
      }
      return result;
    };
  }
  const rows = createTracker();
  const timers = new WeakMap();
  function clear(mount) {
    clearTimeout(timers.get(mount));
    mount.querySelector('.sports-odds')?.remove();
  }
  function render(mount, event) {
    clear(mount);
    const values = rows(event);
    if (values.length) {
      const section = mount.ownerDocument.createElement('section');
      section.className = 'sports-odds';
      section.setAttribute('aria-label', 'Game odds');
      for (const value of values) {
        const item = mount.ownerDocument.createElement('div');
        const label = mount.ownerDocument.createElement('span');
        const text = mount.ownerDocument.createElement('strong');
        label.textContent = value.label;
        text.textContent = value.text;
        item.append(label, text);
        section.append(item);
      }
      mount.append(section);
      // Retire pregame lines even between provider polls or during a fetch failure.
      timers.set(mount, setTimeout(() => { if (mount.isConnected) render(mount, event); }, 1000));
    }
  }
  global.SportsOverlay.odds = Object.freeze({ createTracker, render, clear, GRACE_MS });
})(typeof window === 'undefined' ? globalThis : window);
