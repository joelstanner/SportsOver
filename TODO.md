# TODO

## Provider permissions

- Confirm written ESPN permission for automated access to the current score/situation endpoints, redistribution in desktop/OBS overlays and team artwork. Ask for aggregate request limits across sports and hosts, plus caching/attribution requirements.
- Confirm MLB authorization for distributed/public overlays, permitted caching, the meaning of non-bulk use, and team-logo rights.
- Complete PDGA developer/license review and confirm whether it covers the current unauthenticated Live endpoints or requires a supported replacement. Ask for rate limits, caching rules and attribution expectations for both Settings and banner views.
- These questions remain open; no outreach or agreement acceptance has been performed. See the dated [provider-access findings](desktop/PROVIDERS.md).

## Ideas

- [ ] Audit outbound API request volume by sport, provider, and endpoint during startup, idle polling, live games, and Settings/OBS use. Identify duplicate calls, measure calls per minute, and recommend changes to polling or caching where needed. Disabled-sport request gating is complete; comparable live request-volume measurements remain.
- Add keyboard shortcuts for more features, extending the existing game-browsing and banner-resizing shortcuts.
- [ ] Plan a simplification of Settings and its relationship to Live control: identify confusing or redundant controls, propose a clearer layout and wording, then implement an initial set of concrete improvements while preserving saved preferences.
- Support multiple banner windows at once with different sports in each banner, including across monitors. Each banner should have its own sport selection and game rotation, size, position, fullscreen, and position lock; save window layouts and share score fetching through the existing engine.
- Favorite players across events: per-event followed-player banners already exist for PDGA and chess. Add a saved favorites list, including clicking a player's name on a leaderboard to add them, and discover/follow their tournaments or matches across events wherever supported providers offer usable data, including outside the main pro tour.
- Explore additional sports with public APIs that require no authentication (PDGA and Lichess chess broadcasts are already supported):
  - **Strongest candidate:** World Archery API v4 (archery; live scores, matches, schedules, and qualification data).
  - **Secondary:** speedrun.com REST API (competitive speedrunning; unauthenticated reads for leaderboards/results, less useful for live scoring).
  - **Needs investigation:** World Rowing official API; verify public access and live-race endpoints.
  - **Uncertain:** World Curling Results API; confirm whether the historical public API is still supported.
  - Before integrating, verify access requirements and usage terms; avoid providers whose terms prohibit automated collection.

## Completed

- [x] Make each category under Sports and watched events expandable and collapsible using a twirldown. Remember its state on the device without changing watched selections or polling.
- [x] Stop API requests when Show sport is unchecked, including score feeds, schedules, tournament discovery, metadata, player lists, and directory refreshes. Check queued work before dispatch, preserve saved selections and provider cooldowns, and cover disabling/re-enabling with regression tests. Already-sent requests may finish.
- [x] Give upcoming games a compact desktop layout below 50%, similar to live games: team logos on either side with the game date/time in the middle.
- [x] Add a compact desktop layout below 50% for live and final team games, emphasizing logos and scores. Upcoming games have a matching compact layout; interrupted games and OBS keep their existing layouts.
- [x] Make scores and logos proportionally larger at smaller desktop banner sizes while retaining team names, clock/status, and detail rows at every size.
- [x] Explain when to refresh the team directory, distinguish it from score/schedule refreshes, and confirm the selected scope before replacing saved team data. Keep watched teams and rankings intact.
- [x] Give every supported sport clickable game-info links on the banner. Team names and logos open the current MLB/ESPN game page when available (added in **0.29.0**); PDGA and chess already have tournament/player links. See [version history](CHANGELOG.md).
