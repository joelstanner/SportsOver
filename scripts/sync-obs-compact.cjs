// Keep the generated OBS treatment identical to the native compact renderer.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const marker = '/* Shared compact team layout: generated from core/compact-banner.css. */';
function compactCSS() {
  return fs.readFileSync(path.join(root, 'core/compact-banner.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//, '/* OBS Small uses the desktop below-50% treatment at its own viewport size. */')
    .replace('@media (width < 236px)', '@media (max-width:400px)')
    .replace('.desktop-banner #sports-overlay', 'body:not(.desktop-banner) #sports-overlay');
}
if (require.main === module) {
  const file = path.join(root, 'core/obs-layouts.css');
  const base = fs.readFileSync(file, 'utf8').split(marker)[0].trimEnd();
  fs.writeFileSync(file, base + '\n\n' + marker + '\n' + compactCSS());
}
module.exports = { compactCSS, marker };
