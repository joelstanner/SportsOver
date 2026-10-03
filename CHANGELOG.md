# Changelog

User-visible changes are listed newest first. Dates record version bumps, not
publication to an app store or a GitHub release.

## 0.28.1 — 2026-10-03

### Fixed

- PDGA player totals, leaders lines, and leaderboards use running scores,
  including first-round events where the posted tournament total is empty.
- PDGA player cards in the rotation show the player name first, the tournament
  and division beneath it in white, and position, total, round score, and progress.

Existing settings are preserved. No migration is required.

## 0.28.0 — 2026-10-03

### Added

- Left and Right arrow navigation through the rotation when the desktop
  banner is focused, including fullscreen and locked-position banners.

### Changed

- Arrow navigation uses a 100 ms slide with horizontal motion blur. Loaded
  games appear immediately while scores refresh, and rapid presses interrupt
  older transitions. Reduced-motion preferences are respected.
- Desktop frames arrive directly from the engine, reducing display latency;
  older polling responses cannot replace a newer displayed game.

Existing settings are preserved. No migration is required.

## 0.27.0 — 2026-10-03

### Added

- File menu actions to export and import settings backups, using the same
  validation and feedback as the Settings buttons.
- An Unlock all control in the rotation header to clear game locks at once.

### Changed

- Hovering over the desktop banner lets the rotation timer count down, then
  holds the current banner until the pointer leaves. Scores continue updating,
  manual browsing still works, and hiding the banner releases the hold.

Existing settings are preserved. No migration is required.

## 0.26.0 — 2026-10-03

### Added

- Manual wheel, trackpad, touch, and keyboard scrolling for PDGA leaderboards
  and chess standings/matchups, preserving hover pause and position through
  score refreshes in desktop and OBS displays.
- Live chess banners show all round boards with tournament points, clock
  snapshots, moves, and results. Player names open the board's game or the
  player's broadcast card.
- A Banner size submenu in the banner's right-click menu, with all 50–300%
  presets and the current size checked across desktop menus.

### Changed

- ESPN, MLB, and PDGA requests share paced service queues and rate-limit
  cooldowns. Displayed-game requests take priority while background work
  continues to receive turns; queued duplicates are promoted without refetching.
- Sports join rotation as their discovery finishes, with per-sport loading
  status instead of waiting for every provider.
- GitHub update checks honor rate-limit retry times across app restarts.

### Fixed

- Explicitly added chess tournaments and PDGA divisions remain discoverable
  after restarts or changes to automatic suggestions. Removing a watch clears
  its saved inclusion so it cannot reappear unexpectedly.
- Tournament title links fit their text without consuming adjacent blank space.

Existing settings are preserved. No migration is required.

## 0.25.0 — 2026-10-03

### Added

- Selective second-tier chess and PDGA suggestions in Available games, with
  qualification reasons, independent toggles, and fifteen-minute discovery.
  Suggestions are enabled by default; adding them to rotation remains manual.
- Visible loading indicators in Live control, with previously received games
  preserved during discovery outages and engine restarts.

### Changed

- Settings backup now has clear import/export actions and import progress,
  validation, and completion feedback.
- Current-round chess watches advance to the next scheduled round as Upcoming,
  keeping tournament standings visible and showing its scheduled start.
- Chess and disc-golf breaks use Final rotation timing; queue state and timers
  update when tournament status changes.

### Fixed

- Restored desktop chess standings when Lichess blocks direct renderer requests.
- Discovery feed failures no longer erase previously loaded games and now
  surface in Live control status.
- Clarified current-event controls and kept long PDGA event names from widening
  the settings layout.

## 0.24.1 — 2026-10-02

### Fixed

- Refresh games waits for the desktop engine to finish and reports updated
  lists, no available updates, or feed failures beside the button. Feedback
  remains visible during background polling.

### Changed

- Added a Refresh games tooltip explaining discovery, rotation updates, and
  feed refresh limits.
- Renamed the chess watch action to Watch tournament and added tooltips to it
  and Watch division explaining what each follows and saves.

## 0.24.0 — 2026-10-02

### Added

- A sport filter for the On banner list, with visible and total game counts.
  Filtering affects only the list and leaves banner playback unchanged.

### Changed

- Disc-golf and chess banners have crisp title icons and richer teal and violet
  gradients, consistent with the other sports.

