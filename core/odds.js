'use strict';
(function initializeOdds(global) {
  const GRACE_MS = 5 * 60 * 1000;
  const NEAR_EVEN_LIMIT = 120;
  const CLOSE_SPREAD_LIMITS = Object.freeze({ football: 3, 'college-football': 3, basketball: 3, 'college-basketball': 3, hockey: 0.5, soccer: 0.5 });
  function isNearEven(value) {
    return Number.isFinite(value) && Math.abs(value) >= 100 && Math.abs(value) <= NEAR_EVEN_LIMIT;
  }
  function isCloseSpread(sport, value) {
    const limit = CLOSE_SPREAD_LIMITS[sport];
    return Number.isFinite(limit) && Number.isFinite(value) && Math.abs(value) <= limit;
  }
  const signed = value => `${value > 0 ? '+' : ''}${value}`;
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
            const price = market === 'moneyline' ? value : odds.spread.prices?.[live ? 'live' : 'pregame']?.[side];
            const line = value === 0 && market === 'spread' ? 'PK' : signed(value);
            const priceText = Number.isFinite(price) ? signed(price) : '';
            const prefix = `${team} `;
            const lineText = market === 'spread' ? line : '';
            const pricePrefix = market === 'spread' && priceText ? ' (' : '';
            const suffix = market === 'spread' && priceText ? ')' : '';
            return [{ side, price, prefix, lineText, pricePrefix, priceText, suffix, closeSpread: market === 'spread' && isCloseSpread(event.sport, value), nearEven: false, text: `${prefix}${lineText}${pricePrefix}${priceText}${suffix}` }];
          });
          // Compare the two teams' outright win odds in the same visible market.
          // Spread prices describe a handicap bet's payout, not team parity.
          const teams = values.filter(value => value.side !== 'draw');
          if (market === 'moneyline' && teams.length === 2 && teams.every(value => isNearEven(value.price))) {
            teams.forEach(value => { value.nearEven = true; });
          }
          if (values.length) result.push({ label: `${live ? 'LIVE ' : begun ? 'PRE ' : ''}${label}`, text: values.map(value => value.text).join(' · '), values });
        }
      }
      return result;
    };
  }
  const rows = createTracker();
  const displayEnabled = () => global.SportsOverlay.config?.loadConfig()?.showBettingInfo !== false;
  const timers = new WeakMap();
  function clear(mount) {
    clearTimeout(timers.get(mount));
    timers.delete(mount);
    mount.querySelector('.sports-odds')?.remove();
  }
  function render(mount, event, tracker = rows, isEnabled = displayEnabled) {
    clear(mount);
    const values = tracker(event);
    if (values.length) {
      const section = mount.ownerDocument.createElement('section');
      section.className = 'sports-odds';
      const enabled = isEnabled();
      section.setAttribute('aria-label', enabled ? 'Game odds' : 'Betting information hidden');
      if (!enabled) {
        section.classList.add('sports-odds-hidden');
        const text = mount.ownerDocument.createElement('strong');
        text.textContent = 'Betting Info: Hidden';
        section.append(text);
      }
      for (const value of enabled ? values : []) {
        const item = mount.ownerDocument.createElement('div');
        const label = mount.ownerDocument.createElement('span');
        const text = mount.ownerDocument.createElement('strong');
        label.className = 'sports-odds-label';
        label.textContent = value.label;
        value.values.forEach((entry, index) => {
          if (index) text.append(' · ');
          text.append(entry.prefix);
          if (entry.lineText) {
            const line = mount.ownerDocument.createElement('span');
            line.className = `sports-odds-line${entry.closeSpread ? ' is-near-even' : ''}`;
            line.textContent = entry.lineText;
            if (entry.closeSpread) line.title = `Close matchup: point spread of ${CLOSE_SPREAD_LIMITS[event.sport]} or less`;
            text.append(line);
          }
          text.append(entry.pricePrefix);
          if (entry.priceText) {
            const price = mount.ownerDocument.createElement('span');
            price.className = `sports-odds-price${entry.nearEven ? ' is-near-even' : ''}`;
            price.textContent = entry.priceText;
            if (entry.nearEven) price.title = 'Evenly matched teams: both moneylines within ±120';
            text.append(price);
          }
          text.append(entry.suffix);
        });
        item.append(label, text);
        section.append(item);
      }
      mount.append(section);
      // Retire pregame lines even between provider polls or during a fetch failure.
      timers.set(mount, setTimeout(() => { if (mount.isConnected) render(mount, event, tracker, isEnabled); }, 1000));
    }
  }
  global.SportsOverlay.odds = Object.freeze({ createTracker, render, clear, isNearEven, isCloseSpread, GRACE_MS, NEAR_EVEN_LIMIT, CLOSE_SPREAD_LIMITS });
})(typeof window === 'undefined' ? globalThis : window);
