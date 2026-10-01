const RELEASES_URL = 'https://github.com/joelstanner/SportsOver/releases/latest';
const RELEASE_API = 'https://api.github.com/repos/joelstanner/SportsOver/releases/latest';

function parseVersion(value) {
  const match = String(value).match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/);
  if (!match) throw Error('Unrecognized release version');
  const core = match.slice(1, 4).map(Number);
  const pre = match[4]?.split('.') || [];
  if (core.some(number => !Number.isSafeInteger(number)) || pre.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) throw Error('Unrecognized release version');
  return { core, pre };
}

// Semantic versions compare numerically; development builds never downgrade.
function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
    const x = a.pre[index], y = b.pre[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return x.length !== y.length ? (x.length > y.length ? 1 : -1) : (x > y ? 1 : -1);
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function createUpdateChecker({ app, dialog, shell, fetchImpl = globalThis.fetch, onStateChange = () => {}, timeoutMs = 10000,
  now = Date.now, readLastCheck = () => null, saveLastCheck = () => {} }) {
  let checking = false;
  let lastAutomaticCheck = null;
  function menuItem() {
    return { id: 'check-updates', label: checking ? 'Checking for updates…' : 'Check for updates…', enabled: !checking, click: () => check() };
  }
  async function checkOnLaunch({ background = false } = {}) {
    if (checking) return;
    const timestamp = now();
    let previous = lastAutomaticCheck;
    try { previous ??= readLastCheck(); } catch (_) { /* A launch check must never interrupt startup. */ }
    if (Number.isFinite(previous) && previous <= timestamp && timestamp - previous < 24 * 60 * 60 * 1000) return;
    // Record attempts, including failures, to avoid requests on every restart.
    lastAutomaticCheck = timestamp;
    try { saveLastCheck(timestamp); } catch (_) { /* Manual checks remain available if preferences cannot be saved. */ }
    return check({ interactive: false, notify: !background });
  }
  async function check({ interactive = true, notify = true } = {}) {
    if (checking) return;
    checking = true;
    onStateChange();
    try {
      const current = app.getVersion();
      const response = await fetchImpl(RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `SportsOver/${current}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        if (response.status === 404) {
          if (interactive) await dialog.showMessageBox({ type: 'info', title: 'SportsOver updates', message: 'No published release is available yet.', detail: `Installed version: ${current}`, buttons: ['OK'] });
          return;
        }
        throw Error('Release check failed');
      }
      const release = await response.json();
      if (release.draft !== false || release.prerelease !== false) throw Error('Unexpected release data');
      const latest = release.tag_name;
      if (compareVersions(latest, current) > 0) {
        if (!notify) return;
        const result = await dialog.showMessageBox({
          type: 'info', title: 'SportsOver update available', message: `SportsOver ${latest.replace(/^v/, '')} is available.`,
          detail: `Installed version: ${current}\nOpen the GitHub release page to download and install the update.`,
          buttons: ['Open download page', 'Later'], defaultId: 0, cancelId: 1,
        });
        if (result.response === 0) await shell.openExternal(RELEASES_URL);
      } else if (interactive) {
        await dialog.showMessageBox({ type: 'info', title: 'SportsOver updates', message: 'You’re up to date.', detail: `Installed version: ${current}\nLatest published version: ${latest.replace(/^v/, '')}`, buttons: ['OK'] });
      }
    } catch (_) {
      if (interactive) await dialog.showMessageBox({
        type: 'warning', title: 'SportsOver updates', message: 'Could not check for updates.',
        detail: 'Check your internet connection and try again. GitHub may be temporarily unavailable.', buttons: ['OK'],
      });
    } finally {
      checking = false;
      onStateChange();
    }
  }
  return { check, checkOnLaunch, menuItem };
}

module.exports = { createUpdateChecker, compareVersions, RELEASES_URL, RELEASE_API };
