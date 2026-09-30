'use strict';
(async () => {
  const api = window.sportsDesktop;
  if (!api || window.top !== window) return;
  if (new URLSearchParams(location.search).has('desktop')) {
    document.body.style.webkitAppRegion = 'drag';
    document.body.title = 'Drag to move. Use SportsOver Settings or the tray to lock, resize, or hide.';
    const scale = () => { document.body.style.zoom = String(window.innerWidth / 472); };
    window.addEventListener('resize', scale);
    scale();
    return;
  }
  const inspection = document.querySelector('.live-preview-block');
  if (inspection) { inspection.hidden = true; inspection.style.display = 'none'; }
  document.querySelectorAll('a[target="_blank"]').forEach(link => { link.hidden = true; link.style.display = 'none'; });
  const section = document.createElement('section');
  section.className = 'watch-team-panel';
  section.style.margin = '20px 28px';
  section.innerHTML = `<div><h2>Desktop banner</h2><p>Drag the unlocked banner to move it. Lock lets clicks pass to the app beneath.</p><p id="desktop-status" role="status"></p></div><div class="watch-team-controls"><div class="actions"><button class="button" data-desktop="unlock">Unlock</button><button class="button button--secondary" data-desktop="lock">Lock</button><button class="button button--secondary" data-desktop="show">Show</button><button class="button button--secondary" data-desktop="hide">Hide</button><button class="button button--secondary" data-desktop="recover">Recover position</button></div><label class="field">Banner size<select id="desktop-size"><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option></select></label></div>`;
  document.querySelector('.tabs').before(section);
  const output = document.createElement('section');
  output.className = 'watch-team-panel'; output.style.margin = '20px 28px';
  output.innerHTML = `<div><h2>OBS and integrations</h2><p>The desktop and OBS display the same SportsOver engine. Hiding the desktop does not hide OBS.</p><p id="obs-address"></p><p id="override-status" role="status"></p></div><div class="actions"><button class="button button--secondary" data-desktop="copy-obs">Copy OBS URL</button><button class="button button--secondary" data-desktop="copy-token">Copy integration token</button><button class="button button--secondary" data-desktop="clear-override">End temporary override</button></div>`;
  section.after(output);
  const status = section.querySelector('#desktop-status');
  function render(value) {
    status.textContent = `${value.visible ? 'Visible' : 'Hidden'} · ${value.locked ? 'Locked / click-through' : 'Unlocked / draggable'}. ${value.shortcut ? 'Recovery shortcut: Ctrl/Cmd+Shift+U.' : 'Recovery shortcut unavailable; use Unlock here or the tray menu.'} ${value.warning}`;
    output.querySelector('#obs-address').textContent = value.obsUrl || 'Local output server unavailable; see the status above.';
    output.querySelector('#override-status').textContent = value.override ? `Temporary game: ${value.override.gameKey} · ends ${new Date(value.override.expiresAt).toLocaleTimeString()}` : 'Normal rotation · no temporary override';
    const select = section.querySelector('select');
    if (document.activeElement !== select) select.value = String(Math.round(value.scale * 100) / 100);
  }
  async function action(name, value) { try { render(await api.action(name, value)); } catch (error) { status.textContent = error.message; } }
  document.querySelectorAll('[data-desktop]').forEach(button => button.addEventListener('click', () => action(button.dataset.desktop)));
  section.querySelector('select').addEventListener('change', event => action('size', Number(event.target.value)));
  async function poll() { try { render(await api.status()); } catch (error) { status.textContent = error.message; } }
  await poll();
  setInterval(poll, 1000);
})();
