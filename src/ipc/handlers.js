'use strict';

const SettingsManager = require('../managers/settings-manager');
const TwitchConnector = require('../connectors/twitch');
const TikTokConnector = require('../connectors/tiktok');
const YouTubeConnector = require('../connectors/youtube');
const EmoteManager    = require('../managers/emote-manager');

/**
 * Register all IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {{ getMainWindow: Function, getSettingsWindow: Function, openSettingsWindow: Function, openTikTokAuthWindow: Function }} ctx
 */
function register(ipcMain, ctx) {
  const { getMainWindow, openSettingsWindow, openTikTokAuthWindow } = ctx;

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
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.on('window:alwaysOnTop', (_e, val) => {
    getMainWindow()?.setAlwaysOnTop(!!val);
    SettingsManager.set({ alwaysOnTop: !!val });
  });
  ipcMain.on('window:translucent', (_e, val) => {
    SettingsManager.set({ translucent: !!val });
    getMainWindow()?.webContents.send('app:notify', {
      type: 'info',
      msg: 'Reinicia la aplicación para aplicar el modo translúcido.'
    });
  });

  // ── Settings window ────────────────────────────────────────────────────────
  ipcMain.on('settings:open', () => openSettingsWindow());
  ipcMain.handle('settings:getAll', () => SettingsManager.get());
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
    return TwitchConnector.connect(channel, token, getMainWindow);
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
  ipcMain.handle('tiktok:connect', async (_e, username) => {
    return TikTokConnector.connect(username, getMainWindow);
  });
  ipcMain.handle('tiktok:disconnect', async () => TikTokConnector.disconnect());

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
}

module.exports = { register };
