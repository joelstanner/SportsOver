const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
function credentials(directory) {
  const file = path.join(directory, 'integration.json');
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (/^[a-f0-9]{64}$/.test(value.token)) return value;
    throw Error('Invalid integration token');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const value = { token: randomBytes(32).toString('hex') };
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return value;
  }
}
async function startServer({ root, engine, token, port = 17843 }) {
  const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)); };
  const server = http.createServer(async (request, response) => {
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== expectedHost || request.headers.origin && request.headers.origin !== `http://${expectedHost}`) return json(response, 403, { error: 'Forbidden origin or host' });
      const url = new URL(request.url, `http://${expectedHost}`);
      if (url.pathname.startsWith('/api/v1/')) {
        const supplied = Buffer.from(request.headers.authorization || '');
        const expected = Buffer.from(`Bearer ${token}`);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(response, 401, { error: 'Bearer token required' });
        if (request.method === 'GET' && url.pathname === '/api/v1/state') return json(response, 200, engine.state());
        if (request.method === 'POST' && url.pathname === '/api/v1/commands') {
          if (!String(request.headers['content-type']).startsWith('application/json')) return json(response, 415, { error: 'Use application/json' });
          let body = '', size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 4096) { json(response, 413, { error: 'Command too large' }); return; }
            body += chunk;
          }
          return json(response, 200, engine.command(JSON.parse(body)));
        }
        return json(response, 404, { error: 'Unknown endpoint' });
      }
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
      if (url.pathname === '/api/output') return json(response, 200, engine.output());
      if (url.pathname === '/' || url.pathname === '/output') { response.writeHead(302, { Location: '/sports/display.html' }); return response.end(); }
      const relative = decodeURIComponent(url.pathname).replace(/^\/sports\//, '');
      if (!(relative === 'display.html' || relative === 'sports/basketball/gary-payton-circle.png' || relative === 'core/scrolling.js' || relative === 'core/event-model.js' || relative === 'core/countdown.js' || relative === 'core/output.js' || relative === 'core/desktop.js' || /^(core|sports)\/[\w/.-]+\.css$/.test(relative)) || relative.split('/').includes('..')) return json(response, 404, { error: 'Not found' });
      const content = await fs.promises.readFile(path.join(root, relative));
      response.writeHead(200, {
        'Content-Type': relative.endsWith('.png') ? 'image/png' : relative.endsWith('.html') ? 'text/html' : relative.endsWith('.css') ? 'text/css' : 'text/javascript',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; frame-ancestors " + (relative === 'display.html' ? "'self' file:" : "'none'"),
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      }); response.end(content);
    } catch (error) { json(response, error.status || (error instanceof SyntaxError ? 400 : 500), { error: error.message }); }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}/output` };
}
module.exports = { startServer, credentials };
