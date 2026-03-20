'use strict';

const SettingsManager = require('../managers/settings-manager');
const TwitchConnector = require('../connectors/twitch');
const TikTokConnector = require('../connectors/tiktok');
const YouTubeConnector = require('../connectors/youtube');
const EmoteManager    = require('../managers/emote-manager');

/**
 * Register all IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ getMainWindow: Function, getSettingsWindow: Function, openSettingsWindow: Function, openTikTokAuthWindow: Function, openDockWindow: Function, closeDockWindow: Function, getDockWindow: Function }} ctx
 */
function register(ipcMain, ctx) {
  const { getMainWindow, openSettingsWindow, openTikTokAuthWindow, openTwitchOAuthWindow, openDockWindow, closeDockWindow, getDockWindow, openUsercardWindow, getUsercardWindow } = ctx;

  // ── Window controls ────────────────────────────────────────────────────────
  // Use the event sender's window so any window using the preload can control itself
  ipcMain.on('window:minimize', (event) => {
    const { BrowserWindow } = require('electron');
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on('window:maximize', (event) => {
    const { BrowserWindow } = require('electron');
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w) return;
    w.isMaximized() ? w.unmaximize() : w.maximize();
  });
  ipcMain.on('window:close', (event) => {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    console.log('[IPC] window:close called, window:', win ? 'found' : 'not found');
    if (win) {
      win.close();
    } else {
      // Fallback: try to close all windows
      const windows = BrowserWindow.getAllWindows();
      console.log('[IPC] windows count:', windows.length);
      if (windows.length > 0) {
        windows[0].close();
      }
    }
  });
  ipcMain.on('window:alwaysOnTop', (_e, val) => {
    getMainWindow()?.setAlwaysOnTop(!!val);
    SettingsManager.set({ alwaysOnTop: !!val });
  });
  ipcMain.on('window:translucent', (_e, val) => {
    SettingsManager.set({ translucent: !!val });
    const win = getMainWindow();
    if (win) {
      win.setOpacity(val ? (SettingsManager.get().transparency / 100) : 1);
    }
  });

  ipcMain.on('window:transparency', (_e, val) => {
    const clamped = Math.max(70, Math.min(100, val));
    SettingsManager.set({ transparency: clamped, translucent: true });
    const win = getMainWindow();
    if (win) {
      win.setOpacity(clamped / 100);
    }
  });

  // ── Settings window ────────────────────────────────────────────────────────
  ipcMain.on('settings:open', () => openSettingsWindow());
  ipcMain.handle('settings:getAll', () => SettingsManager.get());
  ipcMain.handle('settings:get', (_e, keys) => {
    const all = SettingsManager.get();
    if (Array.isArray(keys)) {
      const result = {};
      keys.forEach(k => { if (k in all) result[k] = all[k]; });
      return result;
    }
    return all;
  });
  ipcMain.handle('settings:set', (_e, patch) => {
    SettingsManager.set(patch);
    const updated = SettingsManager.get();
    // Broadcast to all open windows so settings apply live
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('settings:updated', updated);
    });
    // Apply alwaysOnTop immediately
    if (patch.alwaysOnTop !== undefined) getMainWindow()?.setAlwaysOnTop(!!patch.alwaysOnTop);
    return updated;
  });

  // ── Twitch ─────────────────────────────────────────────────────────────────
  ipcMain.handle('twitch:connect', async (_e, channel, token) => {
    console.log('[IPC] twitch:connect llamado con channel:', channel, 'token:', token ? 'presente' : 'ausente');
    try {
      // If no channel provided, try to get it from settings (saved channel) or use empty
      const settings = SettingsManager.get();
      const channelToUse = channel || settings.twitchChannel || null;
      
      const result = await TwitchConnector.connect(channelToUse, token, getMainWindow);
      console.log('[IPC] twitch:connect resultado:', result);
      return result;
    } catch (err) {
      console.error('[IPC] twitch:connect error:', err.message);
      return { connected: false, error: err.message };
    }
  });

  // Get current Twitch user info from token
  ipcMain.handle('twitch:getUser', async () => {
    const settings = SettingsManager.get();
    const token = settings.twitchToken;
    // Use default clientId if not set in settings
    const clientId = settings.twitchClientId || 'w2q6ngvevmf1gkuu1ngiqwmyzqmjrt';
    
    if (!token) {
      return { loggedIn: false };
    }
    
    try {
      const res = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          'Authorization': `Bearer ${token.replace('oauth:', '')}`,
          'Client-Id': clientId
        }
      });
      const data = await res.json();
      if (data.data && data.data[0]) {
        return {
          loggedIn: true,
          username: data.data[0].login,
          displayName: data.data[0].display_name
        };
      }
      return { loggedIn: false };
    } catch (err) {
      console.error('[IPC] twitch:getUser error:', err.message);
      return { loggedIn: false, error: err.message };
    }
  });
  ipcMain.handle('twitch:disconnect', async () => TwitchConnector.disconnect());
  ipcMain.handle('twitch:ban', async (_e, channel, user, reason) =>
    TwitchConnector.ban(channel, user, reason));
  ipcMain.handle('twitch:timeout', async (_e, channel, user, secs, reason) =>
    TwitchConnector.timeout(channel, user, secs, reason));
  ipcMain.handle('twitch:unban', async (_e, channel, user) =>
    TwitchConnector.unban(channel, user));
  ipcMain.handle('twitch:deleteMessage', async (_e, channel, msgId) =>
    TwitchConnector.deleteMessage(channel, msgId));
  ipcMain.handle('twitch:getUserCard', async (_e, channel, user) =>
    TwitchConnector.getUserCard(channel, user));
  ipcMain.handle('twitch:sendMessage', async (_e, channel, msg) =>
    TwitchConnector.sendMessage(channel, msg));

  // ── TikTok ─────────────────────────────────────────────────────────────────
  ipcMain.on('tiktok:openAuth', (event) => openTikTokAuthWindow(event));
  ipcMain.on('tiktok:setCookies', (_event, cookies) => {
    // Pass cookies to the connector
    if (TikTokConnector.setCookies) {
      TikTokConnector.setCookies(cookies);
    }
  });

  // ── Twitch OAuth ─────────────────────────────────────────────────────────────
  ipcMain.on('twitch:openOAuth', (_event, clientId) => {
    openTwitchOAuthWindow(clientId);
  });
  ipcMain.handle('tiktok:connect', async (_e, username, sessionId) => {
    return TikTokConnector.connect(username, getMainWindow, sessionId);
  });
  ipcMain.handle('tiktok:disconnect', async () => {
    await TikTokConnector.disconnect();
    // Also wipe the persistent Electron session so re-login starts fresh
    try {
      const { session } = require('electron');
      const tiktokSession = session.fromPartition('persist:tiktok');
      await tiktokSession.clearStorageData({ storages: ['cookies'] });
      console.log('[TikTok] Session cookies cleared');
    } catch (e) {
      console.error('[TikTok] Error clearing cookies:', e.message);
    }
    return { ok: true };
  });

  // ── YouTube ────────────────────────────────────────────────────────────────
  ipcMain.handle('youtube:connect', async (_e, channelHandle) => {
    return YouTubeConnector.connect(channelHandle, getMainWindow);
  });
  
  ipcMain.handle('youtube:disconnect', async () => YouTubeConnector.disconnect());

  // ── Emotes ─────────────────────────────────────────────────────────────────
  ipcMain.handle('emotes:loadForChannel', async (_e, platform, channelId) => {
    return EmoteManager.loadForChannel(platform, channelId);
  });
  ipcMain.handle('emotes:getCache', async () => EmoteManager.getSerializableCache());

  // ── Dock Window ───────────────────────────────────────────────────────────
  ipcMain.on('dock:openFloat', () => {
    openDockWindow();
    // Notify main window to hide its docked dock
    const mainWin = getMainWindow();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('dock:floatOpened');
    }
  });

  ipcMain.on('dock:setPosition', (_e, pos) => {
    console.log('[Handlers] dock:setPosition received, pos:', pos);
    // Close dock window first
    closeDockWindow();
    // Save position to settings
    SettingsManager.set({ dockPosition: pos });
    // Notify main window to show docked dock at new position
    const mainWin = getMainWindow();
    console.log('[Handlers] Main window:', mainWin ? 'exists' : 'null');
    if (mainWin && !mainWin.isDestroyed()) {
      console.log('[Handlers] Sending dock:positionChanged to main window');
      mainWin.webContents.send('dock:positionChanged', pos);
    } else {
      console.log('[Handlers] ERROR - main window is destroyed or null');
    }
  });

  ipcMain.on('dock:clearEvents', () => {
    // Clear events in main window's dock too
    const mainWin = getMainWindow();
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('dock:clearEvents');
    }
  });

  // Send event to dock window (from main chat)
  ipcMain.on('dock:addEvent', (_e, event) => {
    const dockWin = getDockWindow();
    if (dockWin && !dockWin.isDestroyed()) {
      dockWin.webContents.send('dock:event', event);
    }
  });
  // ── User Card ──────────────────────────────────────────────────────────────
  ipcMain.handle('usercard:open', (_e, data) => {
    const { screenX, screenY, ...cardData } = data;
    // Inject current theme so the window renders correctly before settings are fetched
    cardData.theme = SettingsManager.get().theme || 'dark';
    openUsercardWindow(cardData, screenX ?? 200, screenY ?? 200);
    return { ok: true };
  });

  ipcMain.on('usercard:close', () => {
    const win = getUsercardWindow();
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.on('usercard:openProfile', (_e, url) => {
    const { shell } = require('electron');
    shell.openExternal(url);
  });
}

module.exports = { register };