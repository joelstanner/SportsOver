# SportsOver

See [CHANGELOG.md](CHANGELOG.md) for version history.

A standalone Electron sports banner for your desktop. Transparent, borderless, draggable, and always on top of ordinary application windows, with separate settings and tray/menu-bar controls. SportsOver owns one sports engine and serves two outputs: the floating desktop banner and an optional local OBS browser source. OBS and Twitchbot are not required to run the app.

## Install Node.js and npm (first-time setup)

**npm** is the tool that downloads SportsOver's dependencies and starts the app. It comes with **Node.js**, so you install Node.js once and then use npm in your terminal. Running `npm install` later installs this project's dependencies, not npm itself. See the [official npm installation guide](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/).

1. Open the [official Node.js download page](https://nodejs.org/en/download/) and choose the **LTS (Long-Term Support)** release. SportsOver requires Node.js **22 or newer**.
2. Download the installer for your computer: **macOS Installer (.pkg)** on a Mac or **Windows Installer (.msi)** on Windows. Run it and follow the prompts, keeping npm and the default PATH options enabled.
3. Close and reopen your terminal after installation so it can find the new commands. On macOS, open **Terminal** (Applications → Utilities) or **iTerm** if you already use it. On Windows, open **Command Prompt** from the Start menu.
4. Type each command below and press Enter after each line:

```sh
node --version
npm --version
```

Both should print a version number. The Node.js version should start with `v22` or a higher major number. If either command says “command not found” or “not recognized,” confirm the installer finished and reopen the terminal; if necessary, restart your computer. If your existing Node.js version is below 22, install the current LTS release before continuing.

You only need this setup once per computer. No npm account is required to install or run SportsOver.

## Run from source

Download or clone [SportsOver on GitHub](https://github.com/joelstanner/SportsOver) and extract it if it came as a ZIP. In your terminal, use `cd` (change directory) to enter the folder containing SportsOver's `package.json`.

For example, if the folder is named `SportsOver` in your Downloads folder, use the command for your system:

**macOS — Terminal or iTerm:**

```sh
cd "$HOME/Downloads/SportsOver"
```

**Windows — Command Prompt:**

```bat
cd /d "%USERPROFILE%\Downloads\SportsOver"
```

Replace the example path with the folder's actual location and name. Keep the quotes if the path contains spaces. If npm reports that it cannot find `package.json`, you are probably in the wrong folder.

Once you are in the SportsOver folder, run these commands one at a time:

```sh
npm install
npm start
```

Wait for `npm install` to finish before running `npm start`. Keep that terminal session open while SportsOver runs; you can minimize the terminal window. On later launches, return to the same folder and run `npm start`.

The first installation/start downloads Electron for your OS and architecture. Internet access is needed for installation, live sports feeds, logos, and catalog refresh. The banner and Settings open together. Closing Settings leaves the banner running; use **Quit SportsOver** in the tray/menu bar or application menu to exit.

This repository distributes source only. Installers, signing/notarization, automatic updates, and public-release packaging are outside the current scope. To update a downloaded checkout, replace it with the newer source and run `npm install` again. If you obtained it with Git, pull from your configured source first. The source repository is [joelstanner/SportsOver](https://github.com/joelstanner/SportsOver).

## Desktop controls

`npm start` preserves Electron's diagnostic output. If Chromium reports a macOS Keychain certificate with `Failed parsing extensions`, the launcher adds an explanation that Chromium skipped that certificate and is continuing. No action is needed when scores load normally; other certificate or network errors still need investigation.

- **Skip:** click the unlocked banner to advance to the next rotation item with a fresh display interval. Game locks and temporary overrides still apply. Desktop and OBS stay in sync.
- **Move:** click anywhere on the unlocked banner and drag, including between monitors. Moving more than 5 screen pixels starts a drag; releasing after dragging never skips a game.
- **Settings:** right-click the banner and choose **Settings…**. Right-clicking does not advance rotation.
- **Resize:** choose Banner size in Settings or the tray menu. Proportional scaling keeps the full 472 × 100 design intact; transparent windows do not rely on platform-specific native resize borders.
- **Lock:** clicks pass through the banner to the application beneath it. Use **Unlock** in Settings or uncheck **Lock / click through** in the tray menu.
- **Recover:** **Ctrl+Shift+U** on Windows or **Cmd+Shift+U** on macOS unlocks, shows, and moves the banner onto the primary display, then opens Settings. The Settings status reports if another application owns that shortcut. Tray and Settings controls remain available.
- **Show/hide:** available in Settings and the tray menu. Position, size, lock state, visibility, and sports settings survive restarts. Settings opens on every launch so a hidden or locked banner always has a recovery path.
- Launching a second instance recovers the existing banner. Disconnecting a monitor brings an offscreen banner into an available work area.

## Sports settings

MLB, NFL, college football, NHL, MLS, NBA, and NCAA men's basketball use MLB/ESPN providers and team directories. Rank sports and watched teams, enable/disable favorites, select time zone and fallback behavior, and configure provider polling. **Save settings** applies changes to the banner without reloading it.

To follow NCAA men's basketball, choose **NCAA men’s basketball · NCAAM** in Team tracking, select a team, and save. No college basketball teams are added to your watched list automatically. The ESPN directory, scoreboard, schedules, and game summaries power this sport; these are public endpoints without a supported developer API contract. Refresh team data to update the bundled directory. The banner displays halves and overtime, including overtime finals. College timeouts appear as `TO n` only when ESPN reports a remaining count; missing counts stay hidden. It does not infer timeouts from NBA rules or partial play logs. See the [NCAA provider notes](sports/college-basketball/README.md).

**Live control** reads discovered games from that same engine and manages automatic, hybrid, or curated game rotation, game order and durations, and game locks. A game lock chooses what plays; the desktop click-through lock controls mouse input. **Demo lab** previews deterministic sport/lifecycle examples without changing the live banner. Use the Electron overlay window to view the live output while changing Settings. Demo lab uses fixed data only.

**Refresh teams** saves current provider catalogs in app data, leaving the source checkout unchanged. A failed sport refresh retains its previous directory; other successful sports may still update. Live feeds can be unavailable or delayed. Existing provider fallback/error states apply; this app does not guarantee real-time scores.

Turn off **Show sport** in a sport's Settings card and save to remove that sport
from the banner and game selection, including manually added or locked games.
Teams, ordering, and preferences stay saved. Turn it back on and save to restore
the sport. All sports can be turned off; older configurations keep sports enabled.

Live NHL games show **POWER PLAY ACTIVE** when ESPN's situation feed explicitly
reports a power play. The separate **PP GOALS / OPP** row shows cumulative totals.
The indicator names the team with more players on ice when both feeds share the
latest play and ESPN explicitly reports no empty net. Otherwise it shows a generic
active indicator. It does not infer a countdown from past plays and is hidden
when situation data is unavailable. Live hockey refreshes fetch both the
game summary and situation feed at the configured live refresh interval.

## Background startup

Run `npm start -- --background` to start the engine, local OBS server, and tray
without showing the banner or Settings. For a packaged app, pass `--background`
to its executable. Open Settings or show the banner from the tray when needed.
The flag overrides visibility for this launch without changing the saved banner
visibility preference. Normal startup still restores that preference and opens
Settings. A second launch with `--background` leaves the existing instance alone;
a normal second launch still recovers its windows. On macOS, use the tray to
open a background-started app initially.

## OBS browser source

With SportsOver running, copy the OBS URL from Settings (normally `http://127.0.0.1:17843/output`) into an OBS Browser Source. Set width **472** and height **100**, then scale it in OBS as needed. The page has a transparent background. SportsOver must stay running; hiding or locking its desktop window has no effect on OBS. Closing OBS does not stop SportsOver.

Desktop, OBS and embedded previews consume the same published HTML frame, rendered by one hidden engine. Outputs fetch local snapshots every 200 ms; they never call sports providers or own a rotation timer. Delivery is near-synchronous, not frame-locked video. CSS marquee animation phases may differ between clients. If SportsOver disconnects, the output labels the last received score as disconnected and reconnects automatically.

The listener binds only to IPv4 loopback on port 17843. If that port is occupied, Settings reports the error and the desktop remains usable; free the port and restart for OBS/API access. This implementation intentionally does not expose the listener on your LAN.

## Optional integrations

The secured local API accepts temporary game-selection commands and owns their duration and restoration. See [desktop/API.md](desktop/API.md) for authentication, schemas, retry rules and examples. Copy the integration token from Settings. No Twitch reward mapping or live Twitchbot integration is configured here.

SportsOver is the destination for future sports development. The original `sports-obs-overlay` and Twitchbot sports implementations remain untouched and operational during migration; their retirement requires a later explicit migration decision.

## Storage and recovery

App-owned files live in Electron's user-data directory:

- macOS: `~/Library/Application Support/SportsOver`
- Windows: `%APPDATA%\SportsOver`
- Linux (experimental): typically `~/.config/SportsOver`

`settings.json` contains normalized sports settings and desktop preferences. Changes use atomic file replacement and keep the previous valid file in `settings.json.bak`. If the main file is invalid, the app tries the backup, then defaults, and displays a recovery message in Settings. A damaged primary file is preserved with a `.recovered-<timestamp>` suffix on the next save. Close SportsOver before manually editing/restoring these files. Refreshed directories are under `sports/<sport>/teams.json` in the same data folder. Uninstalling/replacing the source folder does not delete app data.

## Architecture and security

`desktop/main.cjs` owns native windows, tray, single-instance handling, recovery, and a narrow IPC command handler. Renderers use sandboxing, context isolation, no Node integration, denied permissions, blocked popup/navigation targets, and a Content Security Policy. The private `sportsover://app` protocol serves an allowlisted renderer asset tree plus app-owned state/catalog endpoints. The separate loopback listener exposes passive output and a small bearer-authenticated command API; it does not expose settings writes, Electron IPC, or arbitrary source files. No Twitchbot service is involved. Its standard secure scheme allows the existing relative asset URLs and shared-state polling to work ([Electron protocol documentation](https://www.electronjs.org/docs/latest/api/protocol)).

`desktop/store.cjs` validates through the existing configuration model and rejects stale revision writes. `desktop/bounds.cjs` clamps restored placement to connected work areas. `core/app.js` runs live providers and rotation only in the hidden engine window. `core/engine-host.js` publishes frames and game metadata to `desktop/engine-state.cjs`; `display.html` is the passive client shared by desktop, OBS and production previews. Existing `sports` layouts render once in the engine. Settings uses published discovery data. `desktop/server.cjs` serves output and authenticated integration commands. `scripts/serve.mjs` remains an optional browser development server, not the desktop runtime.

## Verification

```sh
npm test
npm run test:desktop
```

`npm test` runs the provider/rotation/configuration suite and desktop persistence, recovery, bounds, and protocol tests. `npm run test:desktop` launches real Electron windows with isolated temporary app data and mocked provider responses. It checks shared rendering, authenticated API access, override expiry/restoration, independent desktop visibility, shared settings, desktop controls and secure preferences, then restarts to verify persistence. It also asserts that only one engine window makes provider requests while desktop, Settings and an HTTP browser-source client are connected. It leaves screenshots and test data in the temporary directory printed at completion. It does not alter your normal preferences.

Platform results and remaining manual checks are recorded in [desktop/TESTING.md](desktop/TESTING.md). Always-on-top cannot cover exclusive-fullscreen games or protected system screens. macOS fullscreen-workspace visibility is requested but needs manual validation on the target setup. Windows support needs native Windows testing. Linux is experimental; Wayland does not provide Electron's always-on-top behavior.

## License

SportsOver is licensed under the [MIT License](LICENSE). Third-party dependencies and sports data, logos, and trademarks remain subject to their respective licenses and terms.

## Local macOS app

Run `npm run build:mac`, then open `dist/SportsOver.app` for the SportsOver application name and scoreboard Dock/Finder icon. This reuses the installed Electron runtime and creates a local ad-hoc signed bundle; it is not notarized for distribution. Rebuild after source changes. `npm start` remains the development launcher and macOS may identify it as Electron. Both launches use the same SportsOver settings.

The menu-bar scoreboard uses a compact template icon with a persistent position. Its initial position is near the right edge to avoid a crowded MacBook notch area; Cmd-drag can reposition it. Banner controls also remain available in the Banner application menu.
