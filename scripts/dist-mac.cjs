// Build downloadable disk images; never sign with Developer ID or publish.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function main() {
  if (process.platform !== 'darwin') throw Error('Build Mac installers on macOS. Windows still uses npm install and npm start.');
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !['--arm64', '--x64', '--all'].includes(args[0]))) {
    throw Error('Usage: npm run dist:mac -- [--arm64 | --x64 | --all]');
  }
  const architectures = args[0] === '--all' ? ['arm64', 'x64'] : [args[0]?.slice(2) || process.arch];
  if (architectures.some(arch => !['arm64', 'x64'].includes(arch))) throw Error('Only Apple Silicon (arm64) and Intel (x64) are supported.');
  const { build, Platform, Arch } = require('electron-builder');
  const root = path.resolve(__dirname, '..');
  // DMG content paths and configuration are relative to the checkout.
  process.chdir(root);
  const output = path.join(root, 'dist', 'installers');
  const version = require('../package.json').version;
  // Separate invocations avoid mounting two volumes with the same name at once.
  for (const arch of architectures) {
    const artifacts = await build({
      projectDir: root,
      config: path.join(root, 'packaging', 'mac.cjs'),
      targets: Platform.MAC.createTarget('dmg', Arch[arch]),
      publish: 'never',
    });
    const filename = `SportsOver-${version}-mac-${arch}.dmg`;
    const dmg = path.join(output, filename);
    if (!artifacts.some(file => path.resolve(file) === dmg)) throw Error(`Build did not produce ${filename}`);
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(dmg)) hash.update(chunk);
    fs.writeFileSync(`${dmg}.sha256`, `${hash.digest('hex')}  ${filename}\n`);
    console.log(`Installer: ${dmg}\nChecksum: ${dmg}.sha256`);
  }
  fs.copyFileSync(path.join(root, 'packaging', 'Install SportsOver.txt'), path.join(output, 'Install SportsOver.txt'));
  console.log('Ad-hoc signed, not notarized. Nothing was uploaded. Test a browser-downloaded copy on another Mac before release.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
