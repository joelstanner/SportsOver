# Desktop verification

Implementation tested on macOS (Darwin 24.6.0, Apple Silicon), Electron 44.5.0, Node 22.16.0. Windows and Linux were not run.

## Automated checks

- `npm test`: existing sports/configuration/rotation tests plus desktop atomic persistence, restart readback, stale-write conflicts, backup recovery, failed-write rollback, disconnected-monitor bounds, negative monitor coordinates, protocol asset restrictions, origin/Host checks, bearer authentication, command validation, idempotent override expiry/cancellation, public-source restrictions, and app-data catalog refresh with mocked upstream responses.
- `npm run test:desktop`: actual macOS Electron process, isolated temporary data, deterministic mocked live rendering, Settings and embedded previews, renderer sandbox/context isolation, native always-on-top flag, lock/unlock controls, show/hide/recover, proportional resizing, configuration propagation between windows, and size/lock/visibility/settings retained after relaunch. A second browser client loads the local HTTP OBS output; the test verifies output equality, continued output with desktop hidden, API authorization, duplicate-command handling, override expiry/restoration, and that only the single engine window sends provider requests. This is an HTTP browser-source compatibility test, not a test inside the OBS application. Screenshots inspected for banner and Settings layout.
- Live mode unit checks simulate finish detection, exact expiry, zero retention,
  missing/stale discoveries, manual removals, and empty active queues. The desktop
  smoke test checks its button, game-lock override/restoration, removal persistence,
  and activation reset plus retention-setting persistence after app restart.
- Test traffic is mocked. This does not establish current live API availability, logo availability, or feed accuracy.

## Manual platform checks still required

The automated test invokes native APIs but does **not** establish that physical mouse clicks pass through to another application or that OS drag regions track real mouse movement correctly. Before relying on the app during a broadcast/session, check:

1. Drag from anywhere on the unlocked banner across monitors with different scaling; quit/restart and confirm placement and size. Click the leftmost 20% to go backwards and elsewhere to advance; confirm wrapping and fresh display intervals at different banner sizes. Double-click the left half to shrink and the right half to enlarge, and confirm the game does not change. Check the 50% and 300% limits. Confirm dragging (including dragging away and back, or dragging on the second press of a double-click) neither skips nor resizes. Right-click and choose Settings; confirm the menu opens Settings without advancing rotation.
2. Right-click the banner and check Lock banner position over a control in another app. Confirm clicks stay on the banner and browse games without activating the underlying control, dragging and double-clicks leave position/size unchanged, and the right-click menu still works. Uncheck Lock banner position to unlock; confirm the tray and Settings reflect both changes. Repeat after restarting with the banner locked. Unlock from the tray, Settings, and the recovery shortcut.
3. Hide the banner, close Settings, and reopen from the tray. Launch a second instance and confirm the existing app recovers.
4. Disconnect the monitor containing the banner, including while locked. Check recovery on the remaining display.
5. Test macOS Spaces/fullscreen and Windows ordinary/maximized apps. Test tray visibility in light/dark modes and Windows taskbar overflow.
6. Check operation when Ctrl/Cmd+Shift+U is already registered elsewhere. Settings should report shortcut unavailability; the tray and Settings buttons remain alternatives.
7. Load the local URL in the actual OBS Browser Source on each target platform. Check reconnection after SportsOver restart and desktop-independent visibility. Test real MLB/ESPN requests and catalog refresh under offline/reconnect conditions.
8. Check Windows source installation/start and all native behaviors. Linux is experimental, especially Wayland; exclusive-fullscreen and protected system screens are outside the always-on-top guarantee.

The app intentionally uses explicit proportional size controls because transparent native-window resizing varies by platform. macOS DMG packaging is available with an ad-hoc signature; Developer ID signing, notarization, automatic updates, and Windows installers are not implemented. See [packaging and release checks](PACKAGING.md). The local development bundle is verified separately below.

## Native menus and icons

The desktop smoke test also checks status-item creation and nonzero native bounds, the Settings shortcut, and hide/show via the application menu. On macOS it checks Dock visibility after normal startup, relaunch, and opening Settings from a background launch; closing Settings keeps the Dock visible and activation reopens Settings without showing a hidden banner. The banner still joins all workspaces. These checks do not prove the status item is physically visible: macOS can hide status items when the menu bar is full or auto-hidden.

The macOS banner uses a floating panel and skips Electron's process-type transformation when joining fullscreen Spaces. Without that option, Electron hides the entire app from the Dock and Cmd-Tab. Manually confirm the app remains in Cmd-Tab, its application menu appears when Settings is active, and the banner remains visible over another app in fullscreen.

