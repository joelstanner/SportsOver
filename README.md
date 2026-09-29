# Universal Sports OBS Overlay

A compact, dependency-free OBS Browser Source overlay with sport-specific layouts. The MLB provider finds the current Mariners game, while separate ESPN adapters find Seahawks, Nebraska, Washington, Kraken, Sounders, and Pistons games. All providers normalize live data into the same event lifecycle before their sport-specific layouts render it.

The current refactor preserves the production Mariners appearance and behavior while separating shared event state, MLB data normalization, baseball rendering, and polling orchestration. Future sports can use different layouts without forcing their details into baseball-shaped UI.

## Run and test locally

The most reliable option is to serve this folder over local HTTP. In PowerShell, open this folder and run:

```powershell
py -m http.server 8080
```

Then visit [http://localhost:8080](http://localhost:8080) in a browser. Stop the server with `Ctrl+C`.

Open [http://localhost:8080/admin/](http://localhost:8080/admin/) for the local control room. Its Settings tab ranks sport categories first, then ranks enabled favorites independently inside each sport. Mariners, Seahawks, Nebraska, Washington, Kraken, Sounders, and Pistons are the defaults. NFL and college football remain separate categories. Existing flat favorite settings migrate automatically. The Live tab embeds the real provider-backed banner. The Demo Lab previews every supported lifecycle and orchestration state without calling live providers or changing saved settings.

### Demo a live game

On an off day, open [http://localhost:8080/?sport=baseball&demo=live](http://localhost:8080/?sport=baseball&demo=live) for a fixed baseball example. Change `sport=football` for the NFL layout or use another configured sport. Demo mode does not call a live API or start a polling timer, so the display remains stable while developing and reviewing visual changes. Remove the query string to return to the highest-ranked sport with an enabled favorite.

For serverless testing in OBS, select `demo.html` as the Browser Source's local file. It redirects to the same fixed live-game example while preserving relative access to the overlay files.

Opening `index.html` directly with a `file:///` URL may also work in some browsers, but browser security policies differ. If the MLB request is blocked or the overlay stays blank, use the local HTTP server command above. No backend or API key is needed.

The MLB Stats API currently responds with permissive CORS headers, so requests from `http://localhost` work directly; the local server only serves these static files.

To diagnose a problem, open the browser developer console. Network/API failures are logged there while the overlay keeps its last valid display.

## Add to OBS

1. In OBS, add a **Browser** source.
2. Enable **Local file** and select `index.html`.
3. To preview a live game without a server, select `demo.html` instead. Switch back to `index.html` for real MLB data.
4. Set the width to `472` and height to `100`.
5. Leave custom CSS empty. The page is already transparent.
6. Enable **Refresh browser when scene becomes active** if you want an immediate refresh on scene changes.

If local-file loading is blocked by a browser or system policy, run the local server and use `http://localhost:8080` as the source URL instead.

## Recommended dimensions

- Browser Source: **472 × 100 px** (recommended)
- Live overlay: up to **460 × 88 px**, plus 6 px transparent breathing room on each side
- Pregame/final/off-day overlay: **460 × 62 px**

At a 2560 × 1440 canvas, this occupies about 18% of the screen width and remains readable at its native size. Scale the OBS source uniformly if needed; avoid stretching it in only one direction.

## Customization

The main controls are at the top of `sports/baseball/style.css` in the `:root` block:

- `--bug-width`, `--bug-height`, and `--detail-row-height`: overall overlay sizes
- `--font-size`: base text size
- `--horizontal-padding`: left/right spacing
- `--navy`, `--panel`, and `--panel-2`: background styling
- `--teal` and `--teal-soft`: Seattle accent styling

In `core/app.js`, change `showNoGameMessage` to `false` to hide the source completely on days with no Mariners game. The polling interval is `pollIntervalMs` (12 seconds by default).

## Display behavior

- **Live:** scores, top/bottom inning indicator, `MID` and `END` labels between innings, inning, ball-strike count, yellow-dot out indicators, base occupancy, current pitcher with pitch count, current batter with game hits/at-bats, and MLB's most recent completed-play description
- **Pregame:** matchup and scheduled time with the computer's local time zone abbreviation
- **Final:** final score and `FINAL`
- **Delayed/postponed/suspended:** MLB's detailed status
- **No game:** a subtle message, or fully hidden via the configuration noted above

The overlay rechecks the schedule every five minutes on off days and keeps the last good display through temporary network failures.
Schedule lookups explicitly use the computer's current local calendar date, including after the date rolls over at midnight.

## Architecture

```text
sports-obs-overlay/
├── index.html
├── admin/
│   ├── index.html
│   ├── admin.js
│   └── admin.css
├── core/
│   ├── app.js
│   ├── config.js
│   ├── event-model.js
│   └── registry.js
├── sports/
│   ├── baseball/
│   │   ├── demo-data.js
│   │   ├── layout.js
│   │   ├── style.css
│   │   └── providers/
│   │       └── mlb.js
│   ├── football/
│   │   ├── demo-data.js
│   │   ├── layout.js
│   │   ├── style.css
│   │   └── providers/
│   │       └── espn.js
│   ├── college-football/
│   │   ├── demo-data.js
│   │   └── providers/
│   │       └── espn.js
│   ├── hockey/
│   │   ├── demo-data.js
│   │   ├── layout.js
│   │   ├── style.css
│   │   └── providers/
│   │       └── espn.js
│   ├── soccer/
│   │   ├── demo-data.js
│   │   ├── layout.js
│   │   ├── style.css
│   │   └── providers/
│   │       └── espn.js
│   └── basketball/
│       ├── demo-data.js
│       ├── layout.js
│       ├── style.css
│       └── providers/
│           └── espn.js
└── tests/
    ├── core/
    │   └── registry.test.js
    └── sports/
        ├── baseball/
        │   └── mlb-provider.test.js
        ├── football/
        │   └── demo-data.test.js
        ├── hockey/
        │   └── espn-provider.test.js
        ├── soccer/
        │   └── espn-provider.test.js
        └── basketball/
            └── espn-provider.test.js
```

- `core/event-model.js`: shared event envelope, lifecycle states, and non-baseball pregame date/time formatting used by current and future sports. Baseball intentionally keeps time-only pregame formatting.
- `core/config.js`: versioned local settings, nested sport/favorite rankings, catalogs, validation, migration, and persistence.
- `core/registry.js`: connects named providers and sport layouts without hard-coding their implementation paths into shared logic.
- `core/app.js`: current single-event orchestration and refresh timing.
- `sports/baseball/providers/mlb.js`: MLB schedule/live-feed requests and normalization into the shared event envelope.
- `sports/baseball/layout.js`: creates baseball markup and renders scores, innings, counts, outs, bases, players, and last play.
- `sports/baseball/style.css`: baseball-specific presentation.
- `sports/baseball/demo-data.js`: stable MLB fixtures for visual development.
- `sports/football/layout.js`: creates football markup and renders team logos, scores, quarter, clock, down and distance, field position, possession, and last play.
- `sports/football/style.css`: football-specific presentation.
- `sports/football/demo-data.js`: fixed NFL fixtures covering every shared lifecycle state.
- `sports/football/providers/espn.js`: unauthenticated ESPN schedule and game-summary adapter for live Seahawks data. ESPN does not publish a compatibility contract for this feed, so normalization tests protect the overlay and the adapter remains replaceable.
- `sports/college-football/providers/espn.js`: separate ESPN NCAAF schedule and game-summary adapter for live Nebraska and Washington data; it reuses the football layout without sharing NFL selection.
- `sports/hockey/providers/espn.js`: free, unauthenticated ESPN schedule and game-summary adapter for live Kraken data, including scores, period, clock, shots, power-play totals, scoring plays, records, and team logos.
- `sports/soccer/providers/espn.js`: free, unauthenticated ESPN MLS schedule and match-summary adapter for live Sounders data, including scores, half, clock, possession, shots on target, match events, records, and team logos.
- `sports/basketball/providers/espn.js`: free, unauthenticated ESPN schedule and game-summary adapter for live Pistons data, including scores, quarter, clock, field-goal percentage, rebounds, scoring plays, records, and team logos.

## Provider selection policy

For every new sport, evaluate a free league-owned feed first. Verify schedule coverage, live details, logos, authentication requirements, browser CORS compatibility, and reliability from a static OBS browser source. Use the league feed when it passes those checks; otherwise use the best free browser-compatible fallback and document why. ESPN is a fallback, not the default assumption.

The NBA-owned live-data CDN was evaluated for basketball. It returned HTTP 403 and restricted browser CORS access to `nba.com`, so this static overlay uses the ESPN adapter instead of adding a proxy dependency.

Add future sports as sibling folders under `sports/`, using sport names for folders and league names for providers. For example, an NFL provider belongs at `sports/football/providers/nfl.js`.

The shared lifecycle is `pregame`, `live`, `interrupted`, and `final`. No-game and temporary-error behavior remain orchestration concerns: no game may hide or show a message, while an error retains the last good display.

Run the dependency-free normalization tests with:

```powershell
node --test tests/core/*.test.js tests/sports/baseball/*.test.js tests/sports/football/*.test.js tests/sports/college-football/*.test.js tests/sports/hockey/*.test.js tests/sports/soccer/*.test.js tests/sports/basketball/*.test.js
```
