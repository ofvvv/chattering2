'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Emote Manager
   ─────────────────────────────────────────────────────────────────────────
   Loads and caches emotes from:
   - 7TV  (channel + global)
   - BTTV (channel + global)
   - FFZ  (channel + global)
   - Twitch native (resolved per-message in the connector)
   - TikTok (no public 3rd-party emote API; uses platform messages as-is)

   Cache structure:
     emoteCache[code] = { url, type: '7tv'|'bttv'|'ffz', animated: bool }
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Keyed by emote code (the text that appears in chat)
const emoteCache = {};

// Track which channels have already been loaded to avoid redundant fetches
const loadedChannels = new Set();

// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Load all 3rd-party emotes for a given platform + channel.
 * @param {'twitch'|'tiktok'|'youtube'} platform
 * @param {string} channelId - Twitch channel login, or arbitrary ID string
 * @returns {Object} serialisable slice of the cache (only new entries)
 */
async function loadForChannel(platform, channelId) {
  const cacheKey = `${platform}:${channelId}`;
  if (loadedChannels.has(cacheKey)) return getSerializableCache();
  loadedChannels.add(cacheKey);

  if (platform === 'twitch') {
    await Promise.allSettled([
      load7tvGlobal(),
      load7tvChannel(channelId),
      loadBttvGlobal(),
      loadBttvChannel(channelId),
      loadFfzGlobal(),
      loadFfzChannel(channelId)
    ]);
  } else if (platform === 'tiktok') {
    // TikTok: only 7TV global emotes (for fun, since many streamers use them)
    await Promise.allSettled([load7tvGlobal()]);
  } else if (platform === 'youtube') {
    await Promise.allSettled([load7tvGlobal(), loadBttvGlobal()]);
  }

  return getSerializableCache();
}

/**
 * Returns a plain object safe to send over IPC.
 */
function getSerializableCache() {
  return Object.fromEntries(
    Object.entries(emoteCache).map(([code, data]) => [code, { url: data.url, animated: data.animated }])
  );
}

// ─── 7TV ─────────────────────────────────────────────────────────────────────
async function load7tvGlobal() {
  try {
    const data = await fetchJson('https://7tv.io/v3/emote-sets/global');
    console.log('[Emotes] 7TV Global emotes:', data?.emotes?.length || 0);
    parseEmoteSet7tv(data?.emotes || []);
  } catch (e) {
    console.error('[Emotes] 7TV Global error:', e.message);
  }
}

async function load7tvChannel(channelLogin) {
  try {
    // 7TV uses Twitch user ID; try login→ID lookup via their API
    console.log('[Emotes] 7TV Channel loading for:', channelLogin);
    const data = await fetchJson(`https://7tv.io/v3/users/twitch/${channelLogin}`);
    console.log('[Emotes] 7TV Channel response:', data ? 'ok' : 'empty');
    const emotes = data?.emote_set?.emotes || [];
    console.log('[Emotes] 7TV Channel emotes:', emotes.length);
    parseEmoteSet7tv(emotes);
  } catch (e) {
    console.error('[Emotes] 7TV Channel error:', e.message);
  }
}

function parseEmoteSet7tv(emotes) {
  emotes.forEach(emote => {
    const code = emote.name;
    const files = emote.data?.host?.files || [];
    // Prefer webp, otherwise png; prefer animated
    const animated = emote.data?.animated || false;
    const format   = animated ? 'webp' : 'webp';
    const file     = files.find(f => f.name === `2x.${format}`) || files[0];
    if (!file) return;
    const url = `https:${emote.data?.host?.url}/${file.name}`;
    emoteCache[code] = { url, animated, type: '7tv' };
  });
}

// ─── BTTV ─────────────────────────────────────────────────────────────────────
async function loadBttvGlobal() {
  try {
    const data = await fetchJson('https://api.betterttv.net/3/cached/emotes/global');
    console.log('[Emotes] BTTV Global emotes:', data?.length || 0);
    parseBttvEmotes(data);
  } catch (e) {
    console.error('[Emotes] BTTV Global error:', e.message);
  }
}

async function loadBttvChannel(channelLogin) {
  try {
    // BTTV needs Twitch user ID; resolve it first
    console.log('[Emotes] BTTV Channel loading for:', channelLogin);
    const userData = await fetchJson(`https://api.betterttv.net/3/cached/users/twitch/${channelLogin}`);
    console.log('[Emotes] BTTV Channel response:', userData ? 'ok' : 'empty');
    parseBttvEmotes(userData?.channelEmotes || []);
    parseBttvEmotes(userData?.sharedEmotes || []);
  } catch (e) {
    console.error('[Emotes] BTTV Channel error:', e.message);
  }
}

function parseBttvEmotes(emotes) {
  if (!Array.isArray(emotes)) return;
  emotes.forEach(emote => {
    const code     = emote.code;
    const animated = emote.imageType === 'gif';
    const url      = `https://cdn.betterttv.net/emote/${emote.id}/2x.${emote.imageType}`;
    emoteCache[code] = { url, animated, type: 'bttv' };
  });
}

// ─── FFZ ─────────────────────────────────────────────────────────────────────
async function loadFfzGlobal() {
  try {
    const data = await fetchJson('https://api.frankerfacez.com/v1/set/global');
    console.log('[Emotes] FFZ Global sets:', Object.keys(data?.sets || {}).length);
    parseFfzSets(data?.sets || {});
  } catch (e) {
    console.error('[Emotes] FFZ Global error:', e.message);
  }
}

async function loadFfzChannel(channelLogin) {
  try {
    console.log('[Emotes] FFZ Channel loading for:', channelLogin);
    const data = await fetchJson(`https://api.frankerfacez.com/v1/room/${channelLogin}`);
    console.log('[Emotes] FFZ Channel response:', data?.room ? 'ok' : 'empty');
    const setId = data?.room?.set;
    if (setId && data?.sets?.[setId]) {
      parseFfzSets({ [setId]: data.sets[setId] });
    }
  } catch (e) {
    console.error('[Emotes] FFZ Channel error:', e.message);
  }
}

function parseFfzSets(sets) {
  Object.values(sets).forEach(set => {
    (set.emoticons || []).forEach(emote => {
      const code = emote.name;
      const urls = emote.urls || {};
      const url  = urls['2'] || urls['1'] || Object.values(urls)[0];
      if (!url) return;
      emoteCache[code] = { url: url.startsWith('//') ? `https:${url}` : url, animated: false, type: 'ffz' };
    });
  });
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Chattering/1.0' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

module.exports = { loadForChannel, getSerializableCache };
