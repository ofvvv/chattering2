# Architecture: Chattering

## Process Model

```
┌─────────────────────────────────────────────────────┐
│  MAIN PROCESS (Node.js)                              │
│  main.js                                             │
│  ├── BrowserWindow: chat (main)                      │
│  ├── BrowserWindow: settings (floating)              │
│  ├── BrowserWindow: tiktok-auth (cookie capture)     │
│  ├── src/ipc/handlers.js   ← all ipcMain registrations│
│  ├── src/connectors/       ← platform connectors     │
│  └── src/managers/         ← settings, emotes        │
└──────────────────┬──────────────────────────────────┘
                   │ contextBridge (preload.js)
       ┌───────────┴───────────┐
       ▼                       ▼
┌──────────────┐       ┌───────────────┐
│ Chat Window  │       │Settings Window│
│ (renderer)   │       │ (renderer)    │
│ index.html   │       │ index.html    │
│ chat.css     │       │ settings.css  │
│ chat.js      │       │ settings.js   │
└──────────────┘       └───────────────┘
```

## IPC Communication

All IPC uses the `window.chattering` bridge exposed by `preload.js`:

- `ipcRenderer.invoke` (async request/response) for: connect, disconnect, getUserCard, settings get/set, emotes load
- `ipcRenderer.send` (fire-and-forget) for: window controls, TikTok auth open, TTS
- `ipcRenderer.on` (events from main) for: chat messages, events, status updates, settings:updated

## Platform Connector Pattern

Each connector (`twitch.js`, `tiktok.js`, `youtube.js`) follows the same pattern:

```js
connect(channel, getMainWindow)  → Promise<{ connected, ... }>
disconnect()                      → Promise<void>
// Internal: emit(channel, data) → win.webContents.send(channel, data)
```

Connectors never directly import `electron` (except for `webContents.send`), keeping them testable.

## Settings Flow

1. User changes a setting in the settings window
2. `settings.js` calls `window.chattering.settings.set(patch)` (debounced 400ms)
3. IPC handler in main process calls `SettingsManager.set(patch)` and broadcasts `settings:updated` to all windows
4. `chat.js` receives `settings:updated` via `window.chattering._onSettingsUpdated(cb)` and calls `applySettings()`

## CSS Architecture

- One CSS file per window (no shared CSS file)
- All theme variables defined as CSS custom properties on `.theme-dark` / `.theme-light`
- No inline styles in HTML (except dynamic `style.color` for usernames, set by JS)
- No Tailwind, no CSS-in-JS

## Performance Considerations

- `backgroundThrottling: false` on main window to prevent lag when unfocused
- Message DOM trimmed to `maxMessages` (default 500) to limit memory
- Emote images use `loading="lazy"` to avoid blocking render
- Scroll uses native `overflow-y: auto` with `overscroll-behavior: contain`
- YouTube connector polls every 5 seconds (configurable)
- TikTok connector uses WebSocket via tiktok-live-connector (push-based)
- Twitch connector uses WebSocket via tmi.js (push-based)
