# Seattle Mariners OBS Score Bug

A compact, dependency-free OBS Browser Source overlay powered by the public MLB Stats API. It automatically finds today's Mariners game (team ID `136`) and displays live scores, inning, outs, and occupied bases.

## Run and test locally

The most reliable option is to serve this folder over local HTTP. In PowerShell, open this folder and run:

```powershell
py -m http.server 8080
```

Then visit [http://localhost:8080](http://localhost:8080) in a browser. Stop the server with `Ctrl+C`.

Opening `index.html` directly with a `file:///` URL may also work in some browsers, but browser security policies differ. If the MLB request is blocked or the overlay stays blank, use the local HTTP server command above. No backend or API key is needed.

The MLB Stats API currently responds with permissive CORS headers, so requests from `http://localhost` work directly; the local server only serves these static files.

To diagnose a problem, open the browser developer console. Network/API failures are logged there while the overlay keeps its last valid display.

## Add to OBS

1. Keep the local server running.
2. In OBS, add a **Browser** source.
3. Clear **Local file** and enter `http://localhost:8080` as the URL.
4. Set the width to `472` and height to `100`.
5. Leave custom CSS empty. The page is already transparent.
6. Enable **Refresh browser when scene becomes active** if you want an immediate refresh on scene changes.

If direct local-file loading works on your system, you may instead enable **Local file** and select `index.html`.

## Recommended dimensions

- Browser Source: **472 × 100 px** (recommended)
- Live overlay: up to **460 × 88 px**, plus 6 px transparent breathing room on each side
- Pregame/final/off-day overlay: **460 × 62 px**

At a 2560 × 1440 canvas, this occupies about 18% of the screen width and remains readable at its native size. Scale the OBS source uniformly if needed; avoid stretching it in only one direction.

## Customization

The main controls are at the top of `style.css` in the `:root` block:

- `--bug-width`, `--bug-height`, and `--detail-row-height`: overall overlay sizes
- `--font-size`: base text size
- `--horizontal-padding`: left/right spacing
- `--navy`, `--panel`, and `--panel-2`: background styling
- `--teal` and `--teal-soft`: Seattle accent styling

In `script.js`, change `showNoGameMessage` to `false` to hide the source completely on days with no Mariners game. The polling interval is `pollIntervalMs` (12 seconds by default).

## Display behavior

- **Live:** scores, top/bottom inning indicator, `MID` and `END` labels between innings, inning, ball-strike count, yellow-dot out indicators, base occupancy, current pitcher with pitch count, current batter with game hits/at-bats, and MLB's most recent completed-play description
- **Pregame:** matchup and scheduled time in the computer's local time zone
- **Final:** final score and `FINAL`
- **Delayed/postponed/suspended:** MLB's detailed status
- **No game:** a subtle message, or fully hidden via the configuration noted above

The overlay rechecks the schedule every five minutes on off days and keeps the last good display through temporary network failures.
