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
  state.settings = await window.chattering.settings.getAll();
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
})();

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
  // Twitch
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
      const channel = $('#input-twitch-channel').value.trim().replace(/^#/, '');
      const token   = $('#input-twitch-token').value.trim();
      if (!channel) return showToast('Escribe un canal de Twitch', 'warning');
      const res = await window.chattering.twitch.connect(channel, token || null);
      if (res.error) throw new Error(res.error);
      state.connectedChannels.twitch = channel;
      addSystemMessage(`Conectado a #${channel} (Twitch)`, 'twitch');
      // Load emotes
      loadEmotes('twitch', res.userId || channel);
      chatInput.placeholder = `Escribe un mensaje en #${channel}…`;

    } else if (platform === 'tiktok') {
      const username = $('#input-tiktok-user').value.trim().replace(/^@/, '');
      if (!username) return showToast('Escribe un usuario de TikTok', 'warning');
      const res = await window.chattering.tiktok.connect(username);
      if (res.error) throw new Error(res.error);
      state.connectedChannels.tiktok = username;
      addSystemMessage(`Conectado a @${username} (TikTok)`, 'tiktok');
      loadEmotes('tiktok', username);

    } else if (platform === 'youtube') {
      const handle = $('#input-yt-handle').value.trim();
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
    Object.assign(state.emoteCache, cache);
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
  btnClearEvents.addEventListener('click', () => {
    dockEvents.innerHTML = '';
  });
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

  // Theme
  body.classList.remove('theme-dark', 'theme-light');
  body.classList.add(s.theme === 'light' ? 'theme-light' : 'theme-dark');

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
  // Filter by platform
  if (settings.filterPlatform && settings.filterPlatform !== 'all') {
    if (msg.platform !== settings.filterPlatform) return true;
  }
  // Filter bot messages
  const botList = (settings.botList || '').split(',').map(b => b.trim().toLowerCase()).filter(Boolean);
  if (botList.includes((msg.username || '').toLowerCase())) return true;

  return false;
}

// ─── TTS ─────────────────────────────────────────────────────────────────────
function initTTS() {
  if (!('speechSynthesis' in window)) return;
  // Pre-load voices
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    const voices = window.speechSynthesis.getVoices();
    state.ttsVoice = voices.find(v => v.lang.startsWith('es')) || voices[0] || null;
  });
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

function ttsProcessQueue() {
  if (!state.ttsQueue.length) { state.ttsBusy = false; return; }
  state.ttsBusy = true;
  const text = state.ttsQueue.shift();
  const utt = new SpeechSynthesisUtterance(text);
  if (state.ttsVoice) utt.voice = state.ttsVoice;
  utt.rate  = state.settings.ttsRate  || 1;
  utt.pitch = state.settings.ttsPitch || 1;
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
$('#btn-minimize').addEventListener('click', () => window.chattering.window.minimize());
$('#btn-maximize').addEventListener('click', () => window.chattering.window.maximize());
$('#btn-close').addEventListener('click',    () => window.chattering.window.close());
$('#btn-settings').addEventListener('click', () => window.chattering.settings.open());

// ─── Live settings refresh ────────────────────────────────────────────────────
// Main process broadcasts 'settings:updated' whenever settings change.
// The preload forwards this via _onSettingsUpdated.
window.chattering._onSettingsUpdated(newSettings => applySettings(newSettings));
