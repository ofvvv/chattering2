'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Twitch Connector
   ─────────────────────────────────────────────────────────────────────────
   ⚠️  DO NOT MODIFY THE CHAT/MESSAGE ENGINE ⚠️
       tmi.js connection, message reception, and sendMessage are working
       correctly. Changes to connect(), onMessage(), or sendMessage() will
       break chat. Only touch moderation, badges, or stream-status sections.

   Uses tmi.js for chat (IRC) + Helix API for badges, user cards
   and ALL moderation actions (ban/timeout/unban/delete).

   Moderation uses Helix, not tmi.js IRC commands, because IRC commands
   return "No response from Twitch" when the server doesn't send a NOTICE
   back — which happens unpredictably. Helix moderation is synchronous,
   returns proper HTTP errors, and doesn't require IRC confirmation.

   Required OAuth scopes for moderation:
     moderator:manage:banned_users  (ban / unban / timeout)
     moderator:manage:chat_messages (delete message)
   ═══════════════════════════════════════════════════════════════════════════ */

const tmi        = require('tmi.js');
const { broadcast } = require('../utils');

// ─── State ───────────────────────────────────────────────────────────────────
let client        = null;
let activeChannel = null;
let activeToken   = null;
let activeUserId  = null;
let authedUsername = null;   // login of the token holder — needed for tmi.js identity
let getMainWindow = null;

const CLIENT_ID = 'w2q6ngvevmf1gkuu1ngiqwmyzqmjrt';

// ─── Connect ─────────────────────────────────────────────────────────────────
async function connect(channel, token, getWin) {
  if (client) await disconnect();

  getMainWindow = getWin;
  activeChannel = (channel || '').replace(/^#/, '').toLowerCase().trim();
  activeToken   = (token || '').replace(/^oauth:/, '');

  if (!activeChannel) throw new Error('Canal de Twitch requerido');

  // ── Start tmi.js IMMEDIATELY — API calls run in parallel, never blocking IRC ─
  // For streamers on their own channel, activeChannel == their login, so identity
  // works right away without waiting for the Helix self-lookup.
  authedUsername = activeChannel; // best-guess until Helix resolves

  const opts = {
    options:    { debug: false, skipUpdatingEmotesets: true },
    connection: { secure: true, reconnect: true },
    channels:   [`#${activeChannel}`]
  };

  if (activeToken) {
    opts.identity = { username: activeChannel, password: `oauth:${activeToken}` };
  }

  client = new tmi.Client(opts);

  // ── Helix API calls — fire in background, do NOT block tmi.js ─────────────
  if (activeToken) {
    (async () => {
      try {
        const headers = { 'Authorization': `Bearer ${activeToken}`, 'Client-Id': CLIENT_ID };
        // Parallel: broadcaster ID + authed user + badges
        const [chanRes, selfRes] = await Promise.all([
          globalThis.fetch(`https://api.twitch.tv/helix/users?login=${activeChannel}`, { headers }),
          globalThis.fetch('https://api.twitch.tv/helix/users', { headers })
        ]);
        const [chanData, selfData] = await Promise.all([chanRes.json(), selfRes.json()]);
        if (chanData.data?.[0]) activeUserId = chanData.data[0].id;
        if (selfData.data?.[0]) {
          authedUsername = selfData.data[0].login;
          // Update identity if we're already connected
          console.log(`[Twitch] Authenticated as: ${authedUsername}`);
        }
        // Load badges now that we have the broadcaster ID
        loadBadges(activeUserId, activeToken); // intentionally not awaited
      } catch (err) {
        console.warn('[Twitch] Background Helix resolve failed:', err.message);
      }
    })();
  }

  // ── Events ───────────────────────────────────────────────────────────────
  client.on('message', onMessage);
  client.on('cheer', onCheer);
  client.on('subscription', onSub);
  client.on('resub', onResub);
  client.on('subgift', onSubGift);
  client.on('raided', onRaid);
  client.on('redemption', onRedemption);

  client.on('messagedeleted', (_ch, _username, _msg, tags) => {
    broadcast('twitch:messagedeleted', { id: tags['target-msg-id'] });
  });
  client.on('ban', (_ch, username) => {
    broadcast('twitch:ban', { username });
  });
  client.on('timeout', (_ch, username, _reason, duration) => {
    broadcast('twitch:timeout', { username, duration });
  });

  client.on('connected', async () => {
    console.log(`[Twitch] Conectado a #${activeChannel}`);
    await checkStreamLive();
    startStreamPoll();  // re-check every 2 min
  });
  client.on('disconnected', (reason) => {
    console.log(`[Twitch] Desconectado: ${reason}`);
    stopStreamPoll();
    broadcast('twitch:status', { connected: false, channel: activeChannel });
  });

  await client.connect();
  return { connected: true, channel: activeChannel, userId: activeUserId };
}

// ─── Disconnect ───────────────────────────────────────────────────────────────
async function disconnect() {
  if (client) {
    try { await client.disconnect(); } catch (_) {}
    client = null;
  }
  activeChannel = null;
  activeToken   = null;
  activeUserId  = null;
  broadcast('twitch:status', { connected: false, channel: null });
}

// ─── Message handler ──────────────────────────────────────────────────────────
function onMessage(channel, tags, message, self) {
  if (self) return;

  const isMod  = tags.mod  || tags['user-type'] === 'mod'  || tags.badges?.broadcaster;
  const isVip  = !!tags.badges?.vip;
  const isSub  = !!tags.subscriber;
  const isOwner = !!tags.badges?.broadcaster;

  // Build badge list from known badge sets
  const badges = buildBadgeObjects(tags.badges || {}, tags['badge-info'] || {});

  broadcast('twitch:message', {
    id:          tags.id || String(Date.now()),
    platform:    'twitch',
    username:    tags.username,
    displayName: tags['display-name'] || tags.username,
    color:       tags.color || null,
    message,
    badges,
    emotes:      tags.emotes || {},
    isAction:    tags['message-type'] === 'action',
    bits:        tags.bits ? parseInt(tags.bits) : 0,
    isMod:       !!isMod,
    isVip,
    isSub,
    isOwner
  });
}

// ─── Event handlers ───────────────────────────────────────────────────────────
function onCheer(channel, tags, message) {
  broadcast('twitch:event', {
    type:        'bits',
    platform:    'twitch',
    username:    tags.username,
    displayName: tags['display-name'] || tags.username,
    amount:      parseInt(tags.bits || 0),
    message
  });
}

function onSub(channel, username, method, message, tags) {
  broadcast('twitch:event', {
    type:        'sub',
    platform:    'twitch',
    username:    tags['display-name'] || username,
    displayName: tags['display-name'] || username,
    message
  });
}

function onResub(channel, username, months, message, tags) {
  broadcast('twitch:event', {
    type:        'resub',
    platform:    'twitch',
    username:    tags['display-name'] || username,
    displayName: tags['display-name'] || username,
    months,
    message
  });
}

function onSubGift(channel, username, streakMonths, recipient, methods, tags) {
  broadcast('twitch:event', {
    type:        'gift',
    platform:    'twitch',
    username:    tags['display-name'] || username,
    displayName: tags['display-name'] || username,
    amount:      1,
    message:     recipient
  });
}

function onRaid(channel, username, viewers) {
  broadcast('twitch:event', {
    type:        'raid',
    platform:    'twitch',
    username,
    displayName: username,
    amount:      viewers
  });
}

function onRedemption(channel, username, rewardType, tags, message) {
  broadcast('twitch:event', {
    type:        'redeem',
    platform:    'twitch',
    username:    tags['display-name'] || username,
    displayName: tags['display-name'] || username,
    giftName:    rewardType,
    message
  });
}

// ─── Moderation (Helix API — NOT tmi.js IRC) ─────────────────────────────────
// tmi.js IRC commands (/ban, /timeout) fail with "No response from Twitch"
// because the server doesn't always send a NOTICE confirmation back.
// The Helix REST API is synchronous and returns proper HTTP errors.

async function resolveUserId(userLogin) {
  if (!activeToken) throw new Error('No token disponible');
  const headers = { 'Authorization': `Bearer ${activeToken}`, 'Client-Id': CLIENT_ID };
  const res  = await globalThis.fetch(`https://api.twitch.tv/helix/users?login=${userLogin}`, { headers });
  const data = await res.json();
  const id   = data.data?.[0]?.id;
  if (!id) throw new Error(`Usuario "${userLogin}" no encontrado en Twitch`);
  return id;
}

async function helixMod(method, path, body = null) {
  if (!activeToken || !activeUserId) throw new Error('No autenticado como moderador');
  const headers = {
    'Authorization': `Bearer ${activeToken}`,
    'Client-Id':     CLIENT_ID,
    'Content-Type':  'application/json'
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await globalThis.fetch(`https://api.twitch.tv/helix/${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

async function ban(channel, user, reason = '') {
  const targetId = await resolveUserId(user);
  await helixMod('POST', `moderation/bans?broadcaster_id=${activeUserId}&moderator_id=${activeUserId}`, {
    data: { user_id: targetId, reason: reason || 'Moderación' }
  });
}

async function timeout(channel, user, seconds = 600, reason = '') {
  const targetId = await resolveUserId(user);
  await helixMod('POST', `moderation/bans?broadcaster_id=${activeUserId}&moderator_id=${activeUserId}`, {
    data: { user_id: targetId, duration: seconds, reason: reason || 'Moderación' }
  });
}

async function unban(channel, user) {
  const targetId = await resolveUserId(user);
  await helixMod('DELETE', `moderation/bans?broadcaster_id=${activeUserId}&moderator_id=${activeUserId}&user_id=${targetId}`);
}

async function deleteMessage(channel, msgId) {
  await helixMod('DELETE', `moderation/chat?broadcaster_id=${activeUserId}&moderator_id=${activeUserId}&message_id=${msgId}`);
}

async function sendMessage(channel, message) {
  if (!client) throw new Error('No conectado a Twitch');
  const ch = channel.startsWith('#') ? channel : `#${channel}`;
  await client.say(ch, message);
}

// ─── User card (Helix API) ────────────────────────────────────────────────────
async function getUserCard(channel, username) {
  if (!activeToken) return null;
  try {
    const headers = { 'Authorization': `Bearer ${activeToken}`, 'Client-Id': CLIENT_ID };
    // Follower info
    const [userRes, followerRes] = await Promise.all([
      globalThis.fetch(`https://api.twitch.tv/helix/users?login=${username}`, { headers }),
      globalThis.fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${activeUserId}&user_id=`, { headers })
    ]);
    const userData = await userRes.json();
    const user     = userData.data?.[0];
    if (!user) return null;

    const followerData = await globalThis.fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${activeUserId}&user_id=${user.id}`,
      { headers }
    ).then(r => r.json());

    return {
      avatarUrl:  user.profile_image_url || '',
      followedAt: followerData.data?.[0]?.followed_at || null,
      isSub:      false  // would need a sub check endpoint
    };
  } catch (err) {
    console.error('[Twitch] getUserCard error:', err.message);
    return null;
  }
}

// ─── Badge loading ────────────────────────────────────────────────────────────
const badgeCache = {};  // { setId: { versionId: url } }

async function loadBadges(channelId, token) {
  if (!token) return;
  try {
    const headers = { 'Authorization': `Bearer ${token}`, 'Client-Id': CLIENT_ID };
    const [globalRes, channelRes] = await Promise.all([
      globalThis.fetch('https://api.twitch.tv/helix/chat/badges/global', { headers }),
      channelId
        ? globalThis.fetch(`https://api.twitch.tv/helix/chat/badges?broadcaster_id=${channelId}`, { headers })
        : Promise.resolve({ json: async () => ({ data: [] }) })
    ]);
    const parse = ({ data }) => {
      (data || []).forEach(set => {
        badgeCache[set.set_id] = {};
        set.versions.forEach(v => {
          badgeCache[set.set_id][v.id] = v.image_url_1x;
        });
      });
    };
    parse(await globalRes.json());
    parse(await channelRes.json());
    console.log(`[Twitch] Badges loaded: ${Object.keys(badgeCache).length} sets`);
  } catch (err) {
    console.error('[Twitch] loadBadges error:', err.message);
  }
}

function buildBadgeObjects(badges, badgeInfo) {
  return Object.entries(badges).map(([setId, versionId]) => {
    const url   = badgeCache[setId]?.[versionId] || '';
    const title = setId === 'subscriber'
      ? `Sub ${badgeInfo.subscriber || versionId}`
      : setId.replace(/_/g, ' ');
    return { url, title };
  }).filter(b => b.url);
}

// ─── Periodic stream poll ────────────────────────────────────────────────────
let streamPollTimer = null;

function startStreamPoll() {
  stopStreamPoll();
  // Re-check every 2 minutes so status reflects reality after stream ends/starts
  streamPollTimer = setInterval(() => checkStreamLive(), 120_000);
}

function stopStreamPoll() {
  if (streamPollTimer) { clearInterval(streamPollTimer); streamPollTimer = null; }
}

// ─── Stream live check ───────────────────────────────────────────────────────
// Called right after tmi.js connects. Emits the real status (live vs offline).
async function checkStreamLive() {
  // Always emit at least a "connected, auth unknown" state immediately
  // so the UI responds even if the API call is slow
  broadcast('twitch:status', { connected: true, idle: true, channel: activeChannel, userId: activeUserId });

  if (!activeToken || !activeUserId) {
    // No token — can read chat but can't check stream status
    broadcast('twitch:status', { connected: true, idle: true, channel: activeChannel, userId: activeUserId });
    return;
  }
  try {
    const headers = { 'Authorization': `Bearer ${activeToken}`, 'Client-Id': CLIENT_ID };
    const res  = await globalThis.fetch(
      `https://api.twitch.tv/helix/streams?user_id=${activeUserId}`, { headers }
    );
    const data = await res.json();
    const isLive = Array.isArray(data.data) && data.data.length > 0;
    console.log(`[Twitch] #${activeChannel} live check: ${isLive ? 'EN VIVO' : 'offline'}`);
    broadcast('twitch:status', {
      connected: true,
      idle:      !isLive,
      channel:   activeChannel,
      userId:    activeUserId
    });
  } catch (err) {
    console.warn('[Twitch] checkStreamLive error:', err.message);
    // On error just show as connected without live info
    broadcast('twitch:status', { connected: true, idle: true, channel: activeChannel, userId: activeUserId });
  }
}

module.exports = {
  connect, disconnect, ban, timeout, unban, deleteMessage, sendMessage, getUserCard
};