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
  tiktokUsername: null,    // auto-resolved from cookies
  ttsEnabled: false,
  ttsVoice: null,
  ttsQueue: [],
  ttsBusy: false,
  MAX_MESSAGES: 500,
  dockFilters: []          // active event type filters for the dock
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
    // Show immediate status badges for all configured platforms so UI responds instantly
    const s0 = state.settings;
    if (s0.twitchToken) setStatusBadge('twitch', 'connecting', 'Twitch: conectando…');
    if (s0.youtubeChannel) setStatusBadge('youtube', 'connecting', 'YouTube: conectando…');
    const savedSid      = (s0.tiktokSessionId || '').trim();
    const savedTikTok   = (s0.tiktokUser || '').trim().replace(/^@/, '');

    // Show TikTok badge if we have either a saved username OR a sessionId
    if (savedTikTok || savedSid) {
      const lbl = savedTikTok ? `TikTok: @${savedTikTok}` : 'TikTok: sesión activa';
      setStatusBadge('tiktok', 'warning', lbl);
    }

    if (savedSid) state.tiktokSessionId = savedSid;
    if (savedTikTok) state.tiktokUsername = savedTikTok;

    // Run auto-connects in parallel for faster startup
    await Promise.allSettled([
      autoConnectTwitch(),
      autoConnectYouTube(),
      (savedTikTok && savedSid)
        ? autoConnectTikTok(savedTikTok, savedSid)
        : savedTikTok
          ? autoConnectTikTok(savedTikTok, null)   // try without sessionId (public streams)
          : Promise.resolve()
    ]);
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
        chatInput.placeholder = 'Escribe un mensaje…';
        
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
    let savedChannel = (state.settings.youtubeChannel || '').trim();
    if (!savedChannel) return;
    // Ensure @ prefix for handles (not for UC... channel IDs)
    if (!savedChannel.startsWith('@') && !savedChannel.startsWith('UC')) {
      savedChannel = '@' + savedChannel;
    }
    console.log('[Chat] Auto-conectando a YouTube:', savedChannel);
    setStatusBadge('youtube', 'connecting', `YouTube: conectando…`);
    const res = await window.chattering.youtube.connect(savedChannel);
    if (res?.connected) {
      state.connectedChannels.youtube = savedChannel;
      addSystemMessage(`Conectado automáticamente a ${savedChannel} (YouTube)`, 'youtube');
      chatInput.placeholder = 'Escribe un mensaje…';
      $('#no-connections-popup')?.classList.add('hidden');
    }
  } catch (err) {
    console.error('[Chat] autoConnectYouTube:', err.message);
    // If not live, the youtube:status IPC will update the badge
  }
}

// ─── Auto-connect TikTok (called when cookies + username available) ──────────
async function autoConnectTikTok(username, sessionId) {
  try {
    console.log('[Chat] Auto-conectando a TikTok:', username);
    const res = await window.chattering.tiktok.connect(username, sessionId);
    if (res && res.connected) {
      state.connectedChannels.tiktok = username;
      addSystemMessage(`Conectado a @${username} (TikTok)`, 'tiktok');
    }
    // If not live (error thrown), the connector already emitted idle status
  } catch (err) {
    // Not live — status badge already set to warning by the error handler
    console.log('[Chat] TikTok auto-connect:', err.message);
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
  
  // Show yellow badge for TikTok if we have a saved session on startup
  const s = state.settings;
  if ((s.tiktokSessionId || s.tiktokCookies) && !state.tiktokSessionId) {
    setStatusBadge('tiktok', 'warning', 'TikTok: sesión activa');
  }

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

// ─── Filter state ─────────────────────────────────────────────────────────────
// Stored directly on state.settings.activeFilters for persistence
function getActiveFilters() {
  return state.settings.activeFilters || { platforms: [], roles: [] };
}

function setActiveFilters(f) {
  state.settings.activeFilters = f;
  window.chattering.settings.set({ activeFilters: f });
  reapplyFilters();
}

// ─── Filters UI ───────────────────────────────────────────────────────────────
function setupFilters() {
  const btnFilters = $('#btn-filters');
  const dropdown   = $('#filters-dropdown');
  if (!btnFilters || !dropdown) return;

  btnFilters.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
    if (!dropdown.classList.contains('hidden')) syncFilterUI();
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== btnFilters) {
      dropdown.classList.add('hidden');
    }
  });

  // Platform chip buttons
  dropdown.querySelectorAll('[data-filter-platform]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.filterPlatform;
      const f = getActiveFilters();
      const idx = f.platforms.indexOf(p);
      if (idx === -1) f.platforms.push(p); else f.platforms.splice(idx, 1);
      setActiveFilters(f);
      syncFilterUI();
    });
  });

  // Role chip buttons
  dropdown.querySelectorAll('[data-filter-role]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.filterRole;
      const f = getActiveFilters();
      const idx = f.roles.indexOf(r);
      if (idx === -1) f.roles.push(r); else f.roles.splice(idx, 1);
      setActiveFilters(f);
      syncFilterUI();
    });
  });

  // Clear all
  const btnClear = $('#btn-clear-filters');
  btnClear?.addEventListener('click', () => {
    setActiveFilters({ platforms: [], roles: [] });
    syncFilterUI();
  });

  // Load saved
  reapplyFilters();
  syncFilterUI();
}

