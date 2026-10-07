// Real browser boundary checks use fake external hosts and never send to them.
require('./offline-network.cjs');
const { chromium } = require('playwright');
const { protectContext } = require('./test-browser.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
(async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/escape') response.writeHead(302, { Location: 'https://provider.test/escaped' });
    if (request.url === '/local') response.writeHead(302, { Location: '/' });
    response.end('local fixture');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
    const violations = [];
    const context = await protectContext(await browser.newContext({ serviceWorkers: 'block' }), violations);
    const page = await context.newPage();
    await page.goto(base);
    assert.equal(await page.locator('body').innerText(), 'local fixture');
    await page.goto(`${base}/local`);
    assert.equal(await page.locator('body').innerText(), 'local fixture', 'local redirects remain available');
    const remote = 'https://provider.test/unmocked';
    await assert.rejects(page.goto(remote));
    await page.waitForURL('chrome-error://chromewebdata/');
    assert.ok(violations.includes(remote));
    await page.route('https://provider.test/fixture', route => route.fulfill({ body: 'recorded fixture' }));
    await page.goto('https://provider.test/fixture');
    assert.equal(await page.locator('body').innerText(), 'recorded fixture');
    // Test handlers cannot accidentally continue or fetch a real remote URL.
    await page.route('https://provider.test/continue', async route => { try { await route.continue(); } catch {} });
    await assert.rejects(page.goto('https://provider.test/continue'));
    await page.waitForURL('chrome-error://chromewebdata/');
    await page.route('https://provider.test/fetch', async route => { try { await route.fetch(); } catch {} });
    await assert.rejects(page.goto('https://provider.test/fetch'));
    await page.waitForURL('chrome-error://chromewebdata/');
    await page.route(`${base}/escape`, async route => { try { await route.continue(); } catch {} });
    await assert.rejects(page.goto(`${base}/escape`));
    await page.waitForURL('chrome-error://chromewebdata/');
    assert.ok(violations.includes('https://provider.test/escaped'));
    await page.route('https://provider.test/redirect-fixture', route => route.fulfill({ status: 302, headers: { Location: remote }, body: '' }));
    await assert.rejects(page.goto('https://provider.test/redirect-fixture'));
    assert.equal(violations.length, 5, 'every bypass attempt was retained for final assertions');
    console.log('Offline browser boundary passed: fixtures, unmatched requests, continue/fetch escapes, local traffic and redirects.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
