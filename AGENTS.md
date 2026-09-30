# Project instructions

## Version bumps

After completing a change that warrants a version bump, ask the user whether to
increment the version before changing it. Recommend a concrete next version and
explain the appropriate level: patch for fixes and polish, minor for new features
or meaningful interaction changes, and major for breaking changes or an explicitly
agreed stable 1.0 release. Explicitly identify when a minor or major bump is warranted.

Do not increment automatically. An explicit user instruction to bump the version
is authorization; do not ask again for that same bump. Group related changes into
one proposed bump rather than bumping for each edit or test build. On approval,
update package.json and package-lock.json together and rebuild dist/SportsOver.app.
