'use strict';
(async () => {
  const obsHost = new URLSearchParams(location.search).get('obs-host') === '1';
  if (window.top !== window && !obsHost) { document.documentElement.style.background = '#26373b'; document.body.style.background = '#26373b'; }
  let displayedSequence = 0;
  let failures = 0;
  let displayedGameKey = null;
  let engineInstance = null;
  let pendingFrame = null, rendering = null;
  let interruptedTransition = false;
  const checkFreshness = !window.sportsDesktop;
  const staleAfterMs = 10000;
  let heartbeatInstance = null, heartbeatSequence = -1, lastHeartbeatAt = -Infinity;
  let offline = checkFreshness;
  const retiredInstances = new Set();
  const isFresh = () => performance.now() - lastHeartbeatAt < staleAfterMs;
  function reportHealth(ready) {
    if (obsHost && window.parent !== window) window.parent.postMessage({
      type: 'sportsover-output-health', ready, instance: heartbeatInstance,
      heartbeatSequence, heartbeatAgeMs: performance.now() - lastHeartbeatAt,
    }, '*');
  }
  function showOffline() {
    if (!checkFreshness) return;
    offline = true;
    pendingFrame = null;
    document.body.classList.add('sports-output-offline');
    reportHealth(false);
    const mount = document.querySelector('#sports-overlay');
    for (const animation of mount.getAnimations({ subtree: true })) animation.cancel();
    if (!mount.querySelector('.output-offline')) {
      const panel = document.createElement('div');
      panel.className = 'output-offline';
      panel.setAttribute('role', 'status');
      panel.innerHTML = '<span>—</span><div><strong>DATA OFFLINE</strong><small>SPORTSOVER DISCONNECTED</small></div><span>—</span>';
      mount.replaceChildren(panel);
    }
  }
  function acceptHeartbeat(frame) {
    if (!checkFreshness) return true;
    if (retiredInstances.has(frame.instance)) return false;
    if (frame.ready !== true || typeof frame.instance !== 'string' || !frame.instance
      || !Number.isSafeInteger(frame.heartbeatSequence) || frame.heartbeatSequence < 1
      || !Number.isFinite(frame.heartbeatAgeMs) || frame.heartbeatAgeMs < 0 || frame.heartbeatAgeMs >= staleAfterMs) {
      showOffline(); return false;
    }
    if (heartbeatInstance !== frame.instance) {
      if (heartbeatInstance) retiredInstances.add(heartbeatInstance);
      heartbeatInstance = frame.instance;
      heartbeatSequence = -1;
    }
    if (frame.heartbeatSequence < heartbeatSequence) return false;
    const advanced = frame.heartbeatSequence > heartbeatSequence;
    if (advanced) {
      heartbeatSequence = frame.heartbeatSequence;
      lastHeartbeatAt = performance.now() - frame.heartbeatAgeMs;
    }
    if (offline && !advanced) return false;
    if (!isFresh()) { showOffline(); return false; }
    return true;
  }
  async function animate(element, className) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    element.classList.remove(className);
    // Restart the same quick animation when another arrow interrupts it.
    void element.offsetWidth;
    const quick = className === 'is-rotating-quick';
    const previousFilter = element.style.filter;
    if (quick) {
      element.style.filter = 'url("#sports-rotation-motion-blur")';
      motionBlurAnimation.beginElement();
    }
    element.classList.add(className);
    try {
      const animations = element.getAnimations().filter(animation => animation.animationName?.startsWith('sports-rotate-'));
      await Promise.allSettled(animations.map(animation => animation.finished));
    } finally {
      element.classList.remove(className);
      if (quick) element.style.filter = previousFilter;
    }
  }
  // Keep unchanged subtrees mounted so unrelated score/footer updates do not
  // restart their CSS animations. Changed text gets a fresh animation.
  function updateNode(current, next, restartChildren = false) {
    if (!restartChildren && current.isEqualNode(next)) return;
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName
      || current.nodeType !== Node.ELEMENT_NODE || current.id !== next.id
      || (!current.children.length && !next.children.length && current.textContent !== next.textContent)) {
      current.replaceWith(next);
      return;
    }
    // Restart with the engine's elapsed offset, rather than applying it twice
    // to an already-running desktop/OBS animation.
    if (current.classList.contains('scorebug-vertical-track')
      && current.style.getPropertyValue('--vertical-delay') !== next.style.getPropertyValue('--vertical-delay')) {
      current.replaceWith(next);
      return;
    }
    for (const attribute of [...current.attributes]) {
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of next.attributes) {
      if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    }
    if (restartChildren) {
      current.replaceChildren(...next.childNodes);
      return;
    }
    const children = [...current.childNodes];
    const nextChildren = [...next.childNodes];
    for (let index = 0; index < Math.max(children.length, nextChildren.length); index++) {
      if (!nextChildren[index]) children[index].remove();
      else if (!children[index]) current.append(nextChildren[index]);
      else updateNode(children[index], nextChildren[index]);
    }
  }
  const note = document.createElement('div');
  note.style.cssText = 'position:fixed;bottom:0;left:6px;background:#392414;color:#fff;font:10px system-ui;padding:2px 6px;display:none';
  document.body.append(note);
  const motionBlur = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  motionBlur.setAttribute('aria-hidden', 'true');
  motionBlur.setAttribute('width', '0');
  motionBlur.setAttribute('height', '0');
  motionBlur.style.position = 'absolute';
  motionBlur.innerHTML = `<defs><filter id="sports-rotation-motion-blur" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
    <feGaussianBlur stdDeviation="0 0"><animate attributeName="stdDeviation" values="5 0;0 0" dur="100ms" begin="indefinite" fill="freeze" /></feGaussianBlur>
  </filter></defs>`;
  document.body.append(motionBlur);
  const motionBlurAnimation = motionBlur.querySelector('animate');
  async function applyFrame(frame) {
    if (checkFreshness && !isFresh()) return;
    if (!offline && engineInstance === frame.instance && frame.sequence <= displayedSequence) return;
    const mount = document.querySelector('#sports-overlay');
    let gameChanged = !offline && engineInstance === frame.instance && displayedGameKey
      && frame.gameKey && displayedGameKey !== frame.gameKey;
    let quick = frame.transition === 'quick';
    const outgoing = gameChanged && !quick;
    if (outgoing) await animate(mount, 'is-rotating-out');
    if (checkFreshness && (!isFresh() || offline && outgoing)) return;
    // Finish the exit once, then use the newest snapshot. Restarting the exit
    // for each update flashes the old banner back to full opacity.
    if (pendingFrame?.instance === frame.instance && pendingFrame.sequence > frame.sequence) {
      frame = pendingFrame;
      pendingFrame = null;
      gameChanged = engineInstance === frame.instance && displayedGameKey
        && frame.gameKey && displayedGameKey !== frame.gameKey;
      quick = frame.transition === 'quick';
    }
    const template = document.createElement('template');
    template.innerHTML = frame.html;
    const quickAnimation = quick && (gameChanged || interruptedTransition);
    interruptedTransition = false;
    const scrolling = window.SportsOverlay?.scrolling;
    const scrollSnapshot = scrolling?.capture(mount);
    const sameGame = !offline && engineInstance === frame.instance && displayedGameKey === frame.gameKey;
    // Identical rows on different cards still need a fresh animation. Reusing
    // the track can carry its elapsed time (including the bottom hold) across
    // rotation. Preserve running subtrees only for updates to the current card.
    // Keep the mount for transition events that may still be queued by a
    // hidden output window; only the incoming card's contents need replacing.
    updateNode(mount, template.content.firstElementChild, !sameGame);
    if (checkFreshness) {
      offline = false;
      document.body.classList.remove('sports-output-offline');
    }
    scrolling?.restore(document.querySelector('#sports-overlay'),
      sameGame ? scrollSnapshot : null);
    window.SportsOverlay.countdown?.refresh();
    displayedGameKey = frame.gameKey;
    engineInstance = frame.instance;
    displayedSequence = frame.sequence;
    if (gameChanged || quickAnimation || outgoing && !quick) await animate(document.querySelector('#sports-overlay'), quick ? 'is-rotating-quick' : 'is-rotating-in');
    document.body.dataset.sequence = String(frame.sequence);
  }
  function receiveFrame(frame) {
    if (!acceptHeartbeat(frame)) return rendering;
    // A polling response may be older than an immediately delivered desktop frame.
    if (!offline && engineInstance === frame.instance && frame.sequence <= displayedSequence) return rendering;
    if (pendingFrame?.instance === frame.instance && pendingFrame.sequence >= frame.sequence) return rendering;
    pendingFrame = frame;
    if (rendering) {
      const mount = document.querySelector('#sports-overlay');
      if (frame.transition === 'quick' && (frame.gameKey !== displayedGameKey || mount.classList.contains('is-rotating-out'))) {
        for (const animation of mount.getAnimations()) {
          if (animation.animationName?.startsWith('sports-rotate-')) {
            interruptedTransition = true;
            animation.cancel();
          }
        }
      }
      return rendering;
    }
    rendering = (async () => {
      while (pendingFrame) {
        const next = pendingFrame;
        pendingFrame = null;
        await applyFrame(next);
      }
    })().finally(() => { rendering = null; });
    return rendering;
  }
  window.sportsDesktop?.onFrame(frame => { receiveFrame(frame)?.catch(console.error); });
  async function poll() {
    try {
      const response = await fetch('/api/output', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw Error('Output unavailable');
      const frame = await response.json();
      await receiveFrame(frame);
      if (checkFreshness && !offline && isFresh()) reportHealth(true);
      failures = 0;
      note.textContent = 'Sports engine reconnecting…';
      note.style.display = checkFreshness || frame.ready ? 'none' : 'block';
    } catch (_) {
      failures++;
      note.textContent = 'SportsOver disconnected';
      note.style.display = checkFreshness ? 'none' : 'block';
    }
    // Desktop changes arrive immediately through onFrame. Retain a slower poll
    // for initial state, reconnects and missed pushes; OBS still needs fast polling.
    setTimeout(poll, failures || window.sportsDesktop ? 1000 : 200);
  }
  if (checkFreshness) {
    showOffline();
    setInterval(() => { if (!isFresh()) showOffline(); }, 250);
  }
  poll();
})();
