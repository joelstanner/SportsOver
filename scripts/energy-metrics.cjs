function summarize(samples) {
  const duration = samples.reduce((sum, sample) => sum + sample.seconds, 0);
  const weighted = key => duration && samples.every(sample => Number.isFinite(sample[key]))
    ? samples.reduce((sum, sample) => sum + sample[key] * sample.seconds, 0) / duration : null;
  return { seconds: duration, samples: samples.length, cpuPercent: weighted('cpuPercent'),
    wakeupsPerSecond: weighted('wakeupsPerSecond'), energyImpact: weighted('energyImpact') };
}
function reduction(before, after) {
  return Number.isFinite(before) && before > 0 && Number.isFinite(after) ? 100 * (before - after) / before : null;
}
function selectEnergySamples(samples, run) {
  const pids = new Set(run.pids);
  // Apple's plist timestamps have whole-second precision. Reserve the following
  // second so a rounded-down timestamp cannot include shutdown in a sample.
  return samples.filter(sample => sample.endMs + 1000 <= run.endMs && sample.endMs - sample.seconds * 1000 >= run.startMs)
    .map(sample => {
      const tasks = sample.tasks.filter(task => pids.has(task.pid));
      // powermetrics reports running tasks, omitting some dormant helpers. Sum
      // only reported rows and retain coverage; never invent per-process zeros.
      if (!tasks.some(task => task.pid === (run.mainPid ?? run.pids[0]))) return null;
      const sum = key => tasks.every(task => Number.isFinite(task[key]))
        ? tasks.reduce((total, task) => total + task[key], 0) : null;
      return { endMs: sample.endMs, seconds: sample.seconds, cpuPercent: sum('cpuPercent'),
        energyImpact: sum('energyImpact'), wakeupsPerSecond: sum('wakeupsPerSecond'),
        reportedPids: tasks.map(task => task.pid), expectedPids: run.pids };
    }).filter(Boolean);
}
function compare(runs, scenario) {
  const group = variant => runs.filter(run => run.scenario === scenario && run.variant === variant);
  const combined = values => {
    const native = summarize(values.flatMap(run => run.samples));
    const cpu = summarize(values.flatMap(run => run.electronSamples || run.samples));
    return { ...native, cpuPercent: cpu.cpuPercent, wakeupsPerSecond: cpu.wakeupsPerSecond };
  };
  const before = combined(group('before'));
  const after = combined(group('after'));
  return { scenario, before, after,
    reductions: Object.fromEntries(['cpuPercent', 'wakeupsPerSecond', 'energyImpact'].map(key => [key, reduction(before[key], after[key])])),
    runMeans: Object.fromEntries(['before', 'after'].map(variant => [variant, group(variant).map(run => combined([run]))])) };
}
module.exports = { summarize, reduction, selectEnergySamples, compare };
