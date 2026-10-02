# Chess broadcasts

Chess uses the public [Lichess Broadcast API](https://lichess-org.github.io/api/#tag/Broadcasts), verified without authentication on October 2, 2026. This covers over-the-board events carried by Lichess; it is not a directory of every FIDE event or a personal online-game tracker.

## Setup and display

Like PDGA, Settings offers browse-or-paste discovery, saved watches, inclusion, ranking, removal, and a followed-player view. Browse current broadcasts, or paste a tournament/round/game broadcast link (or eight-character ID), then load it and watch its current round or pin a specific round. Each saved watch is one rotation entry. Separate tournament sections can be watched independently. No manual chess watch is preselected. Automatic elite discovery is on by default when no preference has been saved; an explicit off choice is preserved.

The tournament banner shows the top 10 players by published tournament points, with Lichess's tiebreak rank determining order among equal scores. It scrolls vertically through a three-row viewport. Choose **Top 3 · static** for a fixed leaderboard. **Add player banner** creates an independent rotation entry for a player in the same tournament/round; its inclusion, order, locks, and duration remain independent. From a player banner, **Add tournament banner** adds the corresponding standings view. Player banners enter rotation only after a player is selected, and leave it again if that selection is cleared. Existing watch identities and player selections are retained.

Standings come from Lichess's public player totals, including custom scoring and grouped tournament scores. They always reflect current tournament totals, even when the matchup banner is pinned to an older round. Broadcasts without published scores show an unavailable message; current-board results are never presented as tournament standings. A standings request failure retains previously received totals with a stale label while player matchups can keep updating.

The followed-player view shows the pairing, ratings/federations when supplied, last broadcast clocks, side to move when a position is supplied, and result. Selection follows FIDE ID across rounds, or exact name when no FIDE ID exists. An absent player falls back to standings. Both layouts fit the existing 460 × 88 scorebug in the 472 × 100 desktop/OBS window. Vertical scrolling completes within the banner's configured rotation duration and preserves its phase through score refreshes. Hover/focus pauses the list in place and leaving resumes it; reduced-motion mode uses manual scrolling only.

Automatic current-round watches retain a stable tournament watch key across rounds. They use an ongoing round first, then the latest scheduled started unfinished round, the latest completed round, or the default/first round. Intermediate completion is a Break; final-round completion is Final. Pinning a round makes its completion Final even if the tournament continues. Watches remain in normal rotation until disabled or removed; top-favorite mode uses the first included chess watch. Existing queue modes, durations, exclusions, locks, and Live mode apply.

## Automatic elite watches

The shared engine checks the directory on startup and every 15 minutes while SportsOver is running, even when score refresh settings are longer. It finds up to eight nearby official high-tier (4) and best-tier (5) tournaments, prioritizing best-tier events. Normal-tier (3) and unofficial events are excluded. The date window extends seven days forward/backward; already followed active tournaments remain through round breaks and directory rollover (bounded to sixteen with retained events). These tiers are Lichess's editorial classification, not an inferred player ranking. Coverage depends on its public broadcasts.

Discovered events are saved in Settings' **Automatic watch list**, separately from manual watches. The list updates as events are posted and retires old events after a healthy discovery. Partial outages can add confirmed events but cannot erase previous watches. Turn **Included** off to exclude an automatic entry; **Keep watch** makes it a manual watch so you can select a player or keep the event indefinitely. Manual watches take precedence over matching discoveries. Pausing automatic discovery preserves the saved list and manual player choices but removes automatically selected entries from rotation and Live mode.

All eligible live events and round breaks rotate. Detected completions remain for one hour in normal rotation, or the configured Live mode retention; newly found finals are offered as a recent-final fallback rather than treated as observed finishes. When no active or retained event remains, the upcoming/recent-final/hide fallback selects the appropriate event. Top-favorite mode limits automatic chess suggestions to one, in addition to the top manual watch. Searches stop when the app is closed and resume on launch; no background OS job is installed.

PDGA retains its existing 15-minute Elite Series/Major discovery and selected-event behavior. Its discovered MPO/FPO divisions now appear in the same saved automatic watch list. An existing PDGA on/off preference is preserved.

## Data and refresh

- `GET /api/broadcast/top`: browse current broadcasts; fifteen-minute cache.
- `GET /api/broadcast/{tourId}`: event metadata and round schedule.
- `GET /broadcast/{tourId}/players`: published player scores, games played, and tiebreak ranks.
- `GET /api/broadcast/-/-/{roundId}`: games, results, positions and clock snapshots. SEO slugs can be replaced with `-`.

All responses are JSON, fitting the existing shared refresh cache and sole desktop engine. Default intervals are 30 seconds live, 60 upcoming, and 300 idle/final. Tournament metadata remains on the live refresh cadence until all posted rounds are completed so newly posted rounds can be discovered. Rotation, native output and OBS reuse the engine. Requests within a page are serialized and in-flight requests deduplicated. HTTP 429 pauses further Lichess requests for at least one minute; routine failures use the existing backoff. Last successful event data is retained with an explicit STALE label, including upcoming pairings when the feed becomes unavailable.

Clocks use Lichess preview centiseconds and show the received snapshot; no local ticking or engine evaluation is added. Source broadcast delay is preserved and labeled when supplied. Missing clocks show a dash. Unknown results are never converted to draws, and missing FEN does not invent a side to move. The full broadcast is linked for boards and analysis. Private broadcasts require authorization and are outside this integration.

Sources: [standings route](https://github.com/lichess-org/lila/blob/master/app/controllers/RelayTour.scala), [standings schema and ranking](https://github.com/lichess-org/lila/blob/master/modules/relay/src/main/RelayPlayer.scala), [broadcast help](https://lichess.org/broadcast/help?lang=en), [round response schema](https://github.com/lichess-org/api/blob/master/doc/specs/schemas/BroadcastRoundGame.yaml), [API usage and rate limits](https://lichess.org/page/api-tips), [preview serializer](https://github.com/lichess-org/lila/blob/master/modules/study/src/main/StudyChapterPreview.scala), [official tier definitions](https://github.com/lichess-org/lila/blob/master/modules/relay/src/main/RelayTour.scala).

## Verification

`npm test` includes provider normalization, round transitions, reference validation, request serialization, rate-limit cooldown, stale recovery, and saved configuration. `npm run test:chess` exercises browse/watch/player selection, persistence, queue locks, round advancement, clocks, scaling, stale recovery, final results, missing-player fallback, mixed-sport rotation and Demo lab with fixture data. `npm run test:chess:desktop` checks the native and OBS outputs in an isolated Electron instance with fixture feeds.

`npm run test:elite` and `npm run test:elite:desktop` verify saved chess/PDGA automatic lists, tier filtering, exclusions, keeping watches, player preferences, persistence, and pausing discovery. The desktop check confirms Settings and OBS reuse one directory search. Unit checks advance time to verify newly posted events are found at the next 15-minute search.

`node tests/browser/tournament-banners.cjs` checks separate tournament/player entries for both sports, saved top-three/top-ten choices, published chess points, vertical scrolling, fixed banner dimensions, and reduced-motion behavior.