After restart, locate the compact scoreboard icon in the right menu bar. Single-click it and check Settings, hide/show, lock, recovery, size and Quit. Check light/dark appearance and Retina displays. The same banner controls are under the **Banner** application menu; Settings uses Cmd+,; standard About, Services, Hide, Edit, File/Close and Window menus use native behavior. With Settings closed and the banner hidden, the tray must still reopen Settings.

Dock/About artwork now uses the supplied scoreboard PNG; see `assets/README.md`. `npm run build:mac` creates a local SportsOver.app with the same icon and native application name. Check its Finder/Dock icon and application menu separately from the `npm start` development launcher. The bundle is ad-hoc signed, not notarized.

The local bundle passed `codesign --verify --deep --strict` and the desktop smoke test using `SPORTSOVER_TEST_EXECUTABLE` set to its executable (renamed from `Contents/MacOS/Electron` to `Contents/MacOS/SportsOver` in 0.16.0). The smoke test reloads the engine after installing request fixtures to avoid a packaged-startup race with live feeds. The running bundle was checked through macOS accessibility: its application menu is named SportsOver. A native placement probe confirmed the default moves the status item to x=1180 on the 1470-point display instead of the center/notch area; physical tray visibility still depends on the OS layout.

## DMG packaging verification — 2026-10-01

Version 0.13.0 installers and the local development app were rebuilt after the
approved version bump. Installers use electron-builder 26.17.0.

- All 173 unit tests passed.
- Apple Silicon and Intel DMGs built successfully. Both passed `hdiutil verify`
  and their generated SHA-256 checksum checks.
- Both app signatures passed `codesign --verify --deep --strict` and report
  ad-hoc signing with no Team ID. Bundle identity is `com.sportsover.desktop`,
  version is 0.13.0, and minimum macOS is 13.0. Executables contain the expected
  arm64 or x86_64 architecture.
- The Apple Silicon packaged app passed the existing desktop/shared-engine
  smoke suite using temporary settings and mocked feeds. Its ASAR archive
  supports the app's relative resources and catalog-module import.
- Both mounted images contained the app, an Applications shortcut, and the
  exact installation instructions. Both archives were checked for required
  runtime files and exclusion of development dependencies and local state.
  An Apple Silicon app copied from the DMG passed the same smoke suite after
  both images were ejected, using an isolated temporary install location.

Native Intel execution, the minimum macOS version on actual hardware,
browser-download quarantine/first-launch approval, and upgrading a real prior
installation still require manual verification. Signing and disk-image integrity
checks do not prove Gatekeeper acceptance or Apple notarization.

## Release verification — 0.14.2, 2026-10-01

- All 199 unit tests and the PDGA browser flow passed, including upcoming-feed
  failures, retained tee times, transition to live scoring, and live backoff.
- Both Mac installers passed disk-image, checksum, signature, version,
  architecture, content, and packaged PDGA-source checks.
- An Apple Silicon app copied from the installer passed the desktop/shared-engine
  smoke suite after ejecting both images. The native drag assertion now waits
  briefly for pointer IPC to update the window position.
- Native Intel execution and first-launch approval on another Mac remain
  unverified. Builds remain ad-hoc signed and unnotarized.

## Release verification — 0.14.1, 2026-10-01

- All 197 unit tests and the disc-golf browser flow passed.
- Rebuilt the local app and both Mac installers at 0.14.1. Disk images,
  checksums, signatures, bundle identity, minimum OS, architecture, and packaged
  runtime files passed verification.
- An Apple Silicon app copied from the mounted installer passed the desktop
  smoke suite after ejecting the image, including Dock visibility and reopening
  Settings after closure. The test waits for closure before simulating activation.
- That copy also passed the live PDGA feed check, 200% banner scaling, player
  selection, rotation, Live mode removal, and shared OBS output.
- Native Intel execution and first-launch approval on another Mac remain
  unverified. Builds remain ad-hoc signed and unnotarized.

## Icon release verification — 0.13.1, 2026-10-01

- All 173 unit tests passed; the local app and both DMGs were rebuilt at 0.13.1.
- Both mounted installers contained the exact approved football PNG, with
  matching generated macOS icons. The extracted 1024-pixel icon was visually
  checked for the football artwork and 6–9 score.
- Installer checksums, signatures, bundle metadata, architecture, and content
  checks passed. The Apple Silicon copy installed from the DMG passed the
  desktop/shared-engine smoke suite after ejecting the disk images.
- The platform and downloaded-app manual checks listed above remain pending.
