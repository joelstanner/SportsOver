'use strict';
(async () => {
  const api = window.sportsDesktop;
  if (!api || window.top !== window) return;
  const browseNotice = document.createElement('p');
  browseNotice.className = 'desktop-browse-notice';
  browseNotice.setAttribute('role', 'status');
  browseNotice.hidden = true;
  document.body.append(browseNotice);
  let browseNoticeTimer;
  api.onBrowseFeedback?.(message => {
    clearTimeout(browseNoticeTimer);
    browseNotice.textContent = message;
    browseNotice.hidden = !message;
    if (message) browseNoticeTimer = setTimeout(() => { browseNotice.hidden = true; }, 4500);
  });
  if (new URLSearchParams(location.search).has('desktop')) {
    document.body.classList.add('desktop-banner');
    const bannerHint = 'Click: browse · Drag: move · Double-click: resize · Right-click: menu';
    document.body.title = bannerHint;
    let hovered = false;
    const setHovered = value => {
      if (hovered === value) return;
      hovered = value;
      api.action('banner-hover', value).catch(console.error);
    };
    const trackHover = event => {
      if (event.pointerType !== 'mouse') return;
      setHovered(!!document.elementFromPoint(event.clientX, event.clientY)?.closest('#sports-overlay'));
    };
    document.addEventListener('pointerover', trackHover);
    document.addEventListener('pointermove', trackHover);
    document.documentElement.addEventListener('pointerleave', () => setHovered(false));
    document.addEventListener('visibilitychange', () => { if (document.hidden) setHovered(false); });
    let cursorTimer;
    const clearCursorIdle = () => {
      clearTimeout(cursorTimer);
      document.body.classList.remove('cursor-idle');
    };
    const showCursor = () => {
      clearCursorIdle();
      if (document.body.classList.contains('desktop-fullscreen')) {
        cursorTimer = setTimeout(() => document.body.classList.add('cursor-idle'), 3000);
      }
    };
    for (const type of ['pointermove', 'pointerdown', 'wheel', 'focus']) {
      window.addEventListener(type, showCursor, { passive: true });
    }
    window.addEventListener('blur', clearCursorIdle);
    const bannerLink = target => target.closest('.chess-scorebug a[href], .pdga-scorebug a[href], #sports-overlay a.team-game-link[href]');
    let pointerId = null;
    const sendPointer = (phase, event) => api.action('banner-pointer', {
      phase, x: event.screenX, y: event.screenY,
    }).catch(console.error);
    function cancelPointer() {
      if (pointerId === null) return;
      const id = pointerId;
      pointerId = null;
      document.body.classList.remove('is-dragging');
      if (document.body.hasPointerCapture(id)) document.body.releasePointerCapture(id);
      api.action('banner-pointer', { phase: 'cancel' }).catch(console.error);
    }
    document.body.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      if (bannerLink(event.target)) return;
      if (event.pointerType === 'touch' && event.target.closest('.scorebug-vertical-viewport')) return;
      if (document.body.classList.contains('desktop-fullscreen') && !event.target.closest('#sports-overlay')) return;
      event.preventDefault();
      pointerId = event.pointerId;
      document.body.setPointerCapture(pointerId);
      sendPointer('start', event);
    });
    document.body.addEventListener('pointermove', event => {
      if (event.pointerId !== pointerId) return;
      if (!(event.buttons & 1)) { cancelPointer(); return; }
      sendPointer('move', event);
    });
    document.body.addEventListener('pointerup', event => {
      if (event.pointerId !== pointerId || event.button !== 0) return;
      const id = pointerId;
      pointerId = null;
      sendPointer('end', event);
      if (document.body.hasPointerCapture(id)) document.body.releasePointerCapture(id);
    });
    document.body.addEventListener('pointercancel', cancelPointer);
    document.body.addEventListener('lostpointercapture', cancelPointer);
    document.body.addEventListener('click', event => {
      const link = bannerLink(event.target);
      if (!link) return;
      event.preventDefault();
      api.action('open-banner-link', link.href).catch(console.error);
    });
    document.body.addEventListener('dragstart', event => event.preventDefault());
    window.addEventListener('blur', cancelPointer);
    const scale = () => {
      const zoom = window.innerWidth / 472;
      // Retain more of the score's size as the whole banner gets smaller.
      const shrink = Math.max(0, 1 - zoom);
      document.body.style.setProperty('--desktop-score-emphasis', String(1 + shrink * 0.8));
      document.body.style.setProperty('--desktop-logo-emphasis', String(1 + shrink * 0.6));
      document.body.style.zoom = String(zoom);
      document.body.style.width = '472px';
      document.body.style.height = `${window.innerHeight / zoom}px`;
    };
    const fullscreen = value => {
      cancelPointer();
      document.documentElement.classList.toggle('desktop-fullscreen', value);
      document.body.classList.toggle('desktop-fullscreen', value);
      if (value) document.body.removeAttribute('title');
      else document.body.title = bannerHint;
      showCursor();
      scale();
    };
    api.onFullscreenChange(fullscreen);
    window.addEventListener('resize', scale);
    scale();
    fullscreen((await api.status()).fullscreen);
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      api.action('step-banner-size', event.key === 'ArrowUp' ? -1 : 1).catch(console.error);
    });
    return;
  }
  const inspection = document.querySelector('.live-preview-block');
  if (inspection) { inspection.hidden = true; inspection.style.display = 'none'; }
  document.querySelectorAll('a[target="_blank"]').forEach(link => { link.hidden = true; link.style.display = 'none'; });
  const section = document.createElement('section');
  section.className = 'desktop-info-card';
  section.setAttribute('aria-labelledby', 'desktop-banner-heading');
  section.innerHTML = `
    <header class="desktop-info-heading">
      <h2 id="desktop-banner-heading">Desktop banner</h2>
      <p>Move, resize, and browse games right from your desktop.</p>
    </header>
    <div class="desktop-info-controls">
      <div class="actions">
        <button class="button button--secondary" data-desktop="toggle-lock" disabled>Lock</button>
        <button class="button button--secondary" data-desktop="toggle-visibility" disabled>Hide</button>
        <button class="button button--secondary" data-desktop="toggle-fullscreen" disabled>Fullscreen</button>
        <button class="button button--secondary" data-desktop="recover">Recover position</button>
      </div>
      <label class="field">Banner size<select id="desktop-size"><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option></select></label>
    </div>
    <div class="desktop-info-guide">
      <h3>Banner controls</h3>
      <dl class="desktop-gestures">
        <div><dt>Browse games <span>Click</span></dt><dd>Click an unfocused banner to focus it without changing games. Once focused, click the leftmost 20% for the previous item or anywhere else for the next item. Team names and logos open the game in your browser. PDGA and chess links also open in your browser.</dd></div>
        <div><dt>Browse games <span>Left / Right arrows</span></dt><dd>With the banner or Settings focused, press Left for the previous item or Right for the next item, with a quick transition. In Settings, arrows keep their normal behavior while editing fields, choosing options, or using a dialog. Works in fullscreen and while the banner position is locked.</dd></div>
        <div><dt>Scroll lists <span>Wheel or trackpad</span></dt><dd>Scroll PDGA and chess rows while hovering to pause automatic movement. Touch swipes also work. With the list focused, use Up/Down arrows, Page Up/Down, or Home/End. Automatic scrolling resumes after you leave and move keyboard focus away.</dd></div>
        <div><dt>Resize <span>Up / Down arrows or double-click</span></dt><dd>With the banner or Settings focused and the position unlocked, press Up to shrink or Down to grow by 5 percentage points, from 10% to 300%. Double-click the left half to shrink or the right half to grow through the 50–300% presets. The top edge stays fixed and the width changes around the horizontal center. Growth stops when there is no room below. In Settings, editing controls keep their normal arrow behavior; focused PDGA and chess lists keep Up/Down for scrolling. Resizing pauses in fullscreen.</dd></div>
        <div><dt>Move <span>Drag</span></dt><dd>When unlocked: click anywhere and drag to reposition. Dragging and resizing keep the current game.</dd></div>
        <div><dt>Fullscreen <span>Ctrl/Cmd + Shift + F</span></dt><dd>Show only the banner, centered across a black screen. The cursor hides after 3 seconds of inactivity; move it to show it again. Press Escape or choose Exit fullscreen to restore the previous size and position. Moving and resizing pause in fullscreen. Opening Settings also exits fullscreen.</dd></div>
        <div><dt>Banner menu <span>Right-click</span></dt><dd>Pin, unpin, or remove the current game from rotation, open Settings, choose a banner size, lock or unlock the banner position, toggle fullscreen, hide the banner, or quit SportsOver.</dd></div>
      </dl>
      <p class="desktop-info-note">Browsing wraps around and restarts the display timer. Hovering lets the timer run down, then holds the banner until the pointer leaves. Clicks pause briefly to detect double-clicks. Game pins and temporary overrides still apply.</p>
    </div>
    <footer class="desktop-info-footer">
      <div id="desktop-status" class="desktop-info-status" role="status">
        <div class="desktop-state-badges"><span id="desktop-visibility" class="desktop-state-badge"></span><span id="desktop-lock-state" class="desktop-state-badge"></span></div>
        <p id="desktop-lock-hint"></p>
        <p id="desktop-warning" class="desktop-info-warning" hidden></p>
      </div>
      <p id="desktop-recovery" class="desktop-info-recovery"></p>
    </footer>`;
  document.querySelector('[data-panel="settings"]').prepend(section);
  const output = document.createElement('section');
  output.className = 'watch-team-panel'; output.style.margin = '20px 28px';
  output.innerHTML = `<div><h2>OBS and integrations</h2><p>The desktop and OBS display the same SportsOver engine. Hiding the desktop does not hide OBS.</p><p id="obs-address"></p><p id="override-status" role="status"></p></div><div class="actions"><button class="button button--secondary" data-desktop="copy-obs">Copy OBS URL</button><button class="button button--secondary" data-desktop="copy-token">Copy integration token</button><button class="button button--secondary" data-desktop="clear-override">End temporary override</button></div>`;
  section.after(output);
  output.querySelector('[data-desktop="clear-override"]').title = 'Integrations can temporarily show a requested game, such as a game requested through a connected Twitch channel-points reward. End the override early to resume normal rotation, or let its timer expire. Your saved queue and settings stay unchanged.';
  const warning = section.querySelector('#desktop-warning');
  function showWarning(message) { warning.textContent = message || ''; warning.hidden = !message; }
  const lockButton = section.querySelector('[data-desktop="toggle-lock"]');
  const visibilityButton = section.querySelector('[data-desktop="toggle-visibility"]');
  const fullscreenButton = section.querySelector('[data-desktop="toggle-fullscreen"]');
  function render(value) {
    const version = document.querySelector('#app-version');
    version.textContent = value.version ? `v${value.version}` : '';
    version.hidden = !value.version;
    const visibility = section.querySelector('#desktop-visibility');
    visibility.textContent = value.visible ? 'Visible' : 'Hidden';
    visibility.dataset.state = value.visible ? 'visible' : 'hidden';
    const lockState = section.querySelector('#desktop-lock-state');
    lockState.textContent = value.locked ? 'Locked' : 'Unlocked';
    lockState.dataset.state = value.locked ? 'locked' : 'unlocked';
    section.querySelector('#desktop-lock-hint').textContent = value.locked ? 'Position locked. Click to browse games or right-click for the menu.' : 'Lock the banner to prevent dragging and double-click resizing.';
    section.querySelector('#desktop-recovery').innerHTML = value.shortcut ? 'Recover position <kbd>Ctrl/Cmd + Shift + U</kbd>' : 'Recovery shortcut unavailable. Use Recover position or the tray menu.';
    showWarning(value.warning);
    lockButton.textContent = value.locked ? 'Unlock' : 'Lock';
    lockButton.dataset.state = value.locked ? 'locked' : 'unlocked';
    lockButton.title = value.locked ? 'Banner position locked. Unlock to drag or double-click to resize.' : 'Lock banner position. Game browsing and the right-click menu remain available.';
    visibilityButton.textContent = value.visible ? 'Hide' : 'Show';
    visibilityButton.dataset.state = value.visible ? 'visible' : 'hidden';
    visibilityButton.title = value.visible ? 'Banner visible. Hide the desktop banner; OBS continues displaying games.' : 'Banner hidden. Show the desktop banner.';
    lockButton.disabled = false;
    visibilityButton.disabled = false;
    fullscreenButton.disabled = false;
    fullscreenButton.textContent = value.fullscreen ? 'Exit fullscreen' : 'Fullscreen';
    fullscreenButton.setAttribute('aria-pressed', String(!!value.fullscreen));
    fullscreenButton.title = value.fullscreen ? 'Restore the previous banner size and position.' : 'Show the centered banner on a black fullscreen background.';
    output.querySelector('#obs-address').textContent = value.obsUrl || 'Local output server unavailable; see the status above.';
    output.querySelector('#override-status').textContent = value.override ? `Temporary game: ${value.override.gameKey} · ends ${new Date(value.override.expiresAt).toLocaleTimeString()}` : 'Normal rotation · no temporary override';
    const select = section.querySelector('select');
    select.disabled = !!value.fullscreen;
    if (document.activeElement !== select) {
      const size = String(Math.round(value.scale * 100) / 100);
      select.querySelector('[data-current-size]')?.remove();
      if (![...select.options].some(option => option.value === size)) {
        const option = new Option(`${Math.round(value.scale * 100)}%`, size);
        option.dataset.currentSize = '';
        select.append(option);
      }
      select.value = size;
    }
  }
  async function action(name, value) { try { render(await api.action(name, value)); } catch (error) { showWarning(error.message); } }
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const target = event.target;
    if (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="tablist"], [role="menu"]')
      || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') void action('step-banner-size', event.key === 'ArrowUp' ? -1 : 1);
    else void action('browse-banner', event.key === 'ArrowLeft' ? 'previous' : 'next');
  });
  document.querySelectorAll('[data-desktop]').forEach(button => button.addEventListener('click', () => action(button.dataset.desktop)));
  section.querySelector('select').addEventListener('change', event => action('size', Number(event.target.value)));
  async function poll() { try { render(await api.status()); } catch (error) { showWarning(error.message); } }
  await poll();
  setInterval(poll, 1000);
})();
