'use strict';
(() => {
  if (!new URLSearchParams(location.search).has('engine') || !window.sportsDesktop) return;
  let last = '', lastSent = 0, refreshResult = null;
  let bannerHovered = false;
  function publish() {
    const mount = document.querySelector('#sports-overlay');
    if (!mount || !window.SportsOverlay.engine) return;
    window.SportsOverlay.engine.setHovered(bannerHovered);
    const copy = mount.cloneNode(true);
    // Outputs run their own complete transitions when the rendered game changes;
    // short-lived engine animation classes can be missed by output polling.
    copy.classList.remove('is-rotating-in', 'is-rotating-out');
    const frame = { html: copy.outerHTML, metadata: { ...window.SportsOverlay.engine.describe(), refreshResult } };
    const serialized = JSON.stringify(frame);
    if (serialized === last && Date.now() - lastSent < 1000) return;
    lastSent = Date.now();
    last = serialized;
    window.sportsDesktop.publish(frame);
  }
  window.sportsDesktop.onEngineCommand(async command => {
    if (command.type === 'hover') bannerHovered = command.value === true;
    if (command.type === 'override') window.SportsOverlay.engine?.override(command.value);
    if (command.type === 'refresh') {
      try {
        if (!window.SportsOverlay.engine) throw Error('Sports engine is not ready. Try again.');
        await window.SportsOverlay.engine.refresh();
        refreshResult = { requestId: command.requestId, error: null };
      } catch (error) { refreshResult = { requestId: command.requestId, error: error.message }; }
    }
    if (command.type === 'next') await window.SportsOverlay.engine?.next({ fast: command.fast === true });
    if (command.type === 'previous') await window.SportsOverlay.engine?.previous({ fast: command.fast === true });
    if (command.type === 'live-mode') window.SportsOverlay.engine?.setLiveMode(command.active);
    publish();
  });
  setInterval(publish, 100);
})();
