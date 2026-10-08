const { randomUUID } = require('node:crypto');

// Desktop, Settings previews, and OBS always consume the same selected source.
function createOutputSource(live) {
  let source = live, sequence = 0, lastKey = null, heartbeatSequence = 0, lastHeartbeatKey = null;
  const instance = randomUUID();
  return {
    select(value) { source = value; },
    output() {
      const frame = source.output();
      const key = `${frame.instance}:${frame.sequence}`;
      if (key !== lastKey) { lastKey = key; sequence++; }
      const heartbeatKey = `${frame.instance}:${frame.heartbeatSequence}`;
      if (Number.isSafeInteger(frame.heartbeatSequence) && frame.heartbeatSequence > 0 && heartbeatKey !== lastHeartbeatKey) {
        lastHeartbeatKey = heartbeatKey; heartbeatSequence++;
      }
      // A single sequence prevents late polling responses from restoring the
      // previous source after entering or leaving demo mode.
      return { ...frame, instance, sequence, heartbeatSequence };
    },
    state: () => source.state(),
    command(body) {
      if (source !== live) throw Object.assign(Error('Return to live output before using integration commands.'), { status: 409 });
      return live.command(body);
    },
  };
}
module.exports = { createOutputSource };
