const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildWindows } = require('./build-win.cjs');
async function main() {
  const artifacts = await buildWindows(true);
  const filename = `SportsOver-${require('../package.json').version}-win-x64-setup.exe`;
  const output = path.resolve(__dirname, '../dist/windows');
  const installer = path.join(output, filename);
  if (!artifacts.some(file => path.resolve(file) === installer)) throw Error(`Build did not produce ${filename}`);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(installer)) hash.update(chunk);
  fs.writeFileSync(`${installer}.sha256`, `${hash.digest('hex')}  ${filename}\n`);
  fs.copyFileSync(path.resolve(__dirname, '../packaging/Install SportsOver Windows.txt'), path.join(output, 'Install SportsOver Windows.txt'));
  console.log(`Unsigned installer: ${installer}\nChecksum: ${installer}.sha256\nNothing was uploaded.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
