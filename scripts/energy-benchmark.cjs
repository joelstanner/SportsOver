// macOS before/after measurements. Does not rebuild an app or change the checkout.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { electron } = require('./test-mode.cjs');
const { summarize, selectEnergySamples, compare } = require('./energy-metrics.cjs');
const root = path.resolve(__dirname, '..');
const changedFiles = ['core/engine-host.js', 'core/output.js'];
const cancellation = new AbortController();
const sleep = ms => delay(ms, undefined, { signal: cancellation.signal });
const quoteShell = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const appleString = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });

function options(args) {
  const opts = { baseline: 'a850415', seconds: 60, warmup: 20, pairs: 2, scenarios: ['static', 'scrolling'], energy: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--energy') opts.energy = true;
    else if (arg === '--visible') continue;
    else if (arg === '--help') return null;
    else if (['--baseline', '--seconds', '--warmup', '--pairs', '--scenarios', '--output'].includes(arg)) {
      const key = arg.slice(2), value = args[++i];
      if (!value || value.startsWith('--')) throw Error(`Missing value for ${arg}`);
      opts[key] = ['seconds', 'warmup', 'pairs'].includes(key) ? Number(value) : key === 'scenarios' ? value.split(',') : value;
    } else throw Error(`Unknown option: ${arg}`);
  }
  for (const [key, min, max] of [['seconds', 4, 300], ['warmup', 2, 120], ['pairs', 1, 4]]) {
    if (!Number.isInteger(opts[key]) || opts[key] < min || opts[key] > max) throw Error(`${key} must be ${min}–${max}`);
  }
  if (!opts.scenarios.length || new Set(opts.scenarios).size !== opts.scenarios.length
    || opts.scenarios.some(value => !['static', 'scrolling'].includes(value))) throw Error('Choose static,scrolling scenarios');
  return opts;
}

async function snapshots(directory, baseline) {
  const names = git('ls-files', '-z').toString().split('\0').filter(name => name &&
    (['index.html', 'display.html', 'package.json'].includes(name) || /^(core|sports|desktop|admin|scripts)\//.test(name)));
  const after = path.join(directory, 'after'), before = path.join(directory, 'before');
  for (const folder of [after, before]) {
    for (const name of names) {
      await fs.mkdir(path.dirname(path.join(folder, name)), { recursive: true });
      await fs.copyFile(path.join(root, name), path.join(folder, name));
    }
    await fs.symlink(path.join(root, 'node_modules'), path.join(folder, 'node_modules'));
  }
  const hashes = {};
  for (const name of changedFiles) {
    const original = git('show', `${baseline}:${name}`);
    await fs.writeFile(path.join(before, name), original);
    hashes[name] = Object.fromEntries(await Promise.all(['before', 'after'].map(async variant =>
      [variant, createHash('sha256').update(await fs.readFile(path.join(directory, variant, name))).digest('hex')])));
  }
  if (Object.values(hashes).every(value => value.before === value.after)) throw Error('Baseline and current publishing code are identical');
  return { before, after, hashes };
}

async function startNativeSampler(directory, maximumSeconds) {
  const file = path.join(directory, 'native.plist'), stop = path.join(directory, 'stop-native');
  // Only this fixed Apple utility runs with administrator privileges. The stop
  // file is data, never executable input. The sampler also has a hard time limit.
  const command = `/usr/bin/powermetrics --samplers tasks --show-process-energy --format plist --sample-rate 2000 --sample-count ${Math.ceil(maximumSeconds / 2)} -o ${quoteShell(file)} & sampler=$!; trap '/bin/kill -TERM "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null' EXIT; while /bin/kill -0 "$sampler" 2>/dev/null && [ ! -e ${quoteShell(stop)} ]; do /bin/sleep 1; done`;
  const child = spawn('/usr/bin/osascript', ['-e', `do shell script ${appleString(command)} with administrator privileges`], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '', exited = false;
  child.stderr.on('data', chunk => { errors += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => { exited = true; code === 0 ? resolve() : reject(Error(errors.trim() || `Energy sampler exited ${code}`)); });
  });
  done.catch(() => {});
  let finishing;
  const finish = () => finishing ||= (async () => {
    await fs.writeFile(stop, 'stop');
    let timeout;
    try { await Promise.race([done, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(Error('Energy sampler did not stop')), 10000);
    })]); } finally { clearTimeout(timeout); }
  })();
  try {
    console.log('Approve the macOS administrator dialog to start native Energy Impact sampling.');
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (exited) { await done; throw Error('Energy sampler stopped before measurements began'); }
      if (await fs.stat(file).then(info => info.size > 0, () => false)) return { file, finish };
      await sleep(250);
    }
    throw Error('Timed out waiting for administrator approval and the first energy sample');
  } catch (error) { await finish().catch(() => {}); throw error; }
}