function syncFilterUI() {
  const f = getActiveFilters();
  const dropdown = $('#filters-dropdown');
  if (!dropdown) return;

  dropdown.querySelectorAll('[data-filter-platform]').forEach(btn => {
    btn.classList.toggle('active', f.platforms.includes(btn.dataset.filterPlatform));
  });
  dropdown.querySelectorAll('[data-filter-role]').forEach(btn => {
    btn.classList.toggle('active', f.roles.includes(btn.dataset.filterRole));
  });

  const hasAny = f.platforms.length > 0 || f.roles.length > 0;
  $('#btn-filters')?.classList.toggle('has-active-filter', hasAny);
}

function reapplyFilters() {
  $$('#chat-messages .chat-message').forEach(row => {
    row.classList.toggle('filtered-out', shouldFilterRow(row));
  });
}

function shouldFilterRow(row) {
  const f = getActiveFilters();

  // Platform filter — show only selected platforms (OR logic)
  if (f.platforms.length > 0) {
    const matchesPlatform = f.platforms.some(p => row.classList.contains(`platform-${p}`));
    if (!matchesPlatform) return true;
  }

  // Role filter — show only messages from users with any of the selected roles (OR logic)
  if (f.roles.length > 0) {
    const matchesRole = f.roles.some(role => {
      if (role === 'mod')  return row.dataset.isMod  === 'true';
      if (role === 'vip')  return row.dataset.isVip  === 'true';
      if (role === 'sub')  return row.dataset.isSub  === 'true';
      if (role === 'owner') return row.dataset.isOwner === 'true';
      return false;
    });
    if (!matchesRole) return true;
  }

  return false;
}

