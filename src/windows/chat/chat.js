'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Chat Window Renderer
   ─────────────────────────────────────────────────────────────────────────
   Responsibilities:
   - Platform tab switching & connection forms
   - Rendering chat messages with emotes, badges, and platform colours
   - Scroll management (auto-scroll + pause + "new messages" button)
   - Events dock rendering
   - User card popup
   - Live settings application
   - TTS via Web Speech API
   - Toast notifications
   ═══════════════════════════════════════════════════════════════════════════ */

// Global error handler - log all errors to console
window.onerror = function(msg, url, line, col, error) {
  console.error('[Chat Error]', msg, 'at line', line, ':', col);
  if (error && error.stack) console.error('[Stack]', error.stack);
  return false;
};

window.onunhandledrejection = function(event) {
  console.error('[Chat Unhandled Promise Rejection]', event.reason);
};

// ─── DOM references ──────────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const chatMessages   = $('#chat-messages');
const chatViewport   = $('#chat-viewport');
const btnNewMessages = $('#btn-new-messages');
const chatInput      = $('#chat-input');
const btnSend        = $('#btn-send');
const dockEvents     = $('#dock-events');
const btnClearEvents = $('#btn-clear-events');
const mainLayout     = $('#main-layout');
const toastContainer = $('#toast-container');

// ─── State ───────────────────────────────────────────────────────────────────
// ─── Twitch-palette for deterministic per-user coloring ─────────────────────
const TWITCH_PALETTE = [
  '#FF0000','#0000FF','#00FF7F','#B22222','#FF7F50',
  '#9ACD32','#FF4500','#2E8B57','#DAA520','#D2691E',
  '#5F9EA0','#1E90FF','#FF69B4','#8A2BE2','#00CED1'
];

function hashColor(username) {
  let n = 0;
  for (const c of username) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return TWITCH_PALETTE[n % TWITCH_PALETTE.length];
}

const PLATFORM_ICONS = {
  twitch:  '<svg viewBox="0 0 24 24"><path fill="#9147ff" d="M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2L3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29l-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.14V3.43h12z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24"><path fill="#ff0000" d="M21.58 7.19c-.23-.87-.91-1.56-1.78-1.79C18.25 5 12 5 12 5s-6.25 0-7.8.4c-.87.23-1.55.92-1.78 1.79C2 8.75 2 12 2 12s0 3.25.42 4.81c.23.87.91 1.56 1.78 1.79C5.75 19 12 19 12 19s6.25 0 7.8-.4c.87-.23 1.55-.92 1.78-1.79C22 15.25 22 12 22 12s0-3.25-.42-4.81zM10 15V9l5.2 3-5.2 3z"/></svg>',
  tiktok:  '<svg viewBox="0 0 24 24"><path fill="#ff0050" d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.95a8.27 8.27 0 004.84 1.55V7.05a4.85 4.85 0 01-1.07-.36z"/></svg>'
};

const state = {
  settings: {},
  emoteCaches: { twitch: {}, tiktok: {}, youtube: {} },  // platform-scoped emote caches
  badgeCache: {},
  sessionMsgCount: {},     // { username: count }
  sessionMessages:  {},    // { 'platform:username': [{message, timestamp}] } — for usercard history
  userColorMap: {},        // { 'platform:username': '#hex' }
  isScrollPaused: false,
  pendingCount: 0,
  activePlatform: 'twitch',
  connectedChannels: { twitch: null, tiktok: null, youtube: null },
  tiktokCookies: null,
  tiktokSessionId: null,
  ttsEnabled: false,
  ttsVoice: null,
  ttsQueue: [],
  ttsBusy: false,
  MAX_MESSAGES: 500
};

// Palette for YouTube/TikTok user colours (same set Twitch uses as defaults)
const CHAT_COLORS = [
  '#ff4500','#2e8b57','#daa520','#ff69b4','#1e90ff',
  '#00ff7f','#9400d3','#ff8c00','#00ced1','#adff2f',
  '#dc143c','#1abc9c','#e67e22','#8e44ad','#2980b9'
];

/** Return a deterministic color for a username, or use the provided Twitch color. */
function getOrAssignColor(platform, username, providedColor) {
  if (platform === 'twitch' && providedColor) return providedColor;
  const key = `${platform}:${username}`;
  if (!state.userColorMap[key]) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = Math.imul(hash * 31, 1) + username.charCodeAt(i) | 0;
    }
    state.userColorMap[key] = CHAT_COLORS[Math.abs(hash) % CHAT_COLORS.length];
  }
  return state.userColorMap[key];
}

// Platform logo SVGs (inline, so no external requests)

// ─── Init ────────────────────────────────────────────────────────────────────
(async function init() {
  console.log('[Chat] Iniciando...');
  try {
    state.settings = await window.chattering.settings.getAll();
    console.log('[Chat] Settings cargadas:', state.settings.twitchToken ? 'con token' : 'sin token');
    applySettings(state.settings);
    setupTabSwitching();
    setupConnectButtons();
    setupChatInput();
    setupScrollBehaviour();
    setupDock();
    setupUserCard();
    registerPlatformListeners();
    registerSettingsListener();
    initTTS();
    showToast('Chattering listo', 'success');
    setupFilters();
    checkConnections();
    
    console.log('[Chat] Iniciando auto-conexión...');
    // Auto-connect to Twitch if logged in
    await autoConnectTwitch();
    // Auto-connect to YouTube if there's a saved channel
    await autoConnectYouTube();
    console.log('[Chat] Auto-conexión completada');
  } catch (err) {
    console.error('[Chat] Error en init():', err);
  }
})();

