'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – YouTube Live Chat Connector
   ─────────────────────────────────────────────────────────────────────────
   Strategy (no API key required):
   1. Fetch the channel's /live page via HTTPS (scrape initial data).
   2. Extract the liveChatRenderer continuation token from ytInitialData.
   3. Poll /youtubei/v1/live_chat/get_live_chat with the continuation token.
   All requests mimic a regular browser to avoid 403s.
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────────────────────────
let pollTimer     = null;
let continuation  = null;
let activeChannel = null;
let getMainWindow = null;
let isRunning     = false;

const POLL_INTERVAL_MS = 5000;
const YT_BASE = 'https://www.youtube.com';

// ─── Connect ─────────────────────────────────────────────────────────────────
async function connect(channelHandle, getWin) {
  if (isRunning) await disconnect();
  getMainWindow = getWin;
  activeChannel = channelHandle;
  isRunning = true;

  emitStatus(false, 'Buscando stream activo…');

  try {
    continuation = await findLiveChatContinuation(channelHandle);
    if (!continuation) throw new Error('No se encontró ningún live activo en este canal.');

    emitStatus(true);
    schedulePoll();
    return { connected: true };
  } catch (err) {
    isRunning = false;
    throw err;
  }
}

// ─── Disconnect ───────────────────────────────────────────────────────────────
async function disconnect() {
  isRunning = false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  continuation  = null;
  activeChannel = null;
  emitStatus(false);
}

// ─── Find the live chat continuation token ────────────────────────────────────
async function findLiveChatContinuation(channelHandle) {
  // Normalise: could be @handle, channel/UC..., or a full URL
  let url;
  if (channelHandle.startsWith('http')) {
    url = channelHandle;
  } else if (channelHandle.startsWith('UC') || channelHandle.startsWith('HC')) {
    url = `${YT_BASE}/channel/${channelHandle}/live`;
  } else {
    const handle = channelHandle.startsWith('@') ? channelHandle : `@${channelHandle}`;
    url = `${YT_BASE}/${handle}/live`;
  }

  const html = await fetchPage(url);
  if (!html) return null;

  return extractContinuation(html);
}

// ─── Extract continuation from page HTML ──────────────────────────────────────
function extractContinuation(html) {
  // ytInitialData is a large JSON blob embedded in the page
  const marker = 'ytInitialData = ';
  const start  = html.indexOf(marker);
  if (start === -1) return null;

  let depth = 0;
  let i = start + marker.length;
  const jsonStart = i;

  // Walk to find matching closing brace
  while (i < html.length) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
    i++;
  }

  try {
    const raw = html.slice(jsonStart, i + 1);
    const data = JSON.parse(raw);

    // Navigate to liveChatRenderer continuationData
    const contents = data?.contents?.twoColumnWatchNextResults
      ?.conversationBar?.liveChatRenderer?.continuations;

    if (contents?.length) {
      return contents[0]?.invalidationContinuationData?.continuation
        || contents[0]?.timedContinuationData?.continuation
        || contents[0]?.liveChatReplayContinuationData?.continuation
        || null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// ─── Poll live chat ───────────────────────────────────────────────────────────
function schedulePoll() {
  if (!isRunning) return;
  pollTimer = setTimeout(pollLiveChat, POLL_INTERVAL_MS);
}

async function pollLiveChat() {
  if (!isRunning || !continuation) return;

  try {
    const body = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20231219.04.00'
        }
      },
      continuation
    };

    const res = await fetch(`${YT_BASE}/youtubei/v1/live_chat/get_live_chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Origin': YT_BASE,
        'Referer': YT_BASE
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`YouTube poll HTTP ${res.status}`);

    const data = await res.json();
    processLiveChatResponse(data);
  } catch (err) {
    console.error('[YouTube] poll error:', err.message);
    // Keep trying unless user disconnected
  }

  schedulePoll();
}

// ─── Process response ─────────────────────────────────────────────────────────
function processLiveChatResponse(data) {
  const cont = data?.continuationContents?.liveChatContinuation;
  if (!cont) return;

  // Update continuation token
  const newCont = cont?.continuations?.[0]?.invalidationContinuationData?.continuation
    || cont?.continuations?.[0]?.timedContinuationData?.continuation;
  if (newCont) continuation = newCont;

  const actions = cont?.actions || [];
  actions.forEach(action => {
    const item = action?.addChatItemAction?.item;
    if (!item) return;

    if (item.liveChatTextMessageRenderer) {
      parseChatMessage(item.liveChatTextMessageRenderer);
    } else if (item.liveChatPaidMessageRenderer) {
      parseSuperChat(item.liveChatPaidMessageRenderer);
    } else if (item.liveChatMembershipItemRenderer) {
      parseMembership(item.liveChatMembershipItemRenderer);
    }
  });
}

// ─── Parsers ──────────────────────────────────────────────────────────────────
function parseChatMessage(r) {
  const username    = r.authorName?.simpleText || 'usuario';
  const displayName = r.authorName?.simpleText || 'usuario';
  const message     = runsToText(r.message?.runs || []);
  const avatarUrl   = r.authorPhoto?.thumbnails?.[0]?.url || '';
  const badges      = parseBadges(r.authorBadges || []);

  emit('youtube:message', {
    id: r.id,
    platform:    'youtube',
    username,
    displayName: `@${displayName}`,
    color:       '#ff0000',
    message,
    badges,
    emotes:      {},
    avatarUrl
  });
}

function parseSuperChat(r) {
  const username    = r.authorName?.simpleText || 'usuario';
  const displayName = r.authorName?.simpleText || 'usuario';
  const amount      = r.purchaseAmountText?.simpleText || '';
  const message     = runsToText(r.message?.runs || []);

  emit('youtube:message', {
    id: r.id,
    platform:    'youtube',
    username,
    displayName: `@${displayName}`,
    color:       '#ffd600',
    message,
    badges:      [],
    emotes:      {},
    highlighted: true
  });

  emit('youtube:event', {
    type: 'superchat', platform: 'youtube',
    username, displayName: `@${displayName}`,
    amount, message
  });
}

function parseMembership(r) {
  const username = r.authorName?.simpleText || 'usuario';
  emit('youtube:event', {
    type: 'member', platform: 'youtube',
    username, displayName: `@${username}`
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function runsToText(runs) {
  return runs.map(r => r.text || r.emoji?.shortcuts?.[0] || '').join('');
}

function parseBadges(rawBadges) {
  return rawBadges.map(b => {
    const icon = b.liveChatAuthorBadgeRenderer;
    return {
      url:   icon?.customThumbnail?.thumbnails?.[0]?.url || '',
      title: icon?.tooltip || 'badge'
    };
  }).filter(b => b.url);
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!res.ok) return null;
    return res.text();
  } catch (_) {
    return null;
  }
}

// ─── Emitters ─────────────────────────────────────────────────────────────────
function emit(channel, data) {
  const win = getMainWindow?.();
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function emitStatus(connected, msg = null) {
  emit('youtube:status', { connected, channel: activeChannel, message: msg });
}

module.exports = { connect, disconnect };