// ─── Chat filter (per-message at render time) ─────────────────────────────────
function shouldFilterMessage(msg) {
  const s = state.settings;
  // Bot list
  const botList = (s.botList || '').split(',').map(b => b.trim().toLowerCase()).filter(Boolean);
  if (botList.includes((msg.username || '').toLowerCase())) return true;
  return false;
}
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
      chatInput.placeholder = 'Escribe un mensaje…';

    } else if (platform === 'tiktok') {
      const tiktokInput = $('#input-tiktok-user');
      // Username can come from: input field → state (cookie-resolved) → settings
      const inputVal = (tiktokInput?.value || '').trim().replace(/^@/, '');
      const username = inputVal
        || state.tiktokUsername
        || state.settings.tiktokUser
        || '';
      if (!username) return showToast('Escribe un usuario de TikTok o inicia sesión primero', 'warning');

      const sessionId = state.tiktokSessionId
        || state.tiktokCookies?.sessionid
        || state.tiktokCookies?.sessionid_ss
        || null;
      console.log(`[Chat] Conectando TikTok: @${username}, sessionId: ${sessionId ? 'presente' : 'ausente'}`);
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
    let status, label;
    if (data.connected && !data.idle) {
      status = 'connected';
      label  = `Twitch: #${data.channel} • En vivo`;
    } else if (data.connected && data.idle) {
      status = 'warning';
      label  = `Twitch: #${data.channel} (offline)`;
    } else {
      status = 'error';
      label  = 'Twitch: desconectado';
    }
    setStatusBadge('twitch', status, label);
  });

  // TikTok cookies
  window.chattering.tiktok.onCookiesCaptured(cookies => {
    // _resolvedUsername is injected by main.js alongside the cookie map
    const resolvedUser = cookies._resolvedUsername || null;
    delete cookies._resolvedUsername;  // don't pollute the cookie map

    state.tiktokCookies    = cookies;
    state.tiktokSessionId  = cookies.sessionid || cookies.sessionid_ss || null;
    state.tiktokUsername   = resolvedUser || state.tiktokUsername;

    window.chattering.tiktok.setCookies(cookies);

    const label = resolvedUser ? `TikTok: @${resolvedUser}` : 'TikTok: sesión activa';
    const _badge = document.getElementById('status-tiktok');
    if (!_badge?.classList.contains('connected')) {
      setStatusBadge('tiktok', 'warning', label);
    }
    showToast('Sesión TikTok capturada' + (resolvedUser ? ` como @${resolvedUser}` : ''), 'success');

    // Auto-connect if we know the username (user connecting to their own stream)
    if (resolvedUser && state.tiktokSessionId) {
      autoConnectTikTok(resolvedUser, state.tiktokSessionId);
    }
  });
  window.chattering.tiktok.onSessionRestored?.(data => {
    if (data?.sessionId) {
      state.tiktokSessionId = data.sessionId;
      // Only show yellow if not already fully connected (green)
      const badge = document.getElementById('status-tiktok');
      const alreadyConnected = badge?.classList.contains('connected');
      if (!alreadyConnected) {
        const savedUser = state.settings.tiktokUser || state.tiktokUsername;
        const label = savedUser ? `TikTok: @${savedUser}` : 'TikTok: sesión activa';
        setStatusBadge('tiktok', 'warning', label);
      }
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
    let s, l;
    const ch = data.channel ? `@${data.channel}` : '';
    if (data.connected && !data.idle) {
      s = 'connected'; l = `TikTok: ${ch}`;
    } else if (data.connected && data.idle) {
      s = 'warning';   l = `TikTok: ${ch} (offline)`;
    } else if (data.idle) {
      s = 'warning';   l = ch ? `TikTok: ${ch} (offline)` : 'TikTok: sesión activa';
    } else {
      s = 'error';     l = 'TikTok: desconectado';
    }
    setStatusBadge('tiktok', s, l);
    if (data.connected) $('#no-connections-popup')?.classList.add('hidden');
  });

  // YouTube
  window.chattering.youtube.onMessage(data => {
    appendChatMessage({ platform: 'youtube', ...data });
    maybeSpeak(data);
  });
  window.chattering.youtube.onEvent(data => {
    appendDockEvent(data);
    appendEventInChat(data);
  });
  window.chattering.youtube.onStatus(data => {
    const s = data.connected ? 'connected' : data.idle ? 'warning' : 'error';
    const l = data.connected ? `YouTube: ${data.channel}`
            : data.idle      ? `YouTube: ${data.channel} (sin live)`
            : 'YouTube: desconectado';
    setStatusBadge('youtube', s, l);
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
    // Store roles for the filter system
    row.dataset.isMod  = !!(msg.isMod  || badges.some(b => /mod|broadcaster/i.test(b.title||'')));
    row.dataset.isVip  = !!(msg.isVip  || badges.some(b => /vip/i.test(b.title||'')));
    row.dataset.isSub  = !!(msg.isSub  || badges.some(b => /sub/i.test(b.title||'')));
    row.dataset.isOwner = !!(msg.isOwner || badges.some(b => /broadcaster/i.test(b.title||'')));
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

    // Group author + sep + content so long messages wrap under the author name
    const bodyWrap = document.createElement('span');
    bodyWrap.className = 'msg-body-wrap';

    const author = document.createElement('span');
    author.className = 'msg-author';
    author.style.color = displayColor;
    author.textContent = displayName || username;
    author.addEventListener('click', (e) => {
      e.stopPropagation();
      openUserCard(e, username, displayName, platform, displayColor, badges, msg.avatarUrl || '');
    });
    bodyWrap.appendChild(author);

    const sep = document.createElement('span');
    sep.className = 'msg-sep';
    sep.textContent = isAction ? '' : ':';
    bodyWrap.appendChild(sep);

    const content = document.createElement('span');
    content.className = 'msg-content';
    content.appendChild(renderMessageContent(message, emotes, bits, platform, msg.ytEmoteMap || {}));
    bodyWrap.appendChild(content);

    row.appendChild(bodyWrap);

    // Apply chat filter if active
    if (shouldFilterMessage(msg)) {
      console.log('[Chat Renderer] ⚠️ Mensaje filtrado:', msg.username, '- plataforma:', msg.platform);
      return;
    }

    // Use rAF to batch DOM insertions — avoids layout thrash on rapid message flood
    requestAnimationFrame(() => {
      chatMessages.appendChild(row);
      if (shouldFilterRow(row)) row.classList.add('filtered-out');
    });
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
  // Debounce scroll to max 16ms (≈60fps) to avoid layout thrash
  let _scrollTimer = null;
  chatViewport.addEventListener('scroll', () => {
    if (_scrollTimer) return;
    _scrollTimer = requestAnimationFrame(() => { _scrollTimer = null; onViewportScroll(); });
  }, { passive: true });
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
    // Show the button immediately when user scrolls up, even with no new messages
    updateNewMessagesButton();
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
  if (state.isScrollPaused) {
    btnNewMessages.textContent = '';
    const icon = document.createElement('svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.innerHTML = '<path d="M7 10l5 5 5-5z"/>';
    btnNewMessages.appendChild(icon);
    const label = state.pendingCount > 0
      ? ` ${state.pendingCount > 99 ? '99+' : state.pendingCount} nuevos`
      : ' Ir al final';
    btnNewMessages.appendChild(document.createTextNode(label));
    btnNewMessages.classList.remove('hidden');
  } else {
    btnNewMessages.classList.add('hidden');
  }
}

// Limit DOM size for performance + memory management
function trimMessageList() {
  while (chatMessages.children.length > state.MAX_MESSAGES) {
    const removed = chatMessages.firstChild;
    chatMessages.removeChild(removed);
  }
  // Cap per-user session message history to prevent unbounded growth
  const MAX_SESSION_MSGS_PER_USER = 50;
  for (const key of Object.keys(state.sessionMessages)) {
    if (state.sessionMessages[key].length > MAX_SESSION_MSGS_PER_USER) {
      state.sessionMessages[key] = state.sessionMessages[key].slice(-MAX_SESSION_MSGS_PER_USER);
    }
  }
  // Cap userColorMap (keep only users seen in current DOM)
  const domUsers = new Set([...chatMessages.querySelectorAll('[data-user]')].map(el => {
    const p = el.classList.toString().match(/platform-(\w+)/)?.[1] || 'twitch';
    return `${p}:${el.dataset.user}`;
  }));
  for (const key of Object.keys(state.userColorMap)) {
    if (!domUsers.has(key)) delete state.userColorMap[key];
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
    // tmi.js filters self=true from IRC echo, so we render it locally
    const selfInfo = await window.chattering.twitch.getUser().catch(() => null);
    appendChatMessage({
      id:          String(Date.now()),
      platform:    'twitch',
      username:    selfInfo?.username || state.connectedChannels.twitch,
      displayName: selfInfo?.displayName || state.connectedChannels.twitch,
      color:       state.userColorMap?.[`twitch:${selfInfo?.username}`] || '#9147ff',
      message:     msg,
      badges:      [],
      emotes:      {},
      isAction:    false
    });
  } catch (e) {
    showToast(`No se pudo enviar: ${e.message}`, 'error');
    chatInput.value = msg; // restore message on error
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
    if (!dock) return;
    dock.style.display = '';
    // Clear any inline dimensions set by the resize handler so CSS classes take over cleanly
    dock.style.width  = '';
    dock.style.height = '';
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
    setDockPosition('top');
  }

  // ── Dock event filter ─────────────────────────────────────────────────────
  const btnDockFilter  = $('#btn-dock-filter');
  const dockFilterDrop = $('#dock-filter-dropdown');

  btnDockFilter?.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    dockFilterDrop?.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (dockFilterDrop && !dockFilterDrop.contains(e.target) && e.target !== btnDockFilter) {
      dockFilterDrop.classList.add('hidden');
    }
  });

  dockFilterDrop?.querySelectorAll('[data-filter-event]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = btn.dataset.filterEvent;
      const idx = state.dockFilters.indexOf(t);
      if (idx === -1) state.dockFilters.push(t); else state.dockFilters.splice(idx, 1);
      btn.classList.toggle('active', state.dockFilters.includes(t));
      btnDockFilter?.classList.toggle('has-active-filter', state.dockFilters.length > 0);
      // Apply filter to existing items
      if (dockEvents) {
        dockEvents.querySelectorAll('.event-item').forEach(el => {
          const evType = [...el.classList].find(cl => cl !== 'event-item') || '';
          el.style.display = (state.dockFilters.length === 0 || state.dockFilters.includes(evType)) ? '' : 'none';
        });
      }
    });
  });

  $('#btn-clear-dock-filters')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.dockFilters = [];
    dockFilterDrop?.querySelectorAll('[data-filter-event]').forEach(b => b.classList.remove('active'));
    btnDockFilter?.classList.remove('has-active-filter');
    if (dockEvents) dockEvents.querySelectorAll('.event-item').forEach(el => { el.style.display = ''; });
  });
}

