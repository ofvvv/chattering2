'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Settings Manager
   ─────────────────────────────────────────────────────────────────────────
   Uses electron-store for persistent, JSON-backed settings.
   Provides synchronous get/set with deep merge and default values.
   ═══════════════════════════════════════════════════════════════════════════ */

const Store = require('electron-store');

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  // Appearance
  theme:           'dark',
  alwaysOnTop:     false,
  translucent:     false,
  transparency:    100,
  fontSize:        13,
  hideBots:        false,
  showPlatformLogos: true,
  maxMessages:     500,
  showTimestamps:  false,
  animatedEmotes:  true,

  // Window state
  mainWindowWidth:  420,
  mainWindowHeight: 900,
  mainWindowX:      null,
  mainWindowY:      null,
  // Legacy keys kept for backwards compatibility (first launch before any save)
  windowWidth:  420,
  windowHeight: 900,
  windowX:      null,
  windowY:      null,
  dockPosition: 'bottom',

  // Chat
  filterPlatform:    'all',
  botList:           'Nightbot,StreamElements,Moobot,Streamlabs',
  highlightMentions: true,
  highlightWords:    '',

  // TTS
  ttsEnabled:      false,
  ttsMessageOnly:  true,
  ttsTwitch:       true,
  ttsYoutube:      false,
  ttsTikTok:       false,
  ttsRate:         1,
  ttsVolume:       1,
  ttsPitch:        1,

  // Alerts
  alertsEnabled: true,
  alertFollow:   true,
  alertSub:      true,
  alertBits:     true,
  alertRaid:     true,

  // Moderation
  banConfirm:      true,
  defaultTimeout:  600,
  modHighlight:    false,

  // Connections
  twitchClientId:  'w2q6ngvevmf1gkuu1ngiqwmyzqmjrt',
  twitchToken:     '',
  twitchChannel:   '',
  youtubeChannel:  '',
  tiktokUser:      '',
  tiktokSessionId: '',

  // Accessibility
  reduceMotion:  false,
  highContrast:  false,
  scrollSpeed:   3
};

// ─── Store instance ────────────────────────────────────────────────────────────
let store = null;

async function init() {
  store = new Store({
    name: 'chattering-settings',
    defaults: DEFAULTS,
    clearInvalidConfig: false
  });
}

function get() {
  if (!store) return { ...DEFAULTS };
  return store.store;
}

function set(patch) {
  if (!store) return;
  // Shallow merge – callers send only the keys they changed
  store.set(patch);
  return store.store;
}

function reset() {
  if (!store) return;
  store.clear();
  store.set(DEFAULTS);
}

module.exports = { init, get, set, reset };