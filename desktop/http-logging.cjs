function displayUrl(value) {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/token|secret|password|credential|authorization|api[-_]?key/i.test(key)) url.searchParams.set(key, '[redacted]');
  }
  return url.href;
}

function installHttpLogging(session, { log = message => console.log(message), now = Date.now } = {}) {
  const requests = new Map();
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  const write = message => {
    try { log(`[SportsOver HTTP] ${message}`); } catch (_) { /* Logging must not interrupt requests. */ }
  };
  const describe = details => `${details.method} ${displayUrl(details.url)}`;
  const elapsed = details => {
    const start = requests.get(details.id);
    requests.delete(details.id);
    return start === undefined ? '' : ` · ${Math.max(0, now() - start)} ms`;
  };
  session.webRequest.onBeforeRequest(filter, (details, callback) => {
    try {
      requests.set(details.id, now());
      write(`#${details.id} → ${describe(details)}`);
    } finally { callback({}); }
  });
  session.webRequest.onBeforeRedirect(filter, details => {
    write(`#${details.id} ← ${details.statusCode} ${describe(details)} · redirect to ${displayUrl(details.redirectURL)}`);
  });
  session.webRequest.onCompleted(filter, details => {
    write(`#${details.id} ← ${details.statusCode} ${describe(details)}${elapsed(details)}${details.fromCache ? ' · cache' : ''}`);
  });
  session.webRequest.onErrorOccurred(filter, details => {
    write(`#${details.id} ✕ ${describe(details)} · ${details.error}${elapsed(details)}`);
  });
}

module.exports = { installHttpLogging };
