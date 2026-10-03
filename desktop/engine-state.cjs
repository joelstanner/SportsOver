const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
class EngineState extends EventEmitter {
  constructor({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    super(); this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.instance = randomUUID(); this.lastSeen = 0;
    this.frame = { sequence: 0, html: '<main id="sports-overlay">Starting SportsOver…</main>', updatedAt: 0 };
    this.metadata = { availableEntries: [], automaticEntries: [], queue: [], currentGameKey: null };
    this.override = null; this.requests = new Map(); this.ready = false;
  }
  publish(frame) {
    this.ready = true; this.lastSeen = this.now();
    const gameKey = frame.metadata.renderedGameKey || null;
    if (frame.html !== this.frame.html || gameKey !== this.frame.gameKey) {
      this.frame = { sequence: this.frame.sequence + 1, html: frame.html, gameKey,
        transition: frame.metadata.rotationTransition === 'quick' ? 'quick' : 'normal', updatedAt: this.now() };
    }
    this.metadata = frame.metadata;
    this.emit('frame', this.output());
  }
  output() { return { ...this.frame, instance: this.instance, ready: this.ready && this.now() - this.lastSeen < 10000, override: this.override }; }
  state() { return { ...this.metadata, ready: this.output().ready, override: this.override }; }
  refresh(send) {
    if (this.pendingRefresh) return this.pendingRefresh;
    const requestId = randomUUID();
    const operation = new Promise((resolve, reject) => {
      let timer;
      const finish = error => {
        this.clearTimer(timer);
        this.off('frame', changed);
        if (error) reject(error);
        else resolve(this.state());
      };
      const changed = () => {
        const result = this.metadata.refreshResult;
        if (result?.requestId === requestId) finish(result.error ? Error(result.error) : null);
      };
      this.on('frame', changed);
      timer = this.setTimer(() => finish(Error('Refresh did not finish. Try again.')), 60000);
      try { send({ type: 'refresh', requestId }); }
      catch (error) { finish(error); }
    });
    this.pendingRefresh = operation.finally(() => { this.pendingRefresh = null; });
    return this.pendingRefresh;
  }
  command(body) {
    const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Expected a command object');
    if (typeof body.requestId !== 'string' || !/^[\w-]{1,100}$/.test(body.requestId)) fail('requestId must be 1–100 letters, digits, underscores or hyphens');
    const fingerprint = JSON.stringify([body.type, body.gameKey, body.durationSeconds, body.overrideId]);
    const prior = this.requests.get(body.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail('requestId already used for another command', 409);
      return prior.result;
    }
    let result;
    if (body.type === 'show-game') {
      if (!this.output().ready) fail('Sports engine is not ready', 503);
      if (this.override) fail('An override is already active; cancel it before replacing it', 409);
      if (!Number.isInteger(body.durationSeconds) || body.durationSeconds < 5 || body.durationSeconds > 3600) fail('durationSeconds must be an integer from 5 to 3600');
      if (typeof body.gameKey !== 'string' || !this.metadata.availableEntries.some(entry => `${entry.candidate.sport}:${entry.candidate.id}` === body.gameKey)) fail('gameKey must identify a currently discovered game', 422);
      this.override = { id: randomUUID(), gameKey: body.gameKey, startedAt: this.now(), expiresAt: this.now() + body.durationSeconds * 1000 };
      this.timer = this.setTimer(() => this.clearOverride(), body.durationSeconds * 1000);
      this.emit('override', this.override);
      result = { accepted: true, override: { ...this.override } };
    } else if (body.type === 'clear-override') {
      if (body.overrideId && body.overrideId !== this.override?.id) fail('Override no longer matches', 409);
      this.clearOverride(); result = { accepted: true, override: null };
    } else fail('Unsupported command type');
    this.requests.set(body.requestId, { fingerprint, result });
    if (this.requests.size > 1000) this.requests.delete(this.requests.keys().next().value);
    return result;
  }
  clearOverride() { this.clearTimer(this.timer); this.timer = null; this.override = null; this.emit('override', null); }
  stop() { this.ready = false; this.clearOverride(); }
}
module.exports = { EngineState };
