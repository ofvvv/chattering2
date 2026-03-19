'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Dock Window Renderer
   ─────────────────────────────────────────────────────────────────────────
   Responsibilities:
   - Display events in floating dock window
   - Handle dock position buttons (dock in main chat window)
   - Sync events with main chat dock
   ═══════════════════════════════════════════════════════════════════════════ */

// Global error handler
window.onerror = function(msg, url, line, col, error) {
  console.error('[Dock Error]', msg, 'at line', line, ':', col);
  return false;
};

window.onunhandledrejection = function(event) {
  console.error('[Dock Unhandled Promise Rejection]', event.reason);
};

// DOM references
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const dockEvents = $('#dock-events');
const dock = $('#events-dock');
const btnDockTop = $('#btn-dock-top');
const btnDockLeft = $('#btn-dock-left');
const btnDockRight = $('#btn-dock-right');
const btnDockBottom = $('#btn-dock-bottom');
const btnClearEvents = $('#btn-clear-events');

// ─── Event handlers ───────────────────────────────────────────────────────

// Dock position buttons - tell main to close dock window and dock in chat
btnDockTop?.addEventListener('click', () => {
  window.chattering?.dock?.setPosition('top');
});

btnDockLeft?.addEventListener('click', () => {
  window.chattering?.dock?.setPosition('left');
});

btnDockRight?.addEventListener('click', () => {
  window.chattering?.dock?.setPosition('right');
});

btnDockBottom?.addEventListener('click', () => {
  window.chattering?.dock?.setPosition('bottom');
});

// Clear events
btnClearEvents?.addEventListener('click', () => {
  if (dockEvents) {
    dockEvents.innerHTML = '';
  }
  // Tell main to clear events in chat dock too
  window.chattering?.dock?.clearEvents();
});

// ─── Event display ───────────────────────────────────────────────────────

/**
 * Add an event to the dock
 * @param {Object} event - Event data
 */
function addEvent(event) {
  if (!dockEvents) return;
  
  const el = document.createElement('div');
  el.className = `event-item event-${event.type}`;
  
  const icons = {
    follow: '👤',
    sub: '⭐',
    gift: '🎁',
    raid: '🚨',
    host: '📡',
    chat: '💬'
  };
  
  el.innerHTML = `
    <span class="event-icon">${icons[event.type] || '•'}</span>
    <span class="event-content">
      <span class="event-message">${escapeHtml(event.message)}</span>
      ${event.time ? `<span class="event-time">${event.time}</span>` : ''}
    </span>
  `;
  
  dockEvents.appendChild(el);
  
  // Auto-scroll to bottom
  dockEvents.scrollTop = dockEvents.scrollHeight;
  
  // Limit events to prevent memory issues
  while (dockEvents.children.length > 100) {
    dockEvents.removeChild(dockEvents.firstChild);
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── IPC listeners ───────────────────────────────────────────────────────

// Listen for events from main process
if (window.chattering?._onDockEvent) {
  window.chattering._onDockEvent((event) => {
    addEvent(event);
  });
}

// Listen for clear events from main
if (window.chattering?._onDockClear) {
  window.chattering._onDockClear(() => {
    if (dockEvents) {
      dockEvents.innerHTML = '';
    }
  });
}

// Listen for theme updates
if (window.chattering?._onSettingsUpdated) {
  window.chattering._onSettingsUpdated((settings) => {
    if (settings.theme) {
      document.body.classList.remove('theme-dark', 'theme-light');
      document.body.classList.add(`theme-${settings.theme}`);
    }
  });
}

// Request initial settings
if (window.chattering?.settings) {
  window.chattering.settings.get(['theme', 'dockPosition']).then(settings => {
    if (settings.theme) {
      document.body.classList.remove('theme-dark', 'theme-light');
      document.body.classList.add(`theme-${settings.theme}`);
    }
  });
}

console.log('[Dock] Window initialized');