// Like accumulation: one entry per user, updated in-place and pinned to bottom
const likeCountMap = {}; // { 'platform:username': { el, count } }

function appendDockEvent(evt) {
  const { type, username, displayName, amount, months, message, platform } = evt;
  const who = displayName || username || 'Anónimo';

  const ICONS = {
    follow: '💙', sub: '⭐', resub: '⭐', gift: '🎁', bits: '💎',
    like: '❤️', raid: '🚀', share: '🔁', superchat: '💛', member: '💙',
    redeem: '✨', streamEnd: '📴'
  };

  // Platform badge (short text)
  const PLAT = { twitch: 'TW', tiktok: 'TT', youtube: 'YT' };

  // ── Likes: accumulate per user, one entry pinned to bottom of dock ─────────
  if (type === 'like') {
    const key = `${platform}:${username}`;
    if (likeCountMap[key]) {
      // Update existing entry in-place
      likeCountMap[key].count += (amount || 1);
      likeCountMap[key].el.querySelector('.event-desc').textContent =
        `${likeCountMap[key].count} like(s)`;
      // Move to bottom
      dockEvents.appendChild(likeCountMap[key].el);
    } else {
      const item = buildEventItem(type, who, `${amount || 1} like(s)`, platform, ICONS, PLAT, evt);
      likeCountMap[key] = { el: item, count: amount || 1 };
      dockEvents.appendChild(item); // likes go to bottom
      if (state.settings.alertsEnabled) flashAlert(item);
    }
    window.chattering?.dock?.addEvent?.({ ...evt, amount: likeCountMap[key].count });
    return;
  }

  // ── All other events: prepend (newest at top) ─────────────────────────────
  const desc = buildEventDescription(type, amount, months, message, platform, evt.giftName);
  const item = buildEventItem(type, who, desc, platform, ICONS, PLAT, evt);
  dockEvents.prepend(item);

  // Trim to 100 items (excluding like entries which are managed separately)
  const nonLikeItems = [...dockEvents.children].filter(el => !el.classList.contains('like'));
  while (nonLikeItems.length > 100) {
    const oldest = nonLikeItems.pop();
    oldest.remove();
  }

  window.chattering?.dock?.addEvent?.({ ...evt });

  if (state.settings.alertsEnabled) flashAlert(item);
}

