async function showUpdateDialog({ dialog, parent, options, platform = process.platform, foreground = true }) {
  if (!parent || parent.isDestroyed()) throw Error('Update dialog needs an available Settings window');
  const wasOnTop = parent.isAlwaysOnTop();
  try {
    if (foreground) {
      if (parent.isMinimized()) parent.restore();
      // The banner is itself topmost. Raise the owner to the same level so its
      // native modal dialog cannot disappear behind the banner or Settings.
      if (!wasOnTop) parent.setAlwaysOnTop(true, platform === 'win32' ? 'pop-up-menu' : 'floating');
      parent.show();
      parent.focus();
    }
    return await dialog.showMessageBox(parent, options);
  } finally {
    if (foreground && !wasOnTop && !parent.isDestroyed()) parent.setAlwaysOnTop(false);
  }
}

module.exports = { showUpdateDialog };
