'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Broadcast Utility
   ═══════════════════════════════════════════════════════════════════════════
   Centralized function to broadcast messages to all renderer windows.
   Used by all platform connectors to avoid code duplication.
   ═══════════════════════════════════════════════════════════════════════════ */

const { BrowserWindow } = require('electron');

/**
 * Broadcast a message to all renderer windows
 * @param {string} channel - IPC channel name
 * @param {*} data - Data to send
 */
function broadcast(channel, data) {
  console.log('[Broadcast] 🔍 broadcast llamado - canal:', channel, '- data:', data ? 'presente' : 'NULL/undefined');
  if (data) {
    console.log('[Broadcast] 🔍 data keys:', Object.keys(data));
  }
  
  const windows = BrowserWindow.getAllWindows();
  console.log('[Broadcast] Enviando a', windows.length, 'ventanas - canal:', channel);
  windows.forEach((win, idx) => {
    if (win && !win.isDestroyed()) {
      console.log('[Broadcast] Enviando a ventana', idx, '- titulo:', win.getTitle());
      win.webContents.send(channel, data);
    } else {
      console.log('[Broadcast] Ventana', idx, 'destruida o null');
    }
  });
}

module.exports = { broadcast };
