'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – TikTok Connector
   ─────────────────────────────────────────────────────────────────────────
   Auth: sessionId only (value of 'sessionid' cookie).
   Username: the creator's @handle whose live to connect to.
   ═══════════════════════════════════════════════════════════════════════════ */

const { WebcastPushConnection } = require('tiktok-live-connector');
const { broadcast }             = require('../utils');

let connection        = null;
let activeUser        = null;
let activeSessionId   = null;
let getMainWindow     = null;
let reconnectTimer    = null;
let reconnectAttempts = 0;

function setCookies(cookies) {
  if (!cookies) return;
  const sid = cookies.sessionid || cookies.sessionid_ss || null;
  if (sid) { activeSessionId = sid; console.log('[TikTok] sessionId updated'); }
}

async function connect(username, getWin, sessionId = null) {
  if (connection) await disconnect();
  getMainWindow     = getWin;
  activeUser        = (username || '').replace(/^@/, '').trim();
  activeSessionId   = sessionId || activeSessionId;
  reconnectAttempts = 0;
  if (!activeUser) throw new Error('TikTok: username requerido');

  const opts = {
    processInitialData:       true,
    enableExtendedGiftInfo:   true,
    enableWebsocketUpgrade:   true,
    requestPollingIntervalMs: 2000,
    reconnectEnabled:         false,  // we handle reconnects ourselves
    clientParams: {
      app_language:    'en-US',
      device_platform: 'web',
      os:              'windows'
    }
  };
  if (activeSessionId) {
    opts.sessionId = activeSessionId;
    console.log('[TikTok] Using sessionId auth');
  }

  connection = new WebcastPushConnection(activeUser, opts);

  connection.on('chat',      onChat);
  connection.on('gift',      onGift);
  connection.on('like',      onLike);
  connection.on('follow',    onFollow);
  connection.on('share',     onShare);
  connection.on('subscribe', onSubscribe);
  connection.on('streamEnd', onStreamEnd);
  connection.on('member',    onMember);
  // Raw websocket msg count for debugging
  connection.on('rawData', (msgType) => {
    if (msgType === 'WebcastChatMessage') console.log('[TikTok] 💬 raw chat packet received');
  });

  connection.on('connected', () => {
    console.log(`[TikTok] Connected to @${activeUser}`);
    emitStatus(true);
    reconnectAttempts = 0;
  });
  connection.on('disconnected', () => {
    console.log(`[TikTok] Disconnected`);
    emitStatus(false);
    scheduleReconnect();
  });
  connection.on('error', (err) => {
    const msg = err?.message || String(err);
    console.error('[TikTok] Error:', msg);
    const isOffline = msg.includes('LIVE has ended') || msg.includes('offline') ||
      msg.includes('not found') || msg.includes('19881007') ||
      msg.includes('user_not_found') || msg.includes('LiveRoomNotFound');
    if (isOffline) {
      emitStatus(false, 'Stream offline', true);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (activeUser) connect(activeUser, getMainWindow, activeSessionId);
      }, 60000);
    } else {
      const userMsg = (msg.includes('not_authenticated') || msg.includes('unauthenticated'))
        ? 'Sesión expirada. Vuelve a iniciar sesión en TikTok.' : msg;
      emitStatus(false, userMsg);
      scheduleReconnect();
    }
  });

  try {
    console.log(`[TikTok] Connecting to @${activeUser}...`);
    const state = await connection.connect();
    console.log(`[TikTok] Room:`, state?.roomInfo?.title || '(no title)');
    return { connected: true, roomInfo: state?.roomInfo || {} };
  } catch (err) {
    connection = null;
    let errorMsg = err.message;
    const isOfflineErr = errorMsg.includes('19881007') || errorMsg.includes('user_not_found') ||
      errorMsg.includes('LiveRoomNotFound') || errorMsg.includes('not found');
    if (isOfflineErr) {
      errorMsg = `@${activeUser} no está en vivo actualmente.`;
      emitStatus(false, errorMsg, true);
    } else {
      emitStatus(false, errorMsg);
    }
    throw new Error(`TikTok: ${errorMsg}`);
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (!activeUser) return;
  reconnectAttempts++;
  const delay = Math.min(2000 * Math.pow(2, reconnectAttempts - 1), 60000);
  reconnectTimer = setTimeout(() => {
    if (activeUser) connect(activeUser, getMainWindow, activeSessionId);
  }, delay);
}

async function disconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempts = 0;
  if (connection) { try { connection.disconnect(); } catch(_){} connection = null; }
  activeUser = null; activeSessionId = null;
  emitStatus(false);
}

function onChat(data) {
  const msg = data.comment || '';
  if (!msg) return;
  broadcast('tiktok:message', {
    id: data.msgId || String(Date.now()), platform: 'tiktok',
    username: data.uniqueId || 'usuario',
    displayName: data.nickname || data.uniqueId || 'usuario',
    color: '#ff0050', message: msg,
    badges: buildBadges(data), emotes: {},
    avatarUrl: data.profilePictureUrl || '',
    isMod: false, isVip: false, isSub: data.isSubscriber || false
  });
}
function onGift(data) {
  if (data.giftType === 1 && !data.repeatEnd) return;
  broadcast('tiktok:event', {
    type: 'gift', platform: 'tiktok',
    username:    data.uniqueId,
    displayName: data.nickname || data.uniqueId,
    amount:      data.repeatCount || 1,
    giftName:    data.giftName || '',
    message:     data.giftName || '',  // used as label
    giftImg:     data.giftPictureUrl
  });
}
function onLike(data) {
  // likeCount = likes in this batch; totalLikeCount = stream total
  const amount = data.likeCount || data.totalLikeCount || 1;
  broadcast('tiktok:event', { type:'like', platform:'tiktok',
    username: data.uniqueId, displayName: data.nickname || data.uniqueId, amount });
}
function onFollow(data) {
  broadcast('tiktok:event', { type:'follow', platform:'tiktok',
    username: data.uniqueId, displayName: data.nickname || data.uniqueId });
}
function onShare(data) {
  broadcast('tiktok:event', { type:'share', platform:'tiktok',
    username: data.uniqueId, displayName: data.nickname || data.uniqueId });
}
function onSubscribe(data) {
  broadcast('tiktok:event', { type:'sub', platform:'tiktok',
    username: data.uniqueId, displayName: data.nickname || data.uniqueId });
}
function onMember(_data) {
  // "member" = user entered the stream — not actionable, ignore
}
function onStreamEnd() {
  emitStatus(false, 'Stream terminado', true);
  broadcast('tiktok:event', { type:'streamEnd', platform:'tiktok',
    username: activeUser, displayName: activeUser });
  scheduleReconnect();
}
function buildBadges(data) {
  return (data.userBadges || [])
    .filter(b => b.displayType === 1 && b.url?.length > 0)
    .map(b => ({ url: b.url, title: b.name || 'badge' }));
}
function emitStatus(connected, errorMsg = null, idle = false) {
  broadcast('tiktok:status', { connected, idle, channel: activeUser, error: errorMsg });
}

module.exports = { connect, disconnect, setCookies };