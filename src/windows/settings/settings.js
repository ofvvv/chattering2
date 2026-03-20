'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Settings Renderer
   Handles: section navigation, reading/writing settings, live preview
   ═══════════════════════════════════════════════════════════════════════════ */

// Global error handler - log all errors to console
window.onerror = function(msg, url, line, col, error) {
  console.error('[Settings Error]', msg, 'at line', line, ':', col);
  if (error && error.stack) console.error('[Stack]', error.stack);
  return false;
};

window.onunhandledrejection = function(event) {
  console.error('[Settings Unhandled Promise Rejection]', event.reason);
};

// DOM helpers - $ for single element, $$ for multiple
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

let currentSettings = {};
let saveTimeout = null;

// ─── Init ────────────────────────────────────────────────────────────────────
(async function init() {
  currentSettings = await window.chattering.settings.getAll();
  applySettingsToUI(currentSettings);
  setupNavigation();
  setupControls();
  setupWindowButtons();
})();

// ─── Navigation ───────────────────────────────────────────────────────────────
function setupNavigation() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      $$('.nav-item').forEach(b => b.classList.remove('active'));
      $$('.settings-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      $(`#sec-${section}`)?.classList.add('active');
    });
  });
}

// ─── Apply settings → UI ──────────────────────────────────────────────────────
function applySettingsToUI(s) {
  // Theme - support all themes
  document.body.classList.remove('theme-dark', 'theme-light', 'theme-gray', 'theme-lightgray', 'theme-sakura', 'theme-midnight');
  document.body.classList.add(`theme-${s.theme || 'dark'}`);

  // Map each control to its setting key
  $$('[data-key]').forEach(el => {
    const key = el.dataset.key;
    const val = s[key];
    if (val === undefined) return;

    if (el.type === 'checkbox') {
      el.checked = !!val;
    } else if (el.tagName === 'SELECT') {
      el.value = val;
    } else if (el.type === 'range' || el.type === 'number') {
      el.value = val;
      updateRangeLabel(el);
    } else {
      el.value = val;
    }
  });
}

// ─── Control event bindings ────────────────────────────────────────────────────
function setupControls() {
  // All inputs → auto-save with debounce
  $$('[data-key]').forEach(el => {
    const eventType = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(eventType, () => onControlChange(el));
  });

  // Range labels live update
  $$('input[type="range"]').forEach(el => {
    el.addEventListener('input', () => updateRangeLabel(el));
  });

  // Hide bots toggle - show/hide bot list
  const hideBotsToggle = $('#chk-hide-bots');
  const botListGroup = $('#bot-list-group');
  if (hideBotsToggle && botListGroup) {
    // Initial state
    botListGroup.style.display = hideBotsToggle.checked ? 'flex' : 'none';
    
    hideBotsToggle.addEventListener('change', () => {
      botListGroup.style.display = hideBotsToggle.checked ? 'flex' : 'none';
    });
  }

  // Reset button
  $('#btn-reset-settings')?.addEventListener('click', async () => {
    if (!confirm('¿Restablecer todos los ajustes por defecto?')) return;
    currentSettings = await window.chattering.settings.set({});
    applySettingsToUI(currentSettings);
    showSaved();
  });
}

function onControlChange(el) {
  const key = el.dataset.key;
  let val;

  if (el.type === 'checkbox') val = el.checked;
  else if (el.type === 'range' || el.type === 'number') val = parseFloat(el.value);
  else val = el.value;

  currentSettings[key] = val;

  // Apply theme changes immediately in settings window
  if (key === 'theme') {
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-gray', 'theme-lightgray', 'theme-sakura', 'theme-midnight');
    document.body.classList.add(`theme-${val}`);
    // Also apply to chat window
    window.chattering.settings.set({ theme: val });
  }

  // Apply transparency immediately
  if (key === 'transparency' || key === 'translucent') {
    window.chattering.window.setTransparency(currentSettings.transparency);
  }

  debouncedSave();
}

function debouncedSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await window.chattering.settings.set(currentSettings);
    showSaved();
  }, 400);
}

// ─── Range label updater ──────────────────────────────────────────────────────
function updateRangeLabel(el) {
  const labelMap = {
    fontSize:     'lbl-fontsize',
    maxMessages:  'lbl-max-messages',
    ttsRate:      'lbl-tts-rate',
    ttsVolume:    'lbl-tts-volume',
    ttsPitch:     'lbl-tts-pitch',
    transparency: 'lbl-transparency'
  };
  const labelId = labelMap[el.dataset.key];
  if (labelId) {
    const lbl = $(`#${labelId}`);
    if (lbl) lbl.textContent = el.value;
  }
}

// ─── Saved indicator ──────────────────────────────────────────────────────────
function showSaved() {
  const indicator = $('#settings-saved-indicator');
  if (indicator) {
    indicator.textContent = '✔ Guardado';
    indicator.classList.add('show');
    setTimeout(() => indicator.classList.remove('show'), 1800);
  }
}

// ─── Toast notification ───────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  // Add to container or create one
  let container = $('#toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;';
    document.body.appendChild(container);
  }
  
  container.appendChild(toast);
  
  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Window buttons ───────────────────────────────────────────────────────────
