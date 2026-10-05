// Exercise real renderer pointer events after native focus has already returned.
// Quiet runs simulate native focus ordering while keeping all windows hidden.
const assert = require('node:assert/strict');

module.exports = async ({ application, admin, banner, engine, quiet }) => {
  const locked = (await banner.evaluate(() => window.sportsDesktop.status())).locked;
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
    globalThis.activationEvents = [];
    for (const type of ['focus', 'blur']) win.on(type, () => globalThis.activationEvents.push({ type, at: Date.now() }));
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown') globalThis.activationEvents.push({ type: 'keyDown', key: input.key, at: Date.now() });
    });
  });
  await engine.evaluate(() => {
    window.activationCommands = [];
    window.sportsDesktop.onEngineCommand(command => window.activationCommands.push({ command, at: Date.now() }));
  });
  const settleOutput = async () => {
    await engine.waitForFunction(() => {
      const state = window.SportsOverlay.engine.describe();
      return state.currentGameKey === state.renderedGameKey;
    });
    const sequence = await banner.evaluate(async () => (await (await fetch('/api/output')).json()).sequence);
    await banner.waitForFunction(sequence => Number(document.body.dataset.sequence) >= sequence, sequence);
  };
  await banner.evaluate(() => {
    window.activationTransitions = 0;
    document.addEventListener('animationstart', event => {
      if (event.animationName.startsWith('sports-rotate')) window.activationTransitions++;
    });
  });
  try {
    if (quiet) {
      await application.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('display.html?desktop'));
        globalThis.bannerFocusSmoke = { win, isFocused: win.isFocused };
        win.isFocused = () => true;
      });
    }
    for (const lock of [false, true]) {
      await admin.evaluate(value => window.sportsDesktop.action(value ? 'lock' : 'unlock'), lock);
      for (const fraction of [0.05, 0.75]) {
        await settleOutput();
        if (quiet) {
          await application.evaluate(() => {
            const { win } = globalThis.bannerFocusSmoke;
            win.emit('blur'); win.emit('focus');
          });
        } else {
          // Establish banner focus first so switching to Settings always emits a
          // real blur, regardless of the preceding smoke scenario's window state.
          await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
            .find(win => win.webContents.getURL().includes('display.html?desktop')).focus());
          await banner.waitForFunction(() => document.hasFocus());
          await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
            .find(win => win.webContents.getURL().includes('/admin/')).focus());
          await admin.waitForFunction(() => document.hasFocus());
          await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
            .find(win => win.webContents.getURL().includes('display.html?desktop')).focus());
          await banner.waitForFunction(() => document.hasFocus());
        }
        const key = await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey);
        const transitions = await banner.evaluate(() => window.activationTransitions);
        const box = await banner.locator('.scorebug').boundingBox();
        const click = () => banner.locator('.scorebug').click({ position: { x: box.width * fraction, y: box.height * 0.05 } });
        await click();
        await banner.waitForTimeout(450);
        assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().currentGameKey), key,
          'activation click does not browse when native focus precedes pointerdown');
        assert.equal(await banner.evaluate(() => window.activationTransitions), transitions,
          'activation click does not play a rotation animation');
        await click();
        await engine.waitForFunction(key => window.SportsOverlay.engine.describe().currentGameKey !== key, key);
        await settleOutput();
      }
    }
  } catch (error) {
    console.log('Activation diagnostics:', JSON.stringify({
      native: await application.evaluate(() => globalThis.activationEvents),
      engine: await engine.evaluate(() => ({ commands: window.activationCommands,
        currentGameKey: window.SportsOverlay.engine.describe().currentGameKey })),
    }));
    throw error;
  } finally {
    await admin.evaluate(value => window.sportsDesktop.action(value ? 'lock' : 'unlock'), locked);
    if (quiet) {
      await application.evaluate(() => {
        const { win, isFocused } = globalThis.bannerFocusSmoke;
        win.isFocused = isFocused;
        win.emit('blur');
        delete globalThis.bannerFocusSmoke;
      });
    }
  }
};
