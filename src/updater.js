'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Auto-Updater
   ─────────────────────────────────────────────────────────────────────────
   Uses electron-updater to check for new releases on GitHub.
   Prompts the user before downloading and before installing.
   Respects a custom install path chosen during NSIS install.
   ═══════════════════════════════════════════════════════════════════════════ */

const { autoUpdater } = require('electron-updater');
const { dialog, app }  = require('electron');

let mainWindowGetter = null;

function getWin() {
  return mainWindowGetter?.();
}

/**
 * Initialise the updater.
 * @param {Function} getMainWindow - returns the current BrowserWindow
 */
function init(getMainWindow) {
  mainWindowGetter = getMainWindow;

  // Log to console for debugging
  autoUpdater.logger = require('electron').require
    ? null  // packaged: silence
    : console;

  // Don't auto-download — ask the user first
  autoUpdater.autoDownload    = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // ── Update available → ask to download ───────────────────────────────────
  autoUpdater.on('update-available', async (info) => {
    const win = getWin();
    const { response } = await dialog.showMessageBox(win || undefined, {
      type:    'info',
      title:   'Actualización disponible',
      message: `Chattering ${info.version} está disponible.\nVersión actual: ${app.getVersion()}`,
      detail:  'Puedes actualizar ahora o más tarde.',
      buttons: ['Actualizar ahora', 'Recordar más tarde'],
      defaultId: 0,
      cancelId:  1
    });

    if (response === 0) {
      autoUpdater.downloadUpdate();
      if (win) win.webContents.send('app:update-downloading');
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] No hay actualizaciones disponibles.');
  });

  autoUpdater.on('download-progress', (progress) => {
    const win = getWin();
    if (win) win.webContents.send('app:update-progress', Math.floor(progress.percent));
  });

  // ── Download complete → ask to install ───────────────────────────────────
  autoUpdater.on('update-downloaded', async (info) => {
    const win = getWin();
    const { response } = await dialog.showMessageBox(win || undefined, {
      type:    'info',
      title:   'Actualización descargada',
      message: `Chattering ${info.version} ha sido descargado.`,
      detail:  'La app se cerrará para instalar la actualización y volverá a abrirse automáticamente.',
      buttons: ['Instalar y reiniciar', 'Instalar al cerrar'],
      defaultId: 0,
      cancelId:  1
    });

    if (response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
    // response === 1: install on next quit (autoInstallOnAppQuit would handle it,
    // but we disabled it above so the user already chose to delay)
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
  });
}

/**
 * Manually check for updates (called from UI or on app start).
 * @param {boolean} silent - if true, don't show a dialog when up-to-date
 */
async function checkForUpdates(silent = true) {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    if (!silent) {
      dialog.showMessageBox({
        type:    'warning',
        title:   'Error al buscar actualizaciones',
        message: err.message
      });
    }
    console.error('[Updater] checkForUpdates failed:', err.message);
  }
}

module.exports = { init, checkForUpdates };