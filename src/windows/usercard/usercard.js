'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – User Card Renderer
   ─────────────────────────────────────────────────────────────────────────
   Receives user data from main process via 'usercard:data' IPC channel.
   Handles:
   - User info display (avatar, name, badges)
   - Message history from current session
   - Moderation actions (Twitch only; grayed out for YouTube/TikTok)
   - Click on name → opens profile in default browser
   ═══════════════════════════════════════════════════════════════════════════ */

window.onerror = (msg, url, line) => {
  console.error('[UserCard]', msg, 'at line', line);
  return false;
};

const $ = sel => document.querySelector(sel);

// ── DOM refs ──────────────────────────────────────────────────────────────────
const ucPlatformIcon = $('#uc-platform-icon');
const ucHeaderTitle  = $('#uc-header-title');
const ucAvatar       = $('#uc-avatar');
const ucDisplayname  = $('#uc-displayname');
const ucUsernameLine = $('#uc-username-line');
const ucBadgesRow    = $('#uc-badges-row');
const statMsgs       = $('#stat-msgs');
const statSub        = $('#stat-sub');
const statMod        = $('#stat-mod');
const ucHistoryList  = $('#uc-history-list');
const ucModLabel     = $('#uc-mod-label');
const modReason      = $('#mod-reason');
const banBtn         = $('#mod-ban');
const unbanBtn       = $('#mod-unban');
const timeoutBtns    = document.querySelectorAll('.timeout-btn');

// ── Platform SVGs (with brand colors) ────────────────────────────────────────
const PLATFORM_ICONS = {
  twitch:  `<svg viewBox="0 0 24 24"><path fill="#9147ff" d="M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2L3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29l-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.14V3.43h12z"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24"><path fill="#ff0000" d="M21.58 7.19c-.23-.87-.91-1.56-1.78-1.79C18.25 5 12 5 12 5s-6.25 0-7.8.4c-.87.23-1.55.92-1.78 1.79C2 8.75 2 12 2 12s0 3.25.42 4.81c.23.87.91 1.56 1.78 1.79C5.75 19 12 19 12 19s6.25 0 7.8-.4c.87-.23 1.55-.92 1.78-1.79C22 15.25 22 12 22 12s0-3.25-.42-4.81zM10 15V9l5.2 3-5.2 3z"/></svg>`,
  tiktok:  `<svg viewBox="0 0 24 24"><path fill="#ff0050" d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 00-.79-.05A6.34 6.34 0 003.15 15.3a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34l-.01-8.91a8.16 8.16 0 004.77 1.52V4.46a4.85 4.85 0 01-.99-.23z"/></svg>`
};

