# TODO

## Provider permissions

- Confirm written ESPN permission for automated access to the current score/situation endpoints, redistribution in desktop/OBS overlays and team artwork. Ask for aggregate request limits across sports and hosts, plus caching/attribution requirements.
- Confirm MLB authorization for distributed/public overlays, permitted caching, the meaning of non-bulk use, and team-logo rights.
- Complete PDGA developer/license review and confirm whether it covers the current unauthenticated Live endpoints or requires a supported replacement. Ask for rate limits, caching rules and attribution expectations for both Settings and banner views.
- These questions remain open; no outreach or agreement acceptance has been performed. See the dated provider-access findings in README.md.

## Ideas

- Support multiple banner windows at once with different sports in each banner, including across monitors. Each banner should have its own sport selection and game rotation, size, position, fullscreen, and position lock; save window layouts and share score fetching through the existing engine.
- Give every sport a clickable area on the banner that opens game info, like the existing disc golf (DG) and chess clickspots.
- Favorite players across events: let users pick players to follow and manage a saved favorites list, including clicking a player's name on a leaderboard to add them. Discover and follow their tournaments or matches wherever supported providers offer usable data, including events outside the main pro tour.
- Explore additional sports with public APIs that require no authentication (PDGA and Lichess chess broadcasts are already supported):
  - **Strongest candidate:** World Archery API v4 (archery; live scores, matches, schedules, and qualification data).
  - **Secondary:** speedrun.com REST API (competitive speedrunning; unauthenticated reads for leaderboards/results, less useful for live scoring).
  - **Needs investigation:** World Rowing official API; verify public access and live-race endpoints.
  - **Uncertain:** World Curling Results API; confirm whether the historical public API is still supported.
  - Before integrating, verify access requirements and usage terms; avoid providers whose terms prohibit automated collection.
