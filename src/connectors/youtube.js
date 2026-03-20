'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – YouTube Live Chat Connector
   ─────────────────────────────────────────────────────────────────────────
   ⚠️  DO NOT MODIFY THE CHAT/MESSAGE ENGINE ⚠️
       getLiveVideoIdFromRenderer, getLiveVideoIdFromNode, connect(),
       and the chat.on('chat') handler are working correctly.
       Only touch emitStatus, error handling, or event types.

   Uses youtube-chat library to connect to YouTube Live streams.
   Handles both @handles and channel IDs.

   Fix log:
   - getLiveVideoIdFromRenderer was called but never defined → added
   - resolveChannelIdViaRenderer had a broken closure (resolve/reject
     referenced inside renderer JS string, out of scope) → removed
   - Node.js fallback used `https` module (causes DNS errors in packaged
     builds) → replaced with globalThis.fetch (native in Electron/Node 18+)
   - chat.on('error') was registered twice → deduplicated
   ═══════════════════════════════════════════════════════════════════════════ */

const { LiveChat } = require('youtube-chat');
const { broadcast } = require('../utils');

// ─── State ───────────────────────────────────────────────────────────────────
let chat         = null;
let activeChannel = null;
let getMainWindow = null;
let isRunning    = false;

// ─── Get live video ID via Chromium renderer ──────────────────────────────────
// Runs a fetch() inside the Electron renderer context.
// This is more reliable than Node.js fetch in packaged builds because
// Chromium handles DNS and TLS independently of Node.
async function getLiveVideoIdFromRenderer(handle) {
  if (!getMainWindow || !getMainWindow()) throw new Error('No hay ventana principal');

  // NOTE: template literal below is intentional — handle is sanitised above.
  const result = await getMainWindow().webContents.executeJavaScript(`
    (async () => {
      try {
        const res = await fetch('https://www.youtube.com/@${handle}/live', {
          headers: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        const html = await res.text();
        const patterns = [
          /"videoId":"([a-zA-Z0-9_-]{11})"/,
          /watch\\?v=([a-zA-Z0-9_-]{11})/,
          /\\/live\\/([a-zA-Z0-9_-]{11})/
        ];
        for (const p of patterns) {
          const m = html.match(p);
          if (m && m[1]) return m[1];
        }
        return null;
      } catch (e) {
        return null;
      }
    })()
  `);

  if (!result) throw new Error('No live stream encontrado para este canal');
  return result;
}

