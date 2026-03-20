'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Twitch Connector
   ─────────────────────────────────────────────────────────────────────────
   Uses tmi.js for chat + Helix API for badges / user cards / moderation.
   Moderation actions (ban / timeout / unban / delete) use the tmi.js
   client directly — the bot must be a mod or the broadcaster.
   ═══════════════════════════════════════════════════════════════════════════ */

const tmi        = require('tmi.js');
const { broadcast } = require('../utils');

// ─── State ───────────────────────────────────────────────────────────────────
let client        = null;
let activeChannel = null;
let activeToken   = null;
let activeUserId  = null;
let getMainWindow = null;

const CLIENT_ID = 'w2q6ngvevmf1gkuu1ngiqwmyzqmjrt';

// ─── Connect ─────────────────────────────────────────────────────────────────
async function connect(channel, token, getWin) {
  if (client) await disconnect();

  getMainWindow = getWin;
  activeChannel = (channel || '').replace(/^#/, '').toLowerCase().trim();
  activeToken   = (token || '').replace(/^oauth:/, '');

  if (!activeChannel) throw new Error('Canal de Twitch requerido');

  // ── Resolve broadcaster user-id for badge / card fetches ─────────────────
  try {
    const headers = {
      'Authorization': `Bearer ${activeToken}`,
      'Client-Id':     CLIENT_ID
    };
    const res  = await globalThis.fetch(`https://api.twitch.tv/helix/users?login=${activeChannel}`, { headers });
    const data = await res.json();
    if (data.data?.[0]) activeUserId = data.data[0].id;
  } catch (_) {}

  // ── Load channel badges ──────────────────────────────────────────────────
  await loadBadges(activeUserId, activeToken);

  // ── Create tmi.js client ─────────────────────────────────────────────────
  const opts = {
    options: { debug: false, skipUpdatingEmotesets: true },
    connection: { secure: true, reconnect: true },
    channels: [`#${activeChannel}`]
  };

  if (activeToken) {
    opts.identity = { username: activeChannel, password: `oauth:${activeToken}` };
  }

  client = new tmi.Client(opts);

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

  client.on('connected', () => {
    console.log(`[Twitch] Conectado a #${activeChannel}`);
    broadcast('twitch:status', { connected: true, channel: activeChannel, userId: activeUserId });
  });
  client.on('disconnected', (reason) => {
    console.log(`[Twitch] Desconectado: ${reason}`);
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

// ─── Moderation ───────────────────────────────────────────────────────────────
// tmi.js handles these natively — the authed user must be broadcaster or mod.

async function ban(channel, user, reason = '') {
  if (!client) throw new Error('No conectado a Twitch');
  const ch = channel.startsWith('#') ? channel : `#${channel}`;
  await client.ban(ch, user, reason || undefined);
}

async function timeout(channel, user, seconds = 600, reason = '') {
  if (!client) throw new Error('No conectado a Twitch');
  const ch = channel.startsWith('#') ? channel : `#${channel}`;
  await client.timeout(ch, user, seconds, reason || undefined);
}

async function unban(channel, user) {
  if (!client) throw new Error('No conectado a Twitch');
  const ch = channel.startsWith('#') ? channel : `#${channel}`;
  await client.unban(ch, user);
}

async function deleteMessage(channel, msgId) {
  if (!client) throw new Error('No conectado a Twitch');
  const ch = channel.startsWith('#') ? channel : `#${channel}`;
  await client.deletemessage(ch, msgId);
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

module.exports = {
  connect, disconnect, ban, timeout, unban, deleteMessage, sendMessage, getUserCard
};