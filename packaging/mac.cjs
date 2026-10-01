const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = {
  appId: 'com.sportsover.desktop',
  productName: 'SportsOver',
  directories: { output: 'dist/installers', buildResources: 'packaging' },
  // Positive patterns keep the checkout, tools, tests, credentials and local
  // state out of the app. Only the catalog module is needed from scripts/.
  files: [
    'desktop/*.cjs',
    'desktop/assets/SportsOver.png',
    'core/**/*.{js,css,json,svg,html}',
    'admin/**/*.{js,css,json,svg,html}',
    'sports/**/*.{js,css,json,svg,html}',
    'scripts/team-catalog.mjs',
    'index.html', 'display.html', 'demo.html', 'package.json', 'LICENSE',
    '!**/{settings,settings.*,integration,credentials*,secrets*}.json',
    '!**/settings.json.*',
  ],
  asar: true,
  npmRebuild: false,
  publish: null,
  mac: {
    target: 'dmg',
    artifactName: 'SportsOver-${version}-mac-${arch}.${ext}',
    icon: 'desktop/assets/SportsOver.png',
    category: 'public.app-category.sports',
    minimumSystemVersion: '13.0',
    // Intentionally outside the Apple Developer Program. Do not discover or
    // use a Developer ID certificate, even if one exists on the build machine.
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
  },
  dmg: {
    title: 'SportsOver ${version}',
    backgroundColor: '#f3f6fa',
    window: { width: 560, height: 360 },
    iconSize: 96,
    iconTextSize: 14,
    contents: [
      { x: 140, y: 120, type: 'file' },
      { x: 420, y: 120, type: 'link', path: '/Applications' },
      { x: 280, y: 265, type: 'file', path: 'packaging/Install SportsOver.txt' },
    ],
    sign: false,
    writeUpdateInfo: false,
  },
  afterSign(context) {
    const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
  },
};
