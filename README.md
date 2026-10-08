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

Each category under **Sports & watched events** has a twirldown beside its name.
Collapse it to hide its details; this choice is remembered on that device and does
not change watched selections or polling. **Show sport** controls the sport itself:
unchecking it stops score, schedule, tournament discovery, metadata, and player-list
API requests for that sport in the banner, Settings, and OBS. Queued requests are
checked again before dispatch; a request already sent may finish. Watched selections
and preferences are retained for re-enabling. **Refresh directory…** skips disabled
sports, including when **All enabled team sports** is selected. Bundled/saved team
directories and demo fixtures remain available locally.

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
| Resize | With the banner or Settings focused and the position unlocked, press Up to shrink or Down to grow smoothly by 10 percentage points (10–300%). Rapid presses continue from the requested size, so each press counts. Double-click the banner's left half to shrink or right half to enlarge. Size presets (50–300%) are also in Settings and menus. Below 50%, live and final team games use large logos and scores on the desktop banner; upcoming games show logos with the scheduled date and time between them. Halftime uses the compact scores with a prominent vertical HT marker. Other interruptions and OBS retain their layouts. “Skip individual sports below 50%” is on by default in Desktop banner settings: it temporarily removes chess and disc golf from the shared desktop/OBS rotation while the desktop banner is small. Turn it off to retain every sport; selected sports return at 50% or larger. Resizing keeps the top edge fixed and the width centered horizontally, shifting sideways only when needed to stay on its monitor. Growth stops when there is no room below. Fields, selectors, and focused tournament lists retain their own arrow behavior. |
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

## OBS size presets

The passive output supports Small (360 × 76), Normal (647 × 137), and Large
(2304 × 280) through `core/obs-layouts.css`. Large presents one game across a
wide strip; Small uses the desktop below-50% treatment: large logos and scores,
centered upcoming date/time, and a vertical halftime marker.
Normal retains the current card. NFL and NCAAF use native-size score numbers;
NFL and NBA preserve their compact native score rows and give stats the remaining
space. Hockey centers scores in the available team
space, uses moderately larger numbers, and preserves the native score-row and
lower-detail proportions. Game selection and rotation remain shared.
Desktop banner sizing is unchanged.

NBA banners use the bundled Gary Payton image in place of Oklahoma City's team
logo, for either home or away games in every game state, including OBS output.

OBS checks the SportsOver engine heartbeat independently of score changes. After
10 seconds without an advancing heartbeat, or when the engine reports it is not
ready, the banner turns grey and replaces its values with `DATA OFFLINE` /
`SPORTSOVER DISCONNECTED`. It stops countdowns and scrolling, then restores the
current frame automatically when a fresh engine heartbeat arrives. This checks
the local engine, not the age of upstream sports-provider data. Older builds
without heartbeat metadata also show the offline state until SportsOver is updated.

The AntlerJones local OBS host in `aj-obs-assets/sportsover-banner` can keep a
grey placeholder visible even when this server is stopped at page load. It embeds
the output page with `?obs-host=1` and requires a fresh rendered-heartbeat signal
before revealing it. Output pages allow embedding by local files and the same
origin; API host/origin checks remain unchanged.

The compact OBS rules are generated from `core/compact-banner.css`; run
`node scripts/sync-obs-compact.cjs` after changing the shared desktop treatment.

For an older installed build, paste the contents of `core/obs-layouts.css`
into the source Custom CSS field and use those browser viewport dimensions.
Recreate/reload the source after changing its viewport; some OBS embedded-browser
versions retain the previous viewport during a resize. The coordinated AntlerJones
OBS controller uses a size-specific `?obs-layout=small|normal|large` URL to reload
the browser at its new dimensions. This query does not change the selected game.

Mocked browser checks: `npm run test:obs`. Set `BROWSER_EXE` to an installed
Chrome/Edge executable when the default Chrome channel is unavailable.

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

Terminal launches print Electron/Chromium runtime diagnostics and renderer console
messages, along with the app's existing output. `[SportsOver HTTP]` entries show
outgoing feed and renderer HTTP requests, response status, elapsed time, redirects,
and network errors. Restart the app after updating to enable these logs.

To save a timestamped diagnostic log while keeping terminal output visible, run:

```sh
npm start -- --debug
```

The source launcher prints the file path and creates a separate
`logs/sportsover-debug-<timestamp>-<pid>.log` for each run. Each line includes a UTC
timestamp and its output stream. The file captures HTTP entries, renderer console
messages, and native diagnostics; it also flushes partial lines when the app exits.
Logs are ignored by Git. The flag can be combined with `--background`.

Chess round feeds follow your configured refresh intervals: the defaults are 30
seconds live, 60 seconds pregame, five minutes idle, and fifteen minutes finished.
Saved timing preferences are preserved. Tournament metadata
and standings use a minimum two-minute cache during play, five minutes before play
or during breaks, and fifteen minutes after completion. Longer configured
intervals are respected. New board results expire standings early, and a completed
round expires metadata so the next round can be selected promptly. Desktop chess
requests share one paced queue and rate-limit cooldown across windows, with
displayed-game requests taking priority over background discovery.

