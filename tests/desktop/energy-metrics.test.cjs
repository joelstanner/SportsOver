const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize, reduction, selectEnergySamples, compare } = require('../../scripts/energy-metrics.cjs');
test('energy summaries weight elapsed time and preserve unavailable and zero values', () => {
  const value = summarize([{ seconds: 1, cpuPercent: 10, energyImpact: 0, wakeupsPerSecond: 4 },
    { seconds: 3, cpuPercent: 2, energyImpact: 0, wakeupsPerSecond: 0 }]);
  assert.equal(value.cpuPercent, 4);
  assert.equal(value.energyImpact, 0);
  assert.equal(value.wakeupsPerSecond, 1);
  assert.equal(summarize([{ seconds: 1, cpuPercent: 2 }]).energyImpact, null);
  assert.equal(summarize([]).cpuPercent, null);
  assert.equal(reduction(0, 0), null);
  assert.equal(reduction(null, 2), null);
  assert.equal(reduction(10, 12), -20);
});
test('native samples exclude other apps and boundaries, retain helper coverage, and reject absent apps', () => {
  const task = pid => ({ pid, cpuPercent: 2, energyImpact: 3, wakeupsPerSecond: 4 });
  const frame = endMs => ({ endMs, seconds: 2, tasks: [task(1), task(2), task(99)] });
  const samples = selectEnergySamples([frame(1100), frame(3000), frame(5000), frame(7000),
    { ...frame(4000), tasks: [task(1)] }, { ...frame(4000), tasks: [task(99)] }], { startMs: 1000, endMs: 6000, pids: [1, 2] });
  assert.equal(samples.length, 3);
  assert.equal(samples[0].cpuPercent, 4);
  assert.equal(samples[0].energyImpact, 6);
  assert.deepEqual(samples[2].reportedPids, [1]);
  assert.deepEqual(samples[2].expectedPids, [1, 2]);
});
test('comparisons keep scenarios separate and include every repeated run', () => {
  const run = (variant, cpuPercent, scenario = 'static') => ({ variant, scenario,
    samples: [{ seconds: 10, cpuPercent, energyImpact: cpuPercent, wakeupsPerSecond: 0 }] });
  const result = compare([run('before', 4), run('before', 6), run('after', 2), run('after', 3), run('after', 999, 'scrolling')], 'static');
  assert.equal(result.before.cpuPercent, 5);
  assert.equal(result.after.cpuPercent, 2.5);
  assert.equal(result.reductions.cpuPercent, 50);
  assert.equal(result.runMeans.before.length, 2);
});
test('comparison CPU covers every app process independently of native row coverage', () => {
  const run = variant => ({ variant, scenario: 'static',
    samples: [{ seconds: 2, cpuPercent: 1, wakeupsPerSecond: 2, energyImpact: 3 }],
    electronSamples: [{ seconds: 3, cpuPercent: 4, wakeupsPerSecond: 5 }] });
  const result = compare([run('before'), run('after')], 'static');
  assert.equal(result.before.cpuPercent, 4);
  assert.equal(result.before.wakeupsPerSecond, 5);
  assert.equal(result.before.energyImpact, 3);
  assert.equal(result.runMeans.before[0].cpuPercent, 4);
});
