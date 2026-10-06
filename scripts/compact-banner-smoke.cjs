const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async ({ application, admin, banner, directory }) => {
  const original = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop')).getBounds());
  const resize = async percent => {
    const width = Math.round(472 * percent / 100);
    await application.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop')).setSize(width, height), { width, height: percent });
    await banner.waitForFunction(width => innerWidth === width, width);
  };
  const fixture = async (sport, mode) => {
    await admin.evaluate(({ sport, mode }) => window.sportsDesktop.action('demo-inspection', { sport, mode }), { sport, mode });
    await banner.waitForFunction(({ sport, mode }) => {
      const root = document.querySelector('#sports-overlay');
      return root.dataset.sport === sport && root.dataset.fixtureState === (mode === 'mixed' ? 'live' : mode);
    }, { sport, mode });
    await banner.waitForFunction(() => !document.querySelector('#sports-overlay').getAnimations().some(animation => animation.animationName?.startsWith('sports-rotate-')));
  };
  const geometry = () => banner.evaluate(() => {
    const root = document.querySelector('#sports-overlay');
    const scores = [...root.querySelectorAll('.team__score, .football-score, .basketball-score, .hockey-score, .soccer-score')];
    const teams = [...root.querySelectorAll('.team, .football-team, .basketball-team, .hockey-team, .soccer-team')];
    const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    return { halftime: root.dataset.halftime === "true", marker: getComputedStyle(root, "::after").content, font: scores.map(el => parseFloat(getComputedStyle(el).fontSize)),
      scores: scores.map(rect), teams: teams.map(rect), root: rect(root),
      detailsVisible: [...root.querySelectorAll('.football-center, .basketball-center, .hockey-center, .soccer-center, .live-panel, .status-details, .football-status, .hockey-status, .soccer-status, .basketball-status')].some(el => el.getBoundingClientRect().height > 0),
      demo: getComputedStyle(root.querySelector('.demo-mark')).display };
  });
  let obs;
  try {
    const obsUrl = (await admin.evaluate(() => window.sportsDesktop.status())).obsUrl;
    await application.evaluate(async ({ BrowserWindow }, url) => {
      const win = new BrowserWindow({ width: 189, height: 100, show: false });
      await win.loadURL(url);
    }, obsUrl);
    obs = application.windows().find(page => page.url().startsWith(new URL(obsUrl).origin));
    for (const sport of ['baseball', 'football', 'college-football', 'basketball', 'college-basketball', 'hockey', 'soccer']) {
      for (const mode of ['live', 'final', 'pregame', 'interrupted']) {
        await fixture(sport, mode);
        for (const percent of [50, 49, 40, 30, 20, 10]) {
          await resize(percent);
          const result = await geometry();
          assert.equal(result.font.length, 2);
          if (percent === 50 || mode === 'interrupted' && !result.halftime) { assert.ok(result.font.every(size => size < 60), 'full layout outside compact states'); continue; }
          if (result.halftime) assert.match(result.marker, /H.*T/s, 'halftime marker is visible');
          assert.deepEqual(result.font, [60, 60], `${sport} ${mode} ${percent}% scores`);
          assert.equal(result.detailsVisible, mode === 'pregame', 'only upcoming date/time remains visible');
          assert.notEqual(result.demo, 'none', 'DEMO remains visible');
          for (let i = 0; mode !== 'pregame' && i < 2; i++) {
            const score = result.scores[i], team = result.teams[i];
            assert.ok(score.left >= team.left - 0.1 && score.right <= team.right + 0.1, `${sport}: score fits team`);
            assert.ok(score.top >= result.root.top && score.bottom <= result.root.bottom, `${sport}: score fits height`);
          }
          assert.ok(result.teams[0].right < result.teams[1].left, 'teams do not overlap');
        }
        await resize(40);
        await banner.screenshot({ path: path.join(directory, `compact-${sport}-${mode}.png`) });
        await obs.waitForFunction(({ sport, mode }) => {
          const root = document.querySelector('#sports-overlay');
          return root.dataset.sport === sport && root.dataset.fixtureState === mode;
        }, { sport, mode });
        const obsFont = await obs.locator('.team__score, .football-score, .basketball-score, .hockey-score, .soccer-score').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        assert.ok(obsFont < 60, 'narrow OBS retains its original layout');
      }
      for (const mode of ['no-event', 'offline', 'error']) {
        await fixture(sport, mode);
        assert.ok((await geometry()).font.every(size => size < 60), `${sport} ${mode} retains original layout`);
      }
    }
    // Exercise state changes on the same layout instance.
    await fixture('football', 'mixed');
    for (const mode of ['live', 'pregame', 'interrupted', 'final']) {
      if (mode !== 'live') await admin.evaluate(() => window.sportsDesktop.action('browse-banner', 'next'));
      await banner.waitForFunction(mode => document.querySelector('#sports-overlay').dataset.fixtureState === mode, mode);
      assert.equal((await geometry()).font[0], 60, 'football halftime stays compact');
    }
    await fixture('basketball', 'final');
    await banner.evaluate(() => {
      document.querySelector('#basketball-away-score').textContent = '104';
      document.querySelector('#basketball-home-score').textContent = '111';
    });
    const wide = await geometry();
    for (let i = 0; i < 2; i++) assert.ok(wide.scores[i].left >= wide.teams[i].left - 0.1 && wide.scores[i].right <= wide.teams[i].right + 0.1, `three-digit scores fit: ${JSON.stringify(wide)}`);
    await banner.screenshot({ path: path.join(directory, 'compact-three-digit.png') });
    console.log(`Compact banner checks passed. Screenshots: ${directory}`);
  } finally {
    await admin.evaluate(() => window.sportsDesktop.action('demo-inspection', null));
    if (obs) await application.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)?.destroy(), obs.url());
    await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop')).setBounds(bounds), original);
  }
};
