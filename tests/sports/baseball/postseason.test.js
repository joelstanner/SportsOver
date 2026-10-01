const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
require('../../../core/event-model.js');
require('../../../sports/baseball/providers/mlb.js');
const { withSchedule } = globalThis.SportsOverlay.mlb;
const event = (state = 'live') => ({ id: '10', state, details: {} });
const game = (extra = {}) => ({ gamePk: 10, gameType: 'F', seriesGameNumber: 1, gamesInSeries: 3,
  seriesDescription: 'AL Wild Card Series', status: { abstractGameState: 'Live' },
  seriesStatus: { wins: 0, losses: 0, result: 'Series tied 0-0' }, ...extra });

test('postseason rounds normalize without treating ordinary series or doubleheaders as playoffs', () => {
  for (const [type, round, length] of [['F','WILD CARD',3],['D','DIVISION SERIES',5],['L','CHAMPIONSHIP',7],['W','WORLD SERIES',7]]) {
    const value = withSchedule(event(), game({ gameType: type, gamesInSeries: length }));
    assert.match(value.details.series.identity, new RegExp(round));
    assert.match(value.details.series.identity, new RegExp(`GAME 1 · BEST OF ${length}`));
  }
  const original = event();
  assert.equal(withSchedule(original, game({ gameType: 'R' })), original);
  assert.equal(withSchedule(original, game({ gamePk: 11 })), original);
  assert.equal(withSchedule(original), original);
  const invalid = withSchedule(original, game({ seriesGameNumber: null, gamesInSeries: '3', gameNumber: 2 }));
  assert.equal(invalid.details.series.identity, 'AL WILD CARD');
});

test('standing freshness follows completed series games and final schedule state', () => {
  assert.equal(withSchedule(event(), game()).details.series.standing, 'SERIES TIED 0-0');
  assert.equal(withSchedule(event('final'), game()).details.series.standing, '');
  const final = game({ status: { abstractGameState: 'Final' }, seriesStatus: { wins: 1, losses: 0, result: 'DET leads 1-0' } });
  assert.equal(withSchedule(event('final'), final).details.series.standing, 'DET LEADS 1-0');
  assert.equal(withSchedule(event(), final).details.series.standing, '');
  assert.equal(withSchedule(event('final'), game({ ...final, seriesStatus: { wins: 2, losses: 0, result: 'DET wins 2-0' } })).details.series.standing, '');
  assert.equal(withSchedule(event(), game({ seriesStatus: { wins: 0, losses: 0, result: '<bad>' } })).details.series.standing, '');
});

function layoutFixture() {
  const elements = new Map(), timers = new Map(); let timerId = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', isConnected: true, dataset: {},
      clientWidth: 438, scrollWidth: 300, style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {} });
    return elements.get(id);
  }
  const root = { querySelector: element, querySelectorAll: () => [element('dot1'), element('dot2')] };
  const scope = { SportsOverlay: { model: { ...globalThis.SportsOverlay.model, formatGameTime:()=> '1 PM' },
    teamTheme: { apply() {} }, scrolling: { render(view, node, text) { node.textContent = text; } } },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id), requestAnimationFrame: fn => fn(), console };
  scope.window = scope;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../../sports/baseball/layout.js'),'utf8'), scope);
  const layout = scope.SportsOverlay.baseballLayout.createLayout(root);
  const current = { id:'10', sport:'baseball', league:'MLB', state:'live', teams:{away:{name:'Away',abbreviation:'AWY'},home:{name:'Home',abbreviation:'HME'}},
    details:{inningNumber:6,inningState:'Top',balls:2,strikes:1,outs:1,bases:{},pitcher:{name:'Pitcher',pitchCount:60},batter:{name:'Batter',hits:1,atBats:2},lastPlay:'Single',series:{identity:'AL WILD CARD · GAME 1 · BEST OF 3',standing:'SERIES TIED 0–0'}} };
  function tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); }
  return {layout,current,element,timers,tick};
}

test('eight-second phases survive score polling and clean up on game/sport changes', () => {
  const f = layoutFixture(); f.layout.render(f.current);
  assert.equal(f.element('#series-details').hidden, false);
  assert.equal([...f.timers.values()][0].ms, 8000);
  const first = [...f.timers.keys()][0]; f.layout.render(f.current);
  assert.equal([...f.timers.keys()][0], first);
  f.tick(); assert.equal(f.element('#series-text').textContent, 'SERIES TIED 0–0');
  f.layout.render(f.current); f.tick();
  assert.equal(f.element('#series-details').hidden, true);
  assert.equal(f.element('#player-details').hidden, false);
  f.layout.render({...f.current, id:'11'});
  assert.match(f.element('#series-text').textContent, /BEST OF 3/);
  f.layout.dispose(); assert.equal(f.timers.size, 0);
});

test('pregame/final/interrupted and inning breaks omit players; regular games retain them', () => {
  for (const state of ['pregame','final','interrupted']) {
    const f=layoutFixture(); f.layout.render({...f.current,state}); f.tick(); f.tick();
    assert.equal(f.element('#player-details').hidden,true);
    f.layout.renderNoEvent(); assert.equal(f.timers.size,0);
    assert.equal(f.element('#series-details').hidden,true);
  }
  const f=layoutFixture(); f.current.details.inningState='Middle'; f.layout.render(f.current); f.tick(); f.tick();
  assert.equal(f.element('#player-details').hidden,true);
  delete f.current.details.series; f.current.details.inningState='Top'; f.layout.render(f.current);
  assert.equal(f.element('#series-details').hidden,true);
  assert.equal(f.element('#player-details').hidden,false);
  assert.equal(f.timers.size,0);
});