// Auto-connect to Twitch when user is logged in
async function autoConnectTwitch() {
  try {
    console.log('[Chat] Verificando si hay sesión de Twitch activa...');
    const userInfo = await window.chattering.twitch.getUser();
    console.log('[Chat] Info del usuario de Twitch:', userInfo);
    
    if (userInfo && userInfo.loggedIn && userInfo.username) {
      console.log('[Chat] Usuario conectado, intentando auto-conectar a:', userInfo.username);
      
      // Auto-connect to the user's own channel
      const res = await window.chattering.twitch.connect(userInfo.username, null);
      console.log('[Chat] Auto-conexión resultado:', res);
      
      if (res && res.connected) {
        state.connectedChannels.twitch = userInfo.username;
        addSystemMessage(`Conectado automáticamente a #${userInfo.username} (Twitch)`, 'twitch');
        loadEmotes('twitch', res.userId || userInfo.username);
        chatInput.placeholder = `Escribe un mensaje en #${userInfo.username}…`;
        
        // Hide no-connections popup
        const popup = $('#no-connections-popup');
        popup?.classList.add('hidden');
      }
    } else {
      console.log('[Chat] No hay sesión de Twitch activa');
    }
  } catch (err) {
    console.error('[Chat] Error en auto-conexión Twitch:', err);
  }
}

// Auto-connect to YouTube when there's a saved channel
async function autoConnectYouTube() {
  try {
    // Check if there's a saved YouTube channel
    const savedChannel = state.settings.youtubeChannel;
    if (!savedChannel) {
      console.log('[Chat] No hay canal de YouTube guardado');
      return;
    }
    
    console.log('[Chat] Auto-conectando a YouTube:', savedChannel);
    const res = await window.chattering.youtube.connect(savedChannel, null);
    console.log('[Chat] Auto-conexión YouTube resultado:', res);
    
    if (res && res.connected) {
      state.connectedChannels.youtube = savedChannel;
      addSystemMessage(`Conectado automáticamente a ${savedChannel} (YouTube)`, 'youtube');
      chatInput.placeholder = `Escribe un mensaje en ${savedChannel}…`;
    }
  } catch (err) {
    console.error('[Chat] Error en auto-conexión YouTube:', err);
  }
}

// ─── Check for connections and show popup ───────────────────────────────────
function checkConnections() {
  const popup = $('#no-connections-popup');
  const btnOpenSettings = $('#btn-open-settings-from-popup');
  
  // Check if any platform is configured in settings
  const hasConnections = state.settings.twitchChannel || 
                        state.settings.youtubeChannel || 
                        state.settings.tiktokUser;
  
  if (!hasConnections && popup) {
    popup.classList.remove('hidden');
  }
  
  btnOpenSettings?.addEventListener('click', () => {
    window.chattering.settings.open();
    popup.classList.add('hidden');
  });
  
  // Hide popup when connected to any platform
  window.chattering.twitch.onStatus((data) => {
    if (data.connected) popup?.classList.add('hidden');
  });
  window.chattering.tiktok.onStatus((data) => {
    if (data.connected) popup?.classList.add('hidden');
  });
  window.chattering.youtube.onStatus((data) => {
    if (data.connected) popup?.classList.add('hidden');
  });
}

// ─── Filters ────────────────────────────────────────────────────────────────────
function setupFilters() {
  const btnFilters = $('#btn-filters');
  const dropdown = $('#filters-dropdown');
  const filterPlatform = $('#filter-platform');
  const filterType = $('#filter-type');
  const filterSubs = $('#filter-subs');
  const filterMods = $('#filter-mods');
  const btnApply = $('#btn-apply-filters');
  
  // Toggle dropdown
  btnFilters?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== btnFilters) {
      dropdown.classList.add('hidden');
    }
  });
  
  // Apply filters
  btnApply?.addEventListener('click', () => {
    const filters = {
      platform: filterPlatform?.value || 'all',
      type: filterType?.value || 'all',
      subsOnly: filterSubs?.checked || false,
      showMods: filterMods?.checked !== false
    };
    
    state.settings.filters = filters;
    window.chattering.settings.set({ filters });
    applyFilters(filters);
    dropdown.classList.add('hidden');
    showToast('Filtros aplicados', 'success');
  });
  
  // Load saved filters
  if (state.settings.filters) {
    filterPlatform.value = state.settings.filters.platform || 'all';
    filterType.value = state.settings.filters.type || 'all';
    if (filterSubs) filterSubs.checked = state.settings.filters.subsOnly || false;
    if (filterMods) filterMods.checked = state.settings.filters.showMods !== false;
    applyFilters(state.settings.filters);
  }
}

function applyFilters(filters) {
  const messages = $$('.chat-message');
  messages.forEach(msg => {
    let show = true;
    
    // Platform filter
    if (filters.platform && filters.platform !== 'all') {
      if (!msg.classList.contains(`platform-${filters.platform}`)) {
        show = false;
      }
    }
    
    // Type filter (events vs chat)
    if (filters.type && filters.type !== 'all') {
      const isEvent = msg.classList.contains('system') || msg.classList.contains('event-item');
      if (filters.type === 'chat' && isEvent) show = false;
      if (filters.type === 'events' && !isEvent) show = false;
    }
    
    msg.classList.toggle('hidden', !show);
  });
}

// ─── Platform tab switching ───────────────────────────────────────────────────
function setupTabSwitching() {
  $$('.platform-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const platform = tab.dataset.platform;
      $$('.platform-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.channel-input-group').forEach(g => g.classList.add('hidden'));
      $(`#connect-${platform}`).classList.remove('hidden');
      state.activePlatform = platform;
    });
  });
}

// ─── Connect buttons ──────────────────────────────────────────────────────────
function setupConnectButtons() {
  // Twitch OAuth
  $('#btn-twitch-oauth')?.addEventListener('click', () => {
    const clientId = state.settings.twitchClientId || 'w2q6ngvevmf1gkuu1ngiqwmyzqmjrt';
    window.chattering.twitch.openOAuth(clientId);
  });
  
  // Listen for OAuth token capture
  window.chattering.twitch.onOAuthCaptured((data) => {
    if (data?.token) {
      state.settings.twitchToken = data.token;
      showToast('Sesión de Twitch iniciada', 'success');
      // Update the token input field
      const tokenInput = $('#input-twitch-token');
      if (tokenInput) tokenInput.value = data.token;
    }
  });
  
  // TikTok login
  $('#btn-tiktok-login')?.addEventListener('click', () => {
    window.chattering.tiktok.openAuthWindow();
  });

  $$('.btn-connect').forEach(btn => {
    btn.addEventListener('click', async () => {
      const platform = btn.dataset.platform;
      await connectPlatform(platform);
    });
  });

  // Also allow Enter in inputs
  $$('.channel-input-group input').forEach(input => {
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const platform = input.closest('.channel-input-group').id.replace('connect-', '');
        await connectPlatform(platform);
      }
    });
  });
}

