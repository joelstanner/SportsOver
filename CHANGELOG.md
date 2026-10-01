# Changelog

User-visible changes are listed newest first. Dates record version bumps, not
publication to an app store or a GitHub release.

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