// ── Profile URL per platform ──────────────────────────────────────────────────
function getProfileUrl(platform, username, channelId) {
  const clean = username.replace(/^@/, '');
  switch (platform) {
    case 'twitch':  return `https://twitch.tv/${clean}`;
    case 'youtube': return channelId
      ? `https://www.youtube.com/channel/${channelId}`
      : `https://www.youtube.com/@${clean}`;
    case 'tiktok':  return `https://www.tiktok.com/@${clean}`;
    default:        return `#`;
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Current state ─────────────────────────────────────────────────────────────
let currentData = null;

// ── Render ────────────────────────────────────────────────────────────────────
function render(data) {
  currentData = data;
  const {
    platform = 'twitch',
    username = '',
    displayName = '',
    color,
    avatarUrl,
    badges = [],
    messages = [],
    isModerator = false,
    isSub = false,
    channel,
    channelId
  } = data;

  // Header
  ucPlatformIcon.innerHTML = PLATFORM_ICONS[platform] || '';
  ucHeaderTitle.textContent = displayName || username;

  // Avatar
  if (avatarUrl) {
    ucAvatar.src = avatarUrl;
    ucAvatar.style.display = '';
  } else {
    ucAvatar.style.display = 'none';
  }

  // Name + link
  ucDisplayname.textContent = displayName || username;
  if (color) ucDisplayname.style.color = color;
  const profileUrl = getProfileUrl(platform, username, channelId);
  ucDisplayname.href = profileUrl;

  ucDisplayname.addEventListener('click', (e) => {
    e.preventDefault();
    window.chattering.usercard.openProfile(profileUrl);
  });

  // Sub-username line (show @username if different from displayName)
  const subLine = username !== displayName ? `@${username.replace(/^@/, '')}` : '';
  ucUsernameLine.textContent = subLine;

  // Badges
  ucBadgesRow.innerHTML = '';
  badges.forEach(b => {
    if (!b.url) return;
    const img = document.createElement('img');
    img.className = 'uc-badge-img';
    img.src = b.url;
    img.alt = b.title || '';
    img.title = b.title || '';
    ucBadgesRow.appendChild(img);
  });

  // Stats
  statMsgs.textContent = messages.length;
  statSub.textContent  = isSub       ? '✓' : '—';
  statMod.textContent  = isModerator ? '✓' : '—';

  // Message history (newest at bottom)
  ucHistoryList.innerHTML = '';
  messages.slice(-25).forEach(msg => {
    const el = document.createElement('div');
    el.className = 'uc-msg';
    const time = new Date(msg.timestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `<span class="uc-msg-time">${time}</span>${escapeHtml(msg.message)}`;
    ucHistoryList.appendChild(el);
  });
  ucHistoryList.scrollTop = ucHistoryList.scrollHeight;

  // Moderation availability
  const modEnabled = platform === 'twitch';
  document.querySelectorAll('.mod-btn').forEach(btn => {
    btn.disabled = !modEnabled;
  });
  modReason.disabled = !modEnabled;

  const platformLabel = { youtube: 'YouTube', tiktok: 'TikTok' }[platform];
  ucModLabel.textContent = modEnabled
    ? 'Moderación'
    : `Moderación (no disponible en ${platformLabel || platform})`;
}

// ── Moderation actions ────────────────────────────────────────────────────────
function flashBtn(btn, text) {
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

timeoutBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!currentData) return;
    const secs   = parseInt(btn.dataset.secs, 10);
    const reason = modReason.value.trim() || 'Moderación';
    window.chattering.twitch.timeout(currentData.channel, currentData.username, secs, reason);
    flashBtn(btn, `${btn.textContent} ✓`);
  });
});

banBtn.addEventListener('click', () => {
  if (!currentData) return;
  if (banBtn.dataset.confirming) {
    // Second click — confirm
    const reason = modReason.value.trim() || 'Moderación';
    window.chattering.twitch.ban(currentData.channel, currentData.username, reason);
    delete banBtn.dataset.confirming;
    banBtn.textContent = 'Ban';
    flashBtn(banBtn, 'Baneado ✓');
  } else {
    // First click — ask for confirmation inline
    banBtn.dataset.confirming = '1';
    const orig = banBtn.textContent;
    banBtn.textContent = '¿Confirmar?';
    setTimeout(() => {
      if (banBtn.dataset.confirming) {
        delete banBtn.dataset.confirming;
        banBtn.textContent = orig;
      }
    }, 3500);
  }
});

unbanBtn.addEventListener('click', () => {
  if (!currentData) return;
  window.chattering.twitch.unban(currentData.channel, currentData.username);
  flashBtn(unbanBtn, 'Desbaneado ✓');
});

// ── Close button ──────────────────────────────────────────────────────────────
$('#uc-close-btn').addEventListener('click', () => {
  window.chattering.usercard.close();
});

// ── IPC: receive data ─────────────────────────────────────────────────────────
window.chattering.usercard._onData((data) => render(data));

// ── Theme sync ────────────────────────────────────────────────────────────────
const THEME_CLASSES = ['theme-dark','theme-light','theme-gray','theme-lightgray','theme-sakura','theme-midnight'];

function applyTheme(theme) {
  document.body.classList.remove(...THEME_CLASSES);
  document.body.classList.add(`theme-${theme || 'dark'}`);
}

window.chattering._onSettingsUpdated?.((s) => { if (s.theme) applyTheme(s.theme); });

window.chattering.settings.get(['theme']).then(s => {
  if (s?.theme) applyTheme(s.theme);
});

console.log('[UserCard] Initialised');