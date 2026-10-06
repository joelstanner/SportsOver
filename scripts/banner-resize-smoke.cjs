const assert = require('node:assert/strict');

module.exports = async ({ application, admin, banner }) => {
  const { original, area } = await application.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
    if (process.platform === 'win32') {
      globalThis.originalBannerSetShape = win.setShape.bind(win);
      win.setShape = rects => { globalThis.lastBannerShape = rects; return globalThis.originalBannerSetShape(rects); };
    }
    const original = win.getBounds(), area = screen.getDisplayMatching(original).workArea;
    win.setBounds({ ...original, x: Math.round(area.x + (area.width - original.width) / 2),
      y: area.y });
    return { original, area };
  });
  const bounds = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(win => win.webContents.getURL().includes('display.html?desktop')).getBounds());
  try {
    for (const scale of [1.25, 0.75, 2, 0.5, 0.25, 3, 1]) {
      const before = await bounds();
      await admin.locator('#desktop-size').selectOption(String(scale));
      const expectedWidth = Math.round(Math.min(472 * scale, area.width, area.height * 472 / 100));
      await banner.waitForFunction(width => innerWidth === width, expectedWidth);
      const after = await bounds();
      assert.equal(after.width, expectedWidth);
      assert.ok(Math.abs(before.x + before.width / 2 - after.x - after.width / 2) <= 0.5);
      assert.equal(after.y, before.y);
    }
    const beforeMenu = await bounds();
    for (const scale of [0.25, 1.25]) {
      await application.evaluate(({ Menu }, scale) => Menu.getApplicationMenu().getMenuItemById(`banner-size-${scale}`).click(), scale);
      const menuWidth = Math.round(Math.min(472 * scale, area.width, area.height * 472 / 100));
      await banner.waitForFunction(width => innerWidth === width, menuWidth);
      const afterMenu = await bounds();
      assert.ok(Math.abs(beforeMenu.x + beforeMenu.width / 2 - afterMenu.x - afterMenu.width / 2) <= 0.5);
      assert.equal(afterMenu.y, beforeMenu.y);
    }
    await admin.evaluate(() => window.sportsDesktop.action('size', 1));
    for (const [page, key, scale] of [[admin, 'ArrowUp', 0.9], [banner, 'ArrowDown', 1]]) {
      const before = await bounds();
      await application.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
        globalThis.resizeFrames = [];
        globalThis.recordResize = () => globalThis.resizeFrames.push(win.getBounds());
        win.on('resize', globalThis.recordResize);
      });
      assert.equal(await page.evaluate(key => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        document.body.dispatchEvent(event);
        return event.defaultPrevented;
      }, key), true, 'arrow is routed to banner resizing');
      const width = Math.round(Math.min(472 * scale, area.width, area.height * 472 / 100));
      await banner.waitForFunction(width => innerWidth === width, width);
      const after = await bounds();
      const frames = await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'))
          .removeListener('resize', globalThis.recordResize);
        return globalThis.resizeFrames;
      });
      assert.ok(new Set(frames.map(frame => frame.width)).size > 2, 'native resize has intermediate frames');
      for (const frame of frames) {
        assert.equal(frame.y, before.y);
        assert.ok(Math.abs(before.x + before.width / 2 - frame.x - frame.width / 2) <= 0.5);
      }
      const geometry = await banner.evaluate(() => ({ width: document.body.style.width, height: document.body.style.height, zoom: document.body.style.zoom }));
      assert.deepEqual(geometry, { width: '472px', height: '100px', zoom: '' }, 'layout remains stable during scaling');
      assert.ok(Math.abs(before.x + before.width / 2 - after.x - after.width / 2) <= 0.5);
      assert.equal(after.y, before.y);
      assert.ok(Math.abs(after.width - before.width) >= 47 && Math.abs(after.width - before.width) <= 48, 'arrows adjust by ten percentage points');
      await admin.waitForFunction(scale => document.querySelector('#desktop-size').value === String(scale), scale);
      assert.equal(await admin.locator('#desktop-size option:checked').innerText(), `${Math.round(scale * 100)}%`);
    }
    for (let percent = 90; percent >= 10; percent -= 10) {
      await admin.evaluate(() => window.sportsDesktop.action('step-banner-size', -1));
      await banner.waitForFunction(width => innerWidth === width, Math.round(472 * percent / 100));
    }
    const tiny = await bounds();
    assert.equal(tiny.width, 47);
    if (process.platform === 'win32') {
      assert.ok(tiny.height >= 10, 'Windows may retain its native caption-height minimum');
      assert.deepEqual(await application.evaluate(() => globalThis.lastBannerShape),
        [{ x: 0, y: 0, width: 47, height: 10 }], 'drawing and mouse input are clipped to the 10% banner');
    } else assert.equal(tiny.height, 10);
    assert.equal(tiny.y, beforeMenu.y);
    await admin.waitForFunction(() => document.querySelector('#desktop-size').value === '0.1');
    await admin.evaluate(() => window.sportsDesktop.action('step-banner-size', -1));
    assert.deepEqual(await bounds(), tiny, '10% is the arrow minimum');
    await admin.evaluate(() => window.sportsDesktop.action('step-banner-size', 1));
    await banner.waitForFunction(() => innerWidth === 94);
    await admin.evaluate(() => window.sportsDesktop.action('size', 1));
    await admin.evaluate(async () => {
      await Promise.all(Array.from({ length: 8 }, () => window.sportsDesktop.action('step-banner-size', -1)));
    });
    await banner.waitForFunction(() => innerWidth === 94);
    const repeated = await bounds();
    assert.equal(repeated.y, beforeMenu.y);
    await admin.waitForFunction(() => document.querySelector('#desktop-size').value === '0.2');
  } finally {
    await admin.evaluate(() => window.sportsDesktop.action('size', 1));
    await application.evaluate(({ BrowserWindow }, original) => {
      const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
      win.setBounds(original);
      if (globalThis.originalBannerSetShape) { win.setShape = globalThis.originalBannerSetShape; delete globalThis.originalBannerSetShape; }
    }, original);
  }
};
