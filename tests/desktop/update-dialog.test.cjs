require('../../scripts/offline-network.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { showUpdateDialog } = require('../../desktop/update-dialog.cjs');

function windowFixture({ minimized = false, onTop = false } = {}) {
  const calls = [];
  const parent = {
    isDestroyed: () => false,
    isMinimized: () => minimized,
    isAlwaysOnTop: () => onTop,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    setAlwaysOnTop: (...args) => calls.push(args),
  };
  return { parent, calls };
}

test('update results restore and raise their Settings owner until the native modal closes', async () => {
  for (const platform of ['win32', 'darwin']) {
    const { parent, calls } = windowFixture({ minimized: true });
    const options = { message: 'Update available', buttons: ['Later'] };
    let close;
    const pending = showUpdateDialog({ parent, options, platform, dialog: {
      showMessageBox: (owner, value) => {
        assert.equal(owner, parent);
        assert.equal(value, options);
        calls.push('dialog');
        return new Promise(resolve => { close = resolve; });
      },
    } });
    assert.deepEqual(calls, ['restore', [true, platform === 'win32' ? 'pop-up-menu' : 'floating'], 'show', 'focus', 'dialog']);
    close({ response: 0 });
    assert.deepEqual(await pending, { response: 0 });
    assert.deepEqual(calls.at(-1), [false]);
  }
});

test('dialog failure restores normal stacking and a closed parent is left alone', async () => {
  for (const destroyed of [false, true]) {
    const { parent, calls } = windowFixture();
    await assert.rejects(showUpdateDialog({ parent, options: {}, dialog: {
      showMessageBox: async () => {
        parent.isDestroyed = () => destroyed;
        throw Error('dialog failed');
      },
    } }), /dialog failed/);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === false), !destroyed);
  }
});

test('quiet tests retain hidden windows and existing topmost owners retain their stacking', async () => {
  for (const options of [{ foreground: false }, { onTop: true }]) {
    const { parent, calls } = windowFixture(options);
    await showUpdateDialog({ parent, options: {}, foreground: options.foreground, dialog: {
      showMessageBox: async owner => { assert.equal(owner, parent); return { response: 0 }; },
    } });
    assert.deepEqual(calls, options.foreground === false ? [] : ['show', 'focus']);
  }
});
