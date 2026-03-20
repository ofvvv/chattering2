'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – TikTok Connector
   ─────────────────────────────────────────────────────────────────────────
   Uses tiktok-live-connector (no API key required).
   Cookies are captured via the TikTok auth window in main.js and passed
   here through SettingsManager or directly per-session.
   
   Features:
   - Manual cookie injection workaround
   - Auto-reconnect with exponential backoff
   - Handles offline streams gracefully
   ═══════════════════════════════════════════════════════════════════════════ */

const { WebcastPushConnection } = require('tiktok-live-connector');
const { broadcast } = require('../utils');

// ─── State ───────────────────────────────────────────────────────────────────
let connection    = null;
let activeUser    = null;
let getMainWindow = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let tiktokCookies = null;

// ─── Set cookies (called from main process) ─────────────────────────────────
function setCookies(cookies) {
  tiktokCookies = cookies;
  console.log('[TikTok] Cookies set:', Object.keys(cookies || {}).length, 'cookies');
}

// ─── Connect ─────────────────────────────────────────────────────────────────
async function connect(username, getWin, sessionId = null) {
  if (connection) await disconnect();
  getMainWindow = getWin;
  activeUser    = username.replace(/^@/, '').trim();
  reconnectAttempts = 0;

  if (!activeUser) {
    throw new Error('TikTok connect failed: username requerido');
  }

  // Build options
  const opts = {
    processInitialData: false,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 2000,
    forceFetchRoomInfo: true,
    clientParams: {
      "app_language": "es-ES",
      "device_platform": "web",
      "tt-target-idc": "useast5"
    },
    requestHeaders: {}
  };

  // Use sessionId if provided, otherwise try to use cookies
  if (sessionId) {
    opts.sessionId = sessionId;
  } else if (tiktokCookies) {
    // Inject cookies directly into request headers as workaround
    // This helps avoid strict validation errors
    const cookieHeader = Object.entries(tiktokCookies)
      .map(([key, val]) => `${key}=${val}`)
      .join('; ');
    opts.requestHeaders['Cookie'] = cookieHeader;
    console.log('[TikTok] Using injected cookies');
  }

  connection = new WebcastPushConnection(activeUser, opts);

  connection.on('chat', onChat);
  connection.on('gift', onGift);
  connection.on('like', onLike);
  connection.on('follow', onFollow);
  connection.on('share', onShare);
  connection.on('subscribe', onSubscribe);
  connection.on('streamEnd', onStreamEnd);
  connection.on('connected', () => {
    console.log(`[TikTok] Connected to ${activeUser}`);
    emitStatus(true);
    reconnectAttempts = 0;
  });
  connection.on('disconnected', () => {
    console.log(`[TikTok] Disconnected from ${activeUser}`);
    emitStatus(false);
    scheduleReconnect();
  });
  connection.on('error', (err) => {
    console.error('[TikTok] connector error:', err.message);
    
    // Handle specific error cases
    if (err.message?.includes('LIVE has ended') || 
        err.message?.includes('offline') || 
        err.message?.includes('not found') ||
        err.message?.includes('19881007')) {
      // Stream is offline - reconnect silently
      console.log(`[TikTok] @${activeUser} está offline. Reintentando en 60s...`);
      emitStatus(false, 'Stream offline. Reintentando...');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (activeUser) connect(activeUser, getWin, sessionId);
      }, 60000);
    } else {
      // Other error - emit and schedule reconnect
      let userMsg = err.message;
      if (err.message?.includes('19881007') || err.message?.includes('user_not_found')) {
        userMsg = 'El usuario no existe o no está en vivo. Asegúrate de que el streamer está transmitiendo.';
      } else if (err.message?.includes('not_authenticated') || err.message?.includes('auth')) {
        userMsg = 'Se requiere iniciar sesión en TikTok. Haz clic en "Login TikTok" primero.';
      }
      emitStatus(false, userMsg);
      scheduleReconnect();
    }
  });

  try {
    console.log(`[TikTok] Attempting to connect to: ${activeUser}`);
    const state = await connection.connect();
    console.log(`[TikTok] Connected successfully, roomInfo:`, state?.roomInfo);
    return { connected: true, roomInfo: state?.roomInfo || {} };
  } catch (err) {
    connection = null;
    // Provide more helpful error messages
    let errorMsg = err.message;
    if (errorMsg?.includes('19881007') || errorMsg?.includes('user_not_found')) {
      errorMsg = 'API Error 19881007: El usuario no existe o no está en vivo actualmente. TikTok Live requiere que el streamer esté transmitiendo.';
    } else if (errorMsg?.includes('not_found')) {
      errorMsg = 'No se encontró el usuario. Verifica el nombre de usuario e intenta de nuevo.';
    }
    throw new Error(`TikTok connect failed: ${errorMsg}`);
  }
}

