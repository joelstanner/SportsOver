# macOS packaging

SportsOver can be distributed as a drag-to-Applications DMG without enrolling
in the Apple Developer Program. The app uses an ad-hoc signature, which checks
bundle integrity but does not verify the developer's identity. It is not
notarized. Downloaded copies normally require an explicit first-launch approval
in macOS Privacy & Security; see the [installation instructions](../packaging/Install%20SportsOver.txt)
and [Apple's guidance](https://support.apple.com/102445).

The current Electron runtime requires macOS 13 Ventura or newer. The packaging
configuration sets the same minimum. Apple Silicon and Intel use separate
downloads. Do not advertise a platform as tested solely because its build passes.
Windows retains its source-based `npm install` / `npm start` workflow.

## Build

Use a Mac with Node.js 22 or newer, npm, Apple's command-line tools, and internet
access to download the pinned Electron and packaging tools. From the checkout:

```sh
npm ci
npm run dist:mac                 # Native architecture of this Node process
npm run dist:mac -- --arm64      # Apple Silicon
npm run dist:mac -- --x64        # Intel
npm run dist:mac -- --all        # Both, built sequentially
```

`packaging/mac.cjs` configures the pinned electron-builder dependency. The build
explicitly selects ad-hoc signing, disables notarization, and never publishes,
even if credentials are present. It uses no Apple account. Hardened Runtime is
disabled for these ad-hoc builds; Electron renderer sandboxing and context
isolation remain enabled. A future Developer ID release needs a separate review
of signing, entitlements, notarization, and stapling.

`dist/installers/` contains:

- `SportsOver-<version>-mac-arm64.dmg` and/or `SportsOver-<version>-mac-x64.dmg`.
- A matching `.dmg.sha256` file for each built image.
- `Install SportsOver.txt`, also included inside each disk image.
- Working app bundles in `mac-arm64/` and `mac/` (Intel), plus builder metadata.

Only the DMGs, their checksums, and the installation instructions are download
assets. Rebuilding the same version and architecture replaces its generated
installer. Checksums describe the current build, not a reproducible byte-for-byte
artifact. Do not attach files left over from a different version to a release.

The existing `npm run build:mac` command still creates `dist/SportsOver.app`
using the installed runtime for local development. The DMG command does not
replace that local app. Both use `com.sportsover.desktop` and the same SportsOver
user-data folder. The installer app's executable is `Contents/MacOS/SportsOver`.

Only an explicit list of runtime files is packaged into `app.asar`; development
dependencies, source-control metadata, build scripts, and local settings are
excluded. Electron's bundled license notices are retained. Live scores, logos,
and refreshed catalogs still require internet access.

## Verify before release

Run `npm test`, then the existing desktop smoke suite against the native
packaged executable. It uses isolated temporary settings and mocked sports feeds:

```sh
SPORTSOVER_TEST_EXECUTABLE="$PWD/dist/installers/mac-arm64/SportsOver.app/Contents/MacOS/SportsOver" npm run test:desktop
```

For Intel on an Intel Mac, substitute `mac` for `mac-arm64`. The build runs
`codesign --verify --deep --strict` on each app. This confirms signature
integrity; it is not a Gatekeeper acceptance or notarization check.

For each produced DMG, verify the disk image and checksum (replace the example
version and architecture with the actual artifact):

```sh
hdiutil verify dist/installers/SportsOver-0.13.0-mac-arm64.dmg
cd dist/installers
shasum -a 256 -c SportsOver-0.13.0-mac-arm64.dmg.sha256
```

Mount the DMG, confirm the app, Applications shortcut, and readable instructions
are present, then copy the app to a temporary install location and repeat the
desktop smoke test against that copy. Check the bundle version, minimum OS,
architecture, icon, and identity against the intended release.

A release also needs a browser-downloaded copy tested on another Mac, with
normal download quarantine preserved. Verify the documented first-launch
approval, launching from Applications after ejecting the image, Settings and
menu-bar recovery, live feeds, actual OBS output, and replacing an older app
without losing preferences. Test native Apple Silicon and native Intel
separately. Do not remove quarantine or disable Gatekeeper to claim a pass.
Managed Macs may not permit opening an unidentified developer's app.

## Release

After the version bump is approved under `AGENTS.md`, update both package
versions and `CHANGELOG.md`, rebuild the local app and installers, and repeat
the relevant checks. Prepare a GitHub release with the matching version,
checksums, installation instructions, and release notes that identify these
builds as unnotarized. Verify an actual downloaded asset before publishing the
release. Building locally does not create a Git tag, release, or upload.

Updates are manual: quit SportsOver and replace the app in Applications.
Preferences and refreshed catalogs remain under
`~/Library/Application Support/SportsOver`. Uninstalling the app leaves this
data in place. No automatic update service or Windows installer is included.
