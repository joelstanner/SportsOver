const fs = require('node:fs/promises');
const path = require('node:path');
const ORIGIN = 'sportsover://app';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://statsapi.mlb.com https://site.api.espn.com https://site.web.api.espn.com https://sports.core.api.espn.com; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
function createHandler({ root, dataRoot, store, refresh, engine }) {
  let refreshing = false;
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  return async request => {
    try {
      const url = new URL(request.url);
      if (url.protocol !== 'sportsover:' || url.host !== 'app') return new Response('Forbidden', { status: 403 });
      if (request.initiatorOrigin && request.initiatorOrigin !== ORIGIN) return new Response('Forbidden', { status: 403 });
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
        const { sport } = JSON.parse(text);
        refreshing = true;
        try { return json({ results: await refresh(sport) }); }
        finally { refreshing = false; store.catalogRevision++; }
      }
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      let relative = decodeURIComponent(url.pathname).replace(/^\/sports\//, '');
      if (relative.endsWith('/')) relative += 'index.html';
      if (relative === 'index.html' && !url.searchParams.has('engine') && !url.searchParams.has('demo') && !url.searchParams.has('scenario')) relative = 'display.html';
      // Only ship renderer assets, never desktop code, settings, repository metadata or arbitrary files.
      if (!/^((?:index|display)\.html|(?:core|admin|sports)\/[\w/.-]+\.(?:html|js|css|json|svg))$/.test(relative) || relative.split('/').includes('..')) return new Response('Not found', { status: 404 });
      let file = path.join(root, relative);
      if (/^sports\/[\w-]+\/teams\.json$/.test(relative)) {
        const updated = path.join(dataRoot, relative);
        try { await fs.access(updated); file = updated; } catch (_) { /* Bundled fallback. */ }
      }
      return new Response(await fs.readFile(file), { headers: { 'Content-Type': types[path.extname(file)], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error.code === 'ENOENT') return new Response('Not found', { status: 404 });
      return json({ detail: error.message, error: error.message }, 500);
    }
  };
}
module.exports = { createHandler, ORIGIN };
