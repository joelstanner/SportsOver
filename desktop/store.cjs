const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('../core/config.js');
const config = globalThis.SportsOverlay.config;

// Writes are synchronous and atomic: a failed write never advances the in-memory revision.
class Store {
  constructor(directory) {
    // Load app-owned directories before validating saved favorites (including newly added teams).
    for (const sport of config.SPORT_CATALOG) {
      try {
        const catalog = JSON.parse(fs.readFileSync(path.join(directory, 'sports', sport.key, 'teams.json'), 'utf8'));
        applyCatalog(catalog);
      } catch (_) { /* Keep the bundled directory if an update is absent or damaged. */ }
    }
    this.file = path.join(directory, 'settings.json');
    fs.mkdirSync(directory, { recursive: true });
    this.warning = '';
    let saved;
    for (const file of [this.file, `${this.file}.bak`]) {
      try {
        saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!saved || saved.version !== 1 || !saved.config || typeof saved.config !== 'object') throw Error('Invalid settings');
        if (file.endsWith('.bak')) this.warning = 'Settings were recovered from the backup.';
        break;
      } catch (error) {
        saved = null;
        if (error.code !== 'ENOENT') this.warning = 'Settings could not be read. Defaults are active; the original file is preserved until you save.';
      }
    }
    this.value = { version: 1, config: config.normalizeConfig(saved?.config || config.DEFAULT_CONFIG), desktop: saved?.desktop || {} };
    this.instance = randomUUID();
    this.revision = 0;
    this.catalogRevision = 0;
    this.validPrimary = !!saved && !this.warning;
  }
  snapshot() {
    return { initialized: true, instance: this.instance, revision: this.revision, catalogRevision: this.catalogRevision, config: this.value.config };
  }
  commit(value) {
    if (this.validPrimary && fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    else if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.recovered-${Date.now()}`);
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.value = value;
    this.validPrimary = true;
  }
  patch(body) {
    if (body?.instance !== this.instance || body?.expectedRevision !== this.revision) {
      return { status: 409, body: { detail: this.snapshot() } };
    }
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) return { status: 400, body: { detail: 'Invalid configuration' } };
    this.commit({ ...this.value, config: config.normalizeConfig({ ...this.value.config, ...body.config }) });
    this.revision++;
    return { status: 200, body: this.snapshot() };
  }
  desktop(patch) { this.commit({ ...this.value, desktop: { ...this.value.desktop, ...patch } }); }
}
function applyCatalog(catalog) {
  if (!config.findSport(catalog.sport) || !Array.isArray(catalog.teams) || !catalog.teams.length) return;
  const teams = catalog.teams.map(team => ({ ...team, sport: catalog.sport, league: catalog.league, provider: catalog.provider, providerStatus: 'live' }));
  config.TEAM_CATALOG.splice(0, config.TEAM_CATALOG.length, ...config.TEAM_CATALOG.filter(team => team.sport !== catalog.sport), ...teams);
}
module.exports = { Store, applyCatalog };
