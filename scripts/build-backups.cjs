const fs = require('node:fs');
const path = require('node:path');

function pruneMacBuildBackups(directory) {
  const backups = fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const match = /^SportsOver\.app\.(\d+)\.previous$/.exec(entry.name);
    return entry.isDirectory() && match ? [{ name: entry.name, timestamp: BigInt(match[1]) }] : [];
  });
  // Bundle modification times are preserved by copying; use the backup timestamp.
  backups.sort((a, b) => a.timestamp > b.timestamp ? -1 : a.timestamp < b.timestamp ? 1 : 0);
  const removed = backups.slice(1).map(backup => backup.name);
  for (const name of removed) fs.rmSync(path.join(directory, name), { recursive: true });
  return removed;
}

module.exports = { pruneMacBuildBackups };
