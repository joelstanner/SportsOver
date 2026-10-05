// Exercise the real context-menu handler and shared saved locks without opening
// a native popup. Visible smoke checks cover native menu presentation separately.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({ application, admin, engine, directory }) => {
  await application.evaluate(({ Menu }) => {
    globalThis.gameLockTestBuild = Menu.buildFromTemplate;
    Menu.buildFromTemplate = function(template) {
      const menu = globalThis.gameLockTestBuild.call(this, template);
      if (template.some(item => item.id === 'lock-current-game')) {
        globalThis.gameLockTestMenu = menu;
        menu.popup = () => {};
      }
      return menu;
    };
  });
  const open = async () => {
    const renderedKey = await engine.evaluate(() => window.SportsOverlay.engine.describe().renderedGameKey);
    await admin.waitForFunction(async key => (await window.sportsDesktop.engine()).renderedGameKey === key, renderedKey);
    return application.evaluate(({ BrowserWindow }) => {
      globalThis.gameLockTestMenu = null;
      BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'))
        .webContents.emit('context-menu');
      const item = globalThis.gameLockTestMenu.getMenuItemById('lock-current-game');
      return { enabled: item.enabled, checked: item.checked, label: item.label };
    });
  };
  const click = checked => application.evaluate(checked => {
    const item = globalThis.gameLockTestMenu.getMenuItemById('lock-current-game');
    item.click({ checked });
  }, checked);
  try {
    const initial = await engine.evaluate(() => window.SportsOverlay.engine.describe());
    const key = initial.renderedGameKey;
    const other = initial.queue.find(entry => `${entry.candidate.sport}:${entry.candidate.id}` !== key);
    const otherKey = `${other.candidate.sport}:${other.candidate.id}`;
    const card = key => admin.locator(`#rotation-queue [data-game-key="${key}"] .lock-game`);
    assert.equal(await card(key).innerText(), 'Pin');
    assert.equal(await admin.locator('#unlock-all-games').innerText(), 'Unpin all');
    assert.deepEqual(await open(), { enabled: true, checked: false, label: 'Pin current game' });
    await click(true);
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().queue.length === 1
      && window.SportsOverlay.engine.describe().renderedGameKey === key
      && window.SportsOverlay.config.loadConfig().lockedGameKeys.includes(key), key);
    await admin.waitForFunction(key => document.querySelector(`#rotation-queue [data-game-key="${key}"] .lock-game`)
      ?.getAttribute('aria-pressed') === 'true', key);
    assert.equal(await card(key).innerText(), 'Pinned');
    const saved = JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'));
    assert.deepEqual(saved.config.lockedGameKeys, [key]);
    assert.equal(saved.desktop.locked, false, 'game locking does not lock banner position');
    assert.equal((await open()).checked, true);
    await card(key).click();
    await engine.waitForFunction(() => window.SportsOverlay.config.loadConfig().lockedGameKeys.length === 0);
    assert.equal((await open()).checked, false, 'Live Control unlock updates banner menu');
    await card(key).click();
    await engine.waitForFunction(key => window.SportsOverlay.config.loadConfig().lockedGameKeys.includes(key), key);
    assert.equal((await open()).checked, true, 'Live Control lock updates banner menu');
    await card(otherKey).click();
    await engine.waitForFunction(() => window.SportsOverlay.config.loadConfig().lockedGameKeys.length === 2
      && window.SportsOverlay.engine.describe().queue.length === 2);
    await admin.waitForFunction(async () => (await window.sportsDesktop.engine()).queue.length === 2);
    // The captured menu still targets the original rendered game.
    await click(false);
    await engine.waitForFunction(otherKey => {
      const state = window.SportsOverlay.engine.describe();
      return state.queue.length === 1 && state.currentGameKey === otherKey && state.renderedGameKey === otherKey
        && JSON.stringify(window.SportsOverlay.config.loadConfig().lockedGameKeys) === JSON.stringify([otherKey]);
    }, otherKey);
    await admin.waitForFunction(key => document.querySelector(`#rotation-queue [data-game-key="${key}"] .lock-game`)
      ?.getAttribute('aria-pressed') === 'true', otherKey);
    await admin.locator('#unlock-all-games').click();
    await engine.waitForFunction(length => window.SportsOverlay.engine.describe().queue.length === length
      && window.SportsOverlay.config.loadConfig().lockedGameKeys.length === 0, initial.queue.length);
    await admin.waitForFunction(() => [...document.querySelectorAll('#rotation-queue .lock-game')]
      .every(button => button.getAttribute('aria-pressed') === 'false'));
  } finally {
    await application.evaluate(({ Menu }) => {
      Menu.buildFromTemplate = globalThis.gameLockTestBuild;
      delete globalThis.gameLockTestBuild;
      delete globalThis.gameLockTestMenu;
    });
  }
};