async function connectPlatform(platform) {
  setStatusBadge(platform, 'connecting', `${capitalize(platform)}: conectando…`);

  try {
    if (platform === 'twitch') {
      const channelInput = $('#input-twitch-channel');
      const tokenInput = $('#input-twitch-token');
      if (!channelInput) return showToast('Error: input de Twitch no encontrado', 'error');
      const channel = (channelInput.value || '').trim().replace(/^#/, '');
      const token = tokenInput ? (tokenInput.value || '').trim() : '';
      if (!channel) return showToast('Escribe un canal de Twitch', 'warning');
      console.log('[Chat] Conectando a Twitch, canal:', channel, 'token:', token ? 'presente' : 'ausente');
      const res = await window.chattering.twitch.connect(channel, token || null);
      console.log('[Chat] Resultado de conexión Twitch:', res);
      if (res.error) throw new Error(res.error);
      state.connectedChannels.twitch = channel;
      addSystemMessage(`Conectado a #${channel} (Twitch)`, 'twitch');
      // Load emotes
      loadEmotes('twitch', res.userId || channel);
      chatInput.placeholder = `Escribe un mensaje en #${channel}…`;

    } else if (platform === 'tiktok') {
      const tiktokInput = $('#input-tiktok-user');
      if (!tiktokInput) return showToast('Error: input de TikTok no encontrado', 'error');
      const username = (tiktokInput.value || '').trim().replace(/^@/, '');
      if (!username) return showToast('Escribe un usuario de TikTok', 'warning');
      
      // Use sessionId from captured cookies or restored settings
      const sessionId = state.tiktokSessionId
        || state.tiktokCookies?.sessionid
        || state.tiktokCookies?.sessionid_ss
        || null;
      const res = await window.chattering.tiktok.connect(username, sessionId);
      if (res.error) throw new Error(res.error);
      state.connectedChannels.tiktok = username;
      addSystemMessage(`Conectado a @${username} (TikTok)`, 'tiktok');
      loadEmotes('tiktok', username);

    } else if (platform === 'youtube') {
      const ytInput = $('#input-yt-handle');
      if (!ytInput) return showToast('Error: input de YouTube no encontrado', 'error');
      const handle = (ytInput.value || '').trim();
      if (!handle) return showToast('Escribe un canal de YouTube', 'warning');
      const res = await window.chattering.youtube.connect(handle);
      if (res.error) throw new Error(res.error);
      state.connectedChannels.youtube = handle;
      // Save YouTube channel to settings for auto-connect
      state.settings.youtubeChannel = handle;
      await window.chattering.settings.set({ youtubeChannel: handle });
      addSystemMessage(`Conectado a ${handle} (YouTube)`, 'youtube');
    }
  } catch (err) {
    setStatusBadge(platform, 'error', `${capitalize(platform)}: error`);
    showToast(`Error conectando: ${err.message}`, 'error');
  }
}

// ─── Platform listeners ───────────────────────────────────────────────────────
function registerPlatformListeners() {
  // Twitch
  window.chattering.twitch.onMessage(data => {
    console.log('[Chat Renderer] Mensaje de Twitch recibido:', data);
    appendChatMessage({ platform: 'twitch', ...data });
    maybeSpeak(data);
  });
  window.chattering.twitch.onEvent(data => {
    appendDockEvent(data);
    appendEventInChat(data);
  });
  window.chattering.twitch.onStatus(data => {
    const label = data.connected
      ? `Twitch: #${data.channel}`
      : `Twitch: desconectado`;
    setStatusBadge('twitch', data.connected ? 'connected' : 'error', label);
  });

  // TikTok cookies
  window.chattering.tiktok.onCookiesCaptured(cookies => {
    state.tiktokCookies = cookies;
    state.tiktokSessionId = cookies.sessionid || cookies.sessionid_ss || null;
    window.chattering.tiktok.setCookies(cookies);
    showToast('Sesión TikTok capturada', 'success');
  });
  // Restored sessionId from settings on startup (no cookies in session)
  window.chattering.tiktok.onSessionRestored?.(data => {
    if (data?.sessionId) {
      state.tiktokSessionId = data.sessionId;
      console.log('[Chat] TikTok sessionId restaurado desde settings');
    }
  });
  window.chattering.tiktok.onMessage(data => {
    appendChatMessage({ platform: 'tiktok', ...data });
    maybeSpeak(data);
  });
  window.chattering.tiktok.onEvent(data => {
    appendDockEvent(data);
    appendEventInChat(data);
  });
  window.chattering.tiktok.onStatus(data => {
    setStatusBadge('tiktok', data.connected ? 'connected' : 'error',
      data.connected ? `TikTok: @${data.channel}` : 'TikTok: desconectado');
  });

  // YouTube
  window.chattering.youtube.onMessage(data => {
    appendChatMessage({ platform: 'youtube', ...data });
  });
  window.chattering.youtube.onEvent(data => {
    appendDockEvent(data);
    appendEventInChat(data);
  });
  window.chattering.youtube.onStatus(data => {
    setStatusBadge('youtube', data.connected ? 'connected' : 'error',
      data.connected ? `YouTube: ${data.channel}` : 'YouTube: desconectado');
  });

  // App-level notifications
  window.chattering.removeAllListeners('app:notify');
}

// ─── Append a chat message ────────────────────────────────────────────────────
function appendChatMessage(msg) {
  try {
    console.log('[Chat Renderer] 📥 appendChatMessage llamado - Plataforma:', msg?.platform, '- Username:', msg?.username, '- Mensaje:', msg?.message);
    
    // Debug: verificar que el mensaje tiene los campos necesarios
    if (!msg.message) {
      console.warn('[Chat Renderer] ⚠️ Mensaje sin contenido (msg.message undefined):', msg);
      return;
    }
    
    console.log('[Chat Renderer] ✅ Mensaje tiene contenido, procediendo a mostrar');
    const {
      platform, id, username, displayName,
      message, badges = [], emotes = {}, isAction = false,
      bits, deleted = false, highlighted = false
    } = msg;

    // Track per-user count and session message history
    state.sessionMsgCount[username] = (state.sessionMsgCount[username] || 0) + 1;
    const sessionKey = `${platform}:${username}`;
    if (!state.sessionMessages[sessionKey]) state.sessionMessages[sessionKey] = [];
    state.sessionMessages[sessionKey].push({ message, timestamp: Date.now() });
    if (state.sessionMessages[sessionKey].length > 50) state.sessionMessages[sessionKey].shift();

    // Resolve display color — Twitch uses its own color, others get a stable assigned color
    const displayColor = getOrAssignColor(platform, username, msg.color);

    const row = document.createElement('div');
    row.className = `chat-message platform-${platform}`;
    row.dataset.id = id || '';
    row.dataset.user = username;
    if (isAction)    row.classList.add('action');
    if (deleted)     row.classList.add('deleted');
    if (highlighted) row.classList.add('highlighted');
    if (bits)        row.classList.add('bits');

    // Platform logo icon (replaces the old 4px dot)
    const icon = document.createElement('span');
    icon.className = 'msg-platform-icon';
    icon.innerHTML = PLATFORM_ICONS[platform] || '';
    row.appendChild(icon);

    // Timestamp (if enabled)
    if (state.settings.showTimestamps) {
      const ts = document.createElement('span');
      ts.className = 'msg-timestamp';
      ts.textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      row.appendChild(ts);
    }

    // Badges
    if (badges.length) {
      const badgeWrap = document.createElement('span');
      badgeWrap.className = 'msg-badges';
      badges.forEach(b => {
        const img = document.createElement('img');
        img.className = 'badge';
        img.src = b.url || '';
        img.alt = b.title || '';
        img.title = b.title || '';
        badgeWrap.appendChild(img);
      });
      row.appendChild(badgeWrap);
    }

    // Author
    const author = document.createElement('span');
    author.className = 'msg-author';
    author.style.color = displayColor;
    author.textContent = displayName || username;
    author.addEventListener('click', (e) => {
      e.stopPropagation();
      openUserCard(e, username, displayName, platform, displayColor, badges, msg.avatarUrl || '');
    });
    row.appendChild(author);

    const sep = document.createElement('span');
    sep.className = 'msg-sep';
    sep.textContent = isAction ? '' : ':';
    row.appendChild(sep);

    // Message content with emotes (platform-scoped, with YouTube custom emoji support)
    const content = document.createElement('span');
    content.className = 'msg-content';
    content.appendChild(renderMessageContent(message, emotes, bits, platform, msg.ytEmoteMap || {}));
    row.appendChild(content);

    // Apply chat filter if active
    if (shouldFilterMessage(msg)) {
      console.log('[Chat Renderer] ⚠️ Mensaje filtrado:', msg.username, '- plataforma:', msg.platform);
      return;
    }

    chatMessages.appendChild(row);
    console.log('[Chat Renderer] ✅ Mensaje agregado al DOM:', msg.id, 'Plataforma:', msg.platform);
    trimMessageList();

    if (!state.isScrollPaused) {
      scrollToBottom();
    } else {
      state.pendingCount++;
      updateNewMessagesButton();
    }
  } catch (err) {
    console.error('[Chat Renderer] Error en appendChatMessage:', err);
  }
}

function addSystemMessage(text, platform = 'system') {
  const row = document.createElement('div');
  row.className = 'chat-message system';
  row.textContent = `• ${text}`;
  chatMessages.appendChild(row);
  if (!state.isScrollPaused) scrollToBottom();
}

// ─── Message content renderer ─────────────────────────────────────────────────
function renderMessageContent(text, emoteMap = {}, bits = 0, platform = 'twitch', ytEmoteMap = {}) {
  const frag = document.createDocumentFragment();

  // Build sorted list of Twitch native emote positions
  const positions = [];
  Object.entries(emoteMap).forEach(([emoteId, ranges]) => {
    ranges.forEach(range => {
      const [s, e] = range.split('-').map(Number);
      positions.push({ start: s, end: e, emoteId });
    });
  });
  positions.sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const pos of positions) {
    if (pos.start > cursor) {
      frag.appendChild(renderTextChunk(text.slice(cursor, pos.start), platform, ytEmoteMap));
    }
    const img = document.createElement('img');
    img.className = 'emote';
    img.src = `https://static-cdn.jtvnw.net/emoticons/v2/${pos.emoteId}/default/dark/1.0`;
    img.alt = text.slice(pos.start, pos.end + 1);
    img.title = img.alt;
    img.loading = 'lazy';
    frag.appendChild(img);
    cursor = pos.end + 1;
  }

  if (cursor < text.length) {
    frag.appendChild(renderTextChunk(text.slice(cursor), platform, ytEmoteMap));
  }

  return frag;
}

