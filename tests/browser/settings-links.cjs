// Exercise native Settings links without opening the user's browser or preferences.
const { electron } = require('../../scripts/test-mode.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
require('../../core/config.js');
const metadata = require('../sports/disc-golf/event.json');
const round = require('../sports/disc-golf/round.json');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sportsover-settings-links-'));
  const config = global.SportsOverlay.config.normalizeConfig();
  config.sports.forEach(group => {
    group.enabled = group.sport === 'disc-golf';
    group.autoFollow = false;
    group.discoverSecondTier = false;
  });
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ version: 1, config, desktop: { visible: false } }));
  let application;
  try {
    application = await electron.launch({ args: [path.resolve(__dirname, '../..')],
      env: { ...process.env, SPORTSOVER_TEST_DATA: directory } });
    await application.firstWindow();
    await application.evaluate(async ({ shell, session }, { metadata, round }) => {
      globalThis.openedLinks = [];
      shell.openExternal = async url => { globalThis.openedLinks.push(url); };
      await session.defaultSession.protocol.handle('https', request => new Response(JSON.stringify({
        data: request.url.includes('fetch_event') ? metadata : round,
      }), { headers: { 'Content-Type': 'application/json' } }));
    }, { metadata, round });
    let admin = application.windows().find(page => page.url().includes('/admin/'));
    if (!admin) admin = await application.waitForEvent('window', { predicate: page => page.url().includes('/admin/') });
    const sport = admin.locator('.sport-card[data-sport="disc-golf"]');
    await sport.locator('.pdga-tournament-input').fill('86076');
    await sport.getByRole('button', { name: 'Load tournament', exact: true }).click();
    await sport.locator('.pdga-division').selectOption('MPO');
    await sport.getByRole('button', { name: 'Watch division', exact: true }).click();
    const link = sport.locator('.pdga-watch-name').first();
    assert.equal(await link.isVisible(), true);
    const href = 'https://www.pdga.com/tour/event/86076';
    assert.equal(await link.getAttribute('href'), href);
    const settingsUrl = admin.url();
    const windowCount = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const opened = () => application.evaluate(() => globalThis.openedLinks);
    await link.click();
    await assertEventually(async () => assert.deepEqual(await opened(), [href]));
    await link.focus();
    await admin.keyboard.press('Enter');
    await assertEventually(async () => assert.deepEqual(await opened(), [href, href]));

    // Cards recreated by Settings updates retain native link behavior.
    await sport.getByRole('button', { name: 'Add player banner', exact: true }).first().click();
    await sport.locator('.pdga-watch-name').nth(1).click();
    await assertEventually(async () => assert.deepEqual(await opened(), [href, href, href]));
    for (const url of ['https://example.com/', 'https://www.pdga.com.evil.com/tour/event/86076',
      'https://user:password@www.pdga.com/tour/event/86076', 'http://www.pdga.com/tour/event/86076']) {
      await admin.evaluate(url => window.open(url, '_blank'), url);
    }
    const engine = application.windows().find(page => page.url().includes('engine=1'));
    const banner = application.windows().find(page => page.url().includes('display.html?desktop'));
    for (const page of [engine, banner]) await page.evaluate(url => window.open(url, '_blank'), href);
    await admin.waitForTimeout(100);
    assert.deepEqual(await opened(), [href, href, href], 'unrecognized links and non-Settings popups stay blocked');
    assert.equal(admin.url(), settingsUrl, 'Settings stays open');
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), windowCount,
      'external links do not create Electron windows');
    console.log('Native Settings links passed: added PDGA cards, mouse/keyboard activation, rerendered cards, URL validation, and popup isolation.');
  } finally {
    if (application) await application.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

async function assertEventually(check) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { await check(); return; }
    catch (error) {
      if (attempt === 49) throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}