## 0.23.0 — 2026-10-02

### Added

- Fullscreen banner mode centers the full-width banner on a black screen, with
  Escape, menu, tray, and Settings controls to exit and restore its previous size
  and position. The cursor hides after three seconds of inactivity.

### Changed

- Shortened the banner interaction tooltip and removed it from the fullscreen
  background.
- Upcoming disc-golf leaderboards show the highest PDGA-rated entrants first,
  with ratings displayed until play begins; tournament standings then take over.
- Truncated names in Banner rotation reveal the full name on hover.
- Seattle teams and the Nebraska Cornhuskers always lead in scored demo and test
  fixtures. Real provider scores are unchanged.

## 0.22.0 — 2026-10-02

### Changed

- Game locks now work in Live mode: hold one eligible game or rotate among
  several, with other live games still available to lock in Live control.
- Vertical leaderboards pause for the first quarter of each rotation cycle
  before scrolling (five seconds with the default twenty-second duration).

### Fixed

- Disc golf no longer treats completed or withdrawn scorecards as active play.
- Chess requires a recorded move on an unfinished board to show Live; unstarted
  pairings and an ongoing round flag alone no longer qualify.
- Tournament breaks show the waiting reason, including an upcoming round.
  Individual tournaments leave Live mode during breaks and return when play
  resumes, even when locked. Team-sport breaks remain eligible.

## 0.21.3 — 2026-10-02

### Fixed

- MLB pregame banners now include the date when the game is not today, using
  the selected display time zone.

## 0.21.2 — 2026-10-02

### Fixed

- College football timeout counts now follow the current half instead of ESPN's
  cumulative game totals, reset at halftime, and count duplicate plays only once.
- College overtime shows one timeout per team for each of the first two extra
  periods, then one shared allowance from the third overtime onward.
- Hide uncertain timeout counts when the feed lacks sufficient play history.

## 0.21.1 — 2026-10-02

### Fixed

- Keep rotation and available-game lists at their scroll positions when changing
  a game's display time or refreshing games, including cards with odds.

## 0.21.0 — 2026-10-02

### Added

- Unsigned Windows x64 NSIS installer with per-user installation, Start menu and
  desktop shortcuts, SHA-256 checksums, and manual install/update instructions.
- Windows build scripts and CI for unit tests, runtime archive inspection,
  checksum verification, and smoke tests of unpacked and installed copies.
- Shared runtime-file allowlist for Windows and macOS packages.

### Fixed

- Restored missing optional packaging dependencies in the lockfile so clean
  dependency installation can complete with the pinned tool versions.

The `npm install` / `npm start` workflow remains supported. Updates are manual;
preferences are retained. No migration is required. Windows CI passed unit tests,
installer and checksum verification, and automated desktop checks of unpacked
and installed copies. Physical interaction, always-on-top and actual OBS checks
remain unverified.

## 0.20.0 — 2026-10-02

### Added

- Separate tournament and followed-player banners for the same disc-golf
  division or chess broadcast, with independent rotation controls.
- Top-10 tournament leaderboards scroll vertically within the compact banner;
  a static top-three option remains available. Chess uses published tournament
  points and tiebreak ranks from Lichess.

### Fixed

- Player lists load automatically when opening saved banners. Failed or empty
  lists offer a retry while preserving the saved player selection.
- Hovering or focusing a leaderboard pauses scrolling in place instead of
  resetting it. Scrolling resumes when the pointer or focus leaves.
- Player banners stay out of rotation until a player is selected, preventing
  duplicate leaderboards from unfinished player watches.

Existing watches and player selections are preserved. No migration is required.
Chess broadcasts without published tournament scores show an unavailable message.

## 0.19.2 — 2026-10-02

### Fixed

- Chess and PDGA banners clear the previous sport's preseason label when
  switching games, including navigating backward from an NBA preseason banner.

## 0.19.1 — 2026-10-02

### Fixed

- PDGA scores links open the displayed tournament, division, and round in the
  browser. Tournament and player links also work from locked or unlocked desktop
  banners without advancing rotation.
- Cached score feeds survive the original request timeout, preventing false
  stale-data warnings between scheduled refreshes while preserving normal
  outage handling and request limits.

## 0.19.0 — 2026-10-02

### Added

- Lichess chess broadcasts with current-round or pinned-round watches, a
  three-board overview, and followed-player pairings, results, and clock snapshots.
