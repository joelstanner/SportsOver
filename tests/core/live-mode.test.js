require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../core/live-mode.js');
const { create } = globalThis.SportsOverlay.liveMode;
const entry = (id, state = 'live', sport = 'baseball') => ({ candidate: { id, state, sport } });
const ids = entries => entries.map(item => item.candidate.id);

test('Live mode starts only with a live game from the rotation, including games between periods', () => {
  const mode = create();
  assert.equal(mode.setActive(true, [entry('next', 'pregame'), entry('done', 'final')]), false);
  const halftime = entry('half', 'interrupted');
  assert.equal(mode.setActive(true, [halftime]), true);
  assert.deepEqual(ids(mode.update({ rotation: [halftime], enabledSports: ['baseball'] })), ['half']);
});

test('individual round breaks cannot activate Live mode and leave its queue until play resumes', () => {
  for (const sport of ['disc-golf', 'chess', 'future-individual-sport']) {
    const mode = create();
    const tournament = state => ({candidate:{id:'tournament',sport,state,competitionType:'individual'}});
    const paused = tournament('interrupted'), live = tournament('live');
    assert.equal(mode.setActive(true, [paused]), false);
    assert.equal(mode.setActive(true, [live]), true);
    const input = {enabledSports:[sport],retentionMinutes:20};
    assert.equal(mode.update({...input,rotation:[live]}).length, 1);
    mode.observe(paused);
    assert.deepEqual(mode.update({...input,rotation:[paused],available:[paused]}), []);
    assert.deepEqual(mode.update({...input,rotation:[],available:[]}), []);
    assert.equal(mode.isActive(), true);
    assert.equal(mode.update({...input,rotation:[live],available:[live]}).length, 1);
    assert.equal(mode.update({...input,rotation:[tournament('final')]}).length, 1, 'actual finals retain the configured grace period');
    mode.setActive(false);
    assert.deepEqual(mode.update({rotation:[paused]}), [paused], 'normal rotation keeps the tournament');
  }
});

test('only rotation games can enter, while previously admitted live games survive suggestion changes', () => {
  const mode = create();
  const live = entry('live'), next = entry('next', 'pregame'), outside = entry('outside');
  mode.setActive(true, [live, next]);
  const input = { rotation: [live, next], available: [live, next, outside], enabledSports: ['baseball'] };
  assert.deepEqual(ids(mode.update(input)), ['live']);
  assert.deepEqual(ids(mode.update({ ...input, rotation: [next] })), ['live']);
  next.candidate.state = 'live';
  assert.deepEqual(ids(mode.update({ ...input, rotation: [next] })), ['live', 'next']);
});

test('finals retain the first detected finish time and expire exactly after the configured interval', () => {
  let time = 100;
  const mode = create({ now: () => time });
  const live = entry('game'), final = entry('game', 'final');
  mode.setActive(true, [live]);
  mode.update({ rotation: [live], enabledSports: ['baseball'] });
  time = 200;
  const input = { rotation: [], available: [final], enabledSports: ['baseball'], retentionMinutes: 20 };
  assert.equal(mode.update(input)[0].liveModeFinishedAt, 200);
  assert.equal(mode.nextExpiry(), 1_200_200);
  time = 1_200_199;
  assert.equal(mode.update(input)[0].liveModeFinishedAt, 200);
  time++;
  assert.deepEqual(mode.update(input), []);
  assert.equal(mode.isActive(), true, 'the latch stays on when its queue empties');
  assert.deepEqual(mode.update({ ...input, rotation: [live], available: [live] }), [], 'stale scoreboards cannot re-admit an expired final');
});

test('polled final status overrides a stale scoreboard, and missing discoveries retain known finals', () => {
  let time = 0;
  const mode = create({ now: () => time });
  const live = entry('game');
  const input = { rotation: [live], available: [live], enabledSports: ['baseball'] };
  mode.setActive(true, [live]); mode.update(input);
  time = 10;
  mode.observe(entry('game', 'final'));
  assert.equal(mode.update(input)[0].candidate.state, 'final');
  time = 500;
  mode.observe(entry('game', 'final'));
  assert.equal(mode.update({ ...input, available: [], rotation: [] })[0].liveModeFinishedAt, 10);
});

test('retention changes apply from the original finish time, and zero removes immediately', () => {
  let time = 0;
  const mode = create({ now: () => time });
  const live = entry('game');
  const input = { rotation: [live], enabledSports: ['baseball'] };
  mode.setActive(true, [live]); mode.update(input); mode.observe(entry('game', 'final'));
  time = 60_000;
  assert.equal(mode.update({ ...input, retentionMinutes: 2 }).length, 1);
  assert.equal(mode.update({ ...input, retentionMinutes: 1 }).length, 0);
  assert.equal(mode.update({ ...input, retentionMinutes: 0 }).length, 0);
});

test('explicit exclusions remove retained finals; undo can restore them, and disabled sports are cleared', () => {
  const mode = create({ now: () => 10 });
  const live = entry('game');
  const input = { rotation: [live], enabledSports: ['baseball'] };
  mode.setActive(true, [live]); mode.update(input); mode.observe(entry('game', 'final'));
  assert.deepEqual(mode.update({ ...input, excludedKeys: ['baseball:game'] }), []);
  assert.equal(mode.update(input).length, 1);
  assert.deepEqual(mode.update({ ...input, enabledSports: [] }), []);
  assert.deepEqual(mode.update({ ...input, rotation: [], available: [entry('game', 'final')] }), []);
});

test('turning off clears the session and leaves the underlying rotation unchanged', () => {
  const mode = create(), live = entry('live'), next = entry('next', 'pregame');
  const rotation = [next, live];
  mode.setActive(true, rotation);
  assert.deepEqual(ids(mode.update({ rotation, enabledSports: ['baseball'] })), ['live']);
  mode.setActive(false);
  assert.equal(mode.update({ rotation }), rotation);
  assert.equal(create().isActive(), false, 'a new engine session starts inactive');
});