// ─── Get live video ID via Node.js (fallback) ─────────────────────────────────
// Uses globalThis.fetch (native in Node 18+ / Electron 28+) to avoid the
// getaddrinfo ENOTFOUND DNS errors that the `https` module causes in packaged builds.
async function getLiveVideoIdFromNode(handle) {
  console.log(`[YouTube] Fallback Node fetch: @${handle}/live`);

  const res = await globalThis.fetch(`https://www.youtube.com/@${handle}/live`, {
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  const html = await res.text();
  console.log(`[YouTube] HTML recibido, tamaño: ${html.length} bytes`);

  const patterns = [
    /"videoId":"([a-zA-Z0-9_-]{11})"/,
    /watch\?v=([a-zA-Z0-9_-]{11})/,
    /\/live\/([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m && m[1]) return m[1];
  }

  throw new Error('Video ID no encontrado. ¿Está el canal transmitiendo en vivo?');
}

// ─── Connect ──────────────────────────────────────────────────────────────────
async function connect(channelHandle, getWin) {
  if (isRunning) await disconnect();

  getMainWindow  = getWin;
  activeChannel  = channelHandle.replace(/^@/, '').trim();
  isRunning      = true;

  emitStatus(false, 'Conectando a YouTube…');

  try {
    console.log(`[YouTube] Conectando a: @${activeChannel}`);

    // ── Step 1: resolve live video ID ────────────────────────────────────────
    let videoId = null;
    try {
      videoId = await getLiveVideoIdFromRenderer(activeChannel);
      console.log(`[YouTube] ✅ Video ID via renderer: ${videoId}`);
    } catch (err) {
      console.warn(`[YouTube] ⚠️ Renderer falló (${err.message}), intentando Node.js…`);
      try {
        videoId = await getLiveVideoIdFromNode(activeChannel);
        console.log(`[YouTube] ✅ Video ID via Node: ${videoId}`);
      } catch (err2) {
        throw new Error(`No se pudo obtener el live. ¿El canal está en vivo? (${err2.message})`);
      }
    }

    // ── Step 2: start youtube-chat with the resolved videoId ─────────────────
    chat = new LiveChat({ liveId: videoId });
    console.log(`[YouTube] LiveChat creado con liveId: ${videoId}`);

    // ── Handlers (registered once, here) ─────────────────────────────────────
    chat.on('start', (liveId) => {
      console.log(`[YouTube] ✅ Chat iniciado, videoId: ${liveId}`);
      emitStatus(true, activeChannel);
    });

    chat.on('chat', (chatItem) => {
      const author   = chatItem.author || {};
      const username = author.name || 'Unknown';

      // Extract plain text and build a shortcode→url map for YouTube custom emoji
      let plainText = '';
      const ytEmoteMap = {};
      if (Array.isArray(chatItem.message)) {
        chatItem.message.forEach(part => {
          if (part.text) {
            plainText += part.text;
          } else if (part.emojiText) {
            // `:shortcode:` token already stripped of colons by the library
            const code = part.emojiText.replace(/^:|:$/g, '');
            plainText += `:${code}:`;
            if (part.url) ytEmoteMap[code] = part.url;
          }
        });
      } else {
        plainText = String(chatItem.message || '');
      }

      if (!plainText.trim()) return;

      emit('youtube:message', {
        id:          chatItem.id || String(Date.now()),
        platform:    'youtube',
        username,
        displayName: username,
        color:       '#ff0000',
        message:     plainText,
        ytEmoteMap,
        badges:      [],
        emotes:      {},
        avatarUrl:   author.thumbnail?.url || '',
        isMember:    author.isMember    || false,
        isModerator: author.isModerator || false,
        isOwner:     author.isOwner     || false
      });
    });

    chat.on('superChat', (sc) => {
      emit('youtube:event', {
        type:        'superchat',
        platform:    'youtube',
        username:    sc.author?.name || 'Unknown',
        displayName: sc.author?.name || 'Unknown',
        amount:      sc.amount   || '',
        currency:    sc.currency || '',
        message:     sc.message  || ''
      });
    });

    chat.on('membership', (m) => {
      emit('youtube:event', {
        type:        'member',
        platform:    'youtube',
        username:    m.author?.name || 'Unknown',
        displayName: m.author?.name || 'Unknown',
        message:     m.message || 'se unió como miembro'
      });
    });

    chat.on('error', (err) => {
      const msg = err?.message || String(err);
      console.error('[YouTube] Error:', msg);
      if (msg.includes('Live Stream was not found') || msg.includes('No live')) {
        emitStatus(false, 'No hay live activo en este canal', true);  // idle=true
      } else if (msg.includes('not found')) {
        emitStatus(false, 'Canal no encontrado');
      } else {
        emitStatus(false, 'Error: ' + msg);
      }
    });

    chat.on('end', () => {
      console.log('[YouTube] Stream terminado');
      isRunning = false;
      emitStatus(false, 'Stream terminado', true);  // idle=true: channel exists, just not live
    });

    // ── Step 3: start polling ─────────────────────────────────────────────────
    const started = await chat.start();
    if (!started) throw new Error('chat.start() devolvió false — el stream puede no estar activo');

    console.log(`[YouTube] ✅ Conectado a @${activeChannel}`);
    return { connected: true, channel: activeChannel };

  } catch (err) {
    isRunning = false;
    chat      = null;
    console.error('[YouTube] Conexión fallida:', err.message);
    emitStatus(false, err.message);
    throw new Error(`YouTube connect failed: ${err.message}`);
  }
}

// ─── Disconnect ───────────────────────────────────────────────────────────────
async function disconnect() {
  isRunning = false;
  if (chat) {
    try { chat.stop(); } catch (_) {}
    chat = null;
  }
  activeChannel = null;
  emitStatus(false);
}

// ─── Emitters ─────────────────────────────────────────────────────────────────
function emit(channel, data) {
  broadcast(channel, data);
}

function emitStatus(connected, msg = null, idle = false) {
  emit('youtube:status', { connected, idle, channel: activeChannel, message: msg });
}

module.exports = { connect, disconnect };