const { app, BrowserWindow, Menu, Tray, nativeImage, globalShortcut, ipcMain, protocol, screen, session, dialog, clipboard, systemPreferences, shell, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { EngineState } = require('./engine-state.cjs');
const { startServer, credentials } = require('./server.cjs');
const { Store, applyCatalog } = require('./store.cjs');
const { fitBounds, fullscreenBounds, BANNER_SCALES, stepBannerScale } = require('./bounds.cjs');
const { createBannerGesture } = require('./banner-gesture.cjs');
const { bannerUrl } = require('./banner-link.cjs');
const { createHandler, ORIGIN } = require('./protocol.cjs');
const { createUpdateChecker } = require('./updates.cjs');
const updateChecker = createUpdateChecker({ app, dialog, shell, onStateChange: menus,
  readLastCheck: () => store?.value.desktop.lastUpdateCheck,
  saveLastCheck: timestamp => store.desktop({ lastUpdateCheck: timestamp }),
  readRateLimit: () => store?.value.desktop.updateRateLimit,
  saveRateLimit: value => store.desktop({ updateRateLimit: value }),
});
let backgroundStartup = process.argv.includes('--background');
app.setName('SportsOver');
if (process.env.SPORTSOVER_TEST_DATA) app.setPath('userData', process.env.SPORTSOVER_TEST_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'sportsover', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const engineState = new EngineState();
let appIcon, trayIcon, outputServer, engineWindow, obsUrl, integrationToken;
let banner, settings, tray, store, quitting = false, locked = false, shortcut = false, saveTimer;
let normalBounds = null, fullscreenDisplayId = null;
let bannerHovered = false;
function setBannerHovered(value) {
  bannerHovered = value;
  if (engineWindow && !engineWindow.isDestroyed()) engineWindow.webContents.send('engine:command', { type: 'hover', value });
}
function fullscreenDisplay() {
  return screen.getAllDisplays().find(display => display.id === fullscreenDisplayId)
    || screen.getDisplayMatching(banner.getBounds());
}
const bannerGesture = createBannerGesture({
  bounds: () => banner.getBounds(),
  move: (x, y) => {
    if (!locked && !normalBounds) banner.setPosition(x, y);
  },
  next: () => engineWindow.webContents.send('engine:command', { type: 'next' }),
  previous: () => engineWindow.webContents.send('engine:command', { type: 'previous' }),
  resize: direction => { if (!locked && !normalBounds) resize(stepBannerScale(banner.getBounds().width / 472, direction)); },
});
const root = path.resolve(__dirname, '..');
const trusted = url => url.startsWith(`${ORIGIN}/sports/`);
function secure(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (normalBounds && input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      setFullscreen(false);
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('render-process-gone', () => { if (!quitting) { lock(false); openSettings(); } });
}
function preferences() { return { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }; }
function persist(patch) {
  try { store.desktop(patch); }
  catch (error) { dialog.showErrorBox('SportsOver could not save preferences', error.message); }
}
function lock(value) {
  bannerGesture({ phase: 'cancel' });
  locked = !!value;
  persist({ locked });
  menus();
}
function showBanner() { backgroundStartup = false; banner.showInactive(); persist({ visible: true }); menus(); }
function hideBanner() { setFullscreen(false); banner.hide(); persist({ visible: false }); menus(); }
function setFullscreen(value) {
  if (value === !!normalBounds) return;
  bannerGesture({ phase: 'cancel' });
  clearTimeout(saveTimer);
  if (value) {
    normalBounds = banner.getBounds();
    persist({ bounds: normalBounds });
    const display = screen.getDisplayMatching(normalBounds);
    fullscreenDisplayId = display.id;
    banner.setBackgroundColor('#000000');
    if (process.platform === 'darwin') banner.setSimpleFullScreen(true);
    else { banner.setFullScreenable(true); banner.setFullScreen(true); }
    banner.setBounds(fullscreenBounds(display));
    showBanner();
    // Electron's normal "floating" level deliberately stays behind the Windows
    // taskbar. Fullscreen must cover it as well as the desktop.
    if (process.platform === 'win32') banner.setAlwaysOnTop(true, 'screen-saver');
    banner.focus();
  } else {
    const bounds = fitBounds(normalBounds, screen.getAllDisplays());
    normalBounds = null;
    fullscreenDisplayId = null;
    if (process.platform === 'darwin') banner.setSimpleFullScreen(false);
    else { banner.setFullScreen(false); banner.setFullScreenable(false); }
    banner.setBackgroundColor('#00000000');
    banner.setBounds(bounds);
    // On Windows "floating" explicitly reorders behind the taskbar and can
    // clear topmost status. Keep the compact banner above other app windows.
    if (process.platform === 'win32') banner.setAlwaysOnTop(true, 'pop-up-menu');
    persist({ bounds });
  }
  banner.webContents.send('desktop:fullscreen', !!normalBounds);
  menus();
}
function fullscreenMenuItem() {
  return { id: 'fullscreen-banner', label: normalBounds ? 'Exit fullscreen' : 'Fullscreen banner',
    accelerator: 'CommandOrControl+Shift+F', click: () => setFullscreen(!normalBounds) };
}
function bannerSizeMenuItem() {
  const width = (normalBounds || banner?.getBounds())?.width;
  return { id: 'banner-size', label: 'Banner size', enabled: !normalBounds,
    submenu: BANNER_SCALES.map(scale => ({ id: `banner-size-${scale}`, label: `${Math.round(scale * 100)}%`,
      type: 'checkbox', checked: width === Math.round(472 * scale), click: () => resize(scale) })) };
}
function recover() {
  setFullscreen(false);
  if (banner.webContents.isCrashed()) banner.webContents.reload();
  lock(false);
  banner.setBounds(fitBounds({}, [screen.getPrimaryDisplay()]));
  showBanner();
  openSettings();
}
function openSettings() {
  setFullscreen(false);
  backgroundStartup = false;
  if (settings && !settings.isDestroyed()) { if (settings.webContents.isCrashed()) settings.webContents.reload(); settings.show(); settings.focus(); return; }
  settings = new BrowserWindow({ icon: appIcon, title: 'SportsOver Settings', width: 1120, height: 820, minWidth: 700, minHeight: 500, backgroundColor: '#0b1620', webPreferences: preferences() });
  secure(settings);
  settings.on('closed', () => { settings = null; });
  settings.loadURL(`${ORIGIN}/sports/admin/`);
}
function settingsBackup(action) {
  openSettings();
  const contents = settings.webContents;
  const run = async () => {
    try {
      if (contents.isDestroyed()) return;
      await contents.executeJavaScript('window.SportsOverlay.config.ready.then(() => undefined)');
      if (contents.isDestroyed()) return;
      // Native menu clicks must grant user activation to open the file picker.
      await contents.executeJavaScript(`window.dispatchEvent(new CustomEvent('sports-settings-backup', { detail: ${JSON.stringify(action)} }))`, true);
    } catch (error) {
      if (!contents.isDestroyed()) dialog.showErrorBox('SportsOver settings backup failed', error.message);
    }
  };
  if (contents.isLoading()) contents.once('did-finish-load', run);
  else void run();
}
function menus() {
  const updateItem = updateChecker.menuItem();
  const controls = [
    { id: 'settings', label: 'Settings…', accelerator: 'CommandOrControl+,', click: openSettings },
    { id: 'toggle-banner', label: banner?.isVisible() ? 'Hide banner' : 'Show banner', click: () => { if (banner.isVisible()) hideBanner(); else showBanner(); } },
    { id: 'lock-banner', label: 'Lock banner position', type: 'checkbox', checked: locked, click: item => lock(item.checked) },
    fullscreenMenuItem(),
    { id: 'recover-banner', label: 'Recover banner (unlock and reposition)', accelerator: 'CommandOrControl+Shift+U', click: recover },
    bannerSizeMenuItem(),
    { type: 'separator' }, updateItem,
    { type: 'separator' }, { label: 'Quit SportsOver', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
  ];
  tray?.setContextMenu(Menu.buildFromTemplate(controls));
  const mac = process.platform === 'darwin';
  const settingsItem = controls[0];
  const bannerControls = controls.slice(1, 6);
  const quitItem = controls.at(-1);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ label: 'SportsOver', submenu: [
      { role: 'about' }, { type: 'separator' }, settingsItem, updateItem,
      { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, quitItem,
    ] }] : []),
    { label: 'File', submenu: [
      ...(mac ? [] : [settingsItem, updateItem, { type: 'separator' }]),
      { id: 'export-settings', label: 'Export settings…', click: () => settingsBackup('export') },
      { id: 'import-settings', label: 'Import settings…', click: () => settingsBackup('import') },
      { type: 'separator' }, { role: 'close' }, ...(mac ? [] : [quitItem]),
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Banner', submenu: bannerControls },
    { role: 'windowMenu' },
  ]));
}
function resize(scale) {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 0.5 || scale > 3) throw Error('Invalid banner size');
  if (normalBounds) return;
  bannerGesture({ phase: 'cancel' });
  banner.setBounds(fitBounds({ ...banner.getBounds(), width: Math.round(472 * scale) }, screen.getAllDisplays()));
  menus();
}
function status() { return { version: app.getVersion(), trayAvailable: !!tray && !tray.isDestroyed(), trayBounds: tray && !tray.isDestroyed() ? tray.getBounds() : null, appIconAvailable: !!appIcon, obsUrl, engineReady: engineState.ready, override: engineState.override, locked, visible: banner.isVisible(), fullscreen: !!normalBounds, scale: (normalBounds || banner.getBounds()).width / 472, shortcut, warning: store.warning }; }
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    if (!argv.includes('--background') && banner) recover();
  });
  app.whenReady().then(async () => {
    store = new Store(app.getPath('userData'));
    // Source launches have no bundle icon. Load custom artwork when supplied.
    const appIconPath = path.join(__dirname, 'assets', 'SportsOver.png');
    if (fs.existsSync(appIconPath)) {
      const image = nativeImage.createFromPath(appIconPath);
      if (!image.isEmpty()) appIcon = image;
      else store.warning += ' SportsOver.png could not be decoded.';
    }
    if (process.platform === 'darwin' && appIcon) app.dock.setIcon(appIcon);
    app.setAboutPanelOptions({ applicationName: 'SportsOver', applicationVersion: app.getVersion(), ...(appIcon ? { iconPath: appIconPath } : {}) });
    const { updateCatalogs } = await import('../scripts/team-catalog.mjs');
    const fetchProvider = require('../core/provider-network.js').create({ fetchImpl: (...args) => net.fetch(...args) });
    protocol.handle('sportsover', createHandler({ root, dataRoot: app.getPath('userData'), store, engine: engineState, fetchProvider, fetchImpl: (...args) => net.fetch(...args), refresh: async sport => {
      try { return await updateCatalogs(sport, app.getPath('userData'), fetchProvider); }
      finally {
        for (const entry of globalThis.SportsOverlay.config.SPORT_CATALOG) {
          try { applyCatalog(JSON.parse(require('node:fs').readFileSync(path.join(app.getPath('userData'), 'sports', entry.key, 'teams.json'), 'utf8'))); }
          catch (_) { /* Keep the bundled or last valid directory. */ }
        }
      }
    } }));
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    integrationToken = credentials(app.getPath('userData')).token;
    try {
      const output = await startServer({ root, engine: engineState, token: integrationToken, port: process.env.SPORTSOVER_TEST_DATA ? 0 : 17843 });
      outputServer = output.server; obsUrl = output.url;
    } catch (error) { store.warning += ` OBS/API listener unavailable: ${error.message}. Free port 17843 and restart.`; }
    engineWindow = new BrowserWindow({ width: 472, height: 100, show: false, webPreferences: { ...preferences(), backgroundThrottling: false } });
    secure(engineWindow);
    engineWindow.webContents.on('did-finish-load', () => setBannerHovered(bannerHovered));
    engineWindow.webContents.on('render-process-gone', () => {
      engineState.stop();
      if (!quitting) setTimeout(() => { if (!engineWindow.isDestroyed()) engineWindow.reload(); }, 1000);
    });
    engineState.on('override', value => {
      if (engineWindow && !engineWindow.isDestroyed() && !engineWindow.webContents.isCrashed()) engineWindow.webContents.send('engine:command', { type: 'override', value });
    });
    ipcMain.on('engine:publish', (event, frame) => {
      if (event.sender !== engineWindow.webContents || event.senderFrame !== event.sender.mainFrame) return;
      if (typeof frame?.html !== 'string' || frame.html.length > 1000000 || !Array.isArray(frame.metadata?.availableEntries)) return;
      engineState.publish(frame);
    });
    ipcMain.handle('engine:state', event => { authorize(event); return engineState.state(); });
    const bounds = fitBounds(store.value.desktop.bounds, screen.getAllDisplays());
    // A macOS panel can float above fullscreen apps without hiding the whole app
    // from the Dock, Cmd-Tab, and application menu bar.
    banner = new BrowserWindow({ ...bounds, ...(process.platform === 'darwin' ? { type: 'panel' } : {}), title: 'SportsOver', transparent: true, backgroundColor: '#00000000', frame: false, hasShadow: false, alwaysOnTop: true, resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false, webPreferences: preferences() });
    secure(banner);
    banner.webContents.on('did-finish-load', () => banner.webContents.send('desktop:fullscreen', !!normalBounds));
    banner.on('blur', () => bannerGesture({ phase: 'cancel' }));
    banner.on('hide', () => bannerGesture({ phase: 'cancel' }));
    banner.on('hide', () => setBannerHovered(false));
    banner.webContents.on('did-start-loading', () => setBannerHovered(false));
    banner.webContents.on('render-process-gone', () => setBannerHovered(false));
    banner.webContents.on('context-menu', () => {
      bannerGesture({ phase: 'cancel' });
      Menu.buildFromTemplate([
        { label: 'Settings…', click: openSettings },
        { id: 'lock-banner', label: 'Lock banner position', type: 'checkbox', checked: locked, click: item => lock(item.checked) },
        fullscreenMenuItem(),
        bannerSizeMenuItem(),
        { id: 'hide-banner', label: 'Hide banner', click: hideBanner },
        updateChecker.menuItem(),
      ]).popup({ window: banner });
    });
    banner.setAlwaysOnTop(true, process.platform === 'win32' ? 'pop-up-menu' : 'floating');
    if (process.platform === 'darwin') banner.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    banner.on('close', event => { if (!quitting) { event.preventDefault(); hideBanner(); } });
    const saveBounds = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => persist({ bounds: normalBounds || banner.getBounds() }), 250); };
    banner.on('move', saveBounds);
    banner.on('resize', saveBounds);
    const fit = () => {
      if (normalBounds) {
        const display = fullscreenDisplay();
        fullscreenDisplayId = display.id;
        normalBounds = fitBounds(normalBounds, screen.getAllDisplays());
        banner.setBounds(fullscreenBounds(display));
      } else banner.setBounds(fitBounds(banner.getBounds(), screen.getAllDisplays()));
    };
    screen.on('display-removed', fit);
    screen.on('display-metrics-changed', fit);
    // A native template icon remains visible in both macOS appearance modes.
    const pixels = Buffer.alloc(20 * 20 * 4);
    for (let y = 3; y < 17; y++) for (let x = 2; x < 18; x++) {
      const border = x < 4 || x > 15 || y < 5 || y > 14 || x === 9 || x === 10;
      if (border) { const i = (y * 20 + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = process.platform === 'darwin' ? 0 : 255; pixels[i + 3] = 255; }
    }
    trayIcon = nativeImage.createFromBitmap(pixels, { width: 20, height: 20 });
    // Keep both the image and Tray alive. Supply a Retina representation too.
    const retina = Buffer.alloc(40 * 40 * 4);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      const source = (Math.floor(y / 2) * 20 + Math.floor(x / 2)) * 4;
      pixels.copy(retina, (y * 40 + x) * 4, source, source + 4);
    }
    trayIcon.addRepresentation({ scaleFactor: 2, buffer: nativeImage.createFromBitmap(retina, { width: 40, height: 40 }).toPNG() });
    trayIcon.setTemplateImage(process.platform === 'darwin');
    try {
      if (trayIcon.isEmpty()) throw Error('The status icon is empty');
      const trayId = '671bb5a6-24fd-45f6-a087-9a51fd74f13b';
      if (process.platform === 'darwin') {
        // AppKit's autosaved status-item position is measured from the right.
        // A registration default avoids the crowded/notched center on first use;
        // an existing user-chosen position always takes precedence.
        systemPreferences.registerDefaults({ [`NSStatusItem Preferred Position ${trayId}`]: 220 });
      }
      tray = process.platform === 'darwin' ? new Tray(trayIcon, trayId) : new Tray(trayIcon);
      tray.setToolTip('SportsOver — desktop sports banner');
      if (process.platform === 'darwin') {
        tray.setIgnoreDoubleClickEvents(true);
      } else tray.on('double-click', openSettings);
      menus();
    } catch (error) {
      tray?.destroy(); tray = null;
      store.warning += ` Tray unavailable: ${error.message}`;
      console.error('SportsOver status item unavailable:', error);
    }
    shortcut = globalShortcut.register('CommandOrControl+Shift+U', recover);
    ipcMain.handle('desktop:status', event => { authorize(event); return status(); });
    ipcMain.handle('desktop:action', async (event, action, value) => {
      authorize(event);
      if (action === 'unlock') { lock(false); showBanner(); }
      else if (action === 'lock') lock(true);
      else if (action === 'toggle-lock') lock(!locked);
      else if (action === 'toggle-visibility') {
        if (banner.isVisible()) hideBanner();
        else showBanner();
      }
      else if (action === 'show') showBanner();
      else if (action === 'hide') hideBanner();
      else if (action === 'toggle-fullscreen') setFullscreen(!normalBounds);
      else if (action === 'recover') recover();
      else if (action === 'size') resize(value);
      else if (action === 'settings') openSettings();
      else if (action === 'banner-hover') {
        if (event.sender !== banner.webContents) throw Error('Banner access required');
        if (typeof value !== 'boolean') throw Error('Banner hover requires a boolean');
        setBannerHovered(value && banner.isVisible());
      }
      else if (action === 'banner-pointer') {
        if (event.sender !== banner.webContents) throw Error('Banner access required');
        bannerGesture(value);
      }
      else if (action === 'open-banner-link') {
        if (event.sender !== banner.webContents) throw Error('Banner access required');
        await shell.openExternal(bannerUrl(value));
      }
      else if (action === 'next') {
        engineWindow.webContents.send('engine:command', { type: 'next' });
      }
      else if (action === 'copy-obs') { if (obsUrl) clipboard.writeText(obsUrl); }
      else if (action === 'copy-token') {
        if (event.sender !== settings?.webContents) throw Error('Settings access required');
        clipboard.writeText(integrationToken);
      }
      else if (action === 'clear-override') engineState.clearOverride();
      else if (action === 'live-mode') {
        if (event.sender !== settings?.webContents) throw Error('Settings access required');
        if (typeof value !== 'boolean') throw Error('Live mode requires an on/off value');
        if (!engineState.output().ready) throw Error('Sports engine is not ready');
        if (value && !engineState.state().liveMode?.active && !engineState.state().liveMode?.canActivate) {
          throw Error('No live games in rotation');
        }
        if (engineState.state().liveMode?.active !== value) await new Promise((resolve, reject) => {
          const changed = () => {
            if (engineState.state().liveMode?.active !== value) return;
            clearTimeout(timeout); engineState.off('frame', changed); resolve();
          };
          const timeout = setTimeout(() => {
            engineState.off('frame', changed); reject(Error('Live mode did not respond. Try again.'));
          }, 5000);
          engineState.on('frame', changed);
          engineWindow.webContents.send('engine:command', { type: 'live-mode', active: value });
        });
      }
      else if (action === 'refresh') {
        const engine = await engineState.refresh(command => engineWindow.webContents.send('engine:command', command));
        return { ...status(), engine };
      }
      else throw Error('Unknown action');
      return status();
    });
    await engineWindow.loadURL(`${ORIGIN}/sports/index.html?engine=1`);
    await banner.loadURL(`${ORIGIN}/sports/display.html?desktop=1`);
    locked = !!store.value.desktop.locked;
    if (!backgroundStartup && store.value.desktop.visible !== false) banner.showInactive();
    menus();
    if (!backgroundStartup) openSettings();
    // Do not hold startup open while GitHub responds; launch checks handle errors silently.
    void updateChecker.checkOnLaunch({ background: backgroundStartup });
  }).catch(error => { dialog.showErrorBox('SportsOver could not start', error.stack || error.message); app.quit(); });
}
function authorize(event) {
  if (event.senderFrame !== event.sender.mainFrame || !trusted(event.senderFrame.url)) throw Error('Untrusted sender');
}
app.on('activate', () => { if (banner && !backgroundStartup) openSettings(); });
app.on('window-all-closed', () => { /* Tray owns the application lifetime. */ });
app.on('before-quit', () => { quitting = true; bannerGesture({ phase: 'cancel' }); clearTimeout(saveTimer); if (banner && store) persist({ bounds: normalBounds || banner.getBounds() }); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.destroy(); engineState.stop(); outputServer?.close(); });
