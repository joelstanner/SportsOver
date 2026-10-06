# SportsOver

A transparent, draggable sports banner that stays above ordinary desktop windows.
Follow your teams and tournaments, rotate live scores, and optionally share the
same banner with OBS. OBS is optional.

Supports **MLB, NFL, college football, NHL, MLS, NBA, NCAA men's basketball,
PDGA disc golf, and Lichess chess broadcasts**.

## Install

Download an installer from the [latest release](https://github.com/joelstanner/SportsOver/releases/latest).
**Node.js and npm are not required.** Releases include SHA-256 checksums and
installation instructions.

| Platform | Download and install |
| --- | --- |
| macOS 13+ · Apple Silicon | Open the `*-mac-arm64.dmg` and drag SportsOver to Applications. |
| macOS 13+ · Intel | Open the `*-mac-x64.dmg` and drag SportsOver to Applications. |
| Windows 10+ · x64 | Run the `*-win-x64-setup.exe`, then launch from the Start menu or desktop shortcut. No administrator access is required. |

Mac builds are ad-hoc signed and not notarized. If macOS blocks first launch,
try opening the app, dismiss the warning, then use **System Settings → Privacy &
Security → Open Anyway** ([Apple's instructions](https://support.apple.com/102445)).
Windows builds are unsigned and may show an unknown-publisher or SmartScreen
warning. See the [Mac](packaging/Install%20SportsOver.txt) and
[Windows](packaging/Install%20SportsOver%20Windows.txt) installation guides for details.

**Updates are manual.** SportsOver checks for new releases on launch, at most
once a day; **Check for updates…** is also available in its menus. Quit the app,
then replace it in Applications on Mac or run the newer Windows installer over
the same destination. Settings are retained.

## Get started

The banner and Settings open together. Closing Settings keeps SportsOver running;
use the tray/menu-bar icon to reopen it or choose **Quit SportsOver**.

- **Settings:** choose and rank teams and sports, set the time zone, and adjust
  score refresh intervals and fallback behavior. Changes save automatically.
  Use **Export settings** / **Import settings…** here or in the File menu for backups.
- **Live control:** add or exclude games, reorder the rotation, set display
  durations, and set **Rotation source** to automatic selections, automatic selections
  plus your games, or only games you choose. Pin one game to
  hold it, or several to rotate among them; **Unpin all** clears game pins.
  **Pinned only** filters the rotation list to pinned games and combines with its sport filter.
  It is disabled when nothing is pinned; clearing the last pin also clears this filter.
- **Live mode:** show live games from your rotation, with configurable finished-game
  retention (20 minutes by default). Tournament breaks leave Live mode until play
  resumes; team-sport breaks remain eligible. Live mode starts off after a restart.
- **Demo lab:** preview individual samples, or use **Inspect the banner and OBS** to show marked fixture data on both outputs. Choose all-live, all-upcoming, final, interrupted, mixed, or fallback states across all sports or one sport. Inspection starts paused; use Previous/Next fixture or Play rotation. **Return to live output** restores real games. Demo mode preserves saved selections and ends when the app quits.

**Automatic game selection** in Settings chooses which games are suggested:
**All watched teams + live spotlight**, or **Top watched team per sport**.
**Rotation source** in Live control decides whether the banner uses those selections,
your chosen games, or both. The top-team option limits automatic suggestions;
you can still add other teams’ games manually. Order, durations, and pins are set in Live control.

Automatic rotation follows included watched teams in rank order, showing shared
matchups once. Watched-team finals can rotate alongside upcoming games for up to
24 hours, ending when the next game starts. Games starting in less than an hour
show a countdown, then **Starting soon** until the feed reports play.

## Banner controls

In Live control → ON BANNER, choose a sport and turn on **Apply to banner** to limit rotation to that sport. Changing the sport updates the active filter; turning the toggle off restores the full rotation and its saved locks. The filter also applies in Live mode and persists across restarts. With the toggle off, the dropdown filters only the list.

When no games match, the banner shows a no-games message and resumes when eligible games return. Temporary game overrides must match the active sport filter; changing the filter ends an override for another sport.

| Action | Control |
| --- | --- |
| Browse games | Click the leftmost 20% for previous; click elsewhere for next. With the banner or Settings focused, use Left/Right arrows. In Settings, arrows retain their normal behavior in fields, selectors, and dialogs. |
| Move | Drag anywhere on the unlocked banner, or use Shift + arrows with the banner or Settings focused to move 5 pixels per press. Hold the keys to keep moving. Fields, selectors, and dialogs retain their own shortcuts. Movement pauses in fullscreen. |
| Resize | With the banner or Settings focused and the position unlocked, press Up to shrink or Down to grow smoothly by 10 percentage points (10–300%). Rapid presses continue from the requested size, so each press counts. Double-click the banner's left half to shrink or right half to enlarge. Size presets (50–300%) are also in Settings and menus. Resizing keeps the top edge fixed and the width centered horizontally, shifting sideways only when needed to stay on its monitor. Growth stops when there is no room below. Fields, selectors, and focused tournament lists retain their own arrow behavior. |
| Open Settings | Right-click the banner and choose **Settings…**, or use the tray/menu bar. |
| Lock position / hide | Use Settings, the tray, or the banner's right-click menu. Position locking keeps game browsing available. |
| Fullscreen | Use **Fullscreen** or **Ctrl/Cmd + Shift + F**; press **Escape** to restore the previous size and position. |
| Recover the banner | **Ctrl/Cmd + Shift + U** shows, unlocks, and moves it to the primary display, then opens Settings. Tray recovery is also available. |

Hovering over the desktop banner holds it when the rotation timer runs out;
scores keep updating, and rotation resumes when you leave. Team names and logos,
tournament titles, and player names open the relevant provider page when available.
Position, size, visibility, and lock state survive restarts.

## Disc golf and chess

In the sport's Settings card, browse current events or paste a tournament URL/ID,
load it, then choose **Watch division** (PDGA) or **Watch tournament** (Lichess).
Chess can follow the current round automatically or pin a round.

Each event can have a tournament banner and a separate **player banner**, with
independent rotation controls. Select a player to include a player banner.
Leaderboards offer **Top 10 · scroll vertically** or **Top 3 · static**; live chess
also shows round matchups. Hover or focus lists to pause scrolling, and browse with
a wheel, trackpad, touch, or keyboard.

**Automatic watch lists** discover elite events every 15 minutes while the app
runs. Elite chess discovery starts on; PDGA pro-tour discovery starts off, with
MPO/FPO selected when enabled. Exclude automatic entries or use **Keep watch** to
save a manual watch. Select second-tier live suggestions appear in **Available
games** by default; add them to rotation manually.

Live feeds require internet access and may be delayed or unavailable. **STALE**
marks retained scores during outages; chess clocks are broadcast snapshots.
Chess standings require published tournament totals. See the
[provider access and request limits](desktop/PROVIDERS.md) and
[chess provider notes](sports/chess/README.md) for scope and restrictions.

## OBS and integrations

With SportsOver running, copy the OBS URL from Settings (normally
`http://127.0.0.1:17843/output`) into an OBS **Browser Source**. Set its dimensions
to **472 × 100**, then scale it in OBS. The background is transparent. Desktop and
OBS share the same engine and rotation; hiding the desktop banner keeps OBS running.

The server is local to your computer. If port 17843 is occupied, free it and
restart SportsOver. For temporary game-selection commands, copy the integration
token from Settings and follow the [local API guide](desktop/API.md).

## Settings and recovery

Saved settings and refreshed team catalogs live in:

- macOS: `~/Library/Application Support/SportsOver`
- Windows: `%APPDATA%\SportsOver`
- Linux (experimental): typically `~/.config/SportsOver`

The app keeps a `settings.json.bak` backup and tries it if `settings.json` is
invalid. Close SportsOver before manually restoring files. Updating or
uninstalling the app leaves this data in place.

## Run from source

Install [Node.js](https://nodejs.org/en/download/) **22 or newer**, clone or download
this repository, and open a terminal in the folder containing `package.json`:

```sh
npm ci
npm start
```

For startup with only the engine, OBS server, and tray, use
`npm start -- --background` (or pass `--background` to the packaged executable).
Open Settings or show the banner from the tray when needed.

```sh
npm test                              # Unit tests
npm run test:desktop                  # Electron smoke tests (quiet by default)
npm run test:desktop -- --visible     # Include native window interactions
```

See [desktop testing](desktop/TESTING.md) for coverage and platform limitations,
and [packaging](desktop/PACKAGING.md) for GitHub Actions installer builds and
release checks. Linux is experimental. Always-on-top behavior does not cover
exclusive-fullscreen games or protected system screens.

[Version history](CHANGELOG.md) · [MIT License](LICENSE)
Sports data, logos, trademarks, and dependencies remain subject to their respective terms.
