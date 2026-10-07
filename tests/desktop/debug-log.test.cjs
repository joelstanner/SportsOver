require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDebugLog } = require('../../scripts/debug-log.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sportsover-debug-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const log = createDebugLog({ directory, now: () => new Date('2026-10-07T19:00:00Z'), pid: 123 });
  t.after(() => log.close());
  return log;
}

test('debug files retain interleaved output streams, split UTF-8, and final partial lines', t => {
  const log = fixture(t);
  log.write('stdout', Buffer.from('[SportsOver HTTP] #1 '));
  log.write('stderr', 'Native diagnostic\r\n');
  for (const byte of Buffer.from('→ GET https://example.com/\n')) log.write('stdout', Buffer.from([byte]));
  log.write('stderr', 'Final partial diagnostic');
  log.close();
  log.close();
  assert.equal(fs.readFileSync(log.file, 'utf8'),
    '2026-10-07T19:00:00.000Z [stderr] Native diagnostic\n'
    + '2026-10-07T19:00:00.000Z [stdout] [SportsOver HTTP] #1 → GET https://example.com/\n'
    + '2026-10-07T19:00:00.000Z [stderr] Final partial diagnostic\n');
  assert.ok(!path.basename(log.file).includes(':'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(log.file).mode & 0o777, 0o600);
});

test('a new debug run cannot overwrite an existing log', t => {
  const log = fixture(t);
  log.write('stdout', 'Keep this log\n');
  const before = fs.readFileSync(log.file, 'utf8');
  assert.throws(() => createDebugLog({ directory: path.dirname(log.file), now: () => new Date('2026-10-07T19:00:00Z'), pid: 123 }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(log.file, 'utf8'), before);
});

test('long diagnostics without newlines are saved before shutdown', t => {
  const log = fixture(t);
  const diagnostic = 'x'.repeat(65537);
  log.write('stdout', diagnostic);
  assert.ok(fs.readFileSync(log.file, 'utf8').includes(diagnostic));
});
