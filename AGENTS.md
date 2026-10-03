# Project instructions

## User shorthand

- `gst` means `git status`. When requested, show the current Git status.

## Version bumps

After completing a change that warrants a version bump, ask the user whether to
increment the version before changing it. Recommend a concrete next version and
explain the appropriate level: patch for fixes and polish, minor for new features
or meaningful interaction changes, and major for breaking changes or an explicitly
agreed stable 1.0 release. Explicitly identify when a minor or major bump is warranted.

Do not increment automatically. An explicit user instruction to bump the version
is authorization; do not ask again for that same bump. Group related changes into
one proposed bump rather than bumping for each edit or test build. On approval,
update package.json and package-lock.json together, update CHANGELOG.md for that
version, and rebuild dist/SportsOver.app.

## Changelog

Update CHANGELOG.md with every version bump, in the same change as the package
version updates. Add a dated entry at the top of the version history using the
exact new version and the date of the bump. Summarize user-visible additions,
changes, and fixes since the previous version; include migration steps or breaking
changes when applicable. Keep entries concise and grounded in completed work.
Group related work under its approved version and do not invent publication dates
or claim that a local version bump was a published release.

## Installer builds and releases

Build future release installers in GitHub Actions. Use successful macOS and
Windows packaging runs for the exact release commit: `SportsOver-macos-arm64`,
`SportsOver-macos-x64`, and `SportsOver-windows-x64`. Verify downloaded checksums
before uploading those artifacts to a release. Do not substitute local installer
builds or artifacts from another commit when CI fails; resolve the CI failure.

`npm run build:mac` remains the local development app rebuild required by version
bumps. Local installer commands are for troubleshooting only. Packaging workflows
produce artifacts; publishing a GitHub release still requires user authorization.
