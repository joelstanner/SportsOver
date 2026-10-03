const fs = require('node:fs');
const path = require('node:path');

const settingsPath = path.resolve(__dirname, '../.sportsover-tests.json');
const isCI = env => !!env.GITHUB_ACTIONS || (!!env.CI && !['0', 'false'].includes(env.CI.toLowerCase()));
function validateMode(mode) {
  if (!['quiet', 'visible'].includes(mode)) throw Error('Test mode must be "quiet" or "visible".');
  return mode;
}
function resolveMode({ argv = process.argv.slice(2), env = process.env, file = settingsPath } = {}) {
  // Release verification must never inherit a developer's reduced coverage.
  if (isCI(env)) return 'visible';
  const flags = argv.filter(arg => ['--quiet', '--visible'].includes(arg));
  if (new Set(flags).size > 1) throw Error('Choose either --quiet or --visible.');
  if (flags.length) return flags[0].slice(2);
  if (env.SPORTSOVER_TEST_MODE) return validateMode(env.SPORTSOVER_TEST_MODE);
  try { return validateMode(JSON.parse(fs.readFileSync(file, 'utf8')).mode); }
  catch (error) {
    if (error.code === 'ENOENT') return 'quiet';
    throw Error(`Cannot read test preference ${file}: ${error.message}`);
  }
}
function saveMode(mode, file = settingsPath) {
  validateMode(mode);
  fs.writeFileSync(file, `${JSON.stringify({ mode }, null, 2)}\n`);
}
let selected;
function testMode() {
  if (!selected) {
    selected = resolveMode();
    console.log(`Desktop test mode: ${selected}${isCI(process.env) ? ' (required by CI)' : ''}.`);
    if (selected === 'quiet') console.log('SKIP native visibility, focus, Dock, tray, global shortcuts, fullscreen, and OS window interaction checks. Use --visible for full coverage.');
  }
  return selected;
}
const electron = {
  async launch(options) {
    const quiet = testMode() === 'quiet';
    if (!options.env?.SPORTSOVER_TEST_DATA) throw Error('Desktop tests require isolated SPORTSOVER_TEST_DATA.');
    // Older packaged apps do not understand the hidden-test flag. Never risk
    // silently showing their windows when the user requested a quiet run.
    if (quiet && options.executablePath) throw Error('Packaged-app tests require --visible (or SPORTSOVER_TEST_MODE=visible). Quiet mode is supported for source launches.');
    return require('playwright')._electron.launch({ ...options,
      env: { ...options.env, SPORTSOVER_TEST_QUIET: quiet ? '1' : '0' },
    });
  },
};
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1) throw Error('Usage: npm run test:mode -- quiet|visible');
    saveMode(args[0]);
    console.log(`Local desktop test preference saved: ${args[0]} (${settingsPath}). CI always uses visible mode.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { resolveMode, saveMode, testMode, electron };
