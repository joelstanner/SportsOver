const path = require('node:path');
async function buildWindows(installer = false) {
  if (process.platform !== 'win32') throw Error('Build Windows packages on Windows.');
  if (process.argv.length > 2) throw Error('Windows packaging currently supports x64 only; no arguments are accepted.');
  const { build, Platform, Arch } = require('electron-builder');
  const root = path.resolve(__dirname, '..');
  process.chdir(root);
  return build({ projectDir: root, config: path.join(root, 'packaging/windows.cjs'),
    targets: Platform.WINDOWS.createTarget(installer ? 'nsis' : 'dir', Arch.x64), publish: 'never' });
}
if (require.main === module) buildWindows().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildWindows };
