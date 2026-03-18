'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – TikTok Connector
   ─────────────────────────────────────────────────────────────────────────
   Uses tiktok-live-connector (no API key required).
   Cookies are captured via the TikTok auth window in main.js and passed
   here through SettingsManager or directly per-session.
   ═══════════════════════════════════════════════════════════════════════════ */

const { WebcastPushConnection } = require('tiktok-live-connector');

// ─── State ───────────────────────────────────────────────────────────────────
let connection    = null;
let activeUser    = null;
let getMainWindow = null;

// ─── Connect ─────────────────────────────────────────────────────────────────
async function connect(username, getWin) {
  if (connection) await disconnect();
  getMainWindow = getWin;
  activeUser    = username.replace(/^@/, '');

  const opts = {
    processInitialData: true,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 2000,
    sessionId: undefined  // will be set if cookies available
  };

  connection = new WebcastPushConnection(activeUser, opts);

  connection.on('chat', onChat);
  connection.on('gift', onGift);
  connection.on('like', onLike);
  connection.on('follow', onFollow);
  connection.on('share', onShare);
  connection.on('subscribe', onSubscribe);
  connection.on('streamEnd', onStreamEnd);
  connection.on('connected', () => emitStatus(true));
  connection.on('disconnected', () => emitStatus(false));
  connection.on('error', (err) => {
    console.error('[TikTok] connector error:', err);
    emitStatus(false, err.message);
  });

  try {
    const state = await connection.connect();
    return { connected: true, roomInfo: state?.roomInfo || {} };
  } catch (err) {
    connection = null;
    throw new Error(`TikTok connect failed: ${err.message}`);
  }
}

// ─── Disconnect ───────────────────────────────────────────────────────────────
async function disconnect() {
  if (!connection) return;
  try { connection.disconnect(); } catch (_) {}
  connection = null;
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
function emit(channel, data) {
  const win = getMainWindow?.();
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function emitStatus(connected, errorMsg = null) {
  emit('tiktok:status', { connected, channel: activeUser, error: errorMsg });
}

module.exports = { connect, disconnect };
