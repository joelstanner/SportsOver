// Exercise Settings keyboard routing through the real renderer and desktop IPC.
const assert = require('node:assert/strict');

module.exports = async ({ admin, engine }) => {
  const initial = await engine.evaluate(() => window.SportsOverlay.engine.describe().renderedGameKey);
  const key = async (key, options = {}) => admin.evaluate(({ key, options }) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    document.querySelector('#live-mode').dispatchEvent(event);
    return event.defaultPrevented;
  }, { key, options });
  assert.equal(await key('ArrowRight'), true);
  await engine.waitForFunction(initial => window.SportsOverlay.engine.describe().renderedGameKey !== initial, initial);
  const next = await engine.evaluate(() => window.SportsOverlay.engine.describe().renderedGameKey);
  assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().rotationTransition), 'quick');
  assert.equal(await key('ArrowLeft'), true);
  await engine.waitForFunction(initial => window.SportsOverlay.engine.describe().renderedGameKey === initial, initial);

  for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing']) {
    assert.equal(await key('ArrowRight', { [modifier]: true }), false);
  }
  for (const tag of ['input', 'textarea', 'select', 'editable', 'slider']) {
    const prevented = await admin.evaluate(tag => {
      const element = document.createElement(['editable', 'slider'].includes(tag) ? 'div' : tag);
      if (tag === 'editable') element.contentEditable = 'true';
      if (tag === 'slider') element.setAttribute('role', 'slider');
      document.body.append(element);
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      element.remove();
      return event.defaultPrevented;
    }, tag);
    assert.equal(prevented, false, `${tag} retains arrow behavior`);
  }
  await admin.evaluate(() => document.querySelector('#reset-settings-dialog').showModal());
  assert.equal(await key('ArrowRight'), false, 'dialogs retain arrow behavior');
  await admin.evaluate(() => document.querySelector('#reset-settings-dialog').close());
  await admin.waitForTimeout(200);
  assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().renderedGameKey), initial);
  // The same engine lock rules apply to keyboard navigation from Settings.
  await admin.locator(`#rotation-queue [data-game-key="${initial}"] .lock-game`).click();
  await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 1);
  assert.equal(await key('ArrowRight'), true);
  await admin.waitForTimeout(200);
  assert.equal(await engine.evaluate(() => window.SportsOverlay.engine.describe().renderedGameKey), initial);
  await admin.locator(`#rotation-queue [data-game-key="${initial}"] .lock-game`).click();
  await engine.waitForFunction(() => window.SportsOverlay.engine.describe().queue.length === 2);
  await assert.rejects(engine.evaluate(() => window.sportsDesktop.action('browse-banner', 'next')), /Settings access required/);
  await assert.rejects(admin.evaluate(() => window.sportsDesktop.action('browse-banner', 'invalid')), /requires a direction/);
  assert.notEqual(initial, next);
};