// Render a text chunk, expanding 3rd-party and YouTube custom emotes
function renderTextChunk(text, platform = 'twitch', ytEmoteMap = {}) {
  const frag = document.createDocumentFragment();
  const platformCache = state.emoteCaches[platform] || {};
  const hasYtEmotes = platform === 'youtube' && Object.keys(ytEmoteMap).length > 0;

  if (hasYtEmotes) {
    // YouTube messages may contain :shortcode: tokens (possibly adjacent, no spaces)
    // Split on them so we can render each as an image when a URL is available
    const parts = text.split(/(:[a-zA-Z0-9_-]+:)/);
    parts.forEach(part => {
      if (!part) return;
      const codeMatch = part.match(/^:([\w-]+):$/);
      if (codeMatch && ytEmoteMap[codeMatch[1]]) {
        const img = document.createElement('img');
        img.className = 'emote';
        img.src = ytEmoteMap[codeMatch[1]];
        img.alt = part;
        img.title = part;
        img.loading = 'lazy';
        frag.appendChild(img);
      } else {
        // Plain text segment — still check platform emote cache word-by-word
        const words = part.split(' ');
        words.forEach((word, i) => {
          const emote = platformCache[word];
          if (emote) {
            const img = document.createElement('img');
            img.className = 'emote';
            img.src = emote.url;
            img.alt = word;
            img.title = word;
            img.loading = 'lazy';
            frag.appendChild(img);
            if (i < words.length - 1) frag.appendChild(document.createTextNode(' '));
          } else {
            frag.appendChild(document.createTextNode(i === 0 ? word : ' ' + word));
          }
        });
      }
    });
    return frag;
  }

  // Standard word-by-word lookup for Twitch / TikTok 3rd-party emotes
  const words = text.split(' ');
  words.forEach((word, i) => {
    const emote = platformCache[word];
    if (emote) {
      const img = document.createElement('img');
      img.className = 'emote';
      img.src = emote.url;
      img.alt = word;
      img.title = word;
      img.loading = 'lazy';
      frag.appendChild(img);
      if (i < words.length - 1) frag.appendChild(document.createTextNode(' '));
    } else {
      frag.appendChild(document.createTextNode(i === 0 ? word : ' ' + word));
    }
  });
  return frag;
}

