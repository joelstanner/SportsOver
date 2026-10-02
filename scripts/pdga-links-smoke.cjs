// Native PDGA links with isolated preferences and deterministic score feeds.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
require('../core/config.js');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sportsover-pdga-links-'));
  const config = global.SportsOverlay.config.normalizeConfig();
  config.sports.forEach(group => { group.enabled = group.sport === 'disc-golf'; });
  config.sports.find(group => group.sport === 'disc-golf').events = [{ tournamentId: '86076', division: 'MPO', enabled: true, view: 'leaderboard', playerId: '' }];
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ version: 1, config, desktop: { visible: false } }));
  const metadata = require('../tests/sports/disc-golf/event.json');
  const round = require('../tests/sports/disc-golf/round.json');
  let application;
  try {
    application = await electron.launch({ ...(process.env.SPORTSOVER_TEST_EXECUTABLE
      ? { executablePath: process.env.SPORTSOVER_TEST_EXECUTABLE, args: [] }
      : { args: [path.resolve(__dirname, '..')] }), env: { ...process.env, SPORTSOVER_TEST_DATA: directory } });
    await application.firstWindow();
    await application.evaluate(async ({ session, BrowserWindow, shell }, { metadata, round }) => {
      globalThis.pdgaLinks = { links: [], navigation: [] };
      shell.openExternal = async url => { globalThis.pdgaLinks.links.push(url); };
      await session.defaultSession.protocol.handle('https', request => new Response(JSON.stringify({
        data: request.url.includes('fetch_event') ? metadata : round,
      }), { headers: { 'Content-Type': 'application/json' } }));
      const engine = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('engine=1'));
      const send = engine.webContents.send.bind(engine.webContents);
      engine.webContents.send = (channel, ...args) => {
        if (channel === 'engine:command' && ['next', 'previous'].includes(args[0]?.type)) globalThis.pdgaLinks.navigation.push(args[0].type);
        return send(channel, ...args);
      };
    }, { metadata, round });
    let admin, engine, banner;
    for (let i = 0; i < 60; i++) {
      const pages = application.windows();
      admin = pages.find(page => page.url().includes('/admin/'));
      engine = pages.find(page => page.url().includes('engine=1'));
      banner = pages.find(page => page.url().includes('display.html?desktop'));
      if (admin && engine && banner) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(admin && engine && banner);
    await engine.reload();
    await banner.locator('.pdga-entry').first().waitFor();
    await admin.evaluate(() => window.sportsDesktop.action('show'));
    const scores = 'https://www.pdga.com/live/event/86076/MPO/scores?round=3';
    assert.equal(await banner.locator('.pdga-footer a').getAttribute('href'), scores);
    await banner.locator('.pdga-footer a').click();
    await admin.evaluate(() => window.sportsDesktop.action('lock'));
    await banner.locator('.pdga-footer a').click();
    await banner.locator('.pdga-event').click();
    await banner.locator('.pdga-name a').first().click();
    await banner.locator('.pdga-footer a').focus();
    await banner.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 600));
    const result = await application.evaluate(() => globalThis.pdgaLinks);
    assert.deepEqual(result.links, [scores, scores, 'https://www.pdga.com/tour/event/86076', 'https://www.pdga.com/player/33705', scores]);
    assert.deepEqual(result.navigation, []);
    await admin.evaluate(() => window.sportsDesktop.action('unlock'));
    await banner.locator('.pdga-total').first().click();
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.deepEqual(await application.evaluate(() => globalThis.pdgaLinks.navigation), ['next']);
    console.log('PDGA scores, tournament, and player links open without navigation; locked clicks, keyboard activation, and normal browsing passed.');
  } finally { if (application) await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
