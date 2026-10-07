// Shared transport boundary for routine Node tests. No environment live override.
const net = require('node:net');
const symbol = Symbol.for('sportsover.offline-network');
function isLocal(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
function install() {
  if (globalThis[symbol]) return globalThis[symbol];
  const violations = [];
  function deny(target) {
    const error = Error(`Offline test attempted external network access: ${target}`);
    error.code = 'TEST_EXTERNAL_NETWORK';
    violations.push(error.message);
    return error;
  }
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    // Node normalizes positional arguments to an array before re-entering here.
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (!(typeof options === 'object' && options.path) && !(typeof options === 'string' && !/^\d+$/.test(options))) {
      const host = typeof options === 'object' ? options.host || 'localhost'
        : typeof args[1] === 'string' ? args[1] : 'localhost';
      if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw deny(host);
    }
    return connect.apply(this, args);
  };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!isLocal(url)) throw deny(url);
    // Let native redirect handling retain method/body semantics. Socket guard
    // also checks every redirected connection, including pooled HTTP clients.
    return nativeFetch(input, options);
  };
  process.on('exit', () => {
    if (violations.length) {
      console.error(violations.join('\n'));
      process.exitCode = 1;
    }
  });
  return globalThis[symbol] = { violations, deny };
}
module.exports = { isLocal, install, ...install() };
