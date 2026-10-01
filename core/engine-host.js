'use strict';
(() => {
  if (!new URLSearchParams(location.search).has('engine') || !window.sportsDesktop) return;
  let last = '', lastSent = 0;
  function publish() {
    const mount = document.querySelector('#sports-overlay');
    if (!mount || !window.SportsOverlay.engine) return;
    const copy = mount.cloneNode(true);
    // Outputs run their own complete transitions when the rendered game changes;
    // short-lived engine animation classes can be missed by output polling.
    copy.classList.remove('is-rotating-in', 'is-rotating-out');
    const frame = { html: copy.outerHTML, metadata: window.SportsOverlay.engine.describe() };
    const serialized = JSON.stringify(frame);
    if (serialized === last && Date.now() - lastSent < 1000) return;
    lastSent = Date.now();
    last = serialized;
    window.sportsDesktop.publish(frame);
  }
  window.sportsDesktop.onEngineCommand(command => {
    if (command.type === 'override') window.SportsOverlay.engine?.override(command.value);
    if (command.type === 'refresh') window.SportsOverlay.engine?.refresh();
    if (command.type === 'next') window.SportsOverlay.engine?.next();
    if (command.type === 'previous') window.SportsOverlay.engine?.previous();
    publish();
  });
  setInterval(publish, 100);
})();
