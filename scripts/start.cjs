const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const path = require('node:path');

const certificateNote = '[SportsOver] Chromium skipped this unreadable macOS Keychain certificate and is continuing. No action is needed if scores load normally.\n';

function createStderrReporter(write) {
  const decoder = new StringDecoder('utf8');
  let pending = '', certificateHeader = false;
  return chunk => {
    // Preserve all original diagnostics, including the certificate error.
    write(chunk);
    pending += decoder.write(chunk);
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (certificateHeader && line === 'ERROR: Failed parsing extensions') write(certificateNote);
      certificateHeader = /^\[[^\]\r\n]*:ERROR:(?:net\/cert\/internal\/)?trust_store_mac\.cc(?::\d+|\(\d+\))\] Error parsing certificate:$/.test(line);
    }
    // A diagnostic without newlines must not grow this inspection buffer forever.
    if (pending.length > 65536) { pending = ''; certificateHeader = false; }
  };
}

if (require.main === module) {
  const child = spawn(require('electron'), ['.', ...process.argv.slice(2)], {
    cwd: path.resolve(__dirname, '..'), stdio: ['inherit', 'inherit', 'pipe'],
  });
  child.stderr.on('data', createStderrReporter(chunk => process.stderr.write(chunk)));
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('close', (code, signal) => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  });
}

module.exports = { createStderrReporter, certificateNote };
