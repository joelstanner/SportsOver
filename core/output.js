'use strict';
(async () => {
  if (window.top !== window) { document.documentElement.style.background = '#26373b'; document.body.style.background = '#26373b'; }
  let signature = '';
  let failures = 0;
  let displayedGameKey = null;
  let engineInstance = null;
  async function animate(element, className) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    element.classList.add(className);
    try {
      const animations = element.getAnimations().filter(animation => animation.animationName?.startsWith('sports-rotate-'));
      await Promise.allSettled(animations.map(animation => animation.finished));
    } finally {
      element.classList.remove(className);
    }
  }
  // Keep unchanged subtrees mounted so unrelated score/footer updates do not
  // restart their CSS animations. Changed text gets a fresh animation.
  function updateNode(current, next) {
    if (current.isEqualNode(next)) return;
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
  async function poll() {
    try {
      const response = await fetch('/api/output', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw Error('Output unavailable');
      const frame = await response.json();
      if (signature !== `${frame.instance}:${frame.sequence}`) {
        const template = document.createElement('template');
        template.innerHTML = frame.html;
        const mount = document.querySelector('#sports-overlay');
        const gameChanged = engineInstance === frame.instance && displayedGameKey
          && frame.gameKey && displayedGameKey !== frame.gameKey;
        if (gameChanged) await animate(mount, 'is-rotating-out');
        const scrolling = window.SportsOverlay?.scrolling;
        const scrollSnapshot = scrolling?.capture(mount);
        updateNode(mount, template.content.firstElementChild);
        scrolling?.restore(document.querySelector('#sports-overlay'),
          gameChanged || engineInstance !== frame.instance ? null : scrollSnapshot);
        if (gameChanged) await animate(document.querySelector('#sports-overlay'), 'is-rotating-in');
        displayedGameKey = frame.gameKey;
        engineInstance = frame.instance;
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