- Automatic elite chess discovery, enabled by default, searches every 15 minutes.
  Chess and PDGA discoveries have saved automatic watch lists with inclusion
  controls and **Keep watch** to preserve manual player preferences.
- Chess joins normal rotation, Live control, Live mode, and Demo lab. Desktop
  broadcast links open in the browser while keeping the current banner selection.

### Fixed

- Automatic watch list updates no longer interrupt concurrent Settings saves.
- Directory discovery stays on its 15-minute cadence with longer score refresh
  intervals; temporary feed failures preserve saved automatic watches.

Existing PDGA discovery preferences and manual watches are preserved. No migration
steps are required; automatic chess discovery can be turned off in Settings.

## 0.18.0 — 2026-10-02

### Added

- Live control game cards show available spreads and moneylines using the
  banner's labels and pregame/live expiry rules.
- Spread payout prices appear in parentheses when supplied by the feed.

### Changed

- Green highlights mark close matchups: spreads within 3 points for football
  and basketball, or 0.5 goals for hockey and soccer; moneylines qualify when
  both teams are within ±120 in the same market. Spread payout prices stay neutral.

### Fixed

- Empty odds entries no longer interrupt rendering of rotation or available games.
- Priced puck lines and mixed pregame/live odds fit the NHL banner frame.

## 0.17.0 — 2026-10-02

### Changed

- Watched-team finals remain in normal rotation alongside upcoming games for
  up to 24 hours after the detected finish, ending when the next game starts.
  Spotlight finals retain one hour; Live mode keeps its separate retention setting.
- Fresh launches without a known finish time recover recent watched finals
  using a conservative cutoff of 24 hours from the reported game start.

## 0.16.0 — 2026-10-01

### Changed

- The desktop lock now holds banner position and prevents double-click resizing
  while keeping game browsing and the right-click menu available. It no longer
  passes clicks through to the application underneath.
- The banner's right-click menu includes a position-lock checkbox and Hide banner.
- The rotation-list item currently shown in the banner has a subtle teal glow
  that follows the rendered game and clears when the engine is unavailable.
- Live and final team games show scores in the game lists, including live
  games outside the rotation. Missing scores are omitted.

### Fixed

- The local Mac app uses the SportsOver executable name as well as the
  SportsOver bundle name, matching the downloadable installers.

## 0.15.0 — 2026-10-01

### Added

- **Automatically follow the pro tour** discovers one Elite Series or Major
  tournament with selectable MPO/FPO divisions. Discovery starts off; both
  divisions are selected by default when enabled. No migration is required.
- Discovered divisions are labeled **Automatic**, with controls to exclude them
  or save them as manual watches. Manual player-view preferences take precedence.

### Changed

- Automatic tournament selection follows scorecard status, stays through round
  breaks, and honors final retention and upcoming/recent-final/hide behavior.
- The shared engine checks the PDGA directory every 15 minutes, reuses tournament
  metadata, and limits concurrent PDGA requests to three.
- Tightened hockey banner spacing to fit odds, power-play, and preseason details.

### Fixed

- Discovered PDGA divisions retain last received data during temporary feed
  failures instead of disappearing from Available games. Recent-final selections
  also remain stable through outages and recover automatically.
- Shared-engine status reports unavailable score feeds, and the PDGA empty-list
  message explains that divisions already in rotation are listed separately.

## 0.14.2 — 2026-10-01

### Fixed

- Upcoming PDGA events retain their upcoming status and tee times when refreshes
  fail, without showing stale-score or automatic-retry warnings.
- Missing first-round score feeds use the upcoming refresh interval.

### Changed

- PDGA failure backoff and automatic-retry messaging apply only to live scores.
  Routine checks continue to detect play starting, new rounds, and result updates.

## 0.14.1 — 2026-10-01

### Fixed

- SportsOver remains in the macOS Dock, Cmd-Tab switcher, and application menu
  while the floating banner follows desktop and fullscreen Spaces.
- Closing Settings keeps the app accessible; activating the app reopens Settings
  without showing a banner that was hidden.

### Changed

- Successful local Mac builds retain only the newest previous app backup.

## 0.14.0 — 2026-10-01

### Added

- Disc golf with PDGA tournament/division selection, current-event browsing,
  and optional followed players. Individual events share rotation, timing,
  locks, Live mode, desktop scaling, and OBS output with team sports.
