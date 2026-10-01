# SportsOver

See [CHANGELOG.md](CHANGELOG.md) for version history.

A standalone Electron sports banner for your desktop. Transparent, borderless, draggable, and always on top of ordinary application windows, with separate settings and tray/menu-bar controls. SportsOver owns one sports engine and serves two outputs: the floating desktop banner and an optional local OBS browser source. OBS and Twitchbot are not required to run the app.

## Install on macOS

Mac disk images are built for **macOS 13 Ventura or newer**, with separate
downloads for **Apple Silicon (`arm64`)** and **Intel (`x64`)**. Check
**Apple menu → About This Mac** if you are unsure which chip you have.
The app includes its runtime: Node.js, npm, and Terminal are not needed.

Download the matching `.dmg` from
[the latest GitHub Release](https://github.com/joelstanner/SportsOver/releases/latest),
open it, and drag **SportsOver** into **Applications**. Eject the disk image,
then open SportsOver from Applications. Each release includes installers,
SHA-256 checksums, and installation instructions. You can also run from source
using the instructions below or build a DMG using [the packaging guide](desktop/PACKAGING.md).

**First launch:** these early builds are ad-hoc signed and **not notarized by
Apple**. macOS will normally block the first launch. If you trust the download,
try opening SportsOver, dismiss the warning, then go to **System Settings →
Privacy & Security → Open Anyway** and confirm. Follow
[Apple's guidance](https://support.apple.com/102445). Managed Macs may prohibit
this exception. Do not disable system-wide security; report warnings about
damage or malware instead of trying to bypass them. The disk image also
includes **Install SportsOver.txt** with these instructions.

**Updates:** quit SportsOver and replace the app in Applications with the new
download. Settings and team selections stay in
`~/Library/Application Support/SportsOver`. Updates are manual.
**Uninstall:** quit the app and move it from Applications to the Trash;
saved preferences remain available for a later reinstall.

Windows continues to use the source installation below with `npm install`
and `npm start`. No Windows installer is provided.

## Install Node.js and npm (Windows or running from source)

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

To update a downloaded source checkout, replace it with the newer source and run `npm install` again. If you obtained it with Git, pull from your configured source first. The source repository is [joelstanner/SportsOver](https://github.com/joelstanner/SportsOver). This remains the Windows installation method; the package is not published to the npm registry.

## Desktop controls

`npm start` preserves Electron's diagnostic output. If Chromium reports a macOS Keychain certificate with `Failed parsing extensions`, the launcher adds an explanation that Chromium skipped that certificate and is continuing. No action is needed when scores load normally; other certificate or network errors still need investigation.

- **Navigate:** click the leftmost 20% of the unlocked banner for the previous rotation item; click elsewhere for the next item. Single clicks wait briefly to distinguish a double-click. Both directions wrap around and start a fresh display interval. Game locks and temporary overrides still apply. Desktop and OBS stay in sync.
- **Move:** click anywhere on the unlocked banner and drag, including between monitors. Moving more than 5 screen pixels starts a drag; releasing after dragging never skips a game.
- **Settings:** right-click the banner and choose **Settings…**. Right-clicking does not advance rotation.
- **Updates:** SportsOver checks the latest published GitHub release on launch, at most once every 24 hours. Normal launches prompt only when a newer version is available; background launches, up-to-date results, and automatic-check failures stay quiet. Choose **Check for updates…** in the tray dropdown, banner right-click menu, or application menu for an immediate manual check. **Open download page** opens the official release page for manual installation.
- **Resize:** double-click the left half of the unlocked banner to shrink it, or the right half to enlarge it, stepping through 50%, 75%, 100%, 125%, 150%, 200%, and 300%. Double-clicks resize without changing games; dragging never resizes. Banner size in Settings and the tray menu also work. Proportional scaling keeps the full 472 × 100 design intact; transparent windows do not rely on platform-specific native resize borders.
- **Lock:** clicks pass through the banner to the application beneath it. Use **Unlock** in Settings or uncheck **Lock / click through** in the tray menu.
- Settings uses two stateful buttons: **Lock / Unlock** and **Hide / Show**. Their labels update after changes from Settings, the tray, or the application menu; each button controls its own state.
- **Recover:** **Ctrl+Shift+U** on Windows or **Cmd+Shift+U** on macOS unlocks, shows, and moves the banner onto the primary display, then opens Settings. The Settings status reports if another application owns that shortcut. Tray and Settings controls remain available.
- **Show/hide:** available in Settings and the tray menu. Position, size, lock state, visibility, and sports settings survive restarts. Settings opens on every launch so a hidden or locked banner always has a recovery path.
- Launching a second instance recovers the existing banner. Disconnecting a monitor brings an offscreen banner into an available work area.

## Sports settings

MLB, NFL, college football, NHL, MLS, NBA, and NCAA men's basketball use MLB/ESPN providers and team directories. Rank sports and watched teams, enable/disable favorites, select time zone and fallback behavior, and configure provider polling. Settings changes save automatically and update the banner without reloading it. Number fields apply when you leave the field or press Enter; invalid values are not saved. If saving fails, your changes remain available and a **Retry save** button appears.

**Disc golf · PDGA:** in its Settings card, paste a PDGA tournament URL/ID (or browse current events), load the tournament, choose a division, and click **Watch division**. Each division is one rotation entry. Choose the top-three leaderboard or **Followed player**, then load and select a player. Missing followed players fall back to the leaders. Rank, disable, or remove watched divisions independently; settings save automatically. No tournament is selected by default.

PDGA uses an individual-competitor model and a compact banner within the existing 472 × 100 window, including 200% scaling. The banner shows provider-reported ranks and ties, total relative to par, round score relative to par, holes completed, playoff winners, and DNF/withdrawal status for a followed player. A completed intermediate round displays **Break**; an event with no scorecards displays **Upcoming**. Tee times are labeled course local because the feed does not always provide a time zone. Watched divisions stay in automatic rotation, including finals, until removed; **Top watched team only** selects the first included PDGA division. Queue modes, locks, durations, and Live mode also apply.

The PDGA Live provider uses publicly reachable, undocumented JSON endpoints without an API key. Defaults are 30 seconds for live scores, 60 for metadata/upcoming, and 300 for finished/idle scores. Requests share the existing cache, failures back off, and the banner retains the last successful scores with a **STALE** label. Only individual stroke-play events are supported. Provider access and response formats can change. Player/event links and PDGA attribution are included.

With no saved settings, watched teams start with Seattle Mariners, Seahawks, Kraken, and Sounders FC; Nebraska Cornhuskers and Washington Huskies in football and men's basketball; Seattle U Redhawks men's basketball; and Detroit Pistons. Existing saved selections are preserved; restoring defaults applies this starting list.

When ESPN supplies spreads or moneylines in the existing scoreboard or game-summary response, the banner shows them in a compact odds row. NHL spreads are labeled **Puck line**; MLS moneylines include the draw when available. Pregame lines remain for five minutes after the banner observes the game start, labeled **PRE**, then disappear. When joining an already live game, the scheduled start is used to avoid showing old pregame lines. Explicit live markets are labeled **LIVE** and remain while supplied; closing lines are never treated as live odds. Finals and missing odds hide the row. This adds no provider requests, and MLB's current feed does not supply odds.

To follow NCAA men's basketball, choose **NCAA men’s basketball · NCAAM** in Team tracking, select a team; the change saves automatically. Existing saved watched lists do not gain college basketball teams automatically. The ESPN directory, scoreboard, schedules, and game summaries power this sport; these are public endpoints without a supported developer API contract. Refresh team data to update the bundled directory. The banner displays halves and overtime, including overtime finals. College timeouts appear as `TO n` only when ESPN reports a remaining count; missing counts stay hidden. It does not infer timeouts from NBA rules or partial play logs. See the [NCAA provider notes](sports/college-basketball/README.md).

Automatic rotation includes one live or fallback game per included watched team, following sport and team rank. Shared matchups appear once. A live game takes priority over the fallback for that same team; other watched teams still contribute their own games. **Top watched team only** limits each sport to its first included team. Manual queue modes, exclusions, ordering, and locks still apply.

**Live control** reads discovered games from that same engine and manages automatic, hybrid, or curated game rotation, game order and durations, and game locks. A game lock chooses what plays; the desktop click-through lock controls mouse input. **Demo lab** previews deterministic sport/lifecycle examples without changing the live banner. Use the Electron overlay window to view the live output while changing Settings. Demo lab uses fixed data only.

**Refresh teams** saves current provider catalogs in app data, leaving the source checkout unchanged. A failed sport refresh retains its previous directory; other successful sports may still update. Live feeds can be unavailable or delayed. Existing provider fallback/error states apply; this app does not guarantee real-time scores.

Turn off **Show sport** in a sport's Settings card to remove that sport
from the banner and game selection, including manually added or locked games.
Teams, ordering, and preferences stay saved. Turn it back on to restore
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
npm run test:pdga
npm run test:pdga:live
```

`npm test` runs the provider/rotation/configuration suite and desktop persistence, recovery, bounds, and protocol tests. `npm run test:desktop` launches real Electron windows with isolated temporary app data and mocked provider responses. It checks shared rendering, authenticated API access, override expiry/restoration, independent desktop visibility, shared settings, desktop controls and secure preferences, then restarts to verify persistence. It also asserts that only one engine window makes provider requests while desktop, Settings and an HTTP browser-source client are connected. It leaves screenshots and test data in the temporary directory printed at completion. It does not alter your normal preferences.

`npm run test:pdga` uses Chrome with fixture scores to check PDGA settings, persistence, player selection, locks, stale data, and mixed-sport rendering. `npm run test:pdga:live` is an optional network check using a completed PDGA tournament in an isolated Electron instance; it verifies the native 200% banner and OBS, then simulates an active round to check removal from Live mode. Set `SPORTSOVER_TEST_EXECUTABLE` to test a built app instead of the source launcher.

Platform results and remaining manual checks are recorded in [desktop/TESTING.md](desktop/TESTING.md). Always-on-top cannot cover exclusive-fullscreen games or protected system screens. macOS fullscreen-workspace visibility is requested but needs manual validation on the target setup. Windows support needs native Windows testing. Linux is experimental; Wayland does not provide Electron's always-on-top behavior.

## License

SportsOver is licensed under the [MIT License](LICENSE). Third-party dependencies and sports data, logos, and trademarks remain subject to their respective licenses and terms.

## Local macOS app

Run `npm run build:mac`, then open `dist/SportsOver.app` for the SportsOver application name and scoreboard Dock/Finder icon. This reuses the installed Electron runtime and creates a local ad-hoc signed bundle; it is not notarized for distribution. Rebuild after source changes. `npm start` remains the development launcher and macOS may identify it as Electron. Both launches use the same SportsOver settings.

Run `npm run dist:mac` on a Mac to build a downloadable DMG for that Mac's
architecture, or `npm run dist:mac -- --all` for both Apple Silicon and Intel.
Installers, SHA-256 checksums, and installation instructions are written to
`dist/installers/`. These are ad-hoc signed, unnotarized builds and are never
uploaded automatically. See [macOS packaging](desktop/PACKAGING.md) for build
commands, verification, and the release checklist.

The menu-bar scoreboard uses a compact template icon with a persistent position. Its initial position is near the right edge to avoid a crowded MacBook notch area; Cmd-drag can reposition it. Banner controls also remain available in the Banner application menu.