ESPN season schedules and MLB watched-team date-range schedules use a minimum
15-minute cache, respecting longer configured intervals. Daily league scoreboards,
NFL week scoreboards, and individual game feeds keep their configured refresh
intervals. Fresh league data takes precedence over cached schedule data for the
same game. Schedule changes outside the current league scoreboard can take up to
15 minutes to appear at default settings; failed requests retain normal retry and
rate-limit recovery timing.

PDGA tournament metadata uses a minimum two-minute cache during play, five minutes
before play or between rounds, and fifteen minutes once every listed division is
confirmed finished. Longer configured intervals are respected. Round score feeds
keep their configured cadence. A newly completed intermediate round expires
metadata early to check for the next round; if that round is not posted yet,
subsequent checks follow the metadata interval. Failed metadata requests keep
normal retry and rate-limit recovery timing.

For startup with only the engine, OBS server, and tray, use
`npm start -- --background` (or pass `--background` to the packaged executable).
Open Settings or show the banner from the tray when needed.

```sh
npm test                              # Unit tests
npm run test:desktop                  # Electron smoke tests (quiet by default)
npm run test:desktop -- --visible     # Include native window interactions
npm run test:network                  # Verify startup network isolation
```

Routine unit, integration, browser, and desktop tests deny outbound network
access by default. Unit files and `npm test` install the Node transport guard;
browser tests use the shared guarded launcher. Explicit mocks still work.
Unexpected external attempts fail the run even if application code catches the
request error. Local OBS/control traffic remains available. Redirects cannot
escape to remote hosts; browser service workers are disabled during tests.

Desktop tests install startup fixtures before windows, discovery, and update
checks. The baseline supplies empty supported-provider feeds, placeholder team
artwork, and a mocked unavailable GitHub release. Test-specific fixtures replace
that dispatcher without reopening native HTTPS. Quiet and visible tests share
the same checks; old packaged apps lacking these guards are refused. Manual
isolated source launches with `SPORTSOVER_TEST_DATA` default to fixtures, while
normal app launches continue to use live providers.

```sh
npm run test:offline-boundaries       # Node transport and redirect protection
npm run test:browser:network          # Browser fixture/bypass/redirect protection
npm run test:providers                # Explicit live checks, serial; stop on failure
npm run test:providers:pdga           # Two live requests: metadata and one round
npm run test:providers:espn           # Two: representative NFL scoreboard/summary
npm run test:providers:mlb            # Two: historical schedule and one game feed
npm run test:providers:lichess        # Three: directory, metadata and one round
npm run test:pdga:live                # Same PDGA cap, then native/OBS snapshot test
```

Live checks run only through explicit commands, outside `npm test` and packaging
CI. These are representative provider contracts, not exhaustive checks of every
sport, endpoint, logo, or current live game. Empty ESPN/Lichess directories report
that score contracts could not be verified. Requests are GET-only, reject
redirects, have an eight-second timeout including response bodies and a four-MiB
body cap, and use 250-ms spacing (1.5 seconds for Lichess). Each provider has a
hard request cap shown above. A 429 or any other failure ends the aggregate run
without retries or extra discovery.

The live checker saves a minimum 60-second cooldown, including successful or
interrupted runs, and serializes simultaneous invocations using a lock in the
OS temporary directory `sportsover-provider-contracts-<user>`. HTTP failures
increase backoff to at most five minutes; a longer `Retry-After` wins. Reruns
respect saved cooldowns. If a killed process leaves the `running` lock directory,
verify no check is running before removing that lock; retain the cooldown JSON.
These pacing choices are SportsOver safeguards, not published provider quotas.

To deliberately record checked responses for fixture review, run e.g.
`npm run test:providers:pdga -- --record /tmp/sportsover-fixture-review`.
`SPORTSOVER_PDGA_TOURNAMENT` and `SPORTSOVER_PDGA_DIVISION` select a different
PDGA sample for the provider-only command. Review captured identities, states,
nullable values, and privacy before copying responses into fixtures; keep Seattle
teams and Nebraska strictly ahead in any synthetic score variants. Record the
capture date/source and run the offline regressions after refreshing fixtures.
The native PDGA check preserves its historical sample and rendering checks using
the captured real response, then fixtures; it does not run live polling loops.

See [desktop testing](desktop/TESTING.md) for coverage and platform limitations,
and [packaging](desktop/PACKAGING.md) for GitHub Actions installer builds and
release checks. Linux is experimental. Always-on-top behavior does not cover
exclusive-fullscreen games or protected system screens.

[Version history](CHANGELOG.md) · [MIT License](LICENSE)
Sports data, logos, trademarks, and dependencies remain subject to their respective terms.
