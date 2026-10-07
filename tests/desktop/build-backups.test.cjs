require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pruneMacBuildBackups } = require('../../scripts/build-backups.cjs');

test('build cleanup keeps the newest timestamped backup and leaves other files untouched', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sportsover-backups-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ['SportsOver.app', 'SportsOver.app.9.previous', 'SportsOver.app.10.previous',
    'SportsOver.app.manual.previous', 'installers']) {
    fs.mkdirSync(path.join(directory, name));
    fs.writeFileSync(path.join(directory, name, 'keep.txt'), name);
  }
  fs.writeFileSync(path.join(directory, 'SportsOver.app.11.previous'), 'not a bundle directory');
  fs.symlinkSync(path.join(directory, 'SportsOver.app'), path.join(directory, 'SportsOver.app.12.previous'));
  assert.deepEqual(pruneMacBuildBackups(directory), ['SportsOver.app.9.previous']);
  for (const name of ['SportsOver.app', 'SportsOver.app.10.previous', 'SportsOver.app.manual.previous', 'installers']) {
    assert.equal(fs.readFileSync(path.join(directory, name, 'keep.txt'), 'utf8'), name);
  }
  assert.equal(fs.readFileSync(path.join(directory, 'SportsOver.app.11.previous'), 'utf8'), 'not a bundle directory');
  assert.equal(fs.lstatSync(path.join(directory, 'SportsOver.app.12.previous')).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(directory, 'SportsOver.app.9.previous')), false);
  assert.deepEqual(pruneMacBuildBackups(directory), [], 'cleanup is safe to repeat');
});

test('build cleanup accepts an empty output directory', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sportsover-backups-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.deepEqual(pruneMacBuildBackups(directory), []);
});
