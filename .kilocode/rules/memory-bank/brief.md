# Project Brief: Chattering

## Purpose

**Chattering** is a lightweight, multi-platform live chat client built with Electron, designed for streamers. It unifies chat from Twitch, TikTok, and YouTube in a single interface inspired by Chatterino, with extra features for a modern streaming workflow.

## Target Users

- Live streamers using Twitch, TikTok Live, and/or YouTube Live simultaneously
- Streamers who need moderation tools, event monitoring, and emote support in one place

## Core Features

- **Twitch**: Connect via tmi.js (IRC), Helix API for moderation and user cards, badge support
- **TikTok**: Connect via tiktok-live-connector (no API key), automatic cookie login via embedded Electron window
- **YouTube**: Connect without API key (scrape ytInitialData + poll live chat continuation)
- **Emotes**: 7TV, BTTV, FFZ (global + channel), Twitch native (per-message)
- **Events dock**: Resizable panel showing follows, subs, gifts, bits, likes, raids
- **Settings**: Floating window with live-applied settings (theme, font, TTS, filters, alerts, moderation)
- **TTS**: Web Speech API with queue, configurable rate/pitch/volume
- **Chat controls**: Scroll auto-pause + "new messages" button, per-message moderation
- **User cards**: Popup with follow date, sub status, per-session message count

## Tech Stack

- **Runtime**: Electron 33
- **Main process**: Node.js (CommonJS)
- **Renderer**: Vanilla HTML + CSS + JS (fully separated files, no framework)
- **Chat**: tmi.js
- **TikTok**: tiktok-live-connector
- **Settings persistence**: electron-store
- **Package manager**: Bun

## Key Constraints

- Max ~5% CPU, ~250 MB RAM target
- No mixing of HTML/CSS/JS — always in separate files
- No TypeScript (pure JS for Electron main+renderer)
- No API key requirement for TikTok or YouTube
- Settings window is a separate floating BrowserWindow
