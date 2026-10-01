# Changelog

User-visible changes are listed newest first. Dates record version bumps, not
publication to an app store or a GitHub release.

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
