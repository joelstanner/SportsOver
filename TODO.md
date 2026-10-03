# TODO

## Ideas

- Favorite players across events: let users pick players to follow and manage a saved favorites list, including clicking a player's name on a leaderboard to add them. Discover and follow their tournaments or matches wherever supported providers offer usable data, including events outside the main pro tour.
- Explore additional sports with public APIs that require no authentication (PDGA and Lichess chess broadcasts are already supported):
  - **Strongest candidate:** World Archery API v4 (archery; live scores, matches, schedules, and qualification data).
  - **Secondary:** speedrun.com REST API (competitive speedrunning; unauthenticated reads for leaderboards/results, less useful for live scoring).
  - **Needs investigation:** World Rowing official API; verify public access and live-race endpoints.
  - **Uncertain:** World Curling Results API; confirm whether the historical public API is still supported.
  - Before integrating, verify access requirements and usage terms; avoid providers whose terms prohibit automated collection.
