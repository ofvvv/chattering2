# Active Context: Chattering

## Current State

**Status**: ✅ Initial implementation complete — ready for first `electron .` run

All core modules are implemented and all npm/bun dependencies are installed.

## Recently Completed

- [x] Replaced Next.js template with full Electron app
- [x] `package.json` – Electron 33, tmi.js, tiktok-live-connector, electron-store, ws
- [x] `main.js` – Main process: chat window, settings window, TikTok auth window (cookie capture)
- [x] `preload.js` – Secure contextBridge API exposing all IPC channels
- [x] `src/ipc/handlers.js` – All IPC handlers registered (window, settings, twitch, tiktok, youtube, emotes)
- [x] `src/windows/chat/index.html` – Main chat UI (titlebar, platform tabs, status bar, chat area, events dock, usercard, toasts)
- [x] `src/windows/chat/chat.css` – Full theme system (dark/light), all UI components styled
- [x] `src/windows/chat/chat.js` – Chat renderer: messages, emotes, scroll, TTS, events dock, user card, platform listeners
- [x] `src/windows/settings/index.html` – Settings window with 7 sections
- [x] `src/windows/settings/settings.css` – Settings window styles
- [x] `src/windows/settings/settings.js` – Live settings apply, debounced save, range labels
- [x] `src/connectors/twitch.js` – tmi.js, badge cache, Helix API (user card, badges, moderation)
- [x] `src/connectors/tiktok.js` – tiktok-live-connector, chat/gift/like/follow/share/subscribe
- [x] `src/connectors/youtube.js` – ytInitialData scrape + live chat poll (no API key)
- [x] `src/managers/emote-manager.js` – 7TV, BTTV, FFZ (global + channel), IPC-serialisable cache
- [x] `src/managers/settings-manager.js` – electron-store with all defaults, get/set/reset
- [x] Removed all Next.js files (src/app, next.config.ts, postcss, tsconfig)
- [x] Dependencies installed via bun

## File Structure

```
chattering/
├── main.js                        # Electron main process
├── preload.js                     # contextBridge IPC bridge
├── package.json
├── src/
│   ├── windows/
│   │   ├── chat/
│   │   │   ├── index.html         # Main chat window
│   │   │   ├── chat.css           # Chat styles (dark/light theme)
│   │   │   └── chat.js            # Chat renderer
│   │   ├── settings/
│   │   │   ├── index.html         # Settings window
│   │   │   ├── settings.css       # Settings styles
│   │   │   └── settings.js        # Settings renderer
│   ├── connectors/
│   │   ├── twitch.js              # tmi.js + Helix API
│   │   ├── tiktok.js              # tiktok-live-connector
│   │   └── youtube.js             # scrape + poll (no API key)
│   ├── managers/
│   │   ├── emote-manager.js       # 7TV, BTTV, FFZ
│   │   └── settings-manager.js   # electron-store wrapper
│   └── ipc/
│       └── handlers.js            # All IPC handler registrations
└── assets/icons/                  # App icons (add icon.png/ico/icns)
```

## How to Run

```bash
bun start         # Run in production mode
bun run dev       # Run with DevTools open
bun run build     # Package with electron-builder
```

## Pending / Future Work

- [ ] Add app icons (assets/icons/icon.png, .ico, .icns)
- [ ] Add TikTok cookie forwarding from auth window to connector (sessionId injection)
- [ ] Add configurable highlight words (currently stored but not rendered)
- [ ] Add context-menu on right-click messages (delete, ban, timeout)
- [ ] Add animated emote toggle (disable GIFs for performance)
- [ ] Test on all three platforms (Twitch/TikTok/YouTube) live
- [ ] Add auto-reconnect UI feedback with retry counter
- [ ] Add chat history export for the session

## Session History

| Date        | Changes                                            |
|-------------|----------------------------------------------------|
| 2026-03-18  | Full Chattering Electron app created from scratch  |
