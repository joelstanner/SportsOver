const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 472, height: 100 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'overlay.test') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      try { await route.fulfill({ body: await fs.readFile(path.join(root, file)), contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)] }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    await page.goto('http://overlay.test/?sport=basketball&demo=live');
    await page.locator('.basketball-scorebug[data-state="live"]').waitFor();
    await page.addStyleTag({ path: path.join(root, 'core/desktop.css') });
    const cases = await page.evaluate(() => {
      document.body.classList.add('desktop-banner');
      const results = [];
      for (const sport of ['baseball', 'football', 'college-football', 'hockey', 'soccer', 'basketball', 'college-basketball']) {
        const layout = window.SportsOverlay.registry.getLayout(sport).createLayout();
        for (const preseason of [false, true]) for (const play of [false, true]) for (const odds of [false, true]) {
          const event = window.SportsOverlay.registry.getDemo(sport, 'live');
          event.details.preseason = preseason;
          event.details.lastPlay = play ? 'A long live play description for the banner.' : '';
          event.details.lastEvent = play ? 'A long live match event for the banner.' : '';
          event.details.odds = odds ? {
            spread: { live: { away: -1.5, home: 1.5 }, prices: { live: { away: -120, home: 110 } } },
            moneyline: { live: { away: -120, home: 110 } },
          } : null;
          layout.render(event);
          const mount = document.querySelector('#sports-overlay');
          const frame = mount.getBoundingClientRect();
          results.push({ sport, preseason, play, odds, frameBottom: frame.bottom, frameHeight: frame.height,
            marker: getComputedStyle(mount, '::before').content,
            markerPosition: getComputedStyle(mount, '::before').position,
            oddsVisible: !!mount.querySelector('.sports-odds')?.getClientRects().length,
            rows: [...mount.children].filter(row => !row.hidden && row.getClientRects().length).map(row => ({ name: row.className, bottom: row.getBoundingClientRect().bottom })) });
        }
      }
      return results;
    });
    assert.equal(cases.length, 56);
    for (const item of cases) {
      const label = `${item.sport} preseason=${item.preseason} play=${item.play} odds=${item.odds}`;
      assert.equal(item.frameHeight, 88, `${label}: stable scoreboard height`);
      assert.equal(item.frameBottom, 94, `${label}: frame inside 100px desktop viewport`);
      for (const row of item.rows) assert.ok(row.bottom <= item.frameBottom - 1, `${label}: ${row.name} clipped at ${row.bottom}`);
      assert.ok(Math.abs(item.rows.at(-1).bottom - (item.frameBottom - 1)) < 0.5, `${label}: no unused band below the last row`);
      if (item.preseason) {
        assert.equal(item.marker, '"PRESEASON"', `${label}: visible preseason marker`);
        assert.equal(item.markerPosition, 'absolute', `${label}: preseason marker does not consume row height`);
      }
      if (item.odds && ['football', 'college-football', 'soccer', 'basketball', 'college-basketball'].includes(item.sport))
        assert.equal(item.oddsVisible, !item.play, `${label}: prioritize play text when both footers need space`);
    }
    const phxDet = await page.evaluate(() => {
      const layout = window.SportsOverlay.registry.getLayout('basketball').createLayout();
      const event = window.SportsOverlay.registry.getDemo('basketball', 'live');
      event.teams.away = { ...event.teams.away, id: 'PHX', name: 'Phoenix Suns', abbreviation: 'PHX', logoUrl: 'https://a.espncdn.com/i/teamlogos/nba/500/phx.png' };
      event.details.preseason = true;
      layout.render(event);
      const mount = document.querySelector('#sports-overlay');
      return { text: mount.innerText, lastPlayBottom: mount.querySelector('.basketball-last-play').getBoundingClientRect().bottom,
        frameBottom: mount.getBoundingClientRect().bottom };
    });
    assert.match(phxDet.text, /PHX/);
    assert.match(phxDet.text, /DET/);
    assert.ok(phxDet.lastPlayBottom <= phxDet.frameBottom - 1, 'PHX–Detroit preseason last play fits');
    console.log('All 56 live team-sport banner cases fit, including PHX–Detroit preseason.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
