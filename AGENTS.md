# Project instructions

## New chat initialization

Before beginning implementation in a new chat, fetch `origin` and inspect the
current branch, its origin tracking branch, local changes, and ahead/behind state.
Ensure the current branch includes the latest commits from its corresponding
origin branch; do not rely on cached remote refs. Fast-forward when possible.
Preserve uncommitted changes and local commits when integrating incoming work;
never discard work, reset the branch, or force-push to achieve synchronization.
Local commits ahead of origin do not need to be published for this check.
If fetching fails, the origin branch cannot be identified, or synchronization
cannot be completed safely, report the blocker before beginning implementation.

## User shorthand

- `gst` means `git status`. When requested, show the current Git status.
- `ship it` authorizes a version bump, commit, push, and published GitHub release.
  Follow the CI installer and checksum requirements below; do not ask again for
  version-bump or publication approval for that shipment.

## Test and demo fixtures

Seattle teams and the Nebraska Cornhuskers must always be winning in demo data,
test fixtures, mocked feeds, and generated test variants whenever scores are
present. Keep them strictly ahead, never tied or behind, including final scores.
Pregame fixtures may omit scores. Use other teams for tests that need ties or
losses, and avoid matching these favorites against each other. When renaming a
fixture team, update its ID, abbreviation, and logo as well so it cannot retain
another team's identity. This rule applies to synthetic data, not real feeds.

## API caching and request optimization

- Cache team schedules and tournament metadata separately from live score feeds.
  A longer metadata or schedule cache must not slow current scores or game-state
  transitions. Classify feeds by their purpose: MLB's daily league `/schedule`
  endpoint carries live scores and must retain scoreboard refresh behavior.
- Prefer fresh league scoreboard data over cached team schedule data for the same
  game in discovery, available-game cards, and automatic rotation.
- When a round completes, expire metadata early where needed to discover the next
  round. Remember that completion so rereading the same finished round does not
  repeatedly invalidate the cache. Preserve configured round-score refresh timing.
- Preserve longer user-configured refresh intervals, failure retry/backoff timing,
  and provider rate-limit cooldowns. Healthy-data cache minimums must not delay
  failure recovery; manual retries and invalidation must not bypass cooldowns.
- Share cached and in-flight requests across clients using the existing refresh
  and provider queue mechanisms. Keep displayed-game requests prioritized over
  background discovery, and retain coordination across desktop windows.
- Do not infer tournament completion from a single finished division or round.
  Use confirmed completion evidence for the relevant tournament scope; unknown or
  unavailable feeds are not evidence of completion.
- Verify cache changes with focused tests for score freshness, state and round
  transitions, shared requests, and failure/rate-limit recovery. Measure request
  reductions using comparable debug-log windows, separating endpoint families,
  startup bursts, browser-cache hits, and changes in watched resources or states.
  Repeated URLs alone do not prove identical response bodies.

Keep exact cache durations and user-facing behavior in README.md. Keep measured
request counts and reductions in analysis reports rather than these instructions.

## Version bumps

After completing a change that warrants a version bump, ask the user whether to
increment the version before changing it. Recommend a concrete next version and
explain the appropriate level: patch for fixes and polish, minor for new features
or meaningful interaction changes, and major for breaking changes or an explicitly
agreed stable 1.0 release. Explicitly identify when a minor or major bump is warranted.

Do not increment automatically. An explicit user instruction to bump the version
is authorization; do not ask again for that same bump. Group related changes into
one proposed bump rather than bumping for each edit or test build. On approval,
update package.json and package-lock.json together and update CHANGELOG.md for
that version. Do not rebuild dist/SportsOver.app locally as part of a version
bump or release.

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

Do not run local Mac app rebuilds unless the user explicitly requests one.
Local installer commands are for troubleshooting only. Packaging workflows
produce artifacts; publishing a GitHub release still requires user authorization.