- Compact leaderboard and followed-player banners with ranks, scores relative
  to par, round progress, tee times, playoff results, and stale-data indicators.
- **Check for updates…** in the tray, banner context menu, and application menu,
  with a link to the official release download page when an update is available.
- Automatic update checks on launch, limited to once per 24 hours. Background
  launches and automatic failures stay quiet; installation remains manual.

### Changed

- Saved settings support individual events while preserving existing team
  selections. Add a tournament in **Settings → Disc golf** to begin watching;
  no migration steps are required.

## 0.13.1 — 2026-10-01

### Changed

- Replaced the app icon with the approved retro Pong-style football artwork,
  featuring pixel paddles, a cyan court, and a 6–9 score. The new artwork is
  included in the desktop app and macOS installers.

## 0.13.0 — 2026-10-01

### Added

- macOS drag-to-Applications DMG installers for Apple Silicon and Intel,
  requiring macOS 13 or newer and no separate Node.js or npm installation.
- Installation, first-launch approval, update, and uninstall instructions,
  with SHA-256 checksums for each installer. These early builds are ad-hoc
  signed and not notarized by Apple; updates are manual.

Windows continues to use the existing source-based npm installation.

## 0.12.0 — 2026-10-01

### Added

- Live Mode filters the selected rotation to live games and temporarily pauses
  queue mode and game locks. Turning it off restores those choices; it starts off
  after app restart.
- Finished games stay in Live Mode for a configurable time after SportsOver
  detects the finish, defaulting to 20 minutes. Set 0 to remove them immediately.

### Changed

- College basketball timeouts use bright bars for the reported remaining count,
  a dim bar for zero, and no markers when the count is unavailable.

### Fixed

- Longer pregame and final team names adjust spacing and font size before
  falling back to abbreviations, preserving full names when they fit.

## 0.11.2 — 2026-10-01

### Changed

- Settings, Live control, and Demo lab tabs stay visible at the top of the
  settings window while scrolling.

## 0.11.1 — 2026-10-01

### Changed

- Made the desktop banner info card easier to scan with separate controls,
  short gesture instructions, status badges, and a recovery shortcut.

### Fixed

- Restore defaults now requires confirmation before replacing saved settings.
  Cancel is focused by default; Cancel or Escape leaves settings unchanged.

## 0.11.0 — 2026-10-01

### Added

- Double-click the unlocked banner's left half to shrink it or right half to
  enlarge it through the existing 50–300% size steps, without changing games.
  Single-click navigation waits 0.4 seconds to distinguish double-clicks.

### Changed

- Condensed desktop controls into Lock/Unlock and Hide/Show toggle buttons.
  Locked state uses amber with a subtle glow; visible state uses teal, and
  hidden state uses a muted outline. Unlocking leaves a hidden banner hidden.
- Fresh settings include Nebraska Cornhuskers, Washington Huskies, and Seattle U
  Redhawks men's basketball alongside the existing Nebraska and Seattle teams
  and Detroit Pistons. Saved watched-team selections are preserved.

## 0.10.3 — 2026-10-01

### Changed

- Pre-game and final banners use available space for full team names, including
  the city, with abbreviations retained when names do not fit. Baseball status
  moves below the teams to give names more room.

## 0.10.2 — 2026-10-01

### Changed

- Added sport icons between the rank number and sport name in Settings.

## 0.10.1 — 2026-10-01

### Changed

- Removed redundant provider tags from watched-team cards and tightened their layout.

## 0.10.0 — 2026-10-01

### Added

- Click the leftmost 20% of the unlocked banner to show the previous rotation
  item; click elsewhere to advance. Both directions wrap and restart the display
  interval, while dragging, game locks, and temporary overrides keep their behavior.

## 0.9.0 — 2026-10-01

### Changed

- Settings save automatically and update the banner. Number fields apply on
  leaving the field or pressing Enter; failed saves retain edits and offer Retry save.
- Automatic rotation includes a live or fallback game for every included watched
  team, in rank order, with shared matchups shown once. Top watched team only
  limits each sport to its first included team; manual queue controls still apply.

### Fixed

- Queued saves preserve rapid edits while another change is saving, and refreshes
  keep actively edited number fields intact.

## 0.8.0 — 2026-10-01

### Added

