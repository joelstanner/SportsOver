// Explicit startup fixtures, available before any test window or update check.
const { serviceFor } = require('../core/provider-network.js');
function startupFixture(value) {
  const url = new URL(value);
  if (url.href === 'https://api.github.com/repos/joelstanner/SportsOver/releases/latest') return new Response('', { status: 404 });
  // Artwork fixtures never contact the logo hosts.
  if ((url.hostname === 'www.mlbstatic.com' && /^\/team-logos\/\d+\.svg$/.test(url.pathname))
    || (url.hostname === 'a.espncdn.com' && url.pathname.startsWith('/i/teamlogos/')))
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', { headers: { 'Content-Type': 'image/svg+xml' } });
  const provider = serviceFor(value);
  if (provider === 'mlb' || provider === 'espn') return Response.json({ dates: [], events: [], sports: [], teams: [] });
  if (provider === 'pdga') return Response.json({ data: url.pathname.includes('fetch_event') ? { Name: 'Offline startup', Divisions: [] } : url.pathname.includes('fetch_round') ? { scores: [] } : [] });
  if (provider === 'lichess') return Response.json(url.pathname.endsWith('/players') ? [] : { active: [], upcoming: [], past: [], rounds: [], games: [] });
  return null;
}
module.exports = { startupFixture };
