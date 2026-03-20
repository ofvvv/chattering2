'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Twitch Connector
   ─────────────────────────────────────────────────────────────────────────
   Uses tmi.js for IRC chat + Helix API for user cards & moderation.
   Emits events to the main BrowserWindow via webContents.send().
   ═══════════════════════════════════════════════════════════════════════════ */

const tmi = require('tmi.js');
const SettingsManager = require('../managers/settings-manager');
const { broadcast } = require('../utils');

// ─── State ───────────────────────────────────────────────────────────────────
let client      = null;
let activeChannel = null;
let getMainWindow = null;
let oauthToken    = null;
let userId        = null;   // broadcaster's Twitch user ID

// ─── Badge cache (loaded once per channel) ──────────────────────────────────
const badgeCache = {};

// ─── Connect ─────────────────────────────────────────────────────────────────
async function connect(channel, token, getWin) {
  if (client) {
    await disconnect();
  }
  getMainWindow = getWin;
  activeChannel = channel.toLowerCase();
  oauthToken    = token || SettingsManager.get().twitchToken || null;

  // Use default clientId if not set in settings
  const defaultClientId = 'w2q6ngvevmf1gkuu1ngiqwmyzqmjrt';
  const clientId = SettingsManager.get().twitchClientId || defaultClientId;

  // Clean token
  const cleanToken = oauthToken
    ? oauthToken.startsWith('oauth:') ? oauthToken : `oauth:${oauthToken}`
    : undefined;

  // Try to resolve the broadcaster user ID for API calls
  if (clientId && cleanToken) {
    try {
      const info = await helixGet(`https://api.twitch.tv/helix/users?login=${activeChannel}`,
        cleanToken.replace('oauth:', ''), clientId);
      if (info?.data?.[0]) userId = info.data[0].id;
    } catch (_) { /* non-critical */ }
  }

  // Load badges
  await loadBadges(activeChannel, cleanToken?.replace('oauth:', ''), clientId);

  // Build tmi client
  const opts = {
    options: { debug: false },  // Disable tmi.js debug
    connection: { reconnect: true, secure: true },
    channels: [activeChannel]
  };

  if (cleanToken) {
    opts.identity = {
      username: activeChannel,
      password: cleanToken
    };
  }

  client = new tmi.Client(opts);

  client.on('message',     onMessage);
  client.on('cheer',       onCheer);
  client.on('sub',         onSub);
  client.on('resub',       onResub);
  client.on('subgift',     onSubgift);
  client.on('raided',      onRaid);
  client.on('ban',         onBan);
  client.on('timeout',     onTimeout);
  client.on('messagedeleted', onMessageDeleted);
  client.on('connected',   () => emitStatus(true));
  client.on('disconnected',() => emitStatus(false));

  try {
    await client.connect();
    return { connected: true, userId };
  } catch (err) {
    console.error('[Twitch Connector] Error al conectar:', err.message);
    return { connected: false, error: err.message };
  }
}

// ─── Disconnect ───────────────────────────────────────────────────────────────
async function disconnect() {
  if (!client) return;
  try { await client.disconnect(); } catch (_) {}
  client = null;
  activeChannel = null;
  emitStatus(false);
}

// ─── Message handler ──────────────────────────────────────────────────────────
function onMessage(channel, userstate, message, self) {
  // Message handling

  const isAction = message.startsWith('\u0001ACTION ');
  const cleanMsg = isAction ? message.slice(8, -1) : message;
  // Message logged below
  const resolved = resolveBadges(userstate['badges'] || {});

  emit('twitch:message', {
    id:          userstate.id,
    platform:    'twitch',
    username:    userstate.username,
    displayName: userstate['display-name'] || userstate.username,
    color:       userstate.color || '#9147ff',
    message:     cleanMsg,
    isAction,
    emotes:      userstate.emotes || {},
    badges:      resolved,
    bits:        userstate.bits ? parseInt(userstate.bits) : 0,
    highlighted: userstate['msg-id'] === 'highlighted-message'
  });
}

// ─── Cheer ────────────────────────────────────────────────────────────────────
function onCheer(channel, userstate, message) {
  emit('twitch:event', {
    type:        'bits',
    platform:    'twitch',
    username:    userstate.username,
    displayName: userstate['display-name'] || userstate.username,
    amount:      userstate.bits || 0,
    message
  });
}

// ─── Sub / resub / gift ───────────────────────────────────────────────────────
function onSub(channel, username, method, message, userstate) {
  emit('twitch:event', {
    type: 'sub', platform: 'twitch', username,
    displayName: userstate['display-name'] || username, message
  });
}

function onResub(channel, username, months, message, userstate) {
  emit('twitch:event', {
    type: 'resub', platform: 'twitch', username,
    displayName: userstate['display-name'] || username, months, message
  });
}

