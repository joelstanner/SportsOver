# TODO

## Ideas

- Add a **Hide banner** option to the banner’s right-click menu.
- Fullscreen mode with a dedicated layout for displaying games across the entire screen.
- Enhance automatic pro-tour discovery by confirming favorite touring pros are entered.
- Explore additional sports with public APIs that require no authentication (PDGA is already supported):
  - **Strongest candidates:** World Archery API v4 (archery; live scores, matches, schedules, and qualification data) and Lichess API / Broadcast API (chess; live games and tournament broadcasts).
  - **Secondary:** speedrun.com REST API (competitive speedrunning; unauthenticated reads for leaderboards/results, less useful for live scoring).
  - **Needs investigation:** World Rowing official API; verify public access and live-race endpoints.
  - **Uncertain:** World Curling Results API; confirm whether the historical public API is still supported.
  - Before integrating, verify access requirements and usage terms; avoid providers whose terms prohibit automated collection.
