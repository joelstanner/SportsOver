const assert = require('node:assert/strict');

module.exports = async ({ admin, banner, engine, application }) => {
  for (const page of [admin, banner, engine]) page.setDefaultTimeout(10000);
  async function waitForQueue(count) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await admin.evaluate(() => window.sportsDesktop.engine())).queue.length === count) return;
      await admin.waitForTimeout(25);
    }
    throw Error(`Host queue did not settle at ${count} games`);
  }
  await admin.getByRole('button', { name: 'Live control', exact: true }).click();
  await admin.locator('#available-games [data-game-key="baseball:2"] .add-game').evaluate(button => button.click());
  await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 2);
  await waitForQueue(2);
  // Hover pauses timed rotation so only the arrow commands can change the game.
  await banner.evaluate(() => window.sportsDesktop.action('banner-hover', true));
  await admin.locator('h1').click();
  const arrow = key => admin.evaluate(key => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    if (!event.defaultPrevented) throw Error('Arrow was not routed to the banner');
  }, key);
  const before = await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey);
  await arrow('ArrowRight');
  await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey !== key, before);
  const after = await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey);
  assert.notEqual(after, before);
  await arrow('ArrowLeft');
  await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey === key, before);
  await admin.locator(`#rotation-queue [data-game-key="${before}"] .lock-game`).evaluate(button => button.click());
  await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 1);
  await waitForQueue(1);
  const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop')).getBounds());
  await arrow('ArrowRight');
  await banner.locator('.desktop-browse-notice').waitFor({ state: 'visible' });
  assert.match(await banner.locator('.desktop-browse-notice').innerText(), /Only one game pinned/);
  assert.match(await admin.locator('.desktop-browse-notice').innerText(), /Only one game pinned/);
  assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), before);
  assert.deepEqual(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop')).getBounds()), bounds);
  assert.equal(await banner.locator('.desktop-browse-notice').evaluate(node => getComputedStyle(node).pointerEvents), 'none');
  // Exercise resizing through both real desktop renderers and native bounds.
  const resizeKey = (page, key, options = {}) => page.evaluate(({ key, options }) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  }, { key, options });
  // Windows can round the client height by one pixel at fractional display DPI.
  const waitForSize = scale => banner.waitForFunction(scale => innerWidth === Math.round(472 * scale) && Math.abs(innerHeight - Math.round(100 * scale)) <= 1, scale);
  await admin.evaluate(() => window.sportsDesktop.action('size', 1));
  assert.equal(await resizeKey(admin, 'ArrowUp'), true);
  await waitForSize(0.95);
  assert.equal(await resizeKey(admin, 'ArrowDown'), true);
  await waitForSize(1);
  assert.equal(await resizeKey(banner, 'ArrowUp'), true);
  await waitForSize(0.95);
  assert.equal(await resizeKey(banner, 'ArrowDown'), true);
  await waitForSize(1);
  assert.equal(await resizeKey(admin, 'ArrowUp', { ctrlKey: true }), false);
  assert.equal(await admin.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    document.querySelector('#desktop-size').dispatchEvent(event);
    return event.defaultPrevented;
  }), false, 'size select retains its own arrows');
  await admin.evaluate(() => window.sportsDesktop.action('lock'));
  await resizeKey(banner, 'ArrowUp');
  await banner.locator('.desktop-browse-notice').waitFor({ state: 'visible' });
  assert.match(await banner.locator('.desktop-browse-notice').innerText(), /Unlock/);
  await waitForSize(1);
  await admin.evaluate(() => window.sportsDesktop.action('unlock'));
  await admin.evaluate(() => window.sportsDesktop.action('size', 0.1));
  await resizeKey(admin, 'ArrowUp');
  await waitForSize(0.1);
  await admin.evaluate(() => window.sportsDesktop.action('size', 3));
  await resizeKey(admin, 'ArrowDown');
  await waitForSize(3);
  await admin.evaluate(() => window.sportsDesktop.action('size', 1));
  await waitForSize(1);
  assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), before, 'resizing preserves the pinned game');
  await assert.rejects(engine.evaluate(() => window.sportsDesktop.action('step-banner-size', 1)), /Banner or Settings access required/);
  await assert.rejects(admin.evaluate(() => window.sportsDesktop.action('step-banner-size', 0)), /requires a direction/);
  await admin.locator(`#rotation-queue [data-game-key="${before}"] .lock-game`).evaluate(button => button.click());
  await waitForQueue(2);
  await arrow('ArrowRight');
  await banner.locator('.desktop-browse-notice').waitFor({ state: 'hidden' });
  await engine.waitForFunction(key => window.SportsOverlay.engine.describe().renderedGameKey !== key, before);
  console.log('Arrow navigation and resizing passed: both renderers, pin feedback, size limits, lock protection, input/modifier exclusions, and game preservation.');
};