async function runTrial({ variant, scenario, pair, snapshot, opts, directory, output }) {
  const label = `${scenario}-${pair + 1}-${variant}`;
  const data = path.join(directory, `data-${label}`);
  await fs.mkdir(data);
  require('../core/config.js');
  const config = structuredClone(globalThis.SportsOverlay.config.DEFAULT_CONFIG);
  config.sports.forEach(sport => { sport.enabled = sport.sport === 'football'; });
  config.showBettingInfo = false;
  config.showAlternateContent = false;
  await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify({ version: 1, config,
    desktop: { visible: false, bounds: { x: 40, y: 100, width: 472, height: 100 } } }));
  let application;
  const errors = [];
  try {
    console.log(`${label}: launching; ${opts.warmup}s warmup, ${opts.seconds}s measurement.`);
    application = await electron.launch({ args: [snapshot, '--background'], env: { ...process.env,
      SPORTSOVER_TEST_MODE: 'visible', SPORTSOVER_TEST_DATA: data } });
    application.process().stderr.on('data', chunk => {
      if (/Error|test-network.*Unexpected/.test(String(chunk))) console.error(String(chunk).trim());
    });
    console.log(`${label}: app started; preparing fixture.`);
    application.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    let engine, banner;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && (!engine || !banner)) {
      const windows = application.windows();
      engine = windows.find(page => page.url().includes('engine=1'));
      banner = windows.find(page => page.url().includes('display.html?desktop'));
      if (!engine || !banner) await sleep(100);
    }
    if (!engine || !banner) throw Error('Benchmark windows did not start');
    // Both snapshots use the same fixture, artwork boundary, Electron runtime,
    // normal visibility behavior, window geometry, and no Settings/OBS client.
    await engine.goto(`sportsover://app/sports/index.html?engine=1&sport=football&${scenario === 'static' ? 'demo=live' : 'scenario=scrolling'}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await banner.locator('#football-home-score').waitFor({ state: 'attached', timeout: 30000 });
    await banner.waitForFunction(() => document.querySelector('#football-home-score')?.textContent === '21', null, { timeout: 30000 });
    assert.equal(await banner.locator('#football-away-score').textContent(), '17', 'Seattle fixture must lead');
    console.log(`${label}: fixture ready.`);
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
      win.setBounds({ x: 40, y: 100, width: 472, height: 100 }); win.showInactive();
    });
    if (scenario === 'static') {
      // Explicit static control removes animation from both variants, including
      // the hidden engine. The scrolling scenario retains normal CSS animations.
      for (const page of [engine, banner]) await page.addStyleTag({ content: '* { animation: none !important; transition: none !important; }' });
    }
    await sleep(opts.warmup * 1000);
    await banner.waitForFunction(async () => (await window.sportsDesktop.status()).engineReady, null, { timeout: 10000 });
    const animationCount = await banner.evaluate(() => document.querySelector('#sports-overlay').getAnimations({ subtree: true }).length);
    assert.ok(scenario === 'static' ? animationCount === 0 : animationCount > 0, 'Fixture must match its static/scrolling scenario');
    await banner.screenshot({ path: path.join(output, `${label}.png`) });
    const take = () => application.evaluate(({ app }) => ({ at: Date.now(), mainPid: process.pid,
      processes: app.getAppMetrics().map(value => ({ pid: value.pid, type: value.type, cpu: value.cpu })) }));
    let previous = await take();
    const pids = previous.processes.map(value => value.pid).sort((a, b) => a - b);
    const startMs = previous.at, electronSamples = [];
    let last = performance.now();
    const end = last + opts.seconds * 1000;
    while (performance.now() < end) {
      await sleep(Math.min(2000, Math.max(1, end - performance.now())));
      const current = await take(), now = performance.now(), seconds = (now - last) / 1000;
      assert.deepEqual(current.processes.map(value => value.pid).sort((a, b) => a - b), pids, 'Process set changed; rerun for comparable totals');
      const cpuSeconds = current.processes.reduce((sum, process) => {
        const old = previous.processes.find(value => value.pid === process.pid);
        if (!Number.isFinite(process.cpu.cumulativeCPUUsage) || !Number.isFinite(old.cpu.cumulativeCPUUsage)) throw Error('Electron lacks cumulative CPU counters');
        return sum + Math.max(0, process.cpu.cumulativeCPUUsage - old.cpu.cumulativeCPUUsage);
      }, 0);
      electronSamples.push({ endMs: current.at, seconds, cpuPercent: 100 * cpuSeconds / seconds,
        wakeupsPerSecond: current.processes.reduce((sum, value) => sum + value.cpu.idleWakeupsPerSecond, 0), energyImpact: null });
      previous = current; last = now;
    }
    assert.deepEqual(errors, []);
    const summary = summarize(electronSamples);
    console.log(`${label}: app CPU ${summary.cpuPercent.toFixed(2)}%, idle wakeups ${summary.wakeupsPerSecond.toFixed(2)}/s.`);
    return { variant, scenario, pair, startMs, endMs: previous.at, mainPid: previous.mainPid, pids, electronSamples,
      samples: electronSamples, animationCount, screenshot: `${label}.png` };
  } finally { if (application) await application.close(); }
}

async function writeReport(report, output) {
  const fmt = value => Number.isFinite(value) ? value.toFixed(2) : 'Unavailable';
  const displayedTime = new Date(report.startedAt).toLocaleString('en-US', { timeZone: report.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone, timeZoneName: 'short' });
  const rows = report.comparisons.flatMap(item => ['energyImpact', 'cpuPercent', 'wakeupsPerSecond'].map(key => {
    const label = { energyImpact: 'Native Energy Impact rate', cpuPercent: 'CPU (% of one core)', wakeupsPerSecond: 'Idle wakeups / second' }[key];
    return `<tr><td>${escape(item.scenario)}</td><td>${label}</td><td>${fmt(item.before[key])}</td><td>${fmt(item.after[key])}</td><td>${fmt(item.reductions[key])}${item.reductions[key] === null ? '' : '%'}</td></tr>`;
  })).join('');
  const trials = report.runs.map(run => { const summary = summarize(run.samples), cpu = summarize(run.electronSamples); return `<tr><td>${escape(run.scenario)}</td><td>${run.pair + 1}</td><td>${run.variant}</td><td>${fmt(summary.energyImpact)}</td><td>${fmt(cpu.cpuPercent)}</td><td>${fmt(cpu.wakeupsPerSecond)}</td><td>${summary.samples}</td><td><a href="${run.screenshot}">Banner</a></td></tr>`; }).join('');
  const notes = [
    'Energy Impact is Apple powermetrics energy_impact_per_s summed across reported benchmark app PIDs (main, renderer, GPU and utility). The native running-task sampler omits some dormant helpers; per-sample PID coverage is saved, and no per-process zero values are invented. It is a relative rate, not watts, battery life, or a transcription of Activity Monitor’s smoothed UI score.',
    'Positive reduction means less work; negative means more. Each scenario alternates order across pairs. Small differences may be noise; inspect repeated runs. This benchmark has no pass/fail performance threshold.',
    'The comparison tables use independent Electron cumulative CPU counters and idle-wakeup counters across all app processes over the full measurement window. Native Energy Impact uses the shorter whole-sample window. The CSV contains native sample rates in energy mode; JSON also retains the independent Electron samples.',
    'Both variants use the same working-tree source, with only core/engine-host.js and core/output.js restored from the baseline in the before copy. The same installed Electron binary runs both. Personal settings and the installed app are untouched.',
    'Fixed Seahawks 21–17 demo, 472×100 visible banner, hidden unthrottled engine, no Settings or OBS client. The static control disables animations on both surfaces; scrolling uses normal animations. This isolates local rendering/output work and does not measure live-provider traffic.',
    'Warmup, startup and shutdown are excluded, with a one-second boundary margin for native timestamp rounding. Native samples must include the app’s main process; missing energy fields fail validation. Other apps and WindowServer work are excluded but can still influence scheduling and system power. Both launches use identical automation/debugging flags, so relative differences are more useful than absolute shipped-app predictions.',
    `Mode: ${report.options.energy ? 'native macOS energy + CPU' : 'CPU/wakeups only; Energy Impact unavailable'}. Warmup ${report.options.warmup}s; measurement ${report.options.seconds}s per run. Samples every 2s.`,
  ];
  if (report.options.seconds < 30 || report.options.pairs < 2) notes.push('SHORT CHECK: use at least 30 seconds and two pairs per scenario for an initial comparison; longer runs improve repeatability.');
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ ...report, notes }, null, 2));
  const csv = ['scenario,pair,variant,end_ms,seconds,cpu_percent,idle_wakeups_per_second,native_energy_impact_rate'];
  for (const run of report.runs) for (const sample of run.samples) csv.push([run.scenario, run.pair + 1, run.variant, sample.endMs, sample.seconds, sample.cpuPercent, sample.wakeupsPerSecond, sample.energyImpact ?? ''].join(','));
  await fs.writeFile(path.join(output, 'samples.csv'), csv.join('\n') + '\n');
  await fs.writeFile(path.join(output, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SportsOver energy comparison</title><style>body{font:16px/1.55 system-ui;margin:40px auto;padding:0 24px;max-width:1100px;color:#152638;background:#f6f8fa}h1{font-size:32px}table{border-collapse:collapse;width:100%;background:white;margin:24px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #dce3e9}th{background:#e4edf3}td:nth-child(n+3){font-variant-numeric:tabular-nums}li{margin:12px 0}small{color:#526474}</style><h1>SportsOver · Before & after</h1><p>${escape(displayedTime)} · ${escape(report.system)}<br><small>Baseline ${escape(report.baseline)} · current source ${escape(report.head)} plus local changes</small></p><table><thead><tr><th>Scenario</th><th>Measurement</th><th>Before</th><th>After</th><th>Reduction</th></tr></thead><tbody>${rows}</tbody></table><h2>Individual runs</h2><table><thead><tr><th>Scenario</th><th>Pair</th><th>Version</th><th>Energy</th><th>CPU %</th><th>Wakeups/s</th><th>Samples</th><th>View</th></tr></thead><tbody>${trials}</tbody></table><h2>How to read this</h2><ul>${notes.map(note => `<li>${escape(note)}</li>`).join('')}</ul><p><a href="samples.csv">Raw samples (CSV)</a> · <a href="results.json">Full results and source hashes (JSON)</a></p></html>`);
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (!opts) { console.log('Usage: npm run test:energy -- [--energy] [--seconds 60] [--warmup 20] [--pairs 2] [--scenarios static,scrolling] [--baseline a850415] [--output DIRECTORY]\n--energy requests macOS administrator approval for native Energy Impact. Without it, CPU/wakeups only.'); return; }
  if (process.platform !== 'darwin') throw Error('This benchmark is for macOS');
  // A visible banner is essential: quiet smoke tests force background rendering
  // and would measure a different workload. This affects only this process.
  process.env.SPORTSOVER_TEST_MODE = 'visible';
  const baseline = git('rev-parse', '--verify', `${opts.baseline}^{commit}`).toString().trim();
  const output = path.resolve(opts.output || path.join(root, 'reports', 'energy', new Date().toISOString().replaceAll(':', '-')));
  await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sportsover-energy-'));
  await fs.writeFile(path.join(directory, 'report-directory.txt'), output);
  const cancel = () => cancellation.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let sampler;
  const runs = [];
  const startedAt = new Date().toISOString();
  const powerBefore = execFileSync('/usr/bin/pmset', ['-g', 'batt'], { encoding: 'utf8' });
  try {
    const copies = await snapshots(directory, baseline);
    if (opts.energy) {
      execFileSync('python3', ['-c', 'import plistlib']);
      sampler = await startNativeSampler(directory, opts.scenarios.length * opts.pairs * 2 * (opts.seconds + opts.warmup + 45) + 120);
    }
    console.log(`Results: ${output}\nThe benchmark banner will appear. Keep the pointer away from its top-left position and keep other workloads/power settings stable.`);
    for (const scenario of opts.scenarios) for (let pair = 0; pair < opts.pairs; pair++) {
      for (const variant of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
        runs.push(await runTrial({ variant, scenario, pair, snapshot: copies[variant], opts, directory, output }));
        await fs.writeFile(path.join(output, 'partial-results.json'), JSON.stringify(runs, null, 2));
      }
    }
    if (sampler) {
      await sampler.finish();
      const pids = [...new Set(runs.flatMap(run => run.pids))];
      const samples = JSON.parse(execFileSync('python3', [path.join(__dirname, 'energy-samples.py'), sampler.file, JSON.stringify(pids)], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
      for (const run of runs) {
        run.samples = selectEnergySamples(samples, run);
        const minimumSamples = Math.max(1, Math.floor((opts.seconds - 4) / 2 * 0.8));
        if (run.samples.length < minimumSamples || run.samples.some(sample => sample.energyImpact === null)) throw Error(`Native energy coverage insufficient for ${run.scenario}/${run.variant}; CPU-only partial results retained`);
      }
    }
    const report = { startedAt, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, baseline, head: git('rev-parse', 'HEAD').toString().trim(),
      options: opts, system: `${os.type()} ${os.release()} ${os.arch()} · ${os.cpus()[0].model}`,
      powerBefore, powerAfter: execFileSync('/usr/bin/pmset', ['-g', 'batt'], { encoding: 'utf8' }),
      sourceHashes: copies.hashes, runs, comparisons: opts.scenarios.map(scenario => compare(runs, scenario)) };
    await writeReport(report, output);
    await fs.rm(path.join(output, 'partial-results.json'));
    console.log(JSON.stringify(report.comparisons, null, 2));
    console.log(`Open ${path.join(output, 'report.html')}`);
  } finally {
    if (sampler) await sampler.finish().catch(error => console.error(error.message));
    await fs.rm(directory, { recursive: true, force: true });
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { options, quoteShell, appleString, writeReport };
