// Isolated fixture check for selective Available games discovery and saved controls.
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
require('../../core/config.js');
const root = path.resolve(__dirname, '../..'), config = global.SportsOverlay.config.normalizeConfig();
config.sports.forEach(group => { group.enabled = ['chess', 'disc-golf'].includes(group.sport); group.autoFollow = false; });
const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
const tour = { id: 'Select01', name: 'International Masters Open', tier: 3, dates: [now - 1000, now + 86400000] };
const round = { id: 'Round001', name: 'Round 1', ongoing: true, startsAt: now - 1000 };
const metadata = { tour, rounds: [round], defaultRoundId: round.id };
const players = [{ name: 'Master One', fideId: 1, title: 'GM' }, { name: 'Master Two', fideId: 2, title: 'WGM' }];
const payload = { tour, round, games: [{ id: 'Game0001', players, lastMove: 'e2e4', status: '*', fen: '8/8/8/8/8/8/8/8 b - - 0 1' }] };
const directory = [{ tournId: 12345, tier: 'A', officialName: 'Regional Pro Championship', startDate: day, endDate: day }];
const pdga = { Name: directory[0].officialName, TierPro: 'A', ScoringFormat: 'S', FinalRound: 3, Divisions: [{ Division: 'MPO', LatestRound: 1 }] };
const scores = { scores: [{ Name: 'Pro Player', PDGANum: 123, Rating: 1020, Round: 1, RoundStarted: 1, Played: 5, Completed: 0, RunningPlace: 1, ToPar: -3 }] };
(async () => {
 const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
 try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } }), errors = [];
  await context.route('**/*', async route => {
   const url = new URL(route.request().url());
   if (url.hostname === 'lichess.org') return route.fulfill({ json: url.pathname.endsWith('/top') ? { active: [{ tour, round }] }
    : url.pathname.endsWith('/players') ? players.map((player, i) => ({ ...player, score: 1 - i, rank: i + 1 })) : url.pathname.includes('/-/-/') ? payload : metadata });
   if (url.hostname === 'www.pdga.com') return route.fulfill({ json: url.pathname.includes('current-events') ? directory : { data: url.pathname.endsWith('fetch_event') ? pdga : scores } });
   if (url.hostname !== 'overlay.test') return route.fulfill({ json: { events: [], dates: [] } });
   const file = url.pathname === '/admin/' ? 'admin/index.html' : url.pathname.slice(1);
   try { return route.fulfill({ body: await fs.readFile(path.join(root, file)), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] }); }
   catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://overlay.test/admin/');
  await page.evaluate(value => localStorage.setItem('sports-overlay.config.v1', JSON.stringify(value)), config); await page.reload();
  await page.getByRole('button', { name: 'Live control', exact: true }).click();
  const chessKey = 'chess:Select01:auto', pdgaKey = 'disc-golf:12345:MPO';
  const available = key => page.locator(`#available-games [data-game-key="${key}"]`);
  await available(chessKey).waitFor(); await available(pdgaKey).waitFor();
  assert.equal(await page.locator('#rotation-queue [data-game-key]').count(), 0);
  assert.match(await available(chessKey).innerText(), /Second tier.*2 GM\/WGM/s);
  assert.match(await available(pdgaKey).innerText(), /Pro A-tier.*1020/s);
  await page.screenshot({ path: '/tmp/sportsover-second-tier-available.png', fullPage: true });
  await available(chessKey).getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator(`#rotation-queue [data-game-key="${chessKey}"]`).waitFor();
  await available(pdgaKey).getByRole('button', { name: 'Watch division', exact: true }).click();
  await page.waitForFunction(() => window.SportsOverlay.config.loadConfig().sports.find(group => group.sport === 'disc-golf').events.length === 1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.chess-second-tier').uncheck(); await page.locator('.pdga-second-tier').uncheck();
  await page.waitForFunction(() => window.SportsOverlay.config.loadConfig().sports.filter(group => ['chess', 'disc-golf'].includes(group.sport)).every(group => !group.discoverSecondTier));
  await page.reload(); assert.equal(await page.locator('.chess-second-tier').isChecked(), false);
  assert.equal(await page.locator('.pdga-second-tier').isChecked(), false);
  await page.getByRole('button', { name: 'Live control', exact: true }).click();
  await page.locator(`#rotation-queue [data-game-key="${pdgaKey}"]`).waitFor();
  assert.equal(await page.locator(`[data-game-key="${chessKey}"]`).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Second-tier browser check passed: labeled suggestions, available-only default, add, keep watch, persisted opt-out and manual watch preservation.');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