function setupWindowButtons() {
  $('#btn-close-settings')?.addEventListener('click', () => {
    window.chattering.window.close();
  });

  // ── Twitch OAuth ─────────────────────────────────────────────────────────────
  $('#btn-twitch-login')?.addEventListener('click', () => {
    console.log('[Settings] Twitch login clicked');
    const clientId = currentSettings.twitchClientId || 'w2q6ngvevmf1gkuu1ngiqwmyzqmjrt';
    window.chattering.twitch.openOAuth(clientId);
  });

  $('#btn-twitch-logout')?.addEventListener('click', async () => {
    console.log('[Settings] Twitch logout clicked');
    if (!confirm('¿Cerrar sesión de Twitch?')) return;
    await window.chattering.settings.set({ twitchToken: '' });
    currentSettings.twitchToken = '';
    updateConnectionStatus('twitch', false);
    showSaved();
  });

  // Listen for OAuth token capture
  window.chattering.twitch.onOAuthCaptured?.((data) => {
    console.log('[Settings] OAuth captured:', data);
    currentSettings.twitchToken = data.token;
    window.chattering.settings.set({ twitchToken: data.token });
    updateConnectionStatus('twitch', true);
    showSaved();
    showToast('Token de Twitch capturado correctamente', 'success');
  });

  // ── YouTube Connect ──────────────────────────────────────────────────────────
  $('#btn-youtube-connect')?.addEventListener('click', async () => {
    console.log('[Settings] YouTube connect clicked');
    const channelId = $('#txt-yt-channel')?.value;
    if (!channelId) {
      alert('Por favor ingresa un canal de YouTube');
      return;
    }
    // Save the channel first
    await window.chattering.settings.set({ youtubeChannel: channelId });
    currentSettings.youtubeChannel = channelId;
    showSaved();
    
    // Try to connect
    try {
      updateConnectionStatus('youtube', false, 'Conectando…');
      await window.chattering.youtube.connect(channelId);
      updateConnectionStatus('youtube', true, 'Conectado');
    } catch (e) {
      console.error('[Settings] YouTube connect error:', e);
      updateConnectionStatus('youtube', false, 'Error');
      alert('Error conectando a YouTube: ' + e.message);
    }
  });

  $('#btn-youtube-disconnect')?.addEventListener('click', async () => {
    console.log('[Settings] YouTube disconnect clicked');
    await window.chattering.youtube.disconnect();
    updateConnectionStatus('youtube', false);
  });

  $('#btn-tiktok-login')?.addEventListener('click', () => {
    console.log('[Settings] TikTok login clicked');
    window.chattering.tiktok.openAuthWindow();
  });

  $('#btn-tiktok-logout')?.addEventListener('click', async () => {
    if (!confirm('¿Cerrar sesión de TikTok? Esto eliminará la sesión guardada.')) return;
    await window.chattering.tiktok.disconnect();
    await window.chattering.settings.set({ tiktokSessionId: '', tiktokCookies: null });
    currentSettings.tiktokSessionId = '';
    currentSettings.tiktokCookies = null;
    updateConnectionStatus('tiktok', false);
    showSaved();
  });

  // Listen for TikTok cookies captured — update status immediately
  window.chattering.tiktok.onCookiesCaptured?.((cookies) => {
    if (cookies) {
      const sid = cookies.sessionid || cookies.sessionid_ss || null;
      if (sid) currentSettings.tiktokSessionId = sid;
      currentSettings.tiktokCookies = cookies;
      updateConnectionStatus('tiktok', true);
      showToast('Sesión de TikTok capturada', 'success');
    }
  });
  // ── Listen for live status updates from connectors ──────────────────────────
  window.chattering.twitch.onStatus?.((data) => {
    updateConnectionStatus('twitch', data.connected);
  });

  window.chattering.youtube.onStatus?.((data) => {
    updateConnectionStatus('youtube', data.connected, data.message);
  });

  window.chattering.tiktok.onStatus?.((data) => {
    updateConnectionStatus('tiktok', data.connected);
  });

  // Check initial connection status
  checkInitialConnectionStatus();
}

// ─── Connection status ───────────────────────────────────────────────────────
function updateConnectionStatus(platform, connected, customMsg = null) {
  const statusEl = $(`#status-${platform}`);
  if (!statusEl) return;
  
  if (connected) {
    statusEl.textContent = customMsg || 'Conectado';
    statusEl.classList.add('connected');
    
    // Toggle buttons: hide login, show logout
    const loginBtn = $(`#btn-${platform}-login`);
    const logoutBtn = $(`#btn-${platform}-logout`);
    if (loginBtn) loginBtn.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
  } else {
    statusEl.textContent = customMsg || 'Desconectado';
    statusEl.classList.remove('connected');
    
    // Toggle buttons: show login, hide logout
    const loginBtn = $(`#btn-${platform}-login`);
    const logoutBtn = $(`#btn-${platform}-logout`);
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
  }
}

async function checkInitialConnectionStatus() {
  if (currentSettings.twitchToken) updateConnectionStatus('twitch', true);
  if (currentSettings.youtubeChannel) updateConnectionStatus('youtube', true);
  // TikTok is "connected" when we have a saved sessionId or cookies
  if (currentSettings.tiktokSessionId || currentSettings.tiktokCookies) {
    updateConnectionStatus('tiktok', true);
  }
}