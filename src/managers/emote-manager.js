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

// ─── In-memory cache (per platform) ─────────────────────────────────────────
// emoteCache[platform][code] = { url, type, animated }
const emoteCache = { twitch: {}, tiktok: {}, youtube: {} };

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
      load7tvGlobal('twitch'),
      load7tvChannel(channelId, 'twitch'),
      loadBttvGlobal('twitch'),
      loadBttvChannel(channelId, 'twitch'),
      loadFfzGlobal('twitch'),
      loadFfzChannel(channelId, 'twitch')
    ]);
  } else if (platform === 'tiktok') {
    await Promise.allSettled([load7tvGlobal('tiktok')]);
  } else if (platform === 'youtube') {
    await Promise.allSettled([load7tvGlobal('youtube'), loadBttvGlobal('youtube')]);
  }

  return getCacheForPlatform(platform);
}

/**
 * Returns the emote cache for a specific platform, safe to send over IPC.
 */
function getCacheForPlatform(platform) {
  const src = emoteCache[platform] || {};
  return Object.fromEntries(
    Object.entries(src).map(([code, data]) => [code, { url: data.url, animated: data.animated }])
  );
}

/**
 * @deprecated Returns merged cache of all platforms (kept for emotes:getCache IPC).
 */
function getSerializableCache() {
  const merged = {};
  for (const plat of Object.keys(emoteCache)) {
    for (const [code, data] of Object.entries(emoteCache[plat])) {
      merged[code] = { url: data.url, animated: data.animated };
    }
  }
  return merged;
}

// ─── 7TV ─────────────────────────────────────────────────────────────────────
async function load7tvGlobal(platform = 'twitch') {
  try {
    const data = await fetchJson('https://7tv.io/v3/emote-sets/global');
    console.log('[Emotes] 7TV Global emotes:', data?.emotes?.length || 0);
    parseEmoteSet7tv(data?.emotes || [], platform);
  } catch (e) {
    console.error('[Emotes] 7TV Global error:', e.message);
  }
}

async function load7tvChannel(channelLogin, platform = 'twitch') {
  // Note: 7TV API accepts both username and numeric user ID
  try {
    // 7TV uses Twitch user ID; try login→ID lookup via their API
    console.log('[Emotes] 7TV Channel loading for:', channelLogin, '(tipo:', typeof channelLogin, ')');
    
    // Add retry logic for transient errors
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await fetchJson(`https://7tv.io/v3/users/twitch/${channelLogin}`);
        console.log('[Emotes] 7TV Channel response:', data ? 'ok' : 'empty');
        const emotes = data?.emote_set?.emotes || [];
        console.log('[Emotes] 7TV Channel emotes:', emotes.length);
        parseEmoteSet7tv(emotes, platform);
        return; // Success, exit
      } catch (e) {
        lastError = e;
        // 404 = channel has no 7TV account — normal, don't retry, don't error-log
        if (e.message.includes('404')) { break; }
        if (e.message.includes('504') || e.message.includes('503') || e.message.includes('network') || e.message.includes('timeout')) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(r => setTimeout(r, delay));
        } else {
          break;
        }
      }
    }
    if (lastError && !lastError.message.includes('404')) {
      console.warn('[Emotes] 7TV Channel error:', lastError.message);
    } else if (lastError) {
      console.log('[Emotes] 7TV: channel', channelLogin, 'has no 7TV account (normal)');
    }
  } catch (e) {
    console.error('[Emotes] 7TV Channel error:', e.message);
  }
}

function parseEmoteSet7tv(emotes, platform = 'twitch') {
  if (!emoteCache[platform]) emoteCache[platform] = {};
  emotes.forEach(emote => {
    const code = emote.name;
    const files = emote.data?.host?.files || [];
    const animated = emote.data?.animated || false;
    const file     = files.find(f => f.name === '2x.webp') || files[0];
    if (!file) return;
    const url = `https:${emote.data?.host?.url}/${file.name}`;
    emoteCache[platform][code] = { url, animated, type: '7tv' };
  });
}

// ─── BTTV ─────────────────────────────────────────────────────────────────────
async function loadBttvGlobal(platform = 'twitch') {
  try {
    const data = await fetchJson('https://api.betterttv.net/3/cached/emotes/global');
    console.log('[Emotes] BTTV Global emotes:', data?.length || 0);
    parseBttvEmotes(data, platform);
  } catch (e) {
    console.error('[Emotes] BTTV Global error:', e.message);
  }
}

async function loadBttvChannel(channelLogin, platform = 'twitch') {
  try {
    // BTTV needs Twitch user ID; resolve it first
    console.log('[Emotes] BTTV Channel loading for:', channelLogin);
    const userData = await fetchJson(`https://api.betterttv.net/3/cached/users/twitch/${channelLogin}`);
    console.log('[Emotes] BTTV Channel response:', userData ? 'ok' : 'empty');
    parseBttvEmotes(userData?.channelEmotes || [], platform);
    parseBttvEmotes(userData?.sharedEmotes || [], platform);
  } catch (e) {
    if (!e.message.includes('404')) console.warn('[Emotes] BTTV Channel error:', e.message);
    else console.log('[Emotes] BTTV: channel', channelLogin, 'not found (normal)');
  }
}

function parseBttvEmotes(emotes, platform = 'twitch') {
  if (!Array.isArray(emotes)) return;
  if (!emoteCache[platform]) emoteCache[platform] = {};
  emotes.forEach(emote => {
    const code     = emote.code;
    const animated = emote.imageType === 'gif';
    const url      = `https://cdn.betterttv.net/emote/${emote.id}/2x.${emote.imageType}`;
    emoteCache[platform][code] = { url, animated, type: 'bttv' };
  });
}

// ─── FFZ ─────────────────────────────────────────────────────────────────────
async function loadFfzGlobal(platform = 'twitch') {
  try {
    const data = await fetchJson('https://api.frankerfacez.com/v1/set/global');
    console.log('[Emotes] FFZ Global sets:', Object.keys(data?.sets || {}).length);
    parseFfzSets(data?.sets || {}, platform);
  } catch (e) {
    console.error('[Emotes] FFZ Global error:', e.message);
  }
}

async function loadFfzChannel(channelLogin, platform = 'twitch') {
  try {
    console.log('[Emotes] FFZ Channel loading for:', channelLogin);
    const data = await fetchJson(`https://api.frankerfacez.com/v1/room/${channelLogin}`);
    console.log('[Emotes] FFZ Channel response:', data?.room ? 'ok' : 'empty');
    const setId = data?.room?.set;
    if (setId && data?.sets?.[setId]) {
      parseFfzSets({ [setId]: data.sets[setId] }, platform);
    }
  } catch (e) {
    console.error('[Emotes] FFZ Channel error:', e.message);
  }
}

function parseFfzSets(sets, platform = 'twitch') {
  if (!emoteCache[platform]) emoteCache[platform] = {};
  Object.values(sets).forEach(set => {
    (set.emoticons || []).forEach(emote => {
      const code = emote.name;
      const urls = emote.urls || {};
      const url  = urls['2'] || urls['1'] || Object.values(urls)[0];
      if (!url) return;
      emoteCache[platform][code] = { url: url.startsWith('//') ? `https:${url}` : url, animated: false, type: 'ffz' };
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

module.exports = { loadForChannel, getSerializableCache, getCacheForPlatform };