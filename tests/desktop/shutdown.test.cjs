require('../../scripts/offline-network.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture() {
  const main = path.resolve(__dirname, '../../desktop/main.cjs');
  const mainRequire = createRequire(main), handlers = new Map();
  const electron = {
    app: { setName() {}, requestSingleInstanceLock: () => false, quit() {},
      on: (name, handler) => handlers.set(name, handler) },
    protocol: { registerSchemesAsPrivileged() {} },
  };
  const context = vm.createContext({
    __dirname: path.dirname(main), process: { argv: [], env: {}, platform: 'darwin' },
    setTimeout, clearTimeout,
    require: name => name === 'electron' ? electron : mainRequire(name),
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context);
  vm.runInContext(`
    function testWindow() {
      const win = { destroyed: false, width: 94, sent: [],
        isDestroyed() { return this.destroyed; },
        getBounds() {
          if (this.destroyed) throw Error('Object has been destroyed');
          return { x: 0, y: 0, width: this.width, height: 20 };
        },
        destroy() { this.destroyed = true; },
      };
      const contents = { mainFrame: {}, isDestroyed: () => win.destroyed,
        send(...args) {
          if (win.destroyed) throw Error('Object has been destroyed');
          win.sent.push(args);
        },
      };
      Object.defineProperty(win, 'webContents', { get() {
        if (win.destroyed) throw Error('Object has been destroyed');
        return contents;
      } });
      return win;
    }
    banner = testWindow();
    engineWindow = testWindow();
    store = { value: { desktop: {} }, desktop() {} };
    const frame = { html: '<main>Live output</main>', metadata: { availableEntries: [], compactRotation: true } };
    function publish(win = engineWindow) {
      const sender = win.webContents;
      publishEngineFrame({ sender, senderFrame: sender.mainFrame }, frame);
    }
  `, context);
  return { run: source => vm.runInContext(source, context), quit: () => handlers.get('before-quit')() };
}

test('Command-Q ignores queued live and demo frames before accessing destroyed windows', () => {
  for (const demo of [false, true]) {
    const f = fixture();
    f.run(`
      inspectionWindow = ${demo} ? testWindow() : null;
      inspectionEngine = ${demo} ? new EngineState() : null;
      const sender = (inspectionWindow || engineWindow).webContents;
      const event = { sender, senderFrame: sender.mainFrame };
    `);
    f.quit();
    f.run('banner.destroy();');
    assert.doesNotThrow(() => f.run('publishEngineFrame(event, frame);'));
    assert.equal(f.run('engineState.ready'), false);
    assert.equal(f.run('engineWindow.sent.length'), 0);
    assert.doesNotThrow(f.quit, 'repeated quit does not read destroyed banner bounds');
  }
});

test('destroyed banners skip compact negotiation and delivery while output still updates', () => {
  for (const demo of [false, true]) {
    const f = fixture();
    if (demo) f.run(`
      inspectionWindow = testWindow(); inspectionEngine = new EngineState();
      inspectionSettings = { revision: 1 };
      frame.metadata.inspection = { revision: 1 };
      outputSource.select(inspectionEngine);
    `);
    f.run('banner.destroy();');
    assert.equal(f.run('compactRotation()'), false);
    assert.doesNotThrow(() => f.run('publish(inspectionWindow || engineWindow);'));
    assert.equal(f.run('(inspectionEngine || engineState).ready'), true);
    assert.equal(f.run('outputSource.output().html'), '<main>Live output</main>');
    assert.equal(f.run('(inspectionWindow || engineWindow).sent.length'), 0);
  }
});

test('live compact negotiation and frame delivery still work before quitting', () => {
  const f = fixture();
  f.run('frame.metadata.compactRotation = false; publish();');
  assert.equal(f.run('engineWindow.sent[0][1].type'), 'compact-rotation');
  assert.equal(f.run('engineWindow.sent[0][1].value'), true);
  assert.equal(f.run('engineState.ready'), false);
  f.run('frame.metadata.compactRotation = true; publish();');
  assert.equal(f.run('engineState.ready'), true);
  assert.equal(f.run('banner.sent[0][0]'), 'desktop:frame');
  for (const setup of ['banner.width = 236;', 'banner.width = 94; normalBounds = { width: 472 };',
    'normalBounds = null; store.value.desktop.skipIndividualWhenSmall = false;', 'banner = null;']) {
    f.run(setup);
    assert.equal(f.run('compactRotation()'), false);
  }
});