// ─── Emotes ───────────────────────────────────────────────────────────────────
async function loadEmotes(platform, channelId) {
  try {
    const cache = await window.chattering.emotes.loadForChannel(platform, channelId);
    console.log('[Chat] Emotes cargados para', platform, '- total:', Object.keys(cache).length);
    if (!state.emoteCaches[platform]) state.emoteCaches[platform] = {};
    Object.assign(state.emoteCaches[platform], cache);
  } catch (e) {
    console.warn('[Chat] Error cargando emotes:', e);
  }
}

// ─── Scroll management ────────────────────────────────────────────────────────
function setupScrollBehaviour() {
  chatViewport.addEventListener('scroll', onViewportScroll, { passive: true });
  btnNewMessages.addEventListener('click', () => {
    resumeScroll();
  });
}

function onViewportScroll() {
  const distFromBottom = chatViewport.scrollHeight - chatViewport.scrollTop - chatViewport.clientHeight;
  if (distFromBottom > 120) {
    if (!state.isScrollPaused) {
      state.isScrollPaused = true;
      state.pendingCount = 0;
    }
  } else {
    if (state.isScrollPaused) resumeScroll();
  }
}

function resumeScroll() {
  state.isScrollPaused = false;
  state.pendingCount = 0;
  btnNewMessages.classList.add('hidden');
  scrollToBottom();
}

function scrollToBottom() {
  chatViewport.scrollTop = chatViewport.scrollHeight;
}

function updateNewMessagesButton() {
  if (state.pendingCount > 0) {
    btnNewMessages.textContent = '';
    const icon = document.createElement('svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.innerHTML = '<path d="M7 10l5 5 5-5z"/>';
    btnNewMessages.appendChild(icon);
    btnNewMessages.appendChild(document.createTextNode(
      ` ${state.pendingCount > 99 ? '99+' : state.pendingCount} nuevos`
    ));
    btnNewMessages.classList.remove('hidden');
  } else {
    btnNewMessages.classList.add('hidden');
  }
}

// Limit DOM size for performance
function trimMessageList() {
  while (chatMessages.children.length > state.MAX_MESSAGES) {
    chatMessages.removeChild(chatMessages.firstChild);
  }
}

// ─── Chat input ───────────────────────────────────────────────────────────────
function setupChatInput() {
  btnSend.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
}

async function sendChatMessage() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  if (!state.connectedChannels.twitch) {
    showToast('Conéctate a Twitch para enviar mensajes', 'warning');
    return;
  }
  chatInput.value = '';
  try {
    await window.chattering.twitch.sendMessage(state.connectedChannels.twitch, msg);
  } catch (e) {
    showToast(`No se pudo enviar: ${e.message}`, 'error');
  }
}

