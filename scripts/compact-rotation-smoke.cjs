const assert = require('node:assert/strict');
module.exports = async ({ application, admin, banner }) => {
  const original = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop')).getBounds());
  const resize = async width => {
    await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop')).setSize(width, Math.round(width * 100 / 472)), width);
    await banner.waitForFunction(width => innerWidth === width, width);
  };
  const count = async expected => admin.waitForFunction(async expected => (await window.sportsDesktop.status()).inspection?.count === expected, expected);
  try {
    await resize(472);
    await admin.evaluate(() => window.sportsDesktop.action('demo-inspection', { mode: 'live', sport: 'all' }));
    await count(9);
    await resize(189);
    await count(7);
    await banner.waitForFunction(() => !['chess', 'disc-golf'].includes(document.querySelector('#sports-overlay').dataset.sport));
    const status = await admin.evaluate(() => window.sportsDesktop.status());
    const state = await fetch(new URL('/api/output', status.obsUrl)).then(r => r.json());
    assert.ok(!/chess-scorebug|pdga-scorebug/.test(state.html), 'OBS shares compact rotation');
    await admin.locator('#skip-individual-small').uncheck();
    await count(9);
    assert.equal((await admin.evaluate(() => window.sportsDesktop.status())).skipIndividualWhenSmall, false);
    await admin.reload();
    await admin.waitForFunction(async () => (await window.sportsDesktop.status()).skipIndividualWhenSmall === false);
    assert.equal(await admin.locator('#skip-individual-small').isChecked(), false);
    await admin.locator('#skip-individual-small').check();
    await count(7);
    await resize(236); await count(9);
    await admin.evaluate(() => window.sportsDesktop.action('demo-inspection', { mode: 'live', sport: 'chess' }));
    await count(1);
    await resize(189); await count(0);
    await banner.getByText('No team games · enlarge banner to show all sports').waitFor();
    await resize(236); await count(1);
    await banner.locator('.chess-scorebug').waitFor();
    console.log('Compact rotation checks passed: threshold, shared OBS, persisted toggle, empty queue, restoration.');
  } finally {
    await admin.evaluate(() => window.sportsDesktop.action('demo-inspection', null));
    await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop')).setBounds(bounds), original);
  }
};
