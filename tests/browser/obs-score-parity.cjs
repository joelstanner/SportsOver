// Compare OBS Normal against native score emphasis using identical mocked events.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../../scripts/test-browser.cjs');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="white"/></svg>' });
      assert.equal(url.hostname, 'overlay.test');
      const file = path.join(root, url.pathname.slice(1));
      return route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html' });
    });
    const native = await context.newPage(), obs = await context.newPage();
    await native.setViewportSize({ width: 472, height: 100 });
    await obs.setViewportSize({ width: 647, height: 137 });
    const errors = [];
    for (const page of [native, obs]) page.on('pageerror', error => errors.push(error.message));
    let count = 0;
    for (const sport of ['football', 'college-football', 'basketball', 'college-basketball', 'baseball', 'soccer']) {
      for (const page of [native, obs]) {
        await page.goto(`http://overlay.test/index.html?sport=${sport}&demo=live`);
        await page.waitForFunction(() => window.SportsOverlay?.registry && !document.querySelector('#sports-overlay').classList.contains('is-loading'));
        if (page === native) {
          await page.addStyleTag({ content: await fs.readFile(path.join(root, 'core/desktop.css'), 'utf8') });
          await page.evaluate(() => document.body.classList.add('desktop-banner'));
        } else await page.addStyleTag({ content: await fs.readFile(path.join(root, 'core/obs-layouts.css'), 'utf8') });
      }
      for (const variant of sport.includes('football') ? ['standard', 'high', 'timeout', 'odds', 'halftime', ...(sport === 'college-football' ? ['zero'] : [])] : ['standard', 'high']) {
        for (const page of [native, obs]) await page.evaluate(({ sport, variant }) => {
          const event = SportsOverlay.registry.getDemo(sport, 'live');
          if (variant === 'high') for (const team of Object.values(event.teams)) team.score += sport.includes('basketball') ? 100 : 10;
          if (variant === 'timeout') Object.assign(event.details, { down: null, distance: null, yardLine: '', lastPlay: 'Official timeout.' });
          if (variant === 'odds') event.details.odds = { moneyline: { live: { away: 110, home: -120 } } };
          if (variant === 'halftime') event.detailedState = 'Halftime';
          if (variant === 'zero') {
            event.teams.away = { id: 'fixture-nmsu', name: 'New Mexico State Aggies', abbreviation: 'NMSU', logoUrl: 'https://fixture.test/nmsu.svg', record: '2-3', score: 0, timeoutsRemaining: 3 };
            event.teams.home = { id: 'fixture-fiu', name: 'Florida International Panthers', abbreviation: 'FIU', logoUrl: 'https://fixture.test/fiu.svg', record: '2-2', score: 0, timeoutsRemaining: 3 };
            Object.assign(event.details, { clock: '2:43', quarter: '1ST', possessionTeam: 'FIU', down: 1, distance: 6, yardLine: 'NMSU 6' });
          }
          SportsOverlay.registry.getLayout(sport).createLayout().render(event);
        }, { sport, variant });
        const measure = page => page.evaluate(() => {
          const mount = document.querySelector('#sports-overlay'), row = mount.querySelector('.football-main,.basketball-main,.game-view,.soccer-main');
          return { height: mount.getBoundingClientRect().height, row: row.getBoundingClientRect().toJSON(),
            scores: [...mount.querySelectorAll('.football-score,.basketball-score,.team__score,.soccer-score')].map(el => ({ font: parseFloat(getComputedStyle(el).fontSize), box: el.getBoundingClientRect().toJSON() })),
            footer: [...mount.children].filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect().bottom),
            bottom: mount.getBoundingClientRect().bottom,
            teams: [...mount.querySelectorAll('.football-team,.basketball-team,.team,.soccer-team')].map(el => ({ width: el.clientWidth, scroll: el.scrollWidth })) };
        });
        const n = await measure(native), o = await measure(obs), label = `${sport} ${variant}`;
        assert.deepEqual(o.scores.map(s => s.font), n.scores.map(s => s.font), `${label}: native score sizing`);
        for (const score of o.scores) if (score.box.width) {
          assert(score.box.top >= o.row.top - 1 && score.box.bottom <= o.row.bottom + 1, `${label}: score fits row`);
          assert(score.box.left >= 0 && score.box.right <= 647, `${label}: score fits width`);
        }
        for (const team of o.teams) assert(team.scroll <= team.width + 1, `${label}: team does not overflow`);
        for (const bottom of o.footer) assert(bottom <= o.bottom + 1, `${label}: footer not clipped`);
        if (['football', 'basketball'].includes(sport) && variant !== 'halftime') {
          const zoom = 647 / 460;
          assert(Math.abs(o.row.height / zoom - n.row.height) < 1, `${label}: compact native row proportions`);
        }
        if (process.env.SCREENSHOT_DIR && (variant === 'standard' || variant === 'zero')) await obs.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${sport}-normal-${variant}-parity.png`) });
        count++;
      }
    }
    assert.deepEqual(errors, []);
    console.log(`OBS score parity: ${count} sport/variant comparisons passed, including NCAAF 0-0, NFL, NBA, three-digit basketball, optional odds/timeouts and footer fit; feeds mocked.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
