// Inspect the actual archive, rather than assuming builder glob behavior.
const assert = require('node:assert/strict');
const path = require('node:path');
const asar = require('@electron/asar');
const archive = process.argv[2];
assert.ok(archive, 'Usage: npm run verify:package -- <resources/app.asar>');
const files = asar.listPackage(path.resolve(archive)).map(file => file.replaceAll('\\', '/').replace(/^\//, ''));
for (const file of ['desktop/main.cjs', 'desktop/preload.cjs', 'desktop/test-network.cjs', 'desktop/test-fixtures.cjs', 'desktop/test-node-network.cjs', 'desktop/assets/SportsOver.png',
  'scripts/team-catalog.mjs', 'core/registry.js', 'index.html', 'display.html', 'package.json', 'LICENSE']) {
  assert.ok(files.includes(file), `Missing runtime file: ${file}`);
}
for (const file of files) {
  assert.ok(!/(^|\/)(node_modules|tests|packaging|\.git)(\/|$)/.test(file), `Unexpected development file: ${file}`);
  assert.ok(!/(^|\/)(settings(?:\..*)?\.json(?:\..*)?|integration\.json|credentials.*|secrets.*|\.env.*|\.npmrc)$/.test(file), `Unexpected local state: ${file}`);
  assert.ok(!file.startsWith('scripts/') || file === 'scripts/team-catalog.mjs', `Unexpected build script: ${file}`);
}
console.log(`Runtime archive checked: ${archive}`);
