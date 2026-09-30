# Desktop verification

Implementation tested on macOS (Darwin 24.6.0, Apple Silicon), Electron 44.5.0, Node 22.16.0. Windows and Linux were not run.

## Automated checks

- `npm test`: existing sports/configuration/rotation tests plus desktop atomic persistence, restart readback, stale-write conflicts, backup recovery, failed-write rollback, disconnected-monitor bounds, negative monitor coordinates, protocol asset restrictions, origin/Host checks, bearer authentication, command validation, idempotent override expiry/cancellation, public-source restrictions, and app-data catalog refresh with mocked upstream responses.
- `npm run test:desktop`: actual macOS Electron process, isolated temporary data, deterministic mocked live rendering, Settings and embedded previews, renderer sandbox/context isolation, native always-on-top flag, lock/unlock controls, show/hide/recover, proportional resizing, configuration propagation between windows, and size/lock/visibility/settings retained after relaunch. A second browser client loads the local HTTP OBS output; the test verifies output equality, continued output with desktop hidden, API authorization, duplicate-command handling, override expiry/restoration, and that only the single engine window sends provider requests. This is an HTTP browser-source compatibility test, not a test inside the OBS application. Screenshots inspected for banner and Settings layout.
- Test traffic is mocked. This does not establish current live API availability, logo availability, or feed accuracy.

## Manual platform checks still required

The automated test invokes native APIs but does **not** establish that physical mouse clicks pass through to another application or that OS drag regions track real mouse movement correctly. Before relying on the app during a broadcast/session, check:

1. Drag the unlocked banner across monitors with different scaling; quit/restart and confirm placement and size.
2. Lock and click a control in another app beneath the banner. Unlock from the tray, Settings, and the recovery shortcut.
3. Hide the banner, close Settings, and reopen from the tray. Launch a second instance and confirm the existing app recovers.
4. Disconnect the monitor containing the banner, including while locked. Check recovery on the remaining display.
5. Test macOS Spaces/fullscreen and Windows ordinary/maximized apps. Test tray visibility in light/dark modes and Windows taskbar overflow.
6. Check operation when Ctrl/Cmd+Shift+U is already registered elsewhere. Settings should report shortcut unavailability; the tray and Settings buttons remain alternatives.
7. Load the local URL in the actual OBS Browser Source on each target platform. Check reconnection after SportsOver restart and desktop-independent visibility. Test real MLB/ESPN requests and catalog refresh under offline/reconnect conditions.
8. Check Windows source installation/start and all native behaviors. Linux is experimental, especially Wayland; exclusive-fullscreen and protected system screens are outside the always-on-top guarantee.

The app intentionally uses explicit proportional size controls because transparent native-window resizing varies by platform. No installer, signing, notarization, update service, or packaged-release behavior has been tested or implemented.
