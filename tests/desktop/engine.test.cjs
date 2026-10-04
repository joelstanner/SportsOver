const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EngineState } = require('../../desktop/engine-state.cjs');
const { startServer } = require('../../desktop/server.cjs');
const path = require('node:path');
const availableEntries = [{ candidate: { sport: 'baseball', id: '1' } }, { candidate: { sport: 'baseball', id: '2' } }];
test('output game identity follows rendered content, including changes with identical HTML', () => {
  const engine = new EngineState();
  const html = '<main id="sports-overlay">same score</main>';
  engine.publish({ html, metadata: { currentGameKey: 'baseball:1', renderedGameKey: 'baseball:1' } });
  const first = engine.output();
  engine.publish({ html, metadata: { currentGameKey: 'baseball:2', renderedGameKey: 'baseball:1' } });
  assert.equal(engine.output().gameKey, 'baseball:1');
  assert.equal(engine.output().sequence, first.sequence, 'loading the next game does not transition the old frame');
  engine.publish({ html, metadata: { currentGameKey: 'baseball:2', renderedGameKey: 'baseball:2', rotationTransition: 'quick' } });
  assert.equal(engine.output().gameKey, 'baseball:2');
  assert.equal(engine.output().transition, 'quick');
  assert.equal(engine.output().sequence, first.sequence + 1);
  engine.publish({ html, metadata: { renderedGameKey: null } });
  assert.equal(engine.output().gameKey, null);
  assert.equal(engine.output().transition, 'normal');
});
test('temporary overrides expire, retries do not extend them, conflicts and unknown games are rejected', () => {
  let time = 100, callback;
  const engine = new EngineState({ now: () => time, setTimer: fn => { callback = fn; return 1; }, clearTimer: () => {} });
  const changes = [];
  engine.on('override', value => changes.push(value));
  engine.publish({ html: '<main>one</main>', metadata: { availableEntries, queue: availableEntries, currentGameKey: 'baseball:1' } });
  const command = { requestId: 'one', type: 'show-game', gameKey: 'baseball:2', durationSeconds: 5 };
  const accepted = engine.command(command);
  time = 2000;
  assert.deepEqual(engine.command(command), accepted);
  assert.equal(engine.override.expiresAt, 5100);
  assert.throws(() => engine.command({ ...command, requestId: 'two' }), /already active/);
  assert.throws(() => engine.command({ ...command, gameKey: 'baseball:1' }), /requestId/);
  callback();
  assert.equal(engine.override, null);
  assert.equal(changes.at(-1), null);
  assert.equal(engine.state().currentGameKey, 'baseball:1', 'override does not rewrite base state');
  assert.throws(() => engine.command({ ...command, requestId: 'unknown', gameKey: 'baseball:99' }), /currently discovered/);
  assert.throws(() => engine.command({ ...command, requestId: 'duration', durationSeconds: 9000 }), /durationSeconds/);
  engine.command({ ...command, requestId: 'three' });
  assert.throws(() => engine.command({ requestId: 'bad-cancel', type: 'clear-override', overrideId: 'old' }), /no longer matches/);
  engine.command({ requestId: 'cancel', type: 'clear-override' });
  assert.equal(engine.override, null);
  engine.stop();
});
test('banner sport filters cancel incompatible overrides and reject new ones without altering available games', () => {
  const clearedTimers = [], changes = [];
  const engine = new EngineState({ setTimer: () => 1, clearTimer: id => clearedTimers.push(id) });
  engine.on('override', value => changes.push(value));
  const entries = [...availableEntries, { candidate: { sport: 'chess', id: 'tournament' } }];
  const command = { requestId: 'before-filter', type: 'show-game', gameKey: 'baseball:2', durationSeconds: 5 };
  engine.publish({ html: '<main>Baseball</main>', metadata: { availableEntries: entries, renderedGameKey: 'baseball:1' } });
  engine.command(command);
  engine.publish({ html: '<main>No Chess games in rotation</main>', metadata: {
    availableEntries: entries, bannerSportFilter: 'chess', queue: [], currentGameKey: null, renderedGameKey: null,
  } });
  assert.equal(engine.override, null);
  assert.equal(changes.at(-1), null);
  assert.deepEqual(clearedTimers, [1]);
  assert.equal(engine.output().gameKey, null);
  assert.match(engine.output().html, /No Chess games/);
  assert.equal(engine.output().override, null);
  assert.deepEqual(engine.state().availableEntries, entries);
  assert.throws(() => engine.command({ ...command, requestId: 'filtered' }), error =>
    error.status === 422 && /active banner sport filter/.test(error.message));
  engine.command({ ...command, requestId: 'matching', gameKey: 'chess:tournament' });
  engine.publish({ html: '<main>Chess</main>', metadata: { availableEntries: entries, bannerSportFilter: 'chess', renderedGameKey: 'chess:tournament' } });
  assert.equal(engine.override.gameKey, 'chess:tournament', 'matching overrides remain active');
  engine.clearOverride();
  engine.publish({ html: '<main>Baseball</main>', metadata: { availableEntries: entries, bannerSportFilter: '', renderedGameKey: 'baseball:1' } });
  engine.command({ ...command, requestId: 'filter-off' });
  assert.equal(engine.override.gameKey, 'baseball:2', 'removing the filter restores integration access');
  engine.stop();
});

test('public output and command server restrict hosts, origins, credentials, paths, and payloads', async t => {
  const engine = new EngineState();
  engine.publish({ html: '<main id="sports-overlay">same frame</main>', metadata: { availableEntries } });
  const { server, url } = await startServer({ root: path.resolve(__dirname, '../..'), engine, token: 'test-token', port: 0 });
  t.after(() => { engine.stop(); server.closeAllConnections(); server.close(); });
  const base = new URL(url).origin;
  assert.match(await (await fetch(url)).text(), /core\/output.js/);
  for (const script of ['event-model', 'countdown']) {
    const response = await fetch(`${base}/sports/core/${script}.js`);
    assert.equal(response.status, 200, `OBS can load ${script}`);
    assert.match(response.headers.get('Content-Type'), /javascript/);
  }
  assert.equal((await (await fetch(`${base}/api/output`)).json()).html, engine.frame.html);
  assert.equal((await fetch(`${base}/api/v1/state`)).status, 401);
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/api/v1/state`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/api/v1/state`, { headers: { ...headers, Origin: 'https://malicious.example' } })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    require('node:http').get(`${base}/api/output`, { headers: { Host: 'malicious.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(foreignHost, 403);
  assert.equal((await fetch(`${base}/sports/desktop/main.cjs`)).status, 404);
  assert.equal((await fetch(`${base}/sports/core/app.js`)).status, 404);
  assert.equal((await fetch(`${base}/api/sports/state`)).status, 404);
  assert.equal((await fetch(`${base}/api/v1/commands`, { method: 'POST', headers, body: 'x'.repeat(5000) })).status, 413);
  assert.equal((await fetch(`${base}/api/v1/commands`, { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(`${base}/api/v1/commands`, { method: 'POST', headers, body: JSON.stringify({ requestId: 'test', type: 'show-game', gameKey: 'baseball:2', durationSeconds: 5 }) })).status, 200);
});

test('refresh waits for its completion reply, shares pending requests, and returns updated state', async () => {
  const engine = new EngineState();
  engine.publish({ html: '<main>old</main>', metadata: { availableEntries } });
  const sent = [];
  const pending = engine.refresh(command => sent.push(command));
  assert.equal(engine.refresh(command => sent.push(command)), pending);
  assert.equal(sent.length, 1);
  let finished = false;
  pending.then(() => { finished = true; });
  engine.publish({ html: '<main>unrelated score update</main>', metadata: { availableEntries,
    refreshResult: { requestId: 'older-request', error: null } } });
  await Promise.resolve();
  assert.equal(finished, false, 'ordinary output and old replies cannot complete a refresh');
  const updated = [...availableEntries, { candidate: { sport: 'chess', id: 'tournament' } }];
  engine.publish({ html: '<main>updated</main>', metadata: { availableEntries: updated,
    refreshResult: { requestId: sent[0].requestId, error: null } } });
  assert.deepEqual((await pending).availableEntries, updated);
  assert.equal(engine.listenerCount('frame'), 0);
  assert.equal(engine.pendingRefresh, null);
});

test('refresh surfaces engine errors and timeout, cleans up, and can retry', async () => {
  let expire;
  const engine = new EngineState({ setTimer: callback => { expire = callback; return 1; }, clearTimer: () => {} });
  let request;
  const failed = engine.refresh(command => { request = command; });
  engine.publish({ html: '<main>error</main>', metadata: { availableEntries,
    refreshResult: { requestId: request.requestId, error: 'Feed unavailable' } } });
  await assert.rejects(failed, /Feed unavailable/);
  const timeout = engine.refresh(() => {});
  expire();
  await assert.rejects(timeout, /Refresh did not finish/);
  assert.equal(engine.listenerCount('frame'), 0);
  await assert.rejects(engine.refresh(() => { throw Error('Engine closed'); }), /Engine closed/);
  assert.equal(engine.listenerCount('frame'), 0);
});
