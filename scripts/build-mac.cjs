// Local, ad-hoc signed bundle using the already installed Electron runtime.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { pruneMacBuildBackups } = require('./build-backups.cjs');
if (process.platform !== 'darwin') throw Error('Build this app on macOS.');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'SportsOver.app');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sportsover-build-'));
const bundle = path.join(staging, 'SportsOver.app');
try {
  const runtime = path.resolve(require('electron'), '../../..');
  execFileSync('/usr/bin/ditto', [runtime, bundle]);
  const resources = path.join(bundle, 'Contents', 'Resources');
  const appRoot = path.join(resources, 'app');
  fs.mkdirSync(appRoot, { recursive: true });
  // Explicit allowlist keeps dependencies, credentials, and local files out.
  for (const entry of ['desktop', 'core', 'admin', 'sports', 'scripts', 'index.html', 'display.html', 'demo.html', 'package.json', 'LICENSE']) {
    fs.cpSync(path.join(root, entry), path.join(appRoot, entry), { recursive: true });
  }
  fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
  const iconset = path.join(staging, 'SportsOver.iconset');
  fs.mkdirSync(iconset);
  const artwork = path.join(root, 'desktop', 'assets', 'SportsOver.png');
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), artwork, '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'pipe' });
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'SportsOver.icns')]);
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  for (const [key, value] of Object.entries({ CFBundleName: 'SportsOver', CFBundleDisplayName: 'SportsOver', CFBundleIdentifier: 'com.sportsover.desktop', CFBundleIconFile: 'SportsOver.icns', CFBundleShortVersionString: require('../package.json').version, CFBundleVersion: require('../package.json').version })) {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
  }
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  // Keep the prior build recoverable instead of merging stale bundle files.
  if (fs.existsSync(output)) fs.renameSync(output, `${output}.${Date.now()}.previous`);
  execFileSync('/usr/bin/ditto', [bundle, output]);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', output]);
  // Only prune after the replacement is verified, retaining one rollback build.
  pruneMacBuildBackups(path.dirname(output));
  console.log(`Built ${output}\nLocal ad-hoc signature only; not notarized for distribution.`);
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
