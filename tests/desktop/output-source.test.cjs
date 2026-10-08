require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { EngineState } = require('../../desktop/engine-state.cjs');
const { createOutputSource } = require('../../desktop/output-source.cjs');

test('switching demo and live output preserves ordered frames and the live engine', () => {
  const live = new EngineState({ now: () => 100 }), demo = new EngineState({ now: () => 100 }), output = createOutputSource(live);
  const publish = (engine, text) => engine.publish({ html: `<main>${text}</main>`, metadata: { availableEntries: [], renderedGameKey: text } });
  publish(live, 'live');
  const first = output.output();
  publish(demo, 'DEMO'); output.select(demo);
  const sample = output.output();
  assert.equal(sample.instance, first.instance);
  assert.ok(sample.sequence > first.sequence);
  assert.ok(sample.heartbeatSequence > first.heartbeatSequence, 'source switches keep heartbeats ordered');
  assert.equal(output.output().sequence, sample.sequence);
  assert.match(sample.html, /DEMO/);
  assert.throws(() => output.command({}), error => error.status === 409);
  publish(live, 'updated live');
  assert.deepEqual(output.output(), sample, 'background live updates cannot leak into demos');
  output.select(live);
  const restored = output.output();
  assert.ok(restored.sequence > sample.sequence);
  assert.ok(restored.heartbeatSequence > sample.heartbeatSequence);
  assert.match(restored.html, /updated live/);
  assert.equal(output.state().renderedGameKey, 'updated live');
});

test('selected-source heartbeats advance without score changes and cannot be renewed by HTTP polling', () => {
  let time = 100;
  const live = new EngineState({ now: () => time }), output = createOutputSource(live);
  const frame = { html: '<main>unchanged score</main>', metadata: { renderedGameKey: 'hockey:1' } };
  live.publish(frame);
  const first = output.output();
  time += 1000;
  assert.equal(output.output().heartbeatSequence, first.heartbeatSequence);
  assert.equal(output.output().heartbeatAgeMs, 1000);
  live.publish(frame);
  const next = output.output();
  assert.equal(next.sequence, first.sequence);
  assert.ok(next.heartbeatSequence > first.heartbeatSequence);
  time += 10000;
  assert.equal(output.output().ready, false);
  assert.equal(output.output().heartbeatSequence, next.heartbeatSequence);
});
