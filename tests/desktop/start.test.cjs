require('../../scripts/offline-network.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStderrReporter, certificateNote } = require('../../scripts/start.cjs');

const header = '[11568:0930/130902.460285:ERROR:net/cert/internal/trust_store_mac.cc:807] Error parsing certificate:\n';
const error = 'ERROR: Failed parsing extensions\n';

test('startup retains the certificate diagnostic and explains it across split chunks', () => {
  let output = '';
  const report = createStderrReporter(chunk => { output += chunk; });
  for (const char of header + error) report(Buffer.from(char));
  assert.equal(output, header + error + certificateNote);
});

test('other errors are preserved without a misleading reassurance', () => {
  let output = '';
  const report = createStderrReporter(chunk => { output += chunk; });
  const text = header + 'ERROR: Different certificate failure\n'
    + 'ERROR: Failed parsing extensions\n' + 'Network request failed: ERR_CERT_AUTHORITY_INVALID\n';
  report(Buffer.from(text));
  assert.equal(output, text);
});

test('diagnostics without a final newline are still forwarded immediately', () => {
  let output = '';
  const report = createStderrReporter(chunk => { output += chunk; });
  report(Buffer.from('Startup failed'));
  assert.equal(output, 'Startup failed');
});
