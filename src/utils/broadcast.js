'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Broadcast Utility
   ─────────────────────────────────────────────────────────────────────────
   Targeted IPC broadcasting — each channel type only reaches windows that
   actually handle it, avoiding unnecessary IPC overhead.

   Routing rules:
     *:message          → chat window only   (high-volume, no other window needs it)
     *:event            → chat window only   (chat forwards to dock via dock:addEvent)
     *:status           → chat + settings    (both show connection state)
     *:messagedeleted   → chat window only
     settings:updated   → all windows        (theme etc. affects every window)
     tiktok:cookies-*   → chat window only
   ═══════════════════════════════════════════════════════════════════════════ */

const { BrowserWindow } = require('electron');

// Window title identifiers (set via BrowserWindow options)
const TITLE_CHAT     = 'Chattering';
const TITLE_SETTINGS = /[Cc]onfiguración|[Ss]ettings/;
const TITLE_DOCK     = /[Ee]ventos|[Dd]ock/;

function getWindows() {
  return BrowserWindow.getAllWindows().filter(w => w && !w.isDestroyed());
}

function send(win, channel, data) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

function broadcast(channel, data) {
  const wins = getWindows();

  // ── High-volume: messages and events go ONLY to the chat window ────────────
  if (
    channel.endsWith(':message') ||
    channel.endsWith(':event')   ||
    channel.endsWith(':messagedeleted') ||
    channel.endsWith(':ban')     ||
    channel.endsWith(':timeout') ||
    channel === 'tiktok:cookies-captured' ||
    channel === 'tiktok:session-restored'
  ) {
    const chat = wins.find(w => w.getTitle() === TITLE_CHAT);
    if (chat) send(chat, channel, data);
    return;
  }

  // ── Status events → chat + settings (both show connection state) ───────────
  if (channel.endsWith(':status')) {
    wins.forEach(w => {
      const title = w.getTitle();
      if (title === TITLE_CHAT || TITLE_SETTINGS.test(title)) {
        send(w, channel, data);
      }
    });
    return;
  }

  // ── Settings updates → all windows (theme, font size, etc.) ───────────────
  if (channel === 'settings:updated' || channel === 'app:update-downloading' || channel === 'app:update-progress') {
    wins.forEach(w => send(w, channel, data));
    return;
  }

  // ── Default: chat window only (covers any unclassified channel) ────────────
  const chat = wins.find(w => w.getTitle() === TITLE_CHAT);
  if (chat) send(chat, channel, data);
}

module.exports = { broadcast };