// ─── Events dock ─────────────────────────────────────────────────────────────
function setupDock() {
  // Dock position controls
  const dock = $('#events-dock');
  const btnDockTop = $('#btn-dock-top');
  const btnDockLeft = $('#btn-dock-left');
  const btnDockRight = $('#btn-dock-right');
  const btnDockBottom = $('#btn-dock-bottom');
  const btnDockFloat = $('#btn-dock-float');
  
  let isFloating = false;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  
  function setDockPosition(pos) {
    if (!dock) return; // Si no hay dock, no hacemos nada
    
    // Make sure dock is visible (it might be hidden when floating dock was open)
    dock.style.display = '';
    
    // Remove all position classes
    dock.classList.remove('dock-top', 'dock-bottom', 'dock-left', 'dock-right', 'dock-float');
    
    // Show/hide float button based on state
    if (btnDockFloat) {
      btnDockFloat.style.display = ''; // Reset to default
    }
    
    if (pos === 'float') {
      isFloating = true;
      dock.classList.add('dock-float');
      btnDockFloat?.classList.add('active');
      [btnDockTop, btnDockLeft, btnDockRight, btnDockBottom].forEach(btn => btn?.classList.remove('active'));
    } else {
      isFloating = false;
      dock.classList.add(`dock-${pos}`);
      btnDockFloat?.classList.remove('active');
      // Show float button when docked (user can click to undock)
      if (btnDockFloat) {
        btnDockFloat.style.display = '';
      }
      
      // Update button states
      [btnDockTop, btnDockLeft, btnDockRight, btnDockBottom].forEach(btn => btn?.classList.remove('active'));
      
      switch(pos) {
        case 'top': btnDockTop?.classList.add('active'); break;
        case 'left': btnDockLeft?.classList.add('active'); break;
        case 'right': btnDockRight?.classList.add('active'); break;
        case 'bottom': btnDockBottom?.classList.add('active'); break;
      }
    }
    
    // Update main-layout class for horizontal dock (top/bottom)
    if (mainLayout) {
      if (pos === 'top' || pos === 'bottom') {
        mainLayout.classList.add('dock-horizontal');
      } else {
        mainLayout.classList.remove('dock-horizontal');
      }
    }
    
    // Save preference
    state.settings.dockPosition = pos;
    if (window.chattering?.settings) {
      window.chattering.settings.set({ dockPosition: pos });
    }
  }
  
  // Float button - toggle floating mode
  btnDockFloat?.addEventListener('click', () => {
    if (isFloating) {
      // Return to last docked position or default to top
      const lastPos = state.settings.dockPosition || 'top';
      if (lastPos === 'float') {
        setDockPosition('top');
      } else {
        setDockPosition(lastPos);
      }
    } else {
      // Open dock in separate window
      window.chattering?.dock?.openFloat();
      // Hide the dock in chat window (it will be in separate window)
      if (dock) {
        dock.style.display = 'none';
      }
    }
  });
  
  // Listen for dock window closed (user closed the floating dock window)
  if (window.chattering?._onDockClosed) {
    window.chattering._onDockClosed(() => {
      console.log('[Chat] Dock window closed, returning to docked mode');
      // Return to last docked position
      const lastPos = state.settings.dockPosition || 'top';
      if (lastPos === 'float') {
        setDockPosition('top');
      } else {
        setDockPosition(lastPos);
      }
    });
  }

  // Listen for dock position changed from floating dock window
  console.log('[Chat] Checking for dock API, chattering:', !!window.chattering, 'dock:', !!window.chattering?.dock);
  if (window.chattering?.dock) {
    console.log('[Chat] Setting up _onPositionChanged listener');
    try {
      window.chattering.dock._onPositionChanged((pos) => {
        console.log('[Chat] Dock position changed to:', pos);
        if (pos && pos !== 'float') {
          setDockPosition(pos);
        }
      });
      console.log('[Chat] _onPositionChanged listener set up successfully');
    } catch (e) {
      console.log('[Chat] Error setting up _onPositionChanged:', e);
    }
  } else {
    console.log('[Chat] WARNING - window.chattering.dock not available');
  }
  
  // Drag functionality for floating dock
  const dockHeader = $('#dock-header');
  
  dockHeader?.addEventListener('mousedown', (e) => {
    if (!isFloating || !dock) return;
    if (e.target.closest('button')) return; // Don't drag if clicking buttons
    
    isDragging = true;
    const rect = dock.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    dock.style.transition = 'none';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !dock) return;
    
    const x = e.clientX - dragOffset.x;
    const y = e.clientY - dragOffset.y;
    dock.style.left = x + 'px';
    dock.style.top = y + 'px';
    dock.style.transform = 'none';
  });
  
  document.addEventListener('mouseup', () => {
    isDragging = false;
    if (dock) dock.style.transition = '';
  });
  
  // Resize functionality
  const resizeHandle = $('#dock-resize-handle');
  let isResizing = false;
  let startSize = { width: 0, height: 0, x: 0, y: 0 };
  
  resizeHandle?.addEventListener('mousedown', (e) => {
    if (!dock) return;
    isResizing = true;
    startSize.width = dock.offsetWidth;
    startSize.height = dock.offsetHeight;
    startSize.x = e.clientX;
    startSize.y = e.clientY;
    e.preventDefault();
    e.stopPropagation();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing || !dock) return;
    
    const deltaX = e.clientX - startSize.x;
    const deltaY = e.clientY - startSize.y;
    
    // Get current position class
    const currentPos = [...dock.classList].find(c => c.startsWith('dock-'));
    
    if (currentPos === 'dock-top') {
      // Dragging down increases height
      const newHeight = Math.max(100, Math.min(600, startSize.height + deltaY));
      dock.style.height = newHeight + 'px';
    } else if (currentPos === 'dock-bottom') {
      // Dragging UP increases height (inverted)
      const newHeight = Math.max(100, Math.min(600, startSize.height - deltaY));
      dock.style.height = newHeight + 'px';
    } else if (currentPos === 'dock-left') {
      // Dragging right increases width
      const newWidth = Math.max(100, Math.min(400, startSize.width + deltaX));
      dock.style.width = newWidth + 'px';
    } else if (currentPos === 'dock-right') {
      // Dragging LEFT increases width (inverted)
      const newWidth = Math.max(100, Math.min(400, startSize.width - deltaX));
      dock.style.width = newWidth + 'px';
    } else if (currentPos === 'dock-float') {
      // Resize both
      const newWidth = Math.max(200, Math.min(600, startSize.width + deltaX));
      const newHeight = Math.max(150, Math.min(800, startSize.height + deltaY));
      dock.style.width = newWidth + 'px';
      dock.style.height = newHeight + 'px';
    }
  });
  
  document.addEventListener('mouseup', () => {
    isResizing = false;
  });
  
  // Dock position buttons - use event delegation for efficiency
  const dockControls = $('#dock-controls');
  dockControls?.addEventListener('click', (e) => {
    const btn = e.target.closest('[id^="btn-dock-"]');
    if (!btn) return;
    const pos = btn.id.replace('btn-dock-', '');
    if (pos === 'float') {
      // Handle float separately
      btnDockFloat?.dispatchEvent(new Event('click'));
    } else {
      setDockPosition(pos);
    }
  });
  
  // Clear events - sync with dock window
  btnClearEvents?.addEventListener('click', () => {
    if (dockEvents) dockEvents.innerHTML = '';
    window.chattering?.dock?.clearEvents();
  });
  
  // Listen for dock position changed from dock window
  if (window.chattering?._onDockClosed) {
    window.chattering._onDockClosed(() => {
      console.log('[Chat] Dock window closed, returning to docked mode');
      // Return to last docked position
      const lastPos = state.settings.dockPosition || 'top';
      if (lastPos === 'float') {
        setDockPosition('top');
      } else {
        setDockPosition(lastPos);
      }
    });
  }
  
  // Load saved position
  if (state.settings.dockPosition) {
    setDockPosition(state.settings.dockPosition);
  } else {
    // Default to top
    setDockPosition('top');
  }
}