- Banner spreads and moneylines from existing ESPN responses, including NHL
  puck lines and MLS draw odds when available. No extra provider requests.
- Pregame odds clear after a five-minute grace period once play begins;
  explicitly live markets remain labeled LIVE while supplied. Finals hide odds.

## 0.7.2 — 2026-09-30

### Fixed

- Banner dragging validates native coordinate limits and normalizes negative
  zero before moving the window. Invalid gestures cancel without moving the
  banner or skipping a game.

## 0.7.1 — 2026-09-30

### Changed

- Added a Display mode tooltip explaining each option, fallback behavior, and
  how Live control determines the final rotation.

### Fixed

- MLS discovery now combines ESPN's completed results and upcoming fixtures so
  future watched-team matches appear in game selection and rotation.
- NHL end-of-period states now show the period break and hide active power-play
  indicators until play resumes.
- Live control sport dropdowns exclude disabled sports, restore re-enabled
  sports, and reset selections when the selected sport is disabled.

## 0.7.0 — 2026-09-30

### Added

- Per-sport Show sport switches in Settings. Disabling a sport removes its games
  from the banner and game selection, including locks and temporary overrides.
  Re-enabling restores saved teams, ordering, and preferences. All sports can be
  disabled; existing configurations keep sports enabled by default.

## 0.6.0 — 2026-09-30

### Added

- Live NHL power-play indicator using ESPN's situation feed. Shows the team when
  matching on-ice data identifies the advantage; otherwise shows a generic label.
  Clears when inactive or unavailable, with cumulative totals labeled PP GOALS / OPP.

### Fixed

- MLS possession and shots-on-target stats now list the home team first to match
  the score display.

## 0.5.2 — 2026-09-30

### Fixed

- MLS possession and shots-on-target stats use balanced columns and tighter
  spacing to keep labels and values on one line.

## 0.5.1 — 2026-09-30

### Fixed

- Final scores from yesterday now show “YESTERDAY” in all sports; older results
  show their date. Labels follow the configured time zone and preserve overtime
  and full-time status text.

## 0.5.0 — 2026-09-30

### Added

- `--background` startup runs the sports engine, OBS output server, and tray
  without opening the desktop banner or Settings. Saved banner visibility is
  preserved for normal startup.
- Repeated background launches leave an existing instance alone; normal launches
  retain window recovery. Use the tray to open a background-started app.

## 0.4.0 — 2026-09-30

### Added

- NCAA men's basketball through ESPN, with a bundled 362-team directory, team
  tracking, rotation, provider refresh controls, and Demo lab support.
- College basketball display for halves, overtime, and overtime finals. Remaining
  timeouts appear only when explicitly reported, without NBA timeout assumptions.
- This changelog and a project requirement to update it with every version bump.

## 0.3.1 — 2026-09-30

### Added

- Current app version beside the SportsOver heading in Settings, sourced from the
  running app so it stays synchronized with version bumps.

## 0.3.0 — 2026-09-30

### Added

- A tooltip explaining temporary integration overrides, early cancellation,
  automatic expiry, and preservation of saved settings.

### Changed

- Team tracking now selects a sport first, then offers only unwatched teams from
  that sport. Changing sports clears the previous team choice.
- Version bumps require user approval and a recommendation of the next version.

## 0.2.0 — 2026-09-30

### Added

- Click the unlocked banner to advance rotation with a fresh display interval.
- Drag from anywhere on the banner without advancing rotation on release.
- Right-click the banner to open Settings from a native context menu.
- Banner gesture instructions in the main Settings tab.
- An explanatory message after the known macOS Keychain certificate parsing
  diagnostic during `npm start`, while preserving the original error output.

### Fixed

- Default timing fields retain typed values during background refreshes and
  accept Enter to apply. Limits remain 5–300 seconds in 5-second increments.
- Final games in Rotation order share the styling used in Available games.

## 0.1.0 — 2026-09-29

### Added

- Standalone Electron desktop app with a transparent, always-on-top banner,
  Settings, tray/menu-bar controls, and saved window preferences.
- One shared sports engine for desktop and OBS output, plus a local integration
  API for timed game overrides.
- MLB, NFL, college football, NHL, MLS, and NBA providers and team directories.
- Local macOS app bundle with SportsOver branding and icons.

### Fixed

- Preserved scrolling during score updates and restored game transitions in
  passive outputs.
