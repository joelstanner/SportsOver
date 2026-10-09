// Real native update dialogs, isolated settings and mocked release metadata.
const { electron, testMode } = require('./test-mode.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  if (testMode() !== 'visible') throw Error('Native update dialog verification requires --visible.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sportsover-update-dialog-'));
  let application;
  try {
    application = await electron.launch({ args: [path.resolve(__dirname, '..'), '--background'],
      env: { ...process.env, SPORTSOVER_TEST_DATA: directory } });
    const first = await application.firstWindow();
    await first.waitForFunction(async () => {
      try { return (await window.sportsDesktop.status()).engineReady; } catch { return false; }
    });
    // Wait for the silent automatic check to finish before invoking a manual one.
    for (let attempt = 0; ; attempt++) {
      const ready = await application.evaluate(({ Menu }) =>
        globalThis.sportsTestNetworkState().fixtures.some(url => url.includes('api.github.com'))
        && Menu.getApplicationMenu()?.getMenuItemById('check-updates')?.enabled);
      if (ready) break;
      if (attempt >= 100) throw Error('Startup update check did not finish');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await application.evaluate(({ app, session, dialog, Menu, BrowserWindow }) => {
      const { startupFixture } = process.mainModule.require(`${app.getAppPath()}/desktop/test-fixtures.cjs`);
      session.defaultSession.protocol.handle('https', request => request.url.includes('api.github.com')
        ? Response.json({ tag_name: 'v99.0.0', draft: false, prerelease: false }) : startupFixture(request.url));
      globalThis.updateDialogObservations = [];
      const showMessageBox = dialog.showMessageBox.bind(dialog);
      dialog.showMessageBox = async (parent, options) => {
        if (!parent || !options) throw Error('Update dialog has no owner');
        const controller = new AbortController();
        const observation = {
          parentId: parent.id, visible: parent.isVisible(),
          minimized: parent.isMinimized(), topmost: parent.isAlwaysOnTop(),
          menuLabel: Menu.getApplicationMenu().getMenuItemById('check-updates').label,
        };
        globalThis.updateDialogObservations.push(observation);
        // Cancel the actual native dialog automatically without opening a browser.
        const timer = setTimeout(() => controller.abort(), 1500);
        try {
          const pending = showMessageBox(parent, { ...options, title: 'SportsOver update dialog test', signal: controller.signal });
          await new Promise(resolve => setTimeout(resolve, 300));
          observation.modal = !parent.isEnabled();
          return await pending;
        } finally { clearTimeout(timer); }
      };
      Menu.getApplicationMenu().getMenuItemById('toggle-banner').click();
      const banner = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
      if (!banner.isVisible() || !banner.isAlwaysOnTop()) throw Error('Test needs a visible topmost banner');
    });
    for (const initialState of ['closed', 'minimized', 'hidden']) {
      console.log(`Checking native update dialog with ${initialState} Settings.`);
      const previousCount = await application.evaluate(() => globalThis.updateDialogObservations.length);
      await application.evaluate(({ BrowserWindow, Menu }, initialState) => {
        const owner = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/admin/'));
        if (initialState === 'closed' && owner) throw Error('Expected no Settings window at background startup');
        if (initialState === 'minimized') owner.minimize();
        if (initialState === 'hidden') owner.hide();
        Menu.getApplicationMenu().getMenuItemById('check-updates').click();
      }, initialState);
      // Electron's MenuItem.click wrapper does not return the checker's promise.
      for (let attempt = 0; ; attempt++) {
        const complete = await application.evaluate(({ Menu }, previousCount) =>
          globalThis.updateDialogObservations.length > previousCount
          && Menu.getApplicationMenu().getMenuItemById('check-updates').enabled, previousCount);
        if (complete) break;
        if (attempt >= 100) throw Error('Native update dialog did not finish');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const result = await application.evaluate(({ BrowserWindow, Menu }) => {
        const parent = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/admin/'));
        const menu = Menu.getApplicationMenu().getMenuItemById('check-updates');
        return { observation: globalThis.updateDialogObservations.at(-1), parentId: parent.id,
          topmost: parent.isAlwaysOnTop(), enabled: parent.isEnabled(), menuLabel: menu.label, menuEnabled: menu.enabled };
      });
      assert.equal(result.observation.parentId, result.parentId);
      assert.equal(result.observation.visible, true);
      assert.equal(result.observation.minimized, false);
      assert.equal(result.observation.topmost, true);
      assert.equal(result.observation.modal, true);
      assert.equal(result.observation.menuLabel, 'Update dialog open…');
      assert.equal(result.topmost, false);
      assert.equal(result.enabled, true);
      assert.equal(result.menuLabel, 'Check for updates…');
      assert.equal(result.menuEnabled, true);
      console.log(`Native update dialog passed with ${initialState} Settings.`);
    }
  } catch (error) { console.error(error); throw error; }
  finally { if (application) await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
