# Active Context: Chattering

## Current State

**Status**: 🔧 Debugging YouTube messages - added extensive logging to trace message flow

## Recently Completed (Latest Session)

- [x] Added auto-connection to Twitch on OAuth (gets username and connects automatically)
- [x] Fixed Twitch badges not loading (added default clientId)
- [x] Fixed 7TV and BTTV emotes now showing properly
- [x] Fixed dock resize handle positioning based on dock location
- [x] Fixed settings window not updating on connection status (now broadcasts to all windows)
- [x] Added extensive debug logging for troubleshooting
- [x] Fixed 7TV emotes not loading (removed numeric ID check in emote-manager)
- [x] Fixed dock resize handler position (added position: relative to dock element)
- [x] Made float button visible when docked (user can click to undock)
- [x] Made clear-events button more transparent in dock controls
- [x] **Fixed YouTube connection** - Implemented getLiveVideoIdFromNode using Node.js https module with URL format `https://www.youtube.com/@{handle}/live`
- [x] **Fixed YouTube messages** - Convert message array to plain text string, extract ytEmotes for rendering

## Pending/Future Work

- [ ] Add per-user colors for TikTok/YouTube messages (like Twitch)
- [ ] Add platform logos before messages with toggle
- [ ] Make bot list editable with tags
- [ ] Make dock draggable with snap-to-edge behavior
- [ ] Render YouTube emotes (ytEmotes) in chat messages
- [ ] TikTok connection issues (if any)

## File Structure

```
chattering/
├── main.js                        
├── preload.js                     
├── package.json
├── src/
│   ├── windows/
│   │   ├── chat/
│   │   │   ├── index.html        
│   │   │   ├── chat.css          
│   │   │   └── chat.js           
│   │   └── settings/
│   │       ├── index.html        
│   │       ├── settings.css       
│   │       └── settings.js        
│   ├── connectors/
│   │   ├── twitch.js             
│   │   ├── tiktok.js            
│   │   └── youtube.js            
│   ├── managers/
│   │   ├── emote-manager.js      
│   │   └── settings-manager.js   
│   └── ipc/
│       └── handlers.js           
└── assets/icons/                  
```

## How to Run

```bash
bun start         # Run in production mode
bun run dev       # Run with DevTools open
bun run build     # Package with electron-builder
```

## Session History

| Date        | Changes                                            |
|-------------|----------------------------------------------------|
| 2026-03-18  | Full Chattering Electron app created from scratch  |
| 2026-03-18  | Multiple bug fixes and feature implementations       |
| 2026-03-18  | Fixed connection errors, added Settings improvements |
| 2026-03-19  | Fixed 7TV emotes, dock UI improvements (resize handle, float button) |
