'use strict';
(() => {
  if (!new URLSearchParams(location.search).has('engine') || !window.sportsDesktop) return;
  let last = '', lastSent = 0, refreshResult = null;
  let bannerHovered = false, compactPending = 0;
  let observedMount = null, cachedHtml = '', dirty = true, publishTimer = null;
  const observer = new MutationObserver(() => {
    dirty = true;
    // Coalesce a render's DOM changes without waking an unchanged engine at 10 Hz.
    if (publishTimer === null) publishTimer = setTimeout(() => {
      publishTimer = null;
      publish();
    }, 50);
  });
  function publish() {
    const mount = document.querySelector('#sports-overlay');
    if (!mount || !window.SportsOverlay.engine || compactPending) return;
    window.SportsOverlay.engine.setHovered(bannerHovered);
    if (observedMount !== mount) {
      observer.disconnect();
      observedMount = mount;
      observer.observe(mount, { subtree: true, childList: true, characterData: true, attributes: true });
      dirty = true;
    }
    // Commands can publish before the observer's microtask is delivered.
    if (observer.takeRecords().length) dirty = true;
    if (dirty) {
      const copy = mount.cloneNode(true);
      // Outputs run their own complete transitions when the rendered game changes.
      copy.classList.remove('is-rotating-in', 'is-rotating-out');
      cachedHtml = copy.outerHTML;
      dirty = false;
    }
    const frame = { html: cachedHtml, metadata: { ...window.SportsOverlay.engine.describe(), refreshResult } };
    const serialized = JSON.stringify(frame);
    if (serialized === last && Date.now() - lastSent < 1000) return;
    lastSent = Date.now();
    last = serialized;
    window.sportsDesktop.publish(frame);
  }
  window.sportsDesktop.onEngineCommand(async command => {
    if (command.type === 'compact-rotation') {
      compactPending++;
      try { await window.SportsOverlay.engine?.setCompact(command.value); } finally { compactPending--; }
    }
    if (command.type === 'inspection-config') window.SportsOverlay.engine?.configure(command.value);
    if (command.type === 'inspection-play') window.SportsOverlay.engine?.setPlaying(command.value);
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
  // Keep OBS liveness and metadata-only discovery changes current even when the
  // banner DOM does not change. Provider score refresh intervals are independent.
  setInterval(publish, 1000);
  publish();
})();
