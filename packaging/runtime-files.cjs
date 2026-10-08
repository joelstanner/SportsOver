// Shared positive allowlist: exclude development tools and local state.
module.exports = [
    'desktop/*.cjs',
    'desktop/assets/SportsOver.png',
    'core/**/*.{js,css,json,svg,html}',
    'admin/**/*.{js,css,json,svg,html}',
    'sports/**/*.{js,css,json,svg,png,html}',
    'scripts/team-catalog.mjs',
    'index.html', 'display.html', 'demo.html', 'package.json', 'LICENSE',
    '!**/{settings,settings.*,integration,credentials*,secrets*}.json',
    '!**/settings.json.*',
  ];