function appendDockEvent(evt) {
  const { type, username, displayName, amount, months, message, platform } = evt;

  const item = document.createElement('div');
  item.className = `event-item ${type}`;

  const iconMap = {
    follow: '💙', sub: '⭐', resub: '⭐', gift: '🎁', bits: '💎',
    like: '❤️', raid: '🚀', share: '🔁', superchat: '💛', member: '🏅'
  };

  const icon = document.createElement('span');
  icon.className = 'event-icon';
  icon.textContent = iconMap[type] || '📣';

  const body = document.createElement('div');
  body.className = 'event-body';

  const user = document.createElement('div');
  user.className = 'event-user';
  user.textContent = displayName || username || 'Anónimo';

  const desc = document.createElement('div');
  desc.className = 'event-desc';
  desc.textContent = buildEventDescription(type, amount, months, message);

  body.appendChild(user);
  body.appendChild(desc);
  item.appendChild(icon);
  item.appendChild(body);

  dockEvents.prepend(item);

  // Trim dock to 100 events
  while (dockEvents.children.length > 100) {
    dockEvents.removeChild(dockEvents.lastChild);
  }

  // Send event to floating dock window if open
  window.chattering?.dock?.addEvent({
    type,
    message: `${displayName || username || 'Anónimo'}: ${buildEventDescription(type, amount, months, message)}`,
    time: new Date().toLocaleTimeString()
  });

  // Flash alert if enabled
  if (state.settings.alertsEnabled) flashAlert(item);
}

function buildEventDescription(type, amount, months, message) {
  switch (type) {
    case 'follow':  return 'Siguió al canal';
    case 'sub':     return 'Nuevo suscriptor';
    case 'resub':   return `Resub x${months || 1}`;
    case 'gift':    return `Regaló ${amount || 1} sub(s)`;
    case 'bits':    return `${amount || 0} bits`;
    case 'like':    return `${amount || 1} like(s)`;
    case 'share':   return 'Compartió el stream';
    case 'raid':    return `Raid de ${amount || 0} viewers`;
    case 'superchat': return `Super Chat: $${amount || 0}`;
    case 'member':  return `Nuevo miembro`;
    default: return type;
  }
}

function flashAlert(el) {
  el.style.boxShadow = '0 0 0 2px var(--accent)';
  setTimeout(() => { el.style.boxShadow = ''; }, 800);
}

// ─── Inline event row in chat (Chatterino-style highlighted banner) ───────────
const EVENT_ICONS = {
  follow: '💙', sub: '⭐', resub: '⭐', gift: '🎁', bits: '💎',
  like: '❤️', raid: '🚀', share: '🔁', superchat: '💛', member: '🏅',
  redeem: '✨', streamEnd: '📴'
};

function appendEventInChat(evt) {
  const { type, platform, username, displayName, amount, months, message, giftName } = evt;
  const who = displayName || username || 'Anónimo';

  const actionMap = {
    follow:    `siguió el canal`,
    sub:       `se suscribió`,
    resub:     `resub ×${months || 1}`,
    gift:      `regaló ${amount || 1} sub(s)`,
    bits:      `donó ${amount || 0} bits`,
    like:      `dejó ${amount || 1} like(s)`,
    share:     `compartió el stream`,
    raid:      `hizo raid con ${amount || 0} viewers`,
    superchat: `Super Chat $${amount || 0}${message ? ': ' + message : ''}`,
    member:    `se unió como miembro`,
    redeem:    `canjeó "${giftName || message || 'recompensa'}"`,
  };

  const action = actionMap[type];
  if (!action) return; // skip unknown / streamEnd

  const platformLabel = { twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok' }[platform] || platform;

  const row = document.createElement('div');
  row.className = `chat-message chat-event platform-${platform}`;

  const icon = document.createElement('span');
  icon.className = 'event-inline-icon';
  icon.textContent = EVENT_ICONS[type] || '📣';

  const text = document.createElement('span');
  text.className = 'event-inline-text';
  text.innerHTML = `<strong>${escapeText(who)}</strong> ${escapeText(action)} <span class="event-inline-platform">${platformLabel}</span>`;

  row.appendChild(icon);
  row.appendChild(text);
  chatMessages.appendChild(row);
  trimMessageList();
  if (!state.isScrollPaused) scrollToBottom();
}

function escapeText(str) {
  const d = document.createElement('span');
  d.textContent = str;
  return d.innerHTML;
}

// ─── User card (floating window via IPC) ──────────────────────────────────────
function setupUserCard() {
  // The old inline popup is no longer used — the card is a separate BrowserWindow.
  // Nothing to wire up here; clicks are handled in appendChatMessage > author.click.
}

function openUserCard(e, username, displayName, platform, color, badges, avatarUrl) {
  const sessionKey = `${platform}:${username}`;
  const messages   = state.sessionMessages[sessionKey] || [];

  window.chattering.usercard.open({
    platform,
    username,
    displayName,
    color,
    avatarUrl,
    badges,
    messages,
    isModerator: badges.some(b => /mod/i.test(b.title || '')),
    isSub:       badges.some(b => /sub|subscriber/i.test(b.title || '')),
    channel:     state.connectedChannels.twitch || null,
    screenX:     (e.screenX || 0) + 12,
    screenY:     (e.screenY || 0) - 10
  });
}

function markMessagesDeleted(username) {
  $$(`[data-user="${username}"]`).forEach(el => el.classList.add('deleted'));
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function registerSettingsListener() {
  // Live settings updates are handled at the bottom of this file
  // via window.chattering._onSettingsUpdated()
}

function applySettings(s) {
  const body = document.body;

  // Theme - support all themes
  body.classList.remove('theme-dark', 'theme-light', 'theme-gray', 'theme-lightgray', 'theme-sakura', 'theme-midnight');
  body.classList.add(`theme-${s.theme || 'dark'}`);

  // Translucent
  body.classList.toggle('translucent', !!s.translucent);

  // Font size
  if (s.fontSize) {
    document.documentElement.style.setProperty('--font-size', s.fontSize + 'px');
  }

  // TTS
  state.ttsEnabled = !!s.ttsEnabled;

  // Max messages
  if (s.maxMessages) state.MAX_MESSAGES = s.maxMessages;

  // Show/hide timestamps
  // Handled dynamically per message

  state.settings = s;
}

// ─── Chat filter ──────────────────────────────────────────────────────────────
function shouldFilterMessage(msg) {
  const { settings } = state;
  
  // Filtrar por plataforma (CORREGIDO)
  if (settings.filters && settings.filters.platform && settings.filters.platform !== 'all') {
    if (msg.platform !== settings.filters.platform) return true;
  }
  
  // Filtrar bots
  const botList = (settings.botList || '').split(',').map(b => b.trim().toLowerCase()).filter(Boolean);
  if (botList.includes((msg.username || '').toLowerCase())) return true;

  return false;
}

// ─── TTS ─────────────────────────────────────────────────────────────────────
// Store available voices for variation
let availableVoices = [];

function initTTS() {
  if (!('speechSynthesis' in window)) return;
  // Pre-load voices
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    availableVoices = window.speechSynthesis.getVoices();
    state.ttsVoice = availableVoices.find(v => v.lang.startsWith('es')) || availableVoices[0] || null;
  });
  // Initial load
  availableVoices = window.speechSynthesis.getVoices();
}

