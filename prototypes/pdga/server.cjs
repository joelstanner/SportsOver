'use strict';
// Isolated design preview. Run: node prototypes/pdga/server.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const endpoint = 'https://www.pdga.com/apps/tournament/live-api/live_results_fetch_round?TournID=86076&Division=MPO&Round=3';
const event = JSON.parse(fs.readFileSync(path.join(__dirname, 'event-snapshot.json'))).data;
let round = JSON.parse(fs.readFileSync(path.join(__dirname, 'round-snapshot.json'))).data;
let fetchedAt = null;
let attemptedAt = 0;
let error = null;
let pending;
async function refresh() {
  if (pending) return pending;
  if (Date.now() - attemptedAt < 30000) return;
  attemptedAt = Date.now();
  pending = (async () => {
    try {
      const { stdout } = await run('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '15', endpoint], { maxBuffer: 2000000 });
      const response = JSON.parse(stdout);
      if (!Array.isArray(response.data?.scores) || !response.data.scores.length) throw Error('Scores unavailable');
      round = response.data;
      fetchedAt = new Date().toISOString();
      error = null;
    } catch (_) {
      error = 'Refresh unavailable · showing last received scores';
    }
  })().finally(() => { pending = null; });
  return pending;
}
const server = http.createServer(async (req, res) => {
  const expected = '127.0.0.1:17864';
  if (req.headers.host !== expected || (req.headers.origin && req.headers.origin !== `http://${expected}`)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const url = new URL(req.url, `http://${expected}`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (url.pathname === '/api/scores') {
    await refresh();
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ event, round, endpoint, fetchedAt, error }));
  }
  if (url.pathname !== '/') { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});
server.listen(17864, '127.0.0.1', () => console.log('PDGA preview: http://127.0.0.1:17864/ · 200%'));
