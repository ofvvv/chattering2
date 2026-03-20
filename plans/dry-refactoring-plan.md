# DRY Refactoring Plan - Chattering

## Overview
This document outlines the refactoring needed to apply DRY (Don't Repeat Yourself) principles across the Chattering codebase.

---

## 1. Centralized Utilities - `src/utils.js` (NEW FILE)

### 1.1 Broadcast Emitter (Currently duplicated in 3 connectors)
**Location:** `src/connectors/twitch.js`, `tiktok.js`, `youtube.js`

**Current duplicated code:**
```javascript
function emit(channel, data) {
  const { BrowserWindow } = require('electron');
  BrowserWindow.getAllWindows().forEach(win => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  });
}
```

**Solution:** Create `src/utils/broadcast.js`:
```javascript
const { BrowserWindow } = require('electron');

function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  });
}

module.exports = { broadcast };
```

**Impact:** ~15 lines removed from each connector (45 lines total)

---

### 1.2 Time Formatting (Duplicated across renderers)
**Location:** Multiple files - timestamps in chat.js, dock.js

**Solution:** Add to `src/utils/time.js`:
```javascript
function formatTime(date = new Date()) {
  return date.toLocaleTimeString('es-MX', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

module.exports = { formatTime };
```

---

### 1.3 HTML Escape/Sanitization
**Location:** chat.js, dock.js

**Current in chat.js:**
```javascript
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

**Current in dock.js:**
```javascript
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

**Solution:** Add to `src/utils/sanitize.js`:
```javascript
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/"/g, '"');
}

module.exports = { escapeHtml, escapeAttr };
```

**Impact:** ~10 lines removed (5 per file)

---

## 2. Unified Platform Handler Factory

### 2.1 Similar Event Listeners (chat.js)
**Current pattern:**
```javascript
window.chattering.twitch.onMessage(data => appendChatMessage({ platform: 'twitch', ...data }));
window.chattering.tiktok.onMessage(data => appendChatMessage({ platform: 'tiktok', ...data }));
window.chattering.youtube.onMessage(data => appendChatMessage({ platform: 'youtube', ...data }));

window.chattering.twitch.onEvent(data => appendDockEvent(data));
window.chattering.tiktok.onEvent(data => appendDockEvent(data));
```

**Solution:** Create factory function in chat.js:
```javascript
function createPlatformHandler(platform) {
  return {
    onMessage: (data) => appendChatMessage({ platform, ...data }),
    onEvent: (data) => appendDockEvent(data),
    onStatus: (data) => handleStatus(platform, data)
  };
}

// Usage:
const twitch = window.chattering.twitch;
twitch.onMessage(createPlatformHandler('twitch').onMessage);
twitch.onEvent(createPlatformHandler('twitch').onEvent);
```

**Impact:** ~30 lines reduced

---

## 3. DOM Helper Utilities

### 3.1 Element Creation Helpers (chat.js)
**Current:** 50+ lines of repetitive `document.createElement` calls

**Solution:** Add to `src/utils/dom.js`:
```javascript
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'className') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  });
  children.forEach(c => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c instanceof Node) e.appendChild(c);
  });
  return e;
}

// Example: el('span', { className: 'msg-author', text: username })
```

**Impact:** ~100 lines reduced in chat.js

---

## 4. Event Delegation

### 4.1 Dock Event Listeners
**Current:** Each button has individual event listener in chat.js

**Solution:**
```javascript
// Instead of:
btnDockTop?.addEventListener('click', () => setDockPosition('top'));
btnDockLeft?.addEventListener('click', () => setDockPosition('left'));
// ...

// Use delegation:
$('#dock-controls')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[id^="btn-dock-"]');
  if (!btn) return;
  const pos = btn.id.replace('btn-dock-', '');
  setDockPosition(pos);
});
```

**Impact:** ~15 lines reduced

---

## 5. Connector Base Class Pattern

### 5.1 Shared Connector Logic
All three connectors have:
- `connect()` / `disconnect()` pattern
- `setStatus()` 
- Event handlers

**Solution:** Create `src/connectors/base-connector.js`:
```javascript
class BaseConnector {
  constructor(platformName) {
    this.platform = platformName;
    this.connection = null;
  }
  
  broadcast(channel, data) {
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(win => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    });
  }
  
  emitStatus(connected, extra = {}) {
    this.broadcast(`${this.platform}:status`, { 
      connected, 
      ...extra 
    });
  }
  
  emit(channel, data) {
    this.broadcast(`${this.platform}:${channel}`, data);
  }
}

module.exports = { BaseConnector };
```

**Impact:** ~60 lines removed from connectors

---

## Summary of Impact

| Area | Current Lines | After Refactor | Reduction |
|------|---------------|----------------|-----------|
| Emit functions (3 files) | 45 | 10 | 35 (78%) |
| EscapeHtml (2 files) | 10 | 5 | 5 (50%) |
| Platform handlers | 30 | 15 | 15 (50%) |
| DOM helpers | 100 | 30 | 70 (70%) |
| Event delegation | 15 | 5 | 10 (67%) |
| Connector base | 60 | 20 | 40 (67%) |
| **TOTAL** | **260** | **85** | **175 (67%)** |

---

## Implementation Order

1. Create `src/utils/` directory
2. Add `broadcast.js`, `time.js`, `sanitize.js`, `dom.js`
3. Refactor connectors to use shared `broadcast.js`
4. Refactor chat.js DOM helpers
5. Add event delegation for dock controls
6. Create platform handler factory
7. Optionally create base connector class

---

## Files to Modify

- `src/connectors/twitch.js` - Use shared broadcast
- `src/connectors/tiktok.js` - Use shared broadcast  
- `src/connectors/youtube.js` - Use shared broadcast
- `src/windows/chat/chat.js` - DOM helpers, event delegation
- `src/windows/dock/dock.js` - Use shared sanitize

## Files to Create

- `src/utils/broadcast.js`
- `src/utils/time.js`
- `src/utils/sanitize.js`
- `src/utils/dom.js`
- `src/utils/index.js` (exports all)
