const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

function createDebugLog({ directory = path.resolve(__dirname, '../logs'), now = () => new Date(),
  pid = process.pid, onError = error => console.error(`[SportsOver debug] File logging stopped: ${error.message}`) } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const file = path.join(directory, `sportsover-debug-${stamp}-${pid}.log`);
  const fd = fs.openSync(file, 'wx', 0o600);
  const streams = new Map();
  let closed = false, failed = false;
  function record(source, text) {
    if (closed || failed) return;
    try { fs.writeSync(fd, `${now().toISOString()} [${source}] ${text}\n`); }
    catch (error) { failed = true; onError(error); }
  }
  function write(source, chunk) {
    if (closed || failed) return;
    if (!streams.has(source)) streams.set(source, { decoder: new StringDecoder('utf8'), pending: '' });
    const stream = streams.get(source);
    stream.pending += stream.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    let newline;
    while ((newline = stream.pending.indexOf('\n')) !== -1) {
      record(source, stream.pending.slice(0, newline).replace(/\r$/, ''));
      stream.pending = stream.pending.slice(newline + 1);
    }
    // Keep an unterminated diagnostic from growing the inspection buffer forever.
    if (stream.pending.length > 65536) { record(source, stream.pending); stream.pending = ''; }
  }
  function close() {
    if (closed) return;
    for (const [source, stream] of streams) {
      stream.pending += stream.decoder.end();
      if (stream.pending) record(source, stream.pending);
    }
    closed = true;
    try { fs.closeSync(fd); } catch (error) { if (!failed) onError(error); }
  }
  return { file, write, close };
}

module.exports = { createDebugLog };