// ─── Reconnect with exponential backoff ─────────────────────────────────────
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (!activeUser) return;
  
  reconnectAttempts++;
  const delay = Math.min(2000 * Math.pow(2, reconnectAttempts - 1), 60000);
  console.log(`[TikTok] Reconectando en ${delay/1000}s... (Intento ${reconnectAttempts})`);
  
  reconnectTimer = setTimeout(() => {
    if (activeUser && connection) {
      // Already connected or connecting, don't reconnect
    } else if (activeUser) {
      connect(activeUser, getMainWindow);
    }
  }, delay);
}

// ─── Disconnect ───────────────────────────────────────────────────────────────
async function disconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempts = 0;
  
  if (connection) {
    try { connection.disconnect(); } catch (_) {}
    connection = null;
  }
  activeUser = null;
  emitStatus(false);
}

// ─── Chat message ─────────────────────────────────────────────────────────────
function onChat(data) {
  emit('tiktok:message', {
    id:          data.msgId || String(Date.now()),
    platform:    'tiktok',
    username:    data.uniqueId || 'usuario',
    displayName: data.nickname || data.uniqueId || 'usuario',
    color:       '#ff0050',
    message:     data.comment || '',
    badges:      buildTikTokBadges(data),
    emotes:      {},
    avatarUrl:   data.profilePictureUrl || ''
  });
}

// ─── Gift ──────────────────────────────────────────────────────────────────────
function onGift(data) {
  if (data.giftType === 1 && !data.repeatEnd) return;  // Still sending streak

  emit('tiktok:event', {
    type:        'gift',
    platform:    'tiktok',
    username:    data.uniqueId,
    displayName: data.nickname || data.uniqueId,
    amount:      data.repeatCount || 1,
    message:     data.giftName || '',
    giftName:    data.giftName,
    giftImg:     data.giftPictureUrl
  });
}

// ─── Like ──────────────────────────────────────────────────────────────────────
function onLike(data) {
  emit('tiktok:event', {
    type:        'like',
    platform:    'tiktok',
    username:    data.uniqueId,
    displayName: data.nickname || data.uniqueId,
    amount:      data.likeCount || 1
  });
}

// ─── Follow ───────────────────────────────────────────────────────────────────
function onFollow(data) {
  emit('tiktok:event', {
    type:        'follow',
    platform:    'tiktok',
    username:    data.uniqueId,
    displayName: data.nickname || data.uniqueId
  });
}

// ─── Share ────────────────────────────────────────────────────────────────────
function onShare(data) {
  emit('tiktok:event', {
    type:        'share',
    platform:    'tiktok',
    username:    data.uniqueId,
    displayName: data.nickname || data.uniqueId
  });
}

// ─── Subscribe ────────────────────────────────────────────────────────────────
function onSubscribe(data) {
  emit('tiktok:event', {
    type:        'sub',
    platform:    'tiktok',
    username:    data.uniqueId,
    displayName: data.nickname || data.uniqueId
  });
}

// ─── Stream ended ─────────────────────────────────────────────────────────────
function onStreamEnd() {
  emitStatus(false);
  emit('tiktok:event', {
    type: 'streamEnd', platform: 'tiktok',
    username: activeUser, displayName: activeUser
  });
  // Schedule reconnect for when stream comes back
  scheduleReconnect();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildTikTokBadges(data) {
  const badges = [];
  if (data.userBadges) {
    data.userBadges.forEach(badge => {
      if (badge.displayType === 1 && badge.url?.length > 0) {
        badges.push({ url: badge.url, title: badge.name || 'badge' });
      }
    });
  }
  return badges;
}

// ─── Emitters ─────────────────────────────────────────────────────────────────
// Using shared broadcast utility from src/utils
function emit(channel, data) {
  broadcast(channel, data);
}

function emitStatus(connected, errorMsg = null) {
  emit('tiktok:status', { connected, channel: activeUser, error: errorMsg });
}

module.exports = { connect, disconnect, setCookies };
