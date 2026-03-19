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
const state = {
  settings: {},
  emoteCache: {},          // { platform_code: { url, type } }
  badgeCache: {},          // { twitch_badge_set: { version: url } }
  sessionMsgCount: {},     // { username: count }
  isScrollPaused: false,
  pendingCount: 0,
  activePlatform: 'twitch',
  connectedChannels: { twitch: null, tiktok: null, youtube: null },
  tiktokCookies: null,
  ttsEnabled: false,
  ttsVoice: null,
  ttsQueue: [],
  ttsBusy: false,
  MAX_MESSAGES: 500        // keep DOM lean
};

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
    console.error('[Chat] Error en auto-conexión:', err);
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
      
      // Extract sessionId from cookies if available
      let sessionId = null;
      if (state.tiktokCookies) {
        sessionId = state.tiktokCookies.sessionid || state.tiktokCookies.sessionid_ss || null;
      }
      
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
  window.chattering.twitch.onEvent(data => appendDockEvent(data));
  window.chattering.twitch.onStatus(data => {
    const label = data.connected
      ? `Twitch: #${data.channel}`
      : `Twitch: desconectado`;
    setStatusBadge('twitch', data.connected ? 'connected' : 'error', label);
  });

  // TikTok cookies
  window.chattering.tiktok.onCookiesCaptured(cookies => {
    state.tiktokCookies = cookies;
    // Send cookies to main process for the connector
    window.chattering.tiktok.setCookies(cookies);
    showToast('Sesión TikTok capturada', 'success');
  });
  window.chattering.tiktok.onMessage(data => {
    appendChatMessage({ platform: 'tiktok', ...data });
    maybeSpeak(data);
  });
  window.chattering.tiktok.onEvent(data => appendDockEvent(data));
  window.chattering.tiktok.onStatus(data => {
    setStatusBadge('tiktok', data.connected ? 'connected' : 'error',
      data.connected ? `TikTok: @${data.channel}` : 'TikTok: desconectado');
  });

  // YouTube
  window.chattering.youtube.onMessage(data => {
    appendChatMessage({ platform: 'youtube', ...data });
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
    console.log('[Chat Renderer] appendChatMessage llamado con:', msg);
    const {
      platform, id, username, displayName, color,
      message, badges = [], emotes = {}, isAction = false,
      bits, deleted = false, highlighted = false
    } = msg;

    // Track per-user count
    state.sessionMsgCount[username] = (state.sessionMsgCount[username] || 0) + 1;

    const row = document.createElement('div');
    row.className = `chat-message platform-${platform}`;
    row.dataset.id = id || '';
    row.dataset.user = username;
    if (isAction)    row.classList.add('action');
    if (deleted)     row.classList.add('deleted');
    if (highlighted) row.classList.add('highlighted');
    if (bits)        row.classList.add('bits');

    // Platform dot
    const dot = document.createElement('span');
    dot.className = 'msg-platform-dot';
    row.appendChild(dot);

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
    author.style.color = color || getPlatformColor(platform);
    author.textContent = displayName || username;
    author.addEventListener('click', (e) => {
      e.stopPropagation();
      if (platform === 'twitch') openUserCard(username, displayName, color, badges);
    });
    row.appendChild(author);

    const sep = document.createElement('span');
    sep.className = 'msg-sep';
    sep.textContent = isAction ? '' : ':';
    row.appendChild(sep);

    // Message content with emotes
    const content = document.createElement('span');
    content.className = 'msg-content';
    content.appendChild(renderMessageContent(message, emotes, bits));
    row.appendChild(content);

    // Apply chat filter if active
    if (shouldFilterMessage(msg)) return;

    chatMessages.appendChild(row);
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
function renderMessageContent(text, emoteMap = {}, bits = 0) {
  const frag = document.createDocumentFragment();

  // Build sorted list of emote positions from Twitch emote map
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
      const chunk = text.slice(cursor, pos.start);
      frag.appendChild(renderTextChunk(chunk));
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
    frag.appendChild(renderTextChunk(text.slice(cursor)));
  }

  return frag;
}

// Render a text chunk, expanding 3rd-party emote codes found in state.emoteCache
function renderTextChunk(text) {
  const frag = document.createDocumentFragment();
  const words = text.split(' ');

  words.forEach((word, i) => {
    if (state.emoteCache[word]) {
      console.log('[Chat] Renderizando emote:', word);
      const img = document.createElement('img');
      img.className = 'emote';
      img.src = state.emoteCache[word].url;
      img.alt = word;
      img.title = word;
      img.loading = 'lazy';
      frag.appendChild(img);
    } else {
      frag.appendChild(document.createTextNode(i === 0 ? word : ' ' + word));
    }
    if (i < words.length - 1 && state.emoteCache[word]) {
      frag.appendChild(document.createTextNode(' '));
    }
  });

  return frag;
}

// ─── Emotes ───────────────────────────────────────────────────────────────────
async function loadEmotes(platform, channelId) {
  try {
    const cache = await window.chattering.emotes.loadForChannel(platform, channelId);
    console.log('[Chat] Emotes cargados para', platform, channelId, '- total en cache:', Object.keys(cache).length);
    console.log('[Chat] Primeros 10 emotes:', Object.keys(cache).slice(0, 10));
    Object.assign(state.emoteCache, cache);
    console.log('[Chat] EmoteCache ahora tiene:', Object.keys(state.emoteCache).length, 'emotes');
  } catch (e) {
    console.warn('[Chattering] Error cargando emotes:', e);
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
      // Hide float button when docked
      if (btnDockFloat) {
        btnDockFloat.style.display = 'none';
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
  
  btnDockTop?.addEventListener('click', () => setDockPosition('top'));
  btnDockLeft?.addEventListener('click', () => setDockPosition('left'));
  btnDockRight?.addEventListener('click', () => setDockPosition('right'));
  btnDockBottom?.addEventListener('click', () => setDockPosition('bottom'));
  
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

// ─── User card popup ──────────────────────────────────────────────────────────
function setupUserCard() {
  $('#usercard-close').addEventListener('click', closeUserCard);

  $('#uc-ban').addEventListener('click', async () => {
    const user = $('#usercard-popup').dataset.user;
    const channel = state.connectedChannels.twitch;
    if (!user || !channel) return;
    await window.chattering.twitch.ban(channel, user, '');
    showToast(`${user} baneado`, 'success');
    closeUserCard();
    markMessagesDeleted(user);
  });

  $('#uc-timeout').addEventListener('click', async () => {
    const user = $('#usercard-popup').dataset.user;
    const channel = state.connectedChannels.twitch;
    if (!user || !channel) return;
    const secs = parseInt(prompt('Segundos de timeout (ej: 600):', '600')) || 600;
    await window.chattering.twitch.timeout(channel, user, secs, '');
    showToast(`${user} silenciado ${secs}s`, 'success');
    closeUserCard();
  });

  $('#uc-unban').addEventListener('click', async () => {
    const user = $('#usercard-popup').dataset.user;
    const channel = state.connectedChannels.twitch;
    if (!user || !channel) return;
    await window.chattering.twitch.unban(channel, user);
    showToast(`${user} desbaneado`, 'success');
    closeUserCard();
  });

  // Close on backdrop click
  document.addEventListener('click', (e) => {
    const popup = $('#usercard-popup');
    if (!popup.classList.contains('hidden') && !popup.contains(e.target)) {
      closeUserCard();
    }
  });
}

async function openUserCard(username, displayName, color, badges) {
  const popup = $('#usercard-popup');
  popup.dataset.user = username;

  $('#usercard-name').textContent = displayName || username;
  $('#usercard-name').style.color = color || '#efeff1';
  $('#usercard-msgs').textContent = state.sessionMsgCount[username] || 0;

  // Render badges
  const badgesEl = $('#usercard-badges');
  badgesEl.innerHTML = '';
  badges.forEach(b => {
    if (!b.url) return;
    const img = document.createElement('img');
    img.className = 'badge';
    img.src = b.url;
    img.alt = b.title || '';
    badgesEl.appendChild(img);
  });

  popup.classList.remove('hidden');

  // Fetch extra data from Twitch API if connected
  if (state.connectedChannels.twitch) {
    try {
      const card = await window.chattering.twitch.getUserCard(
        state.connectedChannels.twitch, username
      );
      if (card) {
        if (card.avatarUrl) $('#usercard-avatar').src = card.avatarUrl;
        $('#uc-followed').textContent = card.followedAt
          ? new Date(card.followedAt).toLocaleDateString('es')
          : '—';
        $('#uc-sub').textContent = card.isSub ? '✔' : '—';
      }
    } catch (_) { /* non-critical */ }
  }
}

function closeUserCard() {
  $('#usercard-popup').classList.add('hidden');
  $('#usercard-avatar').src = '';
  $('#uc-followed').textContent = '—';
  $('#uc-sub').textContent = '—';
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
  const { username, message } = msg;
  if (!message) return;
  const text = `${username} dice: ${message}`;
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
