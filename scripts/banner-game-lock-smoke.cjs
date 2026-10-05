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
    const pinnedOnly = admin.locator('#pinned-only');
    const visibleKeys = () => admin.locator('#rotation-queue .game-card').evaluateAll(cards => cards.map(card => card.dataset.gameKey));
    assert.equal(await card(key).innerText(), 'Pin');
    assert.equal(await admin.locator('#unlock-all-games').innerText(), 'Unpin all');
    const availableCount = await admin.locator('#available-games .game-card').count();
    assert.equal(await pinnedOnly.isDisabled(), true, 'pinned-only filtering is unavailable without pins');
    assert.equal(await pinnedOnly.getAttribute('aria-pressed'), 'false');
    assert.equal((await visibleKeys()).length, initial.queue.length);
    assert.deepEqual(await open(), { enabled: true, checked: false, label: 'Pin current game' });
    await click(true);
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().queue.length === 1
      && window.SportsOverlay.engine.describe().renderedGameKey === key
      && window.SportsOverlay.config.loadConfig().lockedGameKeys.includes(key), key);
    await admin.waitForFunction(key => document.querySelector(`#rotation-queue [data-game-key="${key}"] .lock-game`)
      ?.getAttribute('aria-pressed') === 'true', key);
    assert.equal(await card(key).innerText(), 'Pinned');
    assert.equal(await pinnedOnly.isEnabled(), true, 'pinning enables the filter');
    const beforeFilter = await admin.evaluate(() => window.SportsOverlay.config.loadConfig());
    await pinnedOnly.click();
    assert.deepEqual(await visibleKeys(), [key]);
    assert.equal(await pinnedOnly.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await admin.evaluate(() => window.SportsOverlay.config.loadConfig()), beforeFilter, 'list filtering does not save rotation changes');
    assert.equal(await admin.locator('#available-games .game-card').count(), availableCount, 'available games are not filtered');
    assert.match(await admin.locator('#rotation-count').innerText(), new RegExp(`^1 of ${initial.queue.length} games`));
    const pinnedConfig = await admin.evaluate(() => window.SportsOverlay.config.loadConfig());
    await admin.locator('#queue-sport-filter').selectOption('chess');
    assert.deepEqual(await visibleKeys(), []);
    assert.equal(await admin.locator('#rotation-queue .rotation-empty').innerText(), 'No pinned games for this sport in rotation.');
    await admin.locator('#queue-sport-filter').selectOption('');
    assert.deepEqual(await visibleKeys(), [key]);
    assert.deepEqual(await admin.evaluate(() => window.SportsOverlay.config.loadConfig()), pinnedConfig, 'pin and sport list filters preserve saved settings');
    await admin.screenshot({ path: path.join(directory, 'pinned-only.png') });
    const saved = JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'));
    assert.deepEqual(saved.config.lockedGameKeys, [key]);
    assert.equal(saved.desktop.locked, false, 'game locking does not lock banner position');
    assert.equal((await open()).checked, true);
    await card(key).click();
    await engine.waitForFunction(() => window.SportsOverlay.config.loadConfig().lockedGameKeys.length === 0);
    assert.equal(await pinnedOnly.getAttribute('aria-pressed'), 'false', 'removing the last pin clears the filter');
    assert.equal(await pinnedOnly.isDisabled(), true);
    assert.equal((await visibleKeys()).length, initial.queue.length);
    assert.equal((await open()).checked, false, 'Live Control unlock updates banner menu');
    await card(key).click();
    await engine.waitForFunction(key => window.SportsOverlay.config.loadConfig().lockedGameKeys.includes(key), key);
    assert.equal((await open()).checked, true, 'Live Control lock updates banner menu');
    await card(otherKey).click();
    await engine.waitForFunction(() => window.SportsOverlay.config.loadConfig().lockedGameKeys.length === 2
      && window.SportsOverlay.engine.describe().queue.length === 2);
    await admin.waitForFunction(async () => (await window.sportsDesktop.engine()).queue.length === 2);
    await pinnedOnly.click();
    // The captured menu still targets the original rendered game.
    await click(false);
    await engine.waitForFunction(otherKey => {
      const state = window.SportsOverlay.engine.describe();
      return state.queue.length === 1 && state.currentGameKey === otherKey && state.renderedGameKey === otherKey
        && JSON.stringify(window.SportsOverlay.config.loadConfig().lockedGameKeys) === JSON.stringify([otherKey]);
    }, otherKey);
    await admin.waitForFunction(key => document.querySelector(`#rotation-queue [data-game-key="${key}"] .lock-game`)
      ?.getAttribute('aria-pressed') === 'true', otherKey);
    await admin.waitForFunction(key => {
      const keys = [...document.querySelectorAll('#rotation-queue .game-card')].map(card => card.dataset.gameKey);
      return keys.length === 1 && keys[0] === key;
    }, otherKey);
    assert.deepEqual(await visibleKeys(), [otherKey]);
    assert.equal(await pinnedOnly.getAttribute('aria-pressed'), 'true', 'the filter stays active while another pin remains');
    await admin.locator('#unlock-all-games').click();
    assert.equal(await pinnedOnly.getAttribute('aria-pressed'), 'false', 'Unpin all immediately clears the filter');
    assert.equal(await pinnedOnly.isDisabled(), true);
    await engine.waitForFunction(length => window.SportsOverlay.engine.describe().queue.length === length
      && window.SportsOverlay.config.loadConfig().lockedGameKeys.length === 0, initial.queue.length);
    assert.equal((await visibleKeys()).length, initial.queue.length, 'Unpin all restores the full list');
    await admin.waitForFunction(() => [...document.querySelectorAll('#rotation-queue .lock-game')]
      .every(button => button.getAttribute('aria-pressed') === 'false'));

    // Remove an automatic pinned game through the actual banner menu, then add
    // it back through Live Control. Preserve the scenario for subsequent checks.
    const beforeRemoval = await admin.evaluate(() => window.SportsOverlay.config.loadConfig());
    await open();
    // Both callbacks capture the displayed game from this menu. Rotation can
    // advance while settings and rendered frames propagate between processes.
    await click(true);
    await engine.waitForFunction(() => window.SportsOverlay.config.loadConfig().lockedGameKeys.length === 1);
    const removalKey = await engine.evaluate(() => window.SportsOverlay.config.loadConfig().lockedGameKeys[0]);
    await admin.waitForFunction(key => document.querySelector(`#rotation-queue [data-game-key="${key}"] .lock-game`)
      ?.getAttribute('aria-pressed') === 'true', removalKey);
    await pinnedOnly.click();
    await application.evaluate(() => {
      const item = globalThis.gameLockTestMenu.getMenuItemById('remove-current-game');
      if (!item || !item.enabled || item.label !== 'Remove from rotation') throw Error('Banner removal option is unavailable');
      item.click();
    });
    await engine.waitForFunction(key => {
      const config = window.SportsOverlay.config.loadConfig();
      const state = window.SportsOverlay.engine.describe();
      return config.excludedGames.includes(key) && !config.lockedGameKeys.includes(key)
        && !state.queue.some(entry => `${entry.candidate.sport}:${entry.candidate.id}` === key)
        && state.renderedGameKey !== key;
    }, removalKey).catch(async error => {
      const details = await engine.evaluate(() => {
        const config = window.SportsOverlay.config.loadConfig();
        const state = window.SportsOverlay.engine.describe();
        return { included: config.includedGames, excluded: config.excludedGames,
          pins: config.lockedGameKeys, current: state.currentGameKey, rendered: state.renderedGameKey,
          queue: state.queue.map(entry => `${entry.candidate.sport}:${entry.candidate.id}`) };
      });
      throw Error(`Banner removal of ${removalKey} did not finish: ${JSON.stringify(details)}`, { cause: error });
    });
    await admin.locator(`#available-games [data-game-key="${removalKey}"] .add-game`).waitFor();
    assert.equal(await admin.locator(`#rotation-queue [data-game-key="${removalKey}"]`).count(), 0);
    assert.equal(await pinnedOnly.getAttribute('aria-pressed'), 'false', 'removing the last pinned game clears the list filter');
    assert.equal(await pinnedOnly.isDisabled(), true);
    const removed = JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).config;
    assert.equal(removed.excludedGames.includes(removalKey), true, 'automatic removal persists its exclusion');
    assert.equal(removed.includedGames.includes(removalKey), false);
    assert.equal(removed.rotationOrder.includes(removalKey), false);
    assert.equal(removed.lockedGameKeys.includes(removalKey), false);
    await admin.locator(`#available-games [data-game-key="${removalKey}"] .add-game`).click();
    await engine.waitForFunction(key => window.SportsOverlay.engine.describe().queue
      .some(entry => `${entry.candidate.sport}:${entry.candidate.id}` === key), removalKey);
    await admin.evaluate(config => window.SportsOverlay.config.saveConfig(config, {
      fields: ['rotationMode', 'includedGames', 'excludedGames', 'rotationOrder', 'lockedGameKeys'],
    }), beforeRemoval);
    await engine.waitForFunction(config => {
      const saved = window.SportsOverlay.config.loadConfig();
      return ['rotationMode', 'includedGames', 'excludedGames', 'rotationOrder', 'lockedGameKeys']
        .every(field => JSON.stringify(saved[field]) === JSON.stringify(config[field]));
    }, beforeRemoval);
    await admin.waitForFunction(length => document.querySelectorAll('#rotation-queue .game-card').length === length, initial.queue.length);
  } finally {
    await application.evaluate(({ Menu }) => {
      Menu.buildFromTemplate = globalThis.gameLockTestBuild;
      delete globalThis.gameLockTestBuild;
      delete globalThis.gameLockTestMenu;
    });
  }
};