function buildEventItem(type, who, desc, platform, ICONS, PLAT, extraData) {
  const item = document.createElement('div');
  item.className = `event-item ${type}`;

  const icon = document.createElement('span');
  icon.className = 'event-icon';
  // TikTok gifts: show the gift image instead of emoji
  if (type === 'gift' && platform === 'tiktok' && extraData?.giftImg) {
    const gImg = document.createElement('img');
    gImg.src = extraData.giftImg;
    gImg.style.cssText = 'width:22px;height:22px;object-fit:contain;border-radius:3px;vertical-align:middle;';
    gImg.onerror = () => { gImg.replaceWith(document.createTextNode('🎁')); };
    icon.appendChild(gImg);
  } else {
    icon.textContent = ICONS[type] || '📣';
  }

  const body = document.createElement('div');
  body.className = 'event-body';

  const userEl = document.createElement('div');
  userEl.className = 'event-user';
  userEl.textContent = who;

  const descEl = document.createElement('div');
  descEl.className = 'event-desc';
  descEl.textContent = desc;

  const platEl = document.createElement('span');
  platEl.className = 'event-platform';
  platEl.textContent = PLAT[platform] || (platform || '').toUpperCase().slice(0, 2);

  body.appendChild(userEl);
  body.appendChild(descEl);
  item.appendChild(icon);
  item.appendChild(body);
  item.appendChild(platEl);
  return item;
}

function buildEventDescription(type, amount, months, message, platform, giftName) {
  switch (type) {
    case 'follow':    return 'siguió al canal';
    case 'sub':       return 'se suscribió';
    case 'resub':     return `resub ×${months || 1}`;
    case 'bits':      return `donó ${amount || 0} bits`;
    case 'like':      return `dio ${amount || 1} like(s)`;
    case 'raid':      return `hizo raid con ${amount || 0} viewers`;
    case 'superchat': return `Super Chat $${amount || 0}${message ? ': ' + message : ''}`;
    case 'share':     return 'ha compartido el live';
    case 'redeem':    return `canjeó "${giftName || message || 'recompensa'}"`;
    case 'gift':
      if (platform === 'tiktok') return `donó ${giftName || message || 'regalo'}${amount && amount > 1 ? ' ×' + amount : ''}`;
      return `regaló ${amount || 1} sub(s)`;
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

  // Likes only go to the dock (accumulated per user), never as inline chat event
  if (type === 'like') return;
  // User joined stream — not actionable
  if (type === 'member') return;
  // Stream ended — no inline banner needed
  if (type === 'streamEnd') return;

  const action = buildEventDescription(type, amount, months, message, platform, giftName);
  if (!action || action === type) return; // unknown type

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

  // ── Theme ──────────────────────────────────────────────────────────────────
  body.classList.remove('theme-dark','theme-light','theme-gray','theme-lightgray','theme-sakura','theme-midnight');
  body.classList.add(`theme-${s.theme || 'dark'}`);

  // ── Translucent ───────────────────────────────────────────────────────────
  body.classList.toggle('translucent', !!s.translucent);

  // ── Font size ─────────────────────────────────────────────────────────────
  if (s.fontSize) document.documentElement.style.setProperty('--font-size', s.fontSize + 'px');

  // ── Message animations ────────────────────────────────────────────────────
  body.classList.toggle('no-msg-anim', s.messageAnimations === false);

  // ── Reduce motion — disables all CSS transitions and animations ───────────
  body.classList.toggle('reduce-motion', !!s.reduceMotion);

  // ── High contrast — stronger text / borders ───────────────────────────────
  body.classList.toggle('high-contrast', !!s.highContrast);

  // ── Timestamps — toggle visibility on all existing + future messages ──────
  body.classList.toggle('show-timestamps', !!s.showTimestamps);

  // ── Scroll speed (1-5) — maps to scroll-behavior transition duration ──────
  const speedMs = [0, 60, 120, 200, 300, 450][s.scrollSpeed || 3] ?? 200;
  document.documentElement.style.setProperty('--scroll-speed', speedMs + 'ms');

  // ── Max messages ──────────────────────────────────────────────────────────
  if (s.maxMessages) state.MAX_MESSAGES = s.maxMessages;

  // ── TTS ───────────────────────────────────────────────────────────────────
  state.ttsEnabled = !!s.ttsEnabled;

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
  const utt  = new SpeechSynthesisUtterance(text);

  if (availableVoices.length > 0) {
    ttsMessageCount++;
    // Prefer Spanish/English voices; cycle through up to 5 for variety
    const preferred = availableVoices.filter(v => v.lang.startsWith('es') || v.lang.startsWith('en'));
    const pool      = preferred.length > 0 ? preferred : availableVoices;
    utt.voice       = pool[ttsMessageCount % Math.min(pool.length, 5)];
  } else if (state.ttsVoice) {
    utt.voice = state.ttsVoice;
  }

  const baseRate  = parseFloat(state.settings.ttsRate)  || 1;
  const basePitch = parseFloat(state.settings.ttsPitch) || 1;
  // ±20% rate variation, ±25% pitch variation — clamped to valid API ranges
  utt.rate   = Math.min(10, Math.max(0.1, baseRate  * (0.8 + Math.random() * 0.4)));
  utt.pitch  = Math.min(2,  Math.max(0,   basePitch * (0.75 + Math.random() * 0.5)));
  utt.volume = parseFloat(state.settings.ttsVolume) || 1;

  utt.onend  = () => ttsProcessQueue();
  utt.onerror = () => ttsProcessQueue();
  window.speechSynthesis.speak(utt);
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function setStatusBadge(platform, status, label) {
  const badge = $(`#status-${platform}`);
  if (!badge) return;
  // Always make visible when we have a status to show
  badge.classList.remove('hidden', 'connected', 'error', 'connecting', 'warning');
  badge.classList.add(status);
  const lbl = badge.querySelector('.status-label');
  if (lbl) lbl.textContent = label;
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