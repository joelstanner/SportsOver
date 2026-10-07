// Negative tests run in children: catching an error must still fail that process.
require('./offline-network.cjs');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const guard = path.join(__dirname, 'offline-network.cjs');
function child(source, expected = 1) {
  const result = spawnSync(process.execPath, ['--require', guard, '-e', source], { encoding: 'utf8', timeout: 15000,
    env: { ...process.env, SPORTSOVER_TEST_NETWORK: 'live' } });
  assert.equal(result.status, expected, result.stderr || result.error?.message);
  if (expected) assert.match(result.stderr, /external network access/);
}
(async () => {
  child("fetch('https://provider.test/feed').catch(() => {})");
  child("try { require('node:https').get('https://provider.test/feed') } catch {} ");
  child("try { require('node:net').connect(443, 'provider.test') } catch {} ");
  child("try { require('node:tls').connect({port:443,host:'provider.test'}) } catch {} ");
  child("fetch('http://127.0.0.1.example.com/feed').catch(() => {})");
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') response.writeHead(302, { Location: 'https://provider.test/feed' });
    else response.end('local');
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Async children keep this server able to respond.
  const { spawn } = require('node:child_process');
  async function fetching(url, expected) {
    await new Promise((resolve, reject) => {
      const process = spawn(require('node:process').execPath, ['--require', guard, '-e', `fetch(${JSON.stringify(url)}).then(r=>r.text()).catch(()=>{})`]);
      let stderr = ''; process.stderr.on('data', chunk => stderr += chunk);
      process.on('error', reject);
      process.on('close', code => { try { assert.equal(code, expected, stderr); if (expected) assert.match(stderr, /external network access/); resolve(); } catch (error) { reject(error); } });
    });
  }
  try { await fetching(base, 0); await fetching(`${base}/redirect`, 1); }
  finally { await new Promise(resolve => server.close(resolve)); }
  console.log('Offline Node boundaries passed: fetch, HTTP/TLS/raw sockets, inherited live settings, redirects, and local traffic.');
})().catch(error => { console.error(error); process.exitCode = 1; });
