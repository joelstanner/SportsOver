const { chromium } = require('../../scripts/test-browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
require('../../core/config.js');
const root = path.resolve(__dirname, '../..');
const config = global.SportsOverlay.config.normalizeConfig();
config.timeZone = 'America/Los_Angeles';
config.sports.forEach(group => { group.enabled = group.sport === 'disc-golf'; });
config.sports.find(group => group.sport === 'disc-golf').events = [
  { tournamentId:'97346', division:'MPO', enabled:true, view:'leaderboard', leaderboardSize:3 },
  { tournamentId:'97346', division:'MPO', enabled:true, view:'player', playerId:'75412', bannerId:'gannon' },
];
config.lockedGameKeys = ['disc-golf:97346:MPO'];
const metadata = { Name:'2026 United States Disc Golf Championship', StartDate:'2026-10-08', EndDate:'2026-10-11',
  DateRange:'Thu-Sun, Oct 8-11, 2026', TimeZone:'America/New_York', Rounds:4, LatestRound:1,
  RoundsList:{1:{Date:'2026-10-08'}}, Divisions:[{Division:'MPO', LatestRound:1}] };
const round = { scores:[
  {Name:'Gannon Buhr', PDGANum:75412, Round:1, Rating:1060, TeeTime:'14:00:00'},
  {Name:'Calvin Heimburg', PDGANum:45971, Round:1, Rating:1051, TeeTime:'14:50:00'},
], layouts:[] };
(async () => {
  const browser = await chromium.launch({headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
  try {
    const context = await browser.newContext({viewport:{width:1120,height:850}, timezoneId:'America/Chicago'});
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'www.pdga.com') return route.fulfill({json:{data:url.pathname.endsWith('fetch_event') ? metadata : round}});
      if (url.hostname !== 'overlay.test') return route.fulfill({json:{events:[],dates:[]}});
      const file = url.pathname === '/admin/' ? 'admin/index.html' : url.pathname.slice(1);
      try { return route.fulfill({body:await fs.readFile(path.join(root,file)), contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]}); }
      catch { return route.fulfill({status:404,body:''}); }
    });
    const page = await context.newPage(), banner = await context.newPage();
    const errors = [];
    for (const surface of [page,banner]) surface.on('pageerror', error => errors.push(error.message));
    await page.goto('http://overlay.test/admin/');
    await page.evaluate(config => localStorage.setItem('sports-overlay.config.v1',JSON.stringify(config)),config);
    await page.reload();
    await page.getByRole('button',{name:'Live control',exact:true}).click();
    const preview = page.locator('#rotation-queue [data-game-key="disc-golf:97346:MPO:banner:gannon"] .game-meta');
    await preview.waitFor();
    assert.match(await preview.innerText(), /Tee 11:00 AM PDT/);
    await banner.goto('http://overlay.test/index.html?sport=disc-golf');
    await banner.locator('.pdga-entry').first().waitFor();
    assert.deepEqual(await banner.locator('.pdga-thru').allTextContents(), ['11:00 AM','11:50 AM']);
    assert.equal(await banner.locator('.pdga-labels span').last().innerText(), 'TEE (PDT)');
    assert.match(await banner.locator('.pdga-thru').first().getAttribute('title'), /Tee 11:00 AM PDT/);
    const noOverflow = async selector => assert.deepEqual(await banner.locator(selector).evaluateAll(elements => elements
      .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent)), []);
    await noOverflow('.pdga-thru');
    await banner.locator('#sports-overlay').screenshot({path:'/tmp/sportsover-pdga-tee-times-board.png'});
    // Use the actual Settings control and observe the saved setting in another window.
    for (const [zone,expected] of [['America/New_York','2:00 PM EDT'],['local','1:00 PM CDT'],['Asia/Calcutta','11:30 PM UTC+5:30']]) {
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      await page.locator('#time-zone').selectOption(zone);
      await page.waitForFunction(zone => JSON.parse(localStorage.getItem('sports-overlay.config.v1')).timeZone === zone,zone);
      await banner.waitForFunction(expected => document.querySelector('.pdga-thru')?.textContent === expected.replace(/ [^ ]+$/, ''),expected);
      assert.equal(await banner.locator('.pdga-labels span').last().innerText(), `TEE (${expected.split(' ').pop()})`);
      await noOverflow('.pdga-thru');
      await page.getByRole('button',{name:'Live control',exact:true}).click();
      await page.waitForFunction(expected => [...document.querySelectorAll('#rotation-queue .game-meta')].some(el => el.textContent.includes(`Tee ${expected}`)),expected);
    }
    await banner.evaluate(({metadata,round}) => {
      const api = window.SportsOverlay;
      api.registry.getLayout('disc-golf').createLayout().render(api.pdga.normalizeEvent(metadata,round,
        {tournamentId:'97346',division:'MPO',view:'player',playerId:'75412'}));
    },{metadata,round});
    assert.equal(await banner.locator('.pdga-metric').last().locator('small').innerText(), 'TEE (UTC+5:30)');
    assert.equal(await banner.locator('.pdga-metric').last().locator('strong').innerText(), '11:30 PM');
    assert.match(await banner.locator('.pdga-footer').innerText(), /Tee 11:30 PM/);
    await noOverflow('.pdga-metric:last-child strong');
    await banner.locator('#sports-overlay').screenshot({path:'/tmp/sportsover-pdga-tee-times-player.png'});
    // Old/malformed feeds still explicitly identify unconverted times.
    await banner.evaluate(({metadata,round}) => {
      const api = window.SportsOverlay;
      api.registry.getLayout('disc-golf').createLayout().render(api.pdga.normalizeEvent({...metadata,TimeZone:null},round,
        {tournamentId:'97346',division:'MPO',view:'leaderboard'}));
    },{metadata,round});
    assert.deepEqual(await banner.locator('.pdga-thru').allTextContents(), ['14:00','14:50']);
    assert.equal(await banner.locator('.pdga-labels span').last().innerText(), 'TEE (LOCAL)');
    assert.match(await banner.locator('.pdga-footer').innerText(), /course local/);
    assert.match(await banner.locator('.pdga-thru').first().getAttribute('title'), /14:00 \(course local\)/);
    assert.deepEqual(errors,[]);
    console.log('PDGA tee times passed: leaderboard, player, preview, setting changes, Local, fractional offset, layout fit, and metadata fallback; feeds mocked.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
