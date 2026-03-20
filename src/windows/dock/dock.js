'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Dock Window Renderer
   ─────────────────────────────────────────────────────────────────────────
   Fix log:
   - _onDockEvent and _onDockClear were accessed as window.chattering._on...
     but the preload exposes them under window.chattering.dock._on...
     → dock never received events or clear signals in floating mode
   ═══════════════════════════════════════════════════════════════════════════ */

window.onerror = function(msg, url, line, col, error) {
  console.error('[Dock Error]', msg, 'at line', line, ':', col);
  return false;
};
window.onunhandledrejection = function(event) {
  console.error('[Dock Unhandled Promise Rejection]', event.reason);
};

const $ = (sel, ctx = document) => ctx.querySelector(sel);

const dockEvents    = $('#dock-events');
const btnDockTop    = $('#btn-dock-top');
const btnDockLeft   = $('#btn-dock-left');
const btnDockRight  = $('#btn-dock-right');
const btnDockBottom = $('#btn-dock-bottom');
const btnClearEvents = $('#btn-clear-events');
const btnMinimize   = $('#btn-minimize');

// ─── Dock position buttons ────────────────────────────────────────────────────
btnDockTop?.addEventListener('click',    () => window.chattering?.dock?.setPosition('top'));
btnDockLeft?.addEventListener('click',   () => window.chattering?.dock?.setPosition('left'));
btnDockRight?.addEventListener('click',  () => window.chattering?.dock?.setPosition('right'));
btnDockBottom?.addEventListener('click', () => window.chattering?.dock?.setPosition('bottom'));

// Minimize → return dock to last saved position inside chat window
btnMinimize?.addEventListener('click', () => {
  window.chattering?.settings?.get(['dockPosition']).then(s => {
    window.chattering?.dock?.setPosition(s?.dockPosition || 'top');
  }).catch(() => {
    window.chattering?.dock?.setPosition('top');
  });
});

// Clear events in both this window and the main chat dock
btnClearEvents?.addEventListener('click', () => {
  if (dockEvents) dockEvents.innerHTML = '';
  window.chattering?.dock?.clearEvents();
});

// ─── Event display ────────────────────────────────────────────────────────────
function addEvent(event) {
  if (!dockEvents) return;

  const icons = { follow: '👤', sub: '⭐', gift: '🎁', raid: '🚨', host: '📡', chat: '💬' };

  const el = document.createElement('div');
  el.className = `event-item event-${event.type}`;
  el.innerHTML = `
    <span class="event-icon">${icons[event.type] || '•'}</span>
    <span class="event-content">
      <span class="event-message">${escapeHtml(event.message || '')}</span>
      ${event.time ? `<span class="event-time">${escapeHtml(event.time)}</span>` : ''}
    </span>
  `;

  dockEvents.appendChild(el);
  dockEvents.scrollTop = dockEvents.scrollHeight;

  // Cap at 100 items to prevent memory growth
  while (dockEvents.children.length > 100) {
    dockEvents.removeChild(dockEvents.firstChild);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── IPC listeners ────────────────────────────────────────────────────────────
// FIXED: events live under window.chattering.dock, not window.chattering
window.chattering?.dock?._onDockEvent((event) => addEvent(event));

window.chattering?.dock?._onDockClear(() => {
  if (dockEvents) dockEvents.innerHTML = '';
});

// Theme sync
window.chattering?._onSettingsUpdated((settings) => {
  if (settings.theme) {
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-gray', 'theme-lightgray', 'theme-sakura', 'theme-midnight');
    document.body.classList.add(`theme-${settings.theme}`);
  }
});

// Apply saved theme on load
window.chattering?.settings?.get(['theme']).then(s => {
  if (s?.theme) {
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-gray', 'theme-lightgray', 'theme-sakura', 'theme-midnight');
    document.body.classList.add(`theme-${s.theme}`);
  }
});

console.log('[Dock] Window initialized');