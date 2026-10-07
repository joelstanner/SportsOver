require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveMode, saveMode, launchOptions, assertFixtureSupport } = require('../../scripts/test-mode.cjs');

test('local preference round trip, command/environment overrides, and CI enforcement', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sportsover-test-mode-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'preference.json');
  const mode = (argv = [], env = {}) => resolveMode({ argv, env, file });
  assert.equal(mode(), 'quiet');
  saveMode('visible', file);
  assert.equal(mode(), 'visible');
  assert.equal(mode(['--quiet']), 'quiet');
  assert.equal(mode([], { SPORTSOVER_TEST_MODE: 'quiet' }), 'quiet');
  assert.equal(mode(['--visible'], { SPORTSOVER_TEST_MODE: 'quiet' }), 'visible');
  saveMode('quiet', file);
  assert.equal(mode(), 'quiet');
  assert.equal(mode(['--quiet'], { CI: 'true', SPORTSOVER_TEST_MODE: 'quiet' }), 'visible');
  assert.equal(mode(['--quiet'], { GITHUB_ACTIONS: 'true' }), 'visible');
  assert.equal(mode([], { CI: 'false' }), 'quiet');
  assert.equal(mode([], { CI: '0' }), 'quiet');
  assert.throws(() => mode(['--quiet', '--visible']), /either/);
  assert.throws(() => mode([], { SPORTSOVER_TEST_MODE: 'typo' }), /quiet.*visible/);
  assert.throws(() => saveMode('typo', file), /quiet.*visible/);
  assert.equal(mode(), 'quiet', 'invalid updates do not overwrite the saved preference');
  fs.writeFileSync(file, 'bad JSON');
  assert.throws(() => mode(), /Cannot read test preference/);
  assert.equal(mode(['--visible']), 'visible', 'explicit override can bypass a malformed preference');
  assert.equal(mode([], { CI: 'true' }), 'visible', 'CI ignores local files entirely');
});

test('routine launches override inherited live access; live checks require a launch option', () => {
  const options = { args: ['/source'], env: { SPORTSOVER_TEST_DATA: '/isolated', SPORTSOVER_TEST_NETWORK: 'live' } };
  for (const quiet of [false, true]) {
    const launch = launchOptions(options, quiet);
    assert.equal(launch.env.SPORTSOVER_TEST_NETWORK, 'fixtures');
    assert.equal(launch.env.SPORTSOVER_TEST_QUIET, quiet ? '1' : '0');
    assert.equal(launchOptions({ ...options, network: 'live' }, quiet).env.SPORTSOVER_TEST_NETWORK, 'live');
    assert.ok(!('network' in launch), 'custom option is not passed to Playwright');
  }
  assert.equal(options.env.SPORTSOVER_TEST_NETWORK, 'live', 'caller environment is preserved');
  assert.throws(() => launchOptions({ ...options, network: 'typo' }, false), /network/);
  assert.throws(() => launchOptions({ env: {} }, false), /isolated/);
  assert.throws(() => launchOptions({ ...options, executablePath: '/old-app' }, true), /visible/);
});

test('old packaged apps are refused before launch, while protected unpacked and ASAR apps are accepted', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sportsover-network-package-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const platform of ['mac', 'win']) {
    const executable = path.join(directory, platform === 'mac' ? 'SportsOver.app/Contents/MacOS/SportsOver' : 'win/SportsOver.exe');
    const resources = path.join(path.dirname(executable), platform === 'mac' ? '../Resources' : 'resources');
    const appRoot = path.join(resources, 'app');
    fs.mkdirSync(path.join(appRoot, 'desktop'), { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'desktop/main.cjs'), '// old app');
    assert.throws(() => assertFixtureSupport(executable), /lacks verified fixture-network protection/);
    for (const file of ['main.cjs', 'test-network.cjs', 'test-fixtures.cjs', 'test-node-network.cjs']) fs.copyFileSync(path.join(__dirname, '../../desktop', file), path.join(appRoot, 'desktop', file));
    assert.doesNotThrow(() => assertFixtureSupport(executable));
    fs.writeFileSync(path.join(appRoot, 'desktop/main.cjs'), '// guard exists but is not installed');
    assert.throws(() => assertFixtureSupport(executable), /Missing startup guard/);
    fs.copyFileSync(path.join(__dirname, '../../desktop/main.cjs'), path.join(appRoot, 'desktop/main.cjs'));
    await require('@electron/asar').createPackage(appRoot, path.join(resources, 'app.asar'));
    fs.rmSync(appRoot, { recursive: true, force: true });
    assert.doesNotThrow(() => assertFixtureSupport(executable));
  }
});
