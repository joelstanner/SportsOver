const assert = require('node:assert/strict');

module.exports = async ({ application, admin, banner }) => {
  const { original, area } = await application.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
    const original = win.getBounds(), area = screen.getDisplayMatching(original).workArea;
    win.setBounds({ ...original, x: Math.round(area.x + (area.width - original.width) / 2),
      y: Math.round(area.y + (area.height - original.height) / 2) });
    return { original, area };
  });
  const bounds = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(win => win.webContents.getURL().includes('display.html?desktop')).getBounds());
  try {
    for (const scale of [1.25, 0.75, 2, 0.5, 3, 1]) {
      const before = await bounds();
      await admin.locator('#desktop-size').selectOption(String(scale));
      const expectedWidth = Math.round(Math.min(472 * scale, area.width, area.height * 472 / 100));
      await banner.waitForFunction(width => innerWidth === width, expectedWidth);
      const after = await bounds();
      assert.equal(after.width, expectedWidth);
      assert.ok(Math.abs(before.x + before.width / 2 - after.x - after.width / 2) <= 0.5);
      assert.ok(Math.abs(before.y + before.height / 2 - after.y - after.height / 2) <= 0.5);
    }
    const beforeMenu = await bounds();
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('banner-size-1.25').click());
    const menuWidth = Math.round(Math.min(590, area.width, area.height * 472 / 100));
    await banner.waitForFunction(width => innerWidth === width, menuWidth);
    const afterMenu = await bounds();
    assert.ok(Math.abs(beforeMenu.x + beforeMenu.width / 2 - afterMenu.x - afterMenu.width / 2) <= 0.5);
    assert.ok(Math.abs(beforeMenu.y + beforeMenu.height / 2 - afterMenu.y - afterMenu.height / 2) <= 0.5);
    for (const [page, key, scale] of [[admin, 'ArrowUp', 1], [banner, 'ArrowDown', 1.25]]) {
      const before = await bounds();
      assert.equal(await page.evaluate(key => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        document.body.dispatchEvent(event);
        return event.defaultPrevented;
      }, key), true, 'arrow is routed to banner resizing');
      const width = Math.round(Math.min(472 * scale, area.width, area.height * 472 / 100));
      await banner.waitForFunction(width => innerWidth === width, width);
      const after = await bounds();
      assert.ok(Math.abs(before.x + before.width / 2 - after.x - after.width / 2) <= 0.5);
      assert.ok(Math.abs(before.y + before.height / 2 - after.y - after.height / 2) <= 0.5);
    }
  } finally {
    await admin.evaluate(() => window.sportsDesktop.action('size', 1));
    await application.evaluate(({ BrowserWindow }, original) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().includes('display.html?desktop')).setBounds(original), original);
  }
};
