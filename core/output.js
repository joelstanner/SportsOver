'use strict';
(async () => {
  if (window.top !== window) { document.documentElement.style.background = '#26373b'; document.body.style.background = '#26373b'; }
  let signature = '';
  let failures = 0;
  const note = document.createElement('div');
  note.style.cssText = 'position:fixed;bottom:0;left:6px;background:#392414;color:#fff;font:10px system-ui;padding:2px 6px;display:none';
  document.body.append(note);
  async function poll() {
    try {
      const response = await fetch('/api/output', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw Error('Output unavailable');
      const frame = await response.json();
      if (signature !== `${frame.instance}:${frame.sequence}`) {
        document.querySelector('#sports-overlay').outerHTML = frame.html;
        signature = `${frame.instance}:${frame.sequence}`;
        document.body.dataset.sequence = String(frame.sequence);
      }
      failures = 0;
      note.textContent = 'Sports engine reconnecting…';
      note.style.display = frame.ready ? 'none' : 'block';
    } catch (_) {
      failures++;
      note.textContent = 'SportsOver disconnected · last received score';
      note.style.display = 'block';
    }
    setTimeout(poll, failures ? 1000 : 200);
  }
  poll();
})();