function onSubgift(channel, username, streakMonths, recipient, methods, userstate) {
  emit('twitch:event', {
    type: 'gift', platform: 'twitch', username,
    displayName: userstate['display-name'] || username, amount: 1
  });
}

// ─── Raid ─────────────────────────────────────────────────────────────────────
function onRaid(channel, username, viewers) {
  emit('twitch:event', {
    type: 'raid', platform: 'twitch', username,
    displayName: username, amount: viewers
  });
}

// ─── Moderation events ────────────────────────────────────────────────────────
function onBan(channel, username) {
  emit('twitch:event', { type: 'ban', platform: 'twitch', username });
}

function onTimeout(channel, username, reason, duration) {
  emit('twitch:event', { type: 'timeout', platform: 'twitch', username, amount: duration });
}

function onMessageDeleted(channel, username, deletedMessage, userstate) {
  emit('twitch:message-deleted', { id: userstate['target-msg-id'], username });
}

// ─── Moderation actions ───────────────────────────────────────────────────────
async function ban(channel, username, reason = '') {
  if (!client) throw new Error('No conectado a Twitch');
  await client.ban(channel, username, reason);
}

async function timeout(channel, username, seconds = 600, reason = '') {
  if (!client) throw new Error('No conectado a Twitch');
  await client.timeout(channel, username, seconds, reason);
}

async function unban(channel, username) {
  if (!client) throw new Error('No conectado a Twitch');
  await client.unban(channel, username);
}

async function deleteMessage(channel, msgId) {
  if (!client) throw new Error('No conectado a Twitch');
  await client.deletemessage(channel, msgId);
}

async function sendMessage(channel, message) {
  if (!client) throw new Error('No conectado a Twitch');
  await client.say(channel, message);
}

// ─── User card (Helix API) ───────────────────────────────────────────────────
async function getUserCard(channel, username) {
  const settings = SettingsManager.get();
  const token    = (oauthToken || settings.twitchToken || '').replace('oauth:', '');
  const clientId = settings.twitchClientId || '';
  if (!token || !clientId) return null;

  try {
    const [userRes, followRes] = await Promise.all([
      helixGet(`https://api.twitch.tv/helix/users?login=${username}`, token, clientId),
      userId
        ? helixGet(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${userId}&user_id=_placeholder_`, token, clientId).catch(() => null)
        : null
    ]);

    const user = userRes?.data?.[0];
    if (!user) return null;

    // Check follow
    const followInfo = userId
      ? await helixGet(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${userId}&user_login=${username}`, token, clientId).catch(() => null)
      : null;

    return {
      username:    user.login,
      displayName: user.display_name,
      avatarUrl:   user.profile_image_url,
      isSub:       false,  // sub check requires separate scope
      followedAt:  followInfo?.data?.[0]?.followed_at || null
    };
  } catch (e) {
    console.error('[Twitch] getUserCard error:', e.message);
    return null;
  }
}

// ─── Badge loading ────────────────────────────────────────────────────────────
async function loadBadges(channel, token, clientId) {
  if (!token || !clientId) {
    return;
  }

  try {
    const [globalRes, channelRes] = await Promise.all([
      helixGet('https://api.twitch.tv/helix/chat/badges/global', token, clientId),
      userId
        ? helixGet(`https://api.twitch.tv/helix/chat/badges?broadcaster_id=${userId}`, token, clientId)
        : null
    ]);

    console.log('[Twitch] Badges global:', globalRes?.data?.length || 0);
    console.log('[Twitch] Badges channel:', channelRes?.data?.length || 0);

    const allSets = [...(globalRes?.data || []), ...(channelRes?.data || [])];
    allSets.forEach(set => {
      badgeCache[set.set_id] = {};
      set.versions.forEach(v => {
        badgeCache[set.set_id][v.id] = {
          url:   v.image_url_1x,
          title: v.title || set.set_id
        };
      });
    });
  } catch (err) {
    console.error('[Twitch] Error cargando badges:', err.message);
  }
}

function resolveBadges(rawBadges) {
  return Object.entries(rawBadges).map(([setId, version]) => {
    const versionData = badgeCache[setId]?.[version];
    return { id: `${setId}/${version}`, url: versionData?.url || '', title: versionData?.title || setId };
  });
}

// ─── Helix API helper ─────────────────────────────────────────────────────────
async function helixGet(url, token, clientId) {
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Client-Id': clientId
    }
  });
  if (!res.ok) throw new Error(`Helix ${res.status}: ${url}`);
  return res.json();
}

// ─── Emitters ─────────────────────────────────────────────────────────────────
// Using shared broadcast utility from src/utils
function emit(channel, data) {
  broadcast(channel, data);
}

function emitStatus(connected) {
  emit('twitch:status', { connected, channel: activeChannel });
}

module.exports = { connect, disconnect, ban, timeout, unban, deleteMessage, sendMessage, getUserCard };
