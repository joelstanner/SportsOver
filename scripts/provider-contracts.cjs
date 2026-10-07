// Explicit, short live checks; this file never imports the routine test guard.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { serviceFor, retryAfterMs } = require('../core/provider-network.js');
const limits = { pdga: 2, espn: 2, mlb: 2, lichess: 3 };
const stateDirectory = path.join(os.tmpdir(), `sportsover-provider-contracts-${process.getuid?.() ?? os.userInfo().username}`);
const validId = id => /^[a-zA-Z0-9]{8}$/.test(String(id));
function createSession({ provider, fetchImpl = globalThis.fetch, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), state = {}, save = async () => {}, log = console.log,
  timeoutMs = 8000, record = async () => {} }) {
  assert.ok(provider in limits, 'Unknown provider');
  assert.ok(timeoutMs > 0 && timeoutMs <= 30000, 'Timeout must be 1–30000 ms');
  let requests = 0, next = 0, stopped = false;
  async function get(name, url, validate) {
    assert.equal(serviceFor(url), provider, 'Contract URL must belong to the selected provider');
    if (stopped || (!requests && now() < (state.until || 0))) throw Error(`${provider}: cooldown until ${new Date(state.until).toISOString()}`);
    if (requests >= limits[provider]) throw Error(`${provider}: request cap ${limits[provider]} reached`);
    if (now() < next) await sleep(next - now());
    requests++;
    next = now() + (provider === 'lichess' ? 1500 : 250);
    // Persist a dispatch cooldown first, including failed/interrupted invocations.
    state.until = now() + 60000;
    await save(state);
    const start = now();
    log(`[${provider}] ${requests}/${limits[provider]} GET ${url}`);
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
      log(`[${provider}] HTTP ${response.status} (${now() - start} ms)`);
      if (!response.ok) {
        state.failures = (state.failures || 0) + 1;
        state.until = now() + Math.max(60000, retryAfterMs(response.headers.get('Retry-After'), now()), Math.min(300000, 60000 * 2 ** Math.min(3, state.failures - 1)));
        stopped = true;
        await save(state);
        await response.body?.cancel();
        throw Error(`${provider}: HTTP ${response.status}; stopped, cooldown until ${new Date(state.until).toISOString()}`);
      }
      // Read a bounded body within the same abort deadline; never accept redirects.
      let bytes = 0, chunks = [];
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) throw Error('Contract response exceeds 4 MiB');
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      validate(body);
      await record(name, body);
      log(`[${provider}] ${name}: contract passed`);
      return body;
    } catch (error) {
      stopped = true;
      if (!state.failures) state.failures = 1;
      state.until = Math.max(state.until, now() + 60000);
      await save(state);
      log(`[${provider}] FAIL ${name}: ${error.message}`);
      throw error;
    }
  }
  return { get, state, count: () => requests };
}
function teamCompetition(competition) {
  assert.ok(competition?.status?.type?.state, 'Missing game state');
  assert.ok(Array.isArray(competition.competitors) && competition.competitors.length === 2, 'Missing team competitors');
  for (const team of competition.competitors) {
    assert.ok(team.team?.id && (team.team.displayName || team.team.name), 'Missing team identity');
    assert.ok(['home', 'away'].includes(team.homeAway), 'Missing home/away identity');
    if (['in', 'post'].includes(competition.status.type.state)) assert.ok(team.score != null && Number.isFinite(Number(team.score)), 'Missing team score');
  }
}
async function checkProvider(session, { provider, tournamentId = '86076', division = 'MPO' }) {
  const get = session.get;
  if (provider === 'pdga') {
    assert.match(tournamentId, /^[1-9]\d{0,8}$/);
    assert.match(division, /^[A-Z][A-Z0-9]{1,7}$/);
    const base = 'https://www.pdga.com/apps/tournament/live-api/';
    const metadata = await get('metadata', `${base}live_results_fetch_event?TournID=${tournamentId}`, value => {
      assert.ok(typeof value.data?.Name === 'string' && value.data.Name, 'Missing tournament name');
      assert.ok(Array.isArray(value.data.Divisions), 'Missing divisions');
      assert.ok(value.data.Divisions.some(item => item.Division === division), 'Selected division unavailable');
    });
    const selected = metadata.data.Divisions.find(item => item.Division === division);
    const round = Number(selected.LatestRound || metadata.data.LatestRound || 1);
    assert.ok(Number.isInteger(round) && round > 0 && round < 100, 'Invalid latest round');
    await get('round', `${base}live_results_fetch_round?TournID=${tournamentId}&Division=${division}&Round=${round}`, value => {
      assert.ok(Array.isArray(value.data?.scores) && value.data.scores.length, 'Missing round scores');
      for (const player of value.data.scores) {
        assert.ok(player.PDGANum && typeof player.Name === 'string', 'Missing player identity');
        assert.ok(Object.hasOwn(player, 'ToPar') && (player.ToPar === null || Number.isFinite(Number(player.ToPar))), 'Invalid total score');
      }
    });
  } else if (provider === 'espn') {
    const base = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
    const board = await get('scoreboard', `${base}scoreboard?limit=1`, value => {
      assert.ok(Array.isArray(value.events), 'Missing scoreboard events');
      for (const event of value.events) { assert.ok(event.id && event.date, 'Missing event identity/date'); teamCompetition(event.competitions?.[0]); }
    });
    if (!board.events.length) throw Error('ESPN scoreboard empty; score/summary contract could not be verified. Retry deliberately during the season.');
    const event = board.events[0];
    assert.match(String(event.id), /^\d+$/);
    await get('summary', `${base}summary?event=${event.id}`, value => teamCompetition(value.header?.competitions?.[0]));
  } else if (provider === 'mlb') {
    // Stable real completed game keeps offseason checks meaningful too.
    const board = await get('schedule', 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2025-06-01&hydrate=linescore', value => {
      assert.ok(Array.isArray(value.dates) && value.dates.some(day => day.games?.length), 'Missing scheduled games');
    });
    const game = board.dates.flatMap(day => day.games || [])[0];
    assert.ok(game.gamePk && game.gameDate && game.status?.abstractGameState, 'Missing schedule identity/state');
    assert.match(String(game.gamePk), /^\d+$/);
    await get('game', `https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`, value => {
      assert.ok(value.gameData?.status?.abstractGameState, 'Missing game state');
      for (const side of ['away', 'home']) {
        assert.ok(value.gameData?.teams?.[side]?.id && value.gameData.teams[side].name, 'Missing team identity');
        assert.ok(Number.isFinite(value.liveData?.linescore?.teams?.[side]?.runs), 'Missing score');
      }
    });
  } else if (provider === 'lichess') {
    const directory = await get('directory', 'https://lichess.org/api/broadcast/top', value => {
      assert.ok(Array.isArray(value.active), 'Missing broadcast directory');
      for (const item of value.active) assert.ok(validId(item.tour?.id), 'Invalid tournament identity');
    });
    const id = directory.active[0]?.tour.id;
    if (!id) throw Error('No active Lichess broadcast; metadata/score contract could not be verified. Retry deliberately later.');
    const metadata = await get('metadata', `https://lichess.org/api/broadcast/${id}`, value => {
      assert.ok(validId(value.tour?.id) && Array.isArray(value.rounds) && value.rounds.length, 'Missing tournament/rounds');
    });
    const round = metadata.rounds.find(item => item.id === metadata.defaultRoundId) || metadata.rounds.at(-1);
    assert.ok(validId(round.id), 'Invalid round identity');
    await get('round', `https://lichess.org/api/broadcast/-/-/${round.id}`, value => {
      assert.ok(validId(value.tour?.id) && validId(value.round?.id) && Array.isArray(value.games), 'Missing round games');
      for (const game of value.games) assert.ok(validId(game.id) && game.players?.length === 2 && game.players.every(player => typeof player.name === 'string'), 'Missing board/player identity');
    });
  }
}
async function runLive({ providers, recordDirectory, directory = stateDirectory, log = console.log }) {
  await fs.mkdir(directory, { recursive: true });
  const lock = path.join(directory, 'running');
  try { await fs.mkdir(lock); }
  catch (error) { if (error.code === 'EEXIST') throw Error(`Another provider check is running, or an interrupted check left ${lock}. Verify no check is running before removing that directory.`); throw error; }
  try {
    for (const provider of providers) {
      assert.ok(provider in limits, 'Unknown provider');
      const file = path.join(directory, `${provider}.json`);
      let state = {};
      try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const save = async value => { await fs.writeFile(`${file}.tmp`, JSON.stringify(value)); await fs.rename(`${file}.tmp`, file); };
      const session = createSession({ provider, state, save, log,
        record: async (name, body) => {
          if (!recordDirectory) return;
          await fs.mkdir(recordDirectory, { recursive: true });
          await fs.writeFile(path.join(recordDirectory, `${provider}-${name}.json`), JSON.stringify(body, null, 2) + '\n');
        } });
      await checkProvider(session, { provider, tournamentId: process.env.SPORTSOVER_PDGA_TOURNAMENT || '86076', division: process.env.SPORTSOVER_PDGA_DIVISION || 'MPO' });
      state.failures = 0;
      state.until = Date.now() + 60000;
      await save(state);
      log(`[${provider}] PASS (${session.count()} requests); next check after ${new Date(state.until).toISOString()}`);
    }
  } finally { await fs.rmdir(lock); }
}
async function cli(argv = process.argv.slice(2)) {
  assert.ok(argv.includes('--live'), 'Live checks require explicit --live (use npm run test:providers).');
  const args = argv.filter(arg => arg !== '--live');
  let recordDirectory;
  const recordIndex = args.indexOf('--record');
  if (recordIndex >= 0) { assert.ok(args[recordIndex + 1], '--record needs an output directory'); recordDirectory = path.resolve(args[recordIndex + 1]); args.splice(recordIndex, 2); }
  const providers = args.length ? args : Object.keys(limits);
  assert.equal(new Set(providers).size, providers.length, 'Do not repeat providers');
  providers.forEach(provider => assert.ok(provider in limits, `Unknown provider: ${provider}`));
  await runLive({ providers, recordDirectory });
}
if (require.main === module) cli().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { limits, createSession, checkProvider, runLive, cli };
