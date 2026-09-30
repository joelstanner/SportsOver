# Local integration API v1

SportsOver must be running. Base URL is `http://127.0.0.1:17843`. Requests must address that exact loopback host. No CORS access is granted to other sites; foreign Origin/Host headers are rejected. Only passive output and renderer styles/scripts are public. Every `/api/v1/` endpoint requires:

```http
Authorization: Bearer <integration-token>
```

Copy the token using **Copy integration token** in Settings. It is generated locally and persisted in `integration.json` under SportsOver user data, separate from exported sports settings. Do not put it in OBS URLs, source control, or public logs. To rotate it, close SportsOver, remove `integration.json`, restart, and update the integration. The token controls this local app; Twitch authentication/permissions/cooldowns remain the integration's responsibility.

## Read authoritative state

`GET /api/v1/state` returns `ready`, `availableEntries`, `automaticEntries`, `queue`, `currentGameKey`, `overrideGameKey`, and `override`. Game keys are `<sport>:<provider-game-id>`; derive them from returned entries' `candidate.sport` and `candidate.id`. Candidate details are provider-specific. Do not guess identifiers or reward mappings.

`GET /api/output` is the read-only passive output snapshot. OBS should use `/output`, not the API directly. Public snapshots contain rendered sports content, never the integration token or user settings.

## Temporary game override

`POST /api/v1/commands` requires `Content-Type: application/json`, a body no larger than 4096 bytes, and a caller-generated `requestId` (1–100 letters/digits/underscores/hyphens).

```json
{
  "requestId": "unique-command-id",
  "type": "show-game",
  "gameKey": "<sport>:<discovered-game-id>",
  "durationSeconds": 30
}
```

`durationSeconds` must be an integer from 5 to 3600. The game must currently exist in the engine's discovered games. Success returns HTTP 200 with `{ "accepted": true, "override": { "id", "gameKey", "startedAt", "expiresAt" } }`; timestamps are Unix milliseconds. Acceptance schedules the engine selection; it does not prove a successful provider response or determine a Twitch redemption's fulfillment status. Read state/output to observe rendering.

Only one temporary override can run at a time. A second one returns 409 until the current override expires or is cancelled. No implicit replacement or queue is invented. Repeating an identical requestId/command returns its original acceptance without restarting or extending the duration. Reusing that ID with different command data returns 409. The most recent 1000 accepted request IDs are retained for the current process only; callers should not replay old commands across an app restart.

SportsOver pauses automatic game advancement while overridden and continues polling the chosen game. The underlying saved settings and queue are not rewritten. At expiry/cancellation, it resumes the underlying selection using current settings; if the prior game is no longer eligible, current queue selection applies. A fresh normal dwell interval begins. Settings changes made during an override remain effective afterward. Overrides end on application exit or engine crash; they are deliberately not resurrected on restart.

## Cancel

```json
{
  "requestId": "unique-cancel-id",
  "type": "clear-override",
  "overrideId": "id-returned-by-show-game"
}
```

`overrideId` is optional; supplying it prevents an old cancellation from clearing a newer override (409 on mismatch). Omitting it clears whichever override is active. Settings also has an **End temporary override** button.

## Errors and integration boundary

- 400: malformed JSON, request ID, command, or duration
- 401: missing/incorrect bearer token
- 403: unexpected Host or Origin
- 409: active override, mismatched cancellation, or conflicting retry ID
- 413/415: oversized body or unsupported content type
- 422: game is not currently discovered
- 503: engine not ready

Twitchbot remains an optional future client. It should own Twitch authentication, reward receiving, authorization, cooldowns and redemption status; SportsOver owns sports data, selection, rendering and timed restoration. No actual reward mapping, integration deployment, or retirement of old implementations is included in this change.
