# Approved implementation plan

1. Retain the secure Electron shell, app-owned settings/catalogs, recoverable bounds, desktop controls and source-run distribution.
2. Run exactly one hidden, unthrottled engine renderer using the shared sports providers, layouts and rotation. Publish rendered state and available-game metadata to the main process.
3. Make desktop, OBS and production previews passive consumers of the same published frame. Settings reads the engine's discovery data instead of polling providers. Deterministic Demo lab remains independent of live state.
4. Add a loopback-only HTTP output and authenticated command API. Validate Host/Origin, bearer token, payload size and command schema. App owns bounded temporary overrides, idempotency, cancellation, expiry and return to the current underlying rotation/settings. Do not mutate saved configuration for overrides.
5. Verify shared output, visibility independence, single engine, API authorization, override restoration, persistence and native shell behavior. Document actual platform limits and migration boundaries.
6. Keep both sibling repositories operational and untouched. Future migration/retirement and real Twitch reward mappings require later authorization.

Implemented in this checkout. Verification: 102 automated tests plus native macOS shared-engine/HTTP-output smoke test. Remaining target-platform/manual validation is recorded in TESTING.md; actual OBS, Windows, physical mouse passthrough and monitor/fullscreen behavior are not claimed as verified. No sibling code or live Twitch integration was changed.