function maybeSpeak(msg) {
  if (!state.ttsEnabled) return;
  const s = state.settings;
  // Per-platform gates (default: Twitch on, others off)
  if (msg.platform === 'twitch'  && s.ttsTwitch  === false) return;
  if (msg.platform === 'youtube' && !s.ttsYoutube) return;
  if (msg.platform === 'tiktok'  && !s.ttsTikTok)  return;
  if (!msg.message) return;
  // ttsMessageOnly defaults true — read only the message, not "username dice:"
  const text = s.ttsMessageOnly !== false
    ? msg.message
    : `${msg.username} dice: ${msg.message}`;
  ttsEnqueue(text);
}

function ttsEnqueue(text) {
  state.ttsQueue.push(text);
  if (!state.ttsBusy) ttsProcessQueue();
}

// Counter for voice variation
let ttsMessageCount = 0;

function ttsProcessQueue() {
  if (!state.ttsQueue.length) { state.ttsBusy = false; return; }
  state.ttsBusy = true;
  const text = state.ttsQueue.shift();
  const utt = new SpeechSynthesisUtterance(text);
  
  // Select voice with variation - cycle through available voices
  if (availableVoices.length > 0) {
    ttsMessageCount++;
    // Select different voice every 3 messages for variety
    const voiceIndex = ttsMessageCount % Math.min(availableVoices.length, 3);
    const preferredVoices = availableVoices.filter(v => v.lang.startsWith('es') || v.lang.startsWith('en'));
    if (preferredVoices.length > 0) {
      utt.voice = preferredVoices[(ttsMessageCount + voiceIndex) % preferredVoices.length];
    } else {
      utt.voice = availableVoices[voiceIndex];
    }
  } else if (state.ttsVoice) {
    utt.voice = state.ttsVoice;
  }
  
  // Base settings from user
  const baseRate = state.settings.ttsRate || 1;
  const basePitch = state.settings.ttsPitch || 1;
  
  // Add slight variation to rate and pitch for variety (±10%)
  utt.rate = baseRate * (0.9 + Math.random() * 0.2);
  utt.pitch = basePitch * (0.95 + Math.random() * 0.1);
  utt.volume = state.settings.ttsVolume || 1;
  
  utt.onend = () => ttsProcessQueue();
  utt.onerror = () => ttsProcessQueue();
  window.speechSynthesis.speak(utt);
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function setStatusBadge(platform, status, label) {
  const badge = $(`#status-${platform}`);
  if (!badge) return;
  badge.classList.remove('hidden', 'connected', 'error', 'connecting');
  badge.classList.add(status);
  badge.querySelector('.status-label').textContent = label;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getPlatformColor(platform) {
  const colors = { twitch: '#9147ff', tiktok: '#ff0050', youtube: '#ff0000' };
  return colors[platform] || '#efeff1';
}

// ─── Window controls (titlebar) ───────────────────────────────────────────────
// Prevent drag region from capturing clicks - use a small delay to distinguish click vs drag
const titlebarDrag = $('#titlebar-drag');
let isDragging = false;
let startX = 0;
let startY = 0;

if (titlebarDrag) {
  titlebarDrag.addEventListener('mousedown', (e) => {
    isDragging = false;
    startX = e.screenX;
    startY = e.screenY;
  });
  
  titlebarDrag.addEventListener('mousemove', (e) => {
    const dx = Math.abs(e.screenX - startX);
    const dy = Math.abs(e.screenY - startY);
    if (dx > 5 || dy > 5) {
      isDragging = true;
    }
  });
  
  titlebarDrag.addEventListener('click', (e) => {
    // Only allow native click behavior if not dragging
    if (!isDragging) {
      e.stopPropagation();
    }
  });
}

$('#btn-minimize').addEventListener('click', (e) => {
  e.stopPropagation();
  window.chattering.window.minimize();
});
$('#btn-maximize').addEventListener('click', (e) => {
  e.stopPropagation();
  window.chattering.window.maximize();
});
$('#btn-close').addEventListener('click', (e) => {
  e.stopPropagation();
  window.chattering.window.close();
});
$('#btn-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  window.chattering.settings.open();
});

// ─── Live settings refresh ────────────────────────────────────────────────────
// Main process broadcasts 'settings:updated' whenever settings change.
// The preload forwards this via _onSettingsUpdated.
window.chattering._onSettingsUpdated(newSettings => applySettings(newSettings));

// ─── Dock events sync ────────────────────────────────────────────────────────
// Listen for clear events from dock window
if (window.chattering?._onDockClear) {
  window.chattering._onDockClear(() => {
    if (dockEvents) {
      dockEvents.innerHTML = '';
    }
  });
}