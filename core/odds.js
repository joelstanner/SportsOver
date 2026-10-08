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
  const displayConfig = () => global.SportsOverlay.config?.loadConfig() || {};
  const HIDDEN_TEXT = 'Betting Info: Hidden';
  function replacementItems(event, config, values) {
    const mode = config.bettingReplacement || 'hidden';
    const stats = (Array.isArray(event.details.playerStats) ? event.details.playerStats : []).filter(stat => stat?.key && typeof stat.text === 'string');
    const details = (Array.isArray(event.details.gameDetails) ? event.details.gameDetails : []).filter(text => typeof text === 'string' && text);
    const custom = typeof config.bettingReplacementText === 'string' ? config.bettingReplacementText.trim() : '';
    if (mode === 'blank') return [];
    if (mode === 'custom') return custom ? [{ key: 'custom', text: custom }] : [];
    if (mode === 'player-stats') return stats.length ? stats : [{ key: 'hidden', text: HIDDEN_TEXT }];
    if (mode === 'game-details') return details.length ? details.map(text => ({ key: text, text })) : [{ key: 'hidden', text: HIDDEN_TEXT }];
    if (mode === 'scrolling') {
      const sources = config.bettingMixSources || ['betting', 'player-stats', 'custom', 'game-details'];
      const items = [];
      if (config.showBettingInfo !== false) items.push(...values.map(value => ({ key: value.label, text: `${value.label} ${value.text}` })));
      if (sources.includes('player-stats')) items.push(...stats);
      if (sources.includes('custom') && custom) items.push({ key: 'custom', text: custom });
      if (sources.includes('game-details')) items.push(...details.map(text => ({ key: text, text })));
      return items.length || !sources.length || config.showBettingInfo !== false ? items : [{ key: 'hidden', text: HIDDEN_TEXT }];
    }
    return [{ key: 'hidden', text: HIDDEN_TEXT }];
  }
  const choices = new WeakMap();
  function replacementText(mount, event, config, values) {
    const mode = config.bettingReplacement || 'hidden';
    const items = replacementItems(event, config, values);
    if (!items.length) return '';
    const identity = `${event.sport}:${event.id}:${mode}`;
    let state = choices.get(mount);
    if (state?.identity !== identity) { state = { identity, started: Date.now(), changed: -Infinity, key: null }; choices.set(mount, state); }
    if (mode === 'scrolling') {
      // Keep a random sample stable throughout the loop and provider refreshes.
      // Changing values updates those stats without constantly restarting it.
      const pool = items.filter(item => event.details.playerStats?.some(stat => stat.key === item.key));
      const signature = pool.map(item => item.key).join('|');
      if (state.pool !== signature) {
        const remaining = [...pool]; state.sample = [];
        while (remaining.length && state.sample.length < 5) state.sample.push(remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0].key);
        state.pool = signature;
      }
      const other = items.filter(item => !pool.includes(item));
      return other.concat((state.sample || []).map(key => pool.find(item => item.key === key)).filter(Boolean)).map(item => item.text).join('   •   ');
    }
    if (mode === 'player-stats') {
      if (Date.now() - state.changed >= 10000 || !items.some(item => item.key === state.key)) {
        const candidates = items.length > 1 ? items.filter(item => item.key !== state.key) : items;
        state.key = candidates[Math.floor(Math.random() * candidates.length)].key;
        state.changed = Date.now();
      }
      return items.find(item => item.key === state.key).text;
    }
    if (mode === 'game-details') return items[Math.floor((Date.now() - state.started) / 10000) % items.length].text;
    return items[0].text;
  }
  const timers = new WeakMap();
  function clear(mount) {
    clearTimeout(timers.get(mount));
    timers.delete(mount);
    mount.querySelector('.sports-odds')?.remove();
    choices.delete(mount);
  }
  function render(mount, event, tracker = rows, getConfig = displayConfig) {
    clearTimeout(timers.get(mount));
    timers.delete(mount);
    const values = tracker(event);
    const config = { ...getConfig() };
    const alternate = config.showAlternateContent === true;
    if (!alternate) config.bettingReplacement = 'hidden';
    const mode = config.bettingReplacement || 'hidden';
    let enabled = config.showBettingInfo !== false && !alternate;
    if (alternate && config.showBettingInfo !== false && mode !== 'scrolling') {
      const items = replacementItems(event, config, values).filter(item => item.key !== 'hidden');
      if (!items.length) enabled = true;
      else if (values.length) {
        config.bettingReplacement = 'scrolling';
        config.bettingMixSources = [mode];
      }
    }
    const scrolling = config.bettingReplacement === 'scrolling';
    if (values.length || alternate) {
      const section = mount.ownerDocument.createElement('section');
      section.className = 'sports-odds';
      section.setAttribute('aria-label', enabled ? 'Game odds' : 'Game information');
      if (!enabled) {
        section.classList.add('sports-odds-hidden');
        const text = mount.ownerDocument.createElement('strong');
        text.textContent = replacementText(mount, event, config, values);
        if (text.textContent) {
          if (scrolling) {
            section.classList.add('sports-odds-scrolling');
            section.tabIndex = 0;
            const track = mount.ownerDocument.createElement('div');
            track.className = 'sports-odds-ticker';
            track.style.setProperty('--odds-scroll-duration', `${Math.max(20, text.textContent.length / 5)}s`);
            const duplicate = text.cloneNode(true);
            duplicate.setAttribute('aria-hidden', 'true');
            track.append(text, duplicate);
            section.append(track);
          } else {
            if (text.textContent !== HIDDEN_TEXT) text.title = text.textContent;
            section.append(text);
          }
        }
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
      const previous = mount.querySelector('.sports-odds');
      if (!section.childNodes.length) previous?.remove();
      else if (scrolling && previous?.className === section.className) {
        // Updating the existing ticker preserves its running CSS animation.
        const track = previous.firstElementChild;
        for (let i = 0; i < 2; i++) track.children[i].textContent = section.firstElementChild.children[i].textContent;
        track.style.cssText = section.firstElementChild.style.cssText;
      } else if (!previous?.isEqualNode(section)) {
        if (previous) previous.replaceWith(section); else mount.append(section);
      }
      // Retire pregame lines even between provider polls or during a fetch failure.
      timers.set(mount, setTimeout(() => { if (mount.isConnected) render(mount, event, tracker, getConfig); }, 1000));
    } else mount.querySelector('.sports-odds')?.remove();
  }
  global.SportsOverlay.odds = Object.freeze({ createTracker, render, clear, replacementItems, isNearEven, isCloseSpread, GRACE_MS, NEAR_EVEN_LIMIT, CLOSE_SPREAD_LIMITS });
})(typeof window === 'undefined' ? globalThis : window);
