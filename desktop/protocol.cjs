const fs = require('node:fs/promises');
const path = require('node:path');
const providerNetwork = require('../core/provider-network.js');
const ORIGIN = 'sportsover://app';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://statsapi.mlb.com https://site.api.espn.com https://site.web.api.espn.com https://sports.core.api.espn.com https://www.pdga.com https://lichess.org; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function createHandler({ root, dataRoot, store, refresh, engine, fetchImpl = globalThis.fetch,
  fetchProvider = providerNetwork.create({ fetchImpl }) }) {
  let refreshing = false;
  const isEnabled = target => store?.snapshot().config.sports.find(group => group.sport === providerNetwork.sportFor(target))?.enabled !== false;
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  return async request => {
    try {
      const url = new URL(request.url);
      if (url.protocol !== 'sportsover:' || url.host !== 'app') return new Response('Forbidden', { status: 403 });
      if (request.initiatorOrigin && request.initiatorOrigin !== ORIGIN) return new Response('Forbidden', { status: 403 });
      if (url.pathname === '/api/provider' || url.pathname === '/api/provider/priority') {
        const promote = url.pathname === '/api/provider/priority';
        if (request.method !== (promote ? 'POST' : 'GET')) return new Response('Method not allowed', { status: 405 });
        const target = url.searchParams.get('url');
        if (!providerNetwork.serviceFor(target)) return json({ error: 'Unsupported score provider URL' }, 400);
        if (!isEnabled(target)) return json({ error: 'Sport is disabled' }, 409);
        if (promote) { fetchProvider.prioritize(target); return json({}); }
        const response = await fetchProvider(target, { requestTimeoutMs: Number(url.searchParams.get('timeout')),
          priority: url.searchParams.get('priority') === 'display' ? 'display' : 'background' });
        // Expose JSON bytes and retry timing only, never upstream cookies/headers.
        const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
        const retry = response.headers.get('Retry-After');
        if (retry) headers['Retry-After'] = retry;
        return new Response(await response.arrayBuffer(), { status: response.status, headers });
      }
      const chessPlayers = /^\/api\/chess\/broadcast\/([a-zA-Z0-9]{8})\/players$/.exec(url.pathname);
      if (chessPlayers) {
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
        if (!isEnabled(`https://lichess.org/broadcast/${chessPlayers[1]}/players`)) return json({ error: 'Sport is disabled' }, 409);
        // Lichess's website standings route does not allow our custom renderer
        // origin. Fetch only this fixed public endpoint in the desktop process.
        const response = await fetchProvider(`https://lichess.org/broadcast/${chessPlayers[1]}/players`, {
          requestTimeoutMs: 8000, priority: url.searchParams.get('priority') === 'display' ? 'display' : 'background',
        });
        if (!response.ok) {
          const failure = json({ error: `Lichess returned HTTP ${response.status}` }, response.status);
          const retry = response.headers?.get('Retry-After');
          if (retry) failure.headers.set('Retry-After', retry);
          return failure;
        }
        return json(await response.json());
      }
      if (url.pathname === '/api/output' && request.method === 'GET') return json(engine.output());
      if (url.pathname === '/api/sports/state') {
        if (request.method === 'GET') return json(store.snapshot());
        if (request.method !== 'PATCH') return new Response('Method not allowed', { status: 405 });
        const text = await request.text();
        if (text.length > 262144) return json({ detail: 'Settings are too large' }, 413);
        const result = store.patch(JSON.parse(text));
        return json(result.body, result.status);
      }
      if (url.pathname === '/sports/api/team-catalog/refresh') {
        if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
        if (refreshing) return json({ error: 'A refresh is already running' }, 409);
        const text = await request.text();
        if (text.length > 1024) return json({ error: 'Request too large' }, 413);
        const { sport, enabledSports } = JSON.parse(text);
        // The renderer may have unchecked a sport just before its autosave.
        // Intersect that selection with the authoritative desktop settings.
        const isSportEnabled = key => store?.snapshot().config.sports.find(group => group.sport === key)?.enabled !== false
          && (!Array.isArray(enabledSports) || enabledSports.includes(key));
        refreshing = true;
        try { return json({ results: await refresh(sport, isSportEnabled) }); }
        finally { refreshing = false; store.catalogRevision++; }
      }
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      let relative = decodeURIComponent(url.pathname).replace(/^\/sports\//, '');
      if (relative.endsWith('/')) relative += 'index.html';
      if (relative === 'index.html' && !url.searchParams.has('engine') && !url.searchParams.has('demo') && !url.searchParams.has('scenario')) relative = 'display.html';
      // Only ship renderer assets, never desktop code, settings, repository metadata or arbitrary files.
      if (!/^((?:index|display)\.html|(?:core|admin|sports)\/[\w/.-]+\.(?:html|js|css|json|svg|png))$/.test(relative) || relative.split('/').includes('..')) return new Response('Not found', { status: 404 });
      let file = path.join(root, relative);
      if (/^sports\/[\w-]+\/teams\.json$/.test(relative)) {
        const updated = path.join(dataRoot, relative);
        try { await fs.access(updated); file = updated; } catch (_) { /* Bundled fallback. */ }
      }
      return new Response(await fs.readFile(file), { headers: { 'Content-Type': types[path.extname(file)], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error.code === 'SPORT_DISABLED') return json({ error: error.message }, 409);
      if (error.code === 'ENOENT') return new Response('Not found', { status: 404 });
      return json({ detail: error.message, error: error.message }, 500);
    }
  };
}
module.exports = { createHandler, ORIGIN };
