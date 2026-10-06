const assert = require('node:assert/strict');

module.exports = async ({ application, admin, banner, engine }) => {
  const bounds = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(win => win.webContents.getURL().includes('display.html?desktop')).getBounds());
  const key = (page, direction, options = {}) => page.evaluate(({ direction, options }) => {
    const event = new KeyboardEvent('keydown', { key: direction, shiftKey: true, bubbles: true, cancelable: true, ...options });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  }, { direction, options });
  async function waitForBounds(expected) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const actual = await bounds();
      if (Object.keys(expected).every(key => expected[key] === actual[key])) return;
      await banner.waitForTimeout(10);
    }
    assert.deepEqual(await bounds(), expected);
  }
  const original = await bounds();
  const initialGame = await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey);
  try {
    for (const page of [admin, banner]) {
      let expected = await bounds();
      for (const [direction, dx, dy] of [['ArrowDown', 0, 5], ['ArrowRight', 5, 0], ['ArrowUp', 0, -5], ['ArrowLeft', -5, 0]]) {
        assert.equal(await key(page, direction), true);
        expected = { ...expected, x: expected.x + dx, y: expected.y + dy };
        await waitForBounds(expected);
      }
    }
    for (let i = 0; i < 10; i++) assert.equal(await key(banner, 'ArrowRight', { repeat: true }), true);
    await waitForBounds({ ...original, x: original.x + 50 });
    for (let i = 0; i < 10; i++) await key(admin, 'ArrowLeft', { repeat: true });
    await waitForBounds(original);
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'isComposing']) {
      for (const page of [admin, banner]) assert.equal(await key(page, 'ArrowRight', { [modifier]: true }), false);
    }
    for (const selector of ['#desktop-size', '#live-mode-final-minutes']) {
      assert.equal(await admin.evaluate(selector => {
        const event = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true });
        document.querySelector(selector).dispatchEvent(event);
        return event.defaultPrevented;
      }, selector), false, 'Settings fields retain Shift + arrows');
    }
    await admin.evaluate(() => document.querySelector('#reset-settings-dialog').showModal());
    assert.equal(await key(admin, 'ArrowRight'), false, 'dialogs retain Shift + arrows');
    await admin.evaluate(() => document.querySelector('#reset-settings-dialog').close());
    await admin.evaluate(() => window.sportsDesktop.action('lock'));
    await key(banner, 'ArrowRight');
    await banner.locator('.desktop-browse-notice').waitFor({ state: 'visible' });
    assert.match(await banner.locator('.desktop-browse-notice').innerText(), /Unlock/);
    await waitForBounds(original);
    await admin.evaluate(() => window.sportsDesktop.action('unlock'));
    await assert.rejects(engine.evaluate(() => window.sportsDesktop.action('step-banner-position', 'ArrowRight')), /Banner or Settings access required/);
    await assert.rejects(admin.evaluate(() => window.sportsDesktop.action('step-banner-position', 'invalid')), /requires an arrow direction/);
    await admin.evaluate(async () => {
      await window.sportsDesktop.action('step-banner-size', -1);
      await window.sportsDesktop.action('step-banner-position', 'ArrowRight');
    });
    const moved = await bounds();
    await banner.waitForTimeout(150);
    assert.deepEqual(await bounds(), moved, 'moving cancels pending resize frames');
    assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), initialGame, 'moving does not browse games');
  } finally {
    await admin.evaluate(() => window.sportsDesktop.action('unlock'));
    await application.evaluate(({ BrowserWindow }, original) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().includes('display.html?desktop')).setBounds(original), original);
  }
};
