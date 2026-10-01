# SportsOver application artwork

`SportsOver.png` is the approved 1254 × 1254 retro Pong-style football icon:
navy background, cyan court and center line, white pixel paddles, a brown
football, and a 6–9 score. It is used for the running Dock icon, About panel,
and Settings window where supported. macOS builds generate the required icon
sizes from this source image.

The status item keeps the compact 1×/2× monochrome scoreboard glyph. Extra text is intentionally omitted to save room near MacBook camera notches.

Run `npm run build:mac` on macOS to create `dist/SportsOver.app` using the installed Electron runtime, a generated `.icns`, and SportsOver bundle metadata. The bundle has a local ad-hoc signature; it is not notarized for distribution. Double-click that app for the SportsOver menu name and Finder icon. `npm start` remains the Electron development launcher.

`npm run dist:mac` uses this same artwork for the packaged application and DMG.
The disk image includes an Applications shortcut and first-launch instructions;
see [macOS packaging](../PACKAGING.md).

The macOS status item uses a stable GUID so Cmd-drag positioning survives relaunches. An AppKit registration default places it near the right edge on first use; saved user preferences override the default. This platform-specific preference key should be rechecked on macOS upgrades.
