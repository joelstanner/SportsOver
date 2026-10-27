# SportsOver application artwork

`SportsOver.png` is the approved 1254 × 1254 retro Pong-style football icon:
rounded navy tile with a transparent exterior, cyan court and center line,
white pixel paddles, a brown football, and a 6–9 score. Preserve the PNG alpha
channel when updating or converting this artwork so the icon has no black
rectangle around its rounded corners. It is used for the running Dock icon,
About panel, and Settings window where supported. macOS builds generate the
required icon sizes from this source image.

The visible tile is centered at approximately 1010 × 1010 pixels on the
1254 × 1254 canvas, leaving about 122 pixels (9.75%) of transparent padding on
each side. This matches the approximately 80.5% tile coverage measured in the
local macOS App Store, Calculator, Preview, and Notes icons. The original
artwork was uniformly resized and padded without redrawing its contents.
Keep this spacing when replacing the artwork so the Dock icon does not appear
oversized beside other apps.

The status item keeps the compact 1×/2× monochrome scoreboard glyph. Extra text is intentionally omitted to save room near MacBook camera notches.

Run `npm run build:mac` on macOS to create `dist/SportsOver.app` using the installed Electron runtime, a generated `.icns`, and SportsOver bundle metadata. The bundle has a local ad-hoc signature; it is not notarized for distribution. Double-click that app for the SportsOver menu name and Finder icon. `npm start` remains the Electron development launcher.

`npm run dist:mac` uses this same artwork for the packaged application and DMG.
The disk image includes an Applications shortcut and first-launch instructions;
see [macOS packaging](../PACKAGING.md).

The macOS status item uses a stable GUID so Cmd-drag positioning survives relaunches. An AppKit registration default places it near the right edge on first use; saved user preferences override the default. This platform-specific preference key should be rechecked on macOS upgrades.
