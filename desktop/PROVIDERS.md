# Provider access and request limits

Reviewed October 3, 2026, excluding Lichess. No official numeric request quota was
found for the ESPN, MLB Stats API or PDGA Live endpoints used here. Public access
is not a redistribution license, and request pacing does not resolve permissions.

| Provider | Published rules and open questions |
| --- | --- |
| ESPN | [Disney terms, section 2](https://disneytermsofuse.com/english/) cover ESPN and require express written permission for automated extraction and business use. Confirm permission for these endpoints, score overlays and team artwork. |
| MLB Stats API | [MLB's data notice](https://gdx.mlb.com/components/copyright.txt) permits individual, noncommercial, non-bulk use and requires written authorization for other uses. Confirm how distribution, public overlays and team logos may be used; no numeric definition of non-bulk was found. |
| PDGA Live | [Website terms](https://www.pdga.com/tos) restrict automated collection and public display. The separate [developer program](https://www.pdga.com/dev) requires membership, a signed agreement, authenticated access and prelaunch implementation review, plus attribution on every screen with PDGA data and links from player/event/course names. Confirm authorization specifically for the unauthenticated Live endpoints used here, applicable limits, caching and display requirements. The current agreement form requires login and has not been reviewed. |
| GitHub releases | [Unauthenticated REST requests](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) share a 60/hour budget per originating IP. Rate-limited 403/429 responses require respecting retry/reset headers and secondary-limit backoff. |

ESPN, MLB and PDGA requests share a desktop-process queue per service, including
Settings lookups and team-directory refreshes. Each service starts requests at
least 250 ms apart and runs one request at a time. This is a SportsOver pacing
choice, not a published provider allowance. ESPN's hosts and all its sports share
one queue. Request timeouts start when a request is dispatched, not while queued.
Requests for the game being displayed take priority over queued discovery and
catalog work. After three display requests, a waiting background request gets a
turn; both groups preserve their own arrival order. If discovery already queued
the displayed game's data, that request is promoted without fetching it twice.
Running requests are allowed to finish, and priority never bypasses a cooldown.
HTTP 429 pauses the entire service for at least one minute; repeated throttling
increases that delay up to five minutes. Longer `Retry-After` values are honored,
including HTTP dates. HTTP 403/503 with `Retry-After` also pauses that service.
Manual retries and new feed URLs cannot bypass an active cooldown; healthy cached
responses remain available. Sports cooldowns last for the desktop process lifetime.
In browser development mode, queues are per page and catalog refreshes use the
development server's separate queue. These limits cannot coordinate other apps or
machines sharing the same public IP.

GitHub checks honor `Retry-After` and `X-RateLimit-Reset`, recognize secondary-limit
errors, and retain cooldowns across app restarts when preferences can be saved.
Manual checks explain when to retry without sending another request during the
cooldown. Automatic checks remain at most daily and stay silent on errors.
No provider permission or license approval is implied by these protections.


For Lichess scope, discovery, and rate limits, see the [chess provider notes](../sports/chess/README.md).

Formula 1 uses the ESPN scoreboard at `/apis/site/v2/sports/racing/f1/scoreboard`
and the website JSON route `/f1/results/_/id/{weekendId}?_xhr=pageContent`.
The latter is restricted to that exact HTTPS route/query and shares the same ESPN
queue and cooldown as the API hosts. Driver profiles and results are linked from
the banner. National flags use ESPN's country artwork URLs. ESPN's existing access
and artwork restrictions still apply; no separate F1 quota or permission has been
established. The website JSON response is not a documented public API contract,
and its active-session freshness has not yet been verified. See the README for
the exact refresh intervals and fallback behavior.
