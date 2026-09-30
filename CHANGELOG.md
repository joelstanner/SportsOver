# Changelog

User-visible changes are listed newest first. Dates record version bumps, not
publication to an app store or a GitHub release.

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
