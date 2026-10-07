require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { EngineState } = require('../../desktop/engine-state.cjs');
const { createOutputSource } = require('../../desktop/output-source.cjs');

test('switching demo and live output preserves ordered frames and the live engine', () => {
  const live = new EngineState(), demo = new EngineState(), output = createOutputSource(live);
  const publish = (engine, text) => engine.publish({ html: `<main>${text}</main>`, metadata: { availableEntries: [], renderedGameKey: text } });
  publish(live, 'live');
  const first = output.output();
  publish(demo, 'DEMO'); output.select(demo);
  const sample = output.output();
  assert.equal(sample.instance, first.instance);
  assert.ok(sample.sequence > first.sequence);
  assert.equal(output.output().sequence, sample.sequence);
  assert.match(sample.html, /DEMO/);
  assert.throws(() => output.command({}), error => error.status === 409);
  publish(live, 'updated live');
  assert.deepEqual(output.output(), sample, 'background live updates cannot leak into demos');
  output.select(live);
  const restored = output.output();
  assert.ok(restored.sequence > sample.sequence);
  assert.match(restored.html, /updated live/);
  assert.equal(output.state().renderedGameKey, 'updated live');
});
