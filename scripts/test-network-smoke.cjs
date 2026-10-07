// Check the real startup boundary without contacting any live provider.
const { electron } = require('./test-mode.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sportsover-test-network-'));
  let application;
  let localRequests = 0;
  const server = http.createServer(async (request, response) => {
    localRequests++;
    if (request.url === '/redirect') { response.writeHead(302, { Location: 'https://live-feed.test/escaped' }); response.end(); return; }
    if (request.url === '/local-redirect') { response.writeHead(302, { Location: '/echo' }); response.end(); return; }
    let body = '';
    for await (const chunk of request) body += chunk;
    response.end(`${request.method}:${body}`);
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const localUrl = `http://127.0.0.1:${server.address().port}`;
    // Deliberately inherit "live": the routine launcher must override it.
    application = await electron.launch({ expectBlockedRequests: true, args: [path.resolve(__dirname, '..')],
      env: { ...process.env, SPORTSOVER_TEST_DATA: directory, SPORTSOVER_TEST_NETWORK: 'live' } });
    const first = await application.firstWindow();
    await first.waitForFunction(() => !!window.sportsDesktop);
    // The first window exists while the remaining startup loads are still
    // pending. Wait for the launch check before replacing its HTTPS handler.
    for (let attempt = 0; attempt < 100; attempt++) {
      const checked = await application.evaluate(() => globalThis.sportsTestNetworkState().fixtures.some(url => url.includes('api.github.com/repos/joelstanner/SportsOver/releases/latest')));
      if (checked) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const status = await first.evaluate(() => window.sportsDesktop.status());
    const startup = await application.evaluate(() => globalThis.sportsTestNetworkState());
    assert.ok(startup, 'fixture protection is installed before first window');
    const results = await application.evaluate(async ({ net }, localUrl) => {
      let secureBlocked = false;
      try { secureBlocked = (await net.fetch('https://live-feed.test/unmocked')).status === 599; }
      catch (error) { secureBlocked = /ERR_BLOCKED_BY_CLIENT/.test(error.message); }
      let insecureBlocked = false;
      try { await net.fetch('http://live-feed.test/unmocked'); }
      catch (error) { insecureBlocked = /ERR_BLOCKED_BY_CLIENT/.test(error.message); }
      const post = await net.fetch(`${localUrl}/echo`, { method: 'POST', body: 'local command' });
      let redirectBlocked = false;
      try { await net.fetch(`${localUrl}/redirect`); }
      catch (error) { redirectBlocked = /ERR_BLOCKED_BY_CLIENT/.test(error.message); }
      const localRedirect = await net.fetch(`${localUrl}/local-redirect`);
      const state = globalThis.sportsTestNetworkState();
      return { secureBlocked, insecureBlocked, post: await post.text(), redirectBlocked, localRedirect: await localRedirect.text(), state };
    }, localUrl);
    assert.equal(results.secureBlocked, true);
    assert.equal(results.insecureBlocked, true);
    assert.equal(results.post, 'POST:local command');
    assert.equal(results.redirectBlocked, true, 'local redirects cannot escape protection');
    assert.equal(results.localRedirect, 'GET:', 'local redirects remain usable');
    assert.equal(localRequests, 4);
    const output = await application.evaluate(async ({ net }, url) => (await net.fetch(url)).status, new URL('/api/output', status.obsUrl).href);
    assert.equal(output, 200, 'local OBS output remains reachable through Electron');
    await application.evaluate(({ BrowserWindow }, url) => {
      globalThis.networkTestMirror = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      globalThis.networkTestMirror.loadURL(url);
    }, status.obsUrl);
    let mirror;
    for (let attempt = 0; attempt < 100; attempt++) {
      mirror = application.windows().find(page => page.url().startsWith(new URL(status.obsUrl).origin));
      if (mirror) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(mirror, 'the local OBS renderer opened');
    mirror.on('console', message => { if (message.type() === 'error') console.error('OBS renderer:', message.text()); });
    await mirror.waitForFunction(() => !!document.body.dataset.sequence, {}, { timeout: 5000 });
    await application.evaluate(({ session }) => {
      session.defaultSession.protocol.handle('https', () => Response.json({ fixture: true }));
    });
    assert.deepEqual(await application.evaluate(async ({ net }) => (await net.fetch('https://live-feed.test/fixture')).json()), { fixture: true });
    assert.equal(await application.evaluate(async ({ net }, url) => {
      try { await net.fetch(url); return false; }
      catch (error) { return /ERR_BLOCKED_BY_CLIENT/.test(error.message); }
    }, `${localUrl}/redirect`), true, 'native redirects stay blocked even after fixtures exist');
    const blocked = await application.evaluate(() => globalThis.sportsTestNetworkState());
    assert.ok(blocked.fixtures.some(url => url.includes('api.github.com/repos/joelstanner/SportsOver/releases/latest')), 'launch update check is mocked before startup');
    assert.equal(startup.blocked, 0, 'startup uses fixtures without unexpected traffic');
    console.log(`Test network smoke passed: ${blocked.blocked} unmocked requests blocked, fixtures work, local POST/OBS/redirects work, external redirects blocked. Isolated data: ${directory}`);
  } finally {
    if (application) await application.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
