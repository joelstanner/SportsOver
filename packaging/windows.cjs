module.exports = {
  appId: 'com.sportsover.desktop',
  productName: 'SportsOver',
  directories: { output: 'dist/windows', buildResources: 'packaging' },
  files: require('./runtime-files.cjs'),
  asar: true,
  npmRebuild: false,
  publish: null,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'SportsOver-${version}-win-${arch}-setup.${ext}',
    icon: 'desktop/assets/SportsOver.png',
    // No certificate discovery or implicit signing on developer/CI machines.
    signtoolOptions: { sign: async () => {} },
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: false,
    deleteAppDataOnUninstall: false,
  },
};
