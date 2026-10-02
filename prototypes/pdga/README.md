# PDGA banner prototype

Archived design preview on branch `codex/pdga-banner-prototype`. This prototype
is separate from the production banner and is not included in app installers.

From the repository root, run:

```sh
node prototypes/pdga/server.cjs
```

Open `http://127.0.0.1:17864/`. The preview includes leaderboard and followed-player
designs and starts with the saved tournament/round snapshots. Its local server
refreshes the example MPO round from PDGA at most once every 30 seconds, retaining
the last received scores if refresh fails.

Return to this preview with `git switch codex/pdga-banner-prototype`; return to
the release code with `git switch main`.
