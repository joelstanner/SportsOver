# NCAA men's basketball

Uses the ESPN source recommended in the prior “Find basketball and chess APIs”
discussion. No API key or additional hosted service is needed.

Base URL: `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball`

- Team directory: `/teams?limit=2000` (362 teams returned on 2026-09-30).
- Team schedule: `/teams/{numeric-team-id}/schedule?season={ending-year}`.
- Division I scoreboard: `/scoreboard?groups=50&limit=1000`, including unranked games.
- Game summary: `/summary?event={id}`.

Identifiers use `ncaam:{team-id}` in the team directory and
`college-basketball:{event-id}` in rotation and integration commands. Existing
settings gain an empty watched-team list and default provider refresh intervals.

The existing basketball layout is shared, with college-specific period and timeout
presentation. Periods 1 and 2 are first and second half; 3 and above are overtime.
Clocks come from ESPN; no NBA quarter length is imposed. Final games retain their
overtime label when period data is available. When summary status omits period or
clock, the latest play supplies those values if available.

NCAA men's rules use two 20-minute halves and five-minute overtimes. Under the
Division I media format, teams start with three 30-second and one 60-second timeout;
only two unused 30-second timeouts carry into the second half. Unused timeouts
carry into overtime, with one extra 30-second timeout for each overtime. These
allocations differ from NBA rules and may depend on the game's media format.
The display uses the same bar symbols as NBA, with one bright bar per explicitly
reported remaining timeout. Zero remaining shows a single dim bar; missing counts
remain hidden. The row has no fixed allocation and does not estimate remaining
timeouts from timeouts used/partial play logs. We do not infer foul bonuses, shot
clocks, or possession arrows from incomplete data.

Rules references:
- [NCAA men's playing rules and current rule book](https://www.ncaa.org/championships/playing-rules/mens-basketball-playing-rules/)
- [2025–26 Division I media timeout format, Rule 5-14.10](https://ncaaorg.s3.amazonaws.com/championships/sports/basketball/rules/men/2025-26PRMBB_TVTimeoutScenariosRegularSeasonGame.pdf)

The provider test fixture is a trimmed response from
`/summary?event=401746082`, the 2025 Florida–Houston championship, retrieved
2026-09-30. Synthetic live and overtime cases exercise rules not present in that
final-game response. Demo lab contains synthetic pregame, live, halftime, and final
games; it does not present them as current results.
