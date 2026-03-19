'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – YouTube Live Chat Connector
   ─────────────────────────────────────────────────────────────────────────
   Uses youtube-chat library to connect to YouTube Live streams.
   Handles both channel IDs and @handles.
   ═══════════════════════════════════════════════════════════════════════════ */

const { LiveChat } = require('youtube-chat');
const https = require('https');
const http = require('http');

// ─── State ───────────────────────────────────────────────────────────────────
let chat = null;
let activeChannel = null;
let activeChannelId = null;
let getMainWindow = null;
let isRunning = false;

const YT_BASE = 'https://www.youtube.com';

// ─── Helper: Resolve handle to channel ID ─────────────────────────────────
function resolveChannelId(handleOrId) {
  return new Promise((resolve, reject) => {
    const input = handleOrId.replace(/^@/, '').trim();
    
    // Check if it looks like a channel ID (starts with UC)
    if (input.startsWith('UC')) {
      resolve(input);
      return;
    }
    
    // Try to fetch the channel page to get the channel ID
    const url = `https://www.youtube.com/@${input}`;
    console.log(`[YouTube] Resolving handle @${input} to channel ID...`);
    
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
        // Process in chunks to find channel ID faster
        if (data.length > 100000) {
          res.destroy();
        }
      });
      
      res.on('end', () => {
        // Try to find channel ID in the page source
        // Pattern: "channelId":"UCxxxxx" or channelId:"UCxxxxx"
        const channelIdMatch = data.match(/"channelId":"(UC[a-zA-Z0-9_-]{20,})"/) || 
                               data.match(/channelId="(UC[a-zA-Z0-9_-]{20,})"/);
        
        if (channelIdMatch && channelIdMatch[1]) {
          console.log(`[YouTube] Resolved @${input} to channel ID: ${channelIdMatch[1]}`);
          resolve(channelIdMatch[1]);
        } else {
          // Try alternate pattern - maybe it's a username not a handle
          const altMatch = data.match(/"canonicalBaseUrl"\s*:\s*"\/@([^"]+)"/);
          if (altMatch) {
            // It's a valid handle, try the channel endpoint
            const channelUrl = `https://www.youtube.com/channel/${input}/live`;
            console.log(`[YouTube] Trying channel URL: ${channelUrl}`);
            resolve(input); // Return the input as-is, youtube-chat will handle it
          } else {
            reject(new Error(`Could not resolve channel ID for @${input}`));
          }
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// ─── Connect ─────────────────────────────────────────────────────────────────
async function connect(channelHandle, getWin) {
  if (isRunning) await disconnect();
  getMainWindow = getWin;
  
  // Normalize the channel handle - remove @ prefix
  let channelName = channelHandle.replace(/^@/, '').trim();
  activeChannel = channelName;
  isRunning = true;

  emitStatus(false, 'Conectando a YouTube…');

  try {
    console.log(`[YouTube] Attempting to connect to channel: ${channelName}`);
    
    // Resolve handle to channel ID if needed
    let channelId = channelName;
    try {
      channelId = await resolveChannelId(channelName);
      activeChannelId = channelId;
    } catch (resolveErr) {
      console.log(`[YouTube] Could not resolve handle, trying as-is: ${resolveErr.message}`);
      channelId = channelName;
    }
    
    console.log(`[YouTube] Using channel ID: ${channelId}`);
    
    chat = new LiveChat({
      channelId: channelId,  // Use resolved channel ID
      lookupInterval: 5000,   // Poll every 5 seconds
      liveChat: true
    });

    chat.on('start', (videoId, videoTitle) => {
      console.log(`[YouTube] Live stream started: ${videoTitle} (${videoId})`);
      emitStatus(true, videoTitle);
    });

    chat.on('chat', (chatItem) => {
      // Parse message author
      const author = chatItem.author;
      const username = author.name || 'Unknown';
      const color = author.nameColor ? `#${author.nameColor.replace('#', '')}` : '#ff0000';
      
      // Build message object
      const message = {
        id: chatItem.id || String(Date.now()),
        platform: 'youtube',
        username: username,
        displayName: username,
        color: color,
        message: chatItem.message || '',
        badges: [],
        emotes: {},
        avatarUrl: author.thumbnail?.url || '',
        isMember: author.isMember || false,
        isModerator: author.isModerator || false,
        isVerified: author.isVerified || false,
        isOwner: author.isOwner || false,
        isSponsor: author.isSponsor || false
      };
      
      emit('youtube:message', message);
    });

    chat.on('superChat', (sc) => {
      // Handle Super Chat events
      const message = {
        id: sc.id || String(Date.now()),
        platform: 'youtube',
        username: sc.author?.name || 'Unknown',
        displayName: sc.author?.name || 'Unknown',
        color: '#ffff00',
        message: sc.message || '',
        badges: [],
        emotes: {},
        amount: sc.amount || '',
        currency: sc.currency || ''
      };
      
      emit('youtube:event', {
        type: 'superchat',
        platform: 'youtube',
        username: message.username,
        displayName: message.displayName,
        amount: message.amount,
        currency: message.currency,
        message: message.message
      });
    });

    chat.on('membership', (m) => {
      // Handle membership/join events
      emit('youtube:event', {
        type: 'member',
        platform: 'youtube',
        username: m.author?.name || 'Unknown',
        displayName: m.author?.name || 'Unknown',
        message: m.message || 'se unió'
      });
    });

    chat.on('error', (err) => {
      console.error('[YouTube] Error:', err);
      // Don't emit error status if it's just "no live"
      if (!err.message.includes('No live') && !err.message.includes('not found')) {
        emitStatus(false, 'Error: ' + err.message);
      }
    });

    chat.on('end', () => {
      console.log('[YouTube] Stream ended');
      emitStatus(false, 'Stream terminado');
    });

    // Start listening
    await chat.start();
    
    console.log(`[YouTube] Connected to ${activeChannel}`);
    return { connected: true, channel: activeChannel };
    
  } catch (err) {
    isRunning = false;
    console.error('[YouTube] Connection failed:', err.message);
    throw new Error(`YouTube connect failed: ${err.message}`);
  }
}

// ─── Disconnect ───────────────────────────────────────────────────────────────
async function disconnect() {
  isRunning = false;
  
  if (chat) {
    try {
      chat.stop();
    } catch (e) {
      console.log('[YouTube] Stop error:', e.message);
    }
    chat = null;
  }
  
  activeChannel = null;
  activeChannelId = null;
  emitStatus(false);
}

// ─── Emitters ─────────────────────────────────────────────────────────────────
function emit(channel, data) {
  const { BrowserWindow } = require('electron');
  // Broadcast to all windows
  BrowserWindow.getAllWindows().forEach(win => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  });
}

function emitStatus(connected, msg = null) {
  emit('youtube:status', { connected, channel: activeChannel, message: msg });
}

module.exports = { connect, disconnect };
