'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ─── Chattering Bridge API ───────────────────────────────────────────────────
// Exposed as window.chattering in all renderer processes
contextBridge.exposeInMainWorld('chattering', {

  // ── Window controls ────────────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
    setAlwaysOnTop: (val) => ipcRenderer.send('window:alwaysOnTop', val),
    setTranslucent: (val) => ipcRenderer.send('window:translucent', val),
    setTransparency: (val) => ipcRenderer.send('window:transparency', val)
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  settings: {
    open:   () => ipcRenderer.send('settings:open'),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    get:    (keys) => ipcRenderer.invoke('settings:get', keys),
    set:    (patch) => ipcRenderer.invoke('settings:set', patch)
  },

  // ── Twitch ─────────────────────────────────────────────────────────────────
  twitch: {
    openOAuth:     (clientId) => ipcRenderer.send('twitch:openOAuth', clientId),
    connect:       (channel, token) => ipcRenderer.invoke('twitch:connect', channel, token),
    disconnect:    () => ipcRenderer.invoke('twitch:disconnect'),
    ban:           (channel, user, reason) => ipcRenderer.invoke('twitch:ban', channel, user, reason),
    timeout:       (channel, user, secs, reason) => ipcRenderer.invoke('twitch:timeout', channel, user, secs, reason),
    unban:         (channel, user) => ipcRenderer.invoke('twitch:unban', channel, user),
    deleteMessage: (channel, msgId) => ipcRenderer.invoke('twitch:deleteMessage', channel, msgId),
    getUserCard:   (channel, user) => ipcRenderer.invoke('twitch:getUserCard', channel, user),
    sendMessage:   (channel, msg) => ipcRenderer.invoke('twitch:sendMessage', channel, msg),
    getUser:       () => ipcRenderer.invoke('twitch:getUser'),
    onMessage:     (cb) => ipcRenderer.on('twitch:message', (_e, data) => cb(data)),
    onEvent:       (cb) => ipcRenderer.on('twitch:event', (_e, data) => cb(data)),
    onStatus:      (cb) => ipcRenderer.on('twitch:status', (_e, data) => cb(data)),
    onOAuthCaptured: (cb) => ipcRenderer.on('twitch:oauth-captured', (_e, data) => cb(data))
  },

  // ── TikTok ─────────────────────────────────────────────────────────────────
  tiktok: {
    openAuthWindow: () => ipcRenderer.send('tiktok:openAuth'),
    setCookies:    (cookies) => ipcRenderer.send('tiktok:setCookies', cookies),
    connect:        (username, sessionId) => ipcRenderer.invoke('tiktok:connect', username, sessionId),
    disconnect:     () => ipcRenderer.invoke('tiktok:disconnect'),
    onMessage:      (cb) => ipcRenderer.on('tiktok:message', (_e, data) => cb(data)),
    onEvent:        (cb) => ipcRenderer.on('tiktok:event', (_e, data) => cb(data)),
    onStatus:       (cb) => ipcRenderer.on('tiktok:status', (_e, data) => cb(data)),
    onCookiesCaptured:    (cb) => ipcRenderer.on('tiktok:cookies-captured',  (_e, data) => cb(data)),
    onSessionRestored:   (cb) => ipcRenderer.on('tiktok:session-restored', (_e, data) => cb(data))
  },

  // ── YouTube ────────────────────────────────────────────────────────────────
  youtube: {
    connect:    (channelId) => ipcRenderer.invoke('youtube:connect', channelId),
    disconnect: () => ipcRenderer.invoke('youtube:disconnect'),
    onMessage:  (cb) => ipcRenderer.on('youtube:message', (_e, data) => cb(data)),
    onEvent:    (cb) => ipcRenderer.on('youtube:event',   (_e, data) => cb(data)),
    onStatus:   (cb) => ipcRenderer.on('youtube:status',  (_e, data) => cb(data))
  },

  // ── User Card ─────────────────────────────────────────────────────────────
  usercard: {
    open:        (data)  => ipcRenderer.invoke('usercard:open', data),
    close:       ()      => ipcRenderer.send('usercard:close'),
    openProfile: (url)   => ipcRenderer.send('usercard:openProfile', url),
    _onData:     (cb)    => ipcRenderer.on('usercard:data', (_e, data) => cb(data))
  },

  // ── Emotes ─────────────────────────────────────────────────────────────────
  emotes: {
    loadForChannel: (platform, channelId) => ipcRenderer.invoke('emotes:loadForChannel', platform, channelId),
    getCache:       () => ipcRenderer.invoke('emotes:getCache')
  },

  // ── Dock Window ───────────────────────────────────────────────────────────
  dock: {
    openFloat:    () => ipcRenderer.send('dock:openFloat'),
    setPosition:  (pos) => ipcRenderer.send('dock:setPosition', pos),
    clearEvents:  () => ipcRenderer.send('dock:clearEvents'),
    addEvent:     (event) => ipcRenderer.send('dock:addEvent', event),
    // Listen for events from main process
    _onDockEvent: (cb) => ipcRenderer.on('dock:event', (_e, data) => cb(data)),
    _onDockClear: (cb) => ipcRenderer.on('dock:clearEvents', (_e, data) => cb(data)),
    // Listen for dock window closed
    _onDockClosed: (cb) => ipcRenderer.on('dock:closed', (_e, data) => cb(data)),
    // Listen for dock position changed
    _onPositionChanged: (cb) => ipcRenderer.on('dock:positionChanged', (_e, data) => cb(data))
  },

  // ── TTS ────────────────────────────────────────────────────────────────────
  tts: {
    speak: (text, options) => ipcRenderer.send('tts:speak', text, options),
    stop:  () => ipcRenderer.send('tts:stop')
  },

  // ── Settings live updates ──────────────────────────────────────────────────
  _onSettingsUpdated: (cb) => ipcRenderer.on('settings:updated', (_e, data) => cb(data)),

  // ── Utility ────────────────────────────────────────────────────────────────
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});