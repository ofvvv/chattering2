'use strict';

const { app, BrowserWindow, ipcMain, screen, shell, session } = require('electron');
const path = require('path');
const http = require('http');
const SettingsManager = require('./src/managers/settings-manager');
const ipcHandlers = require('./src/ipc/handlers');

// ─── Performance: disable hardware acceleration ──────────────────────────────
// These must be called before app.ready - use will-finish-launching event
if (app.on) {
  app.on('will-finish-launching', () => {
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-background-timer-throttling');
    app.commandLine.appendSwitch('force-color-profile', 'srgb');
  });
}

// ─── Globals ────────────────────────────────────────────────────────────────
let mainWindow = null;
let settingsWindow = null;
let dockWindow = null;
let tiktokAuthWindow = null;
let twitchOAuthWindow = null;
let usercardWindow = null;
let oauthServer = null;
const isDev = process.argv.includes('--dev');

// ─── OAuth Callback Server ────────────────────────────────────────────────
function startOAuthServer() {
  return new Promise((resolve) => {
    oauthServer = http.createServer((req, res) => {
      console.log('[OAuth Server] Request:', req.url);
      
      if (req.url.startsWith('/twitch-callback')) {
        // Check for token in query params (sent by our callback page using image trick)
        const urlObj = new URL(req.url, 'http://localhost:3000');
        let accessToken = urlObj.searchParams.get('token');
        const error = urlObj.searchParams.get('error');
        
        // CASO 1: El script de nuestro HTML hizo su trabajo y nos mandó el token
        if (accessToken) {
          console.log('[OAuth Server] ✅ Twitch token received from callback page!');
          console.log('[OAuth Server] Token (first 20 chars):', accessToken.substring(0, 20) + '...');
          
          // Save token to settings
          SettingsManager.set({ twitchToken: accessToken });
          console.log('[OAuth Server] ✅ Token saved to settings');
          
          // Notify main window
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('twitch:oauth-captured', { token: accessToken });
            console.log('[OAuth Server] ✅ Notification sent to main window');
          }
          
          // Return empty response for the image request
          res.writeHead(200);
          res.end();
          return;
        }
        
        // CASO 2: Twitch acaba de redirigir al usuario aquí.
        // Le entregamos nuestro HTML para que lea el token del hash
        console.log('[OAuth Server] Serving callback HTML page');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Redirecting...</title>
  <script>
    // Extract token from URL hash
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const error = params.get('error');
    
    console.log('Token:', accessToken ? 'found' : 'not found');
    
    if (accessToken) {
      // Truco de la imagen para enviar el token sin recargar
      const tokenUrl = 'http://localhost:3000/twitch-callback?token=' + accessToken;
      
      const img = new Image();
      img.src = tokenUrl;
      img.onload = function() { showSuccess(); };
      img.onerror = function() { showSuccess(); };
      
      // También intentar con fetch
      fetch(tokenUrl, { method: 'POST' }).catch(() => {});
      
    } else if (error) {
      document.body.innerHTML = '<h1 style="color:red;font-family:sans-serif;padding:40px;">Error: ' + error + '</h1>';
    } else {
      document.body.innerHTML = '<h1 style="font-family:sans-serif;padding:40px;">Token no encontrado</h1><p>Hash: ' + window.location.hash + '</p>';
    }
    
    function showSuccess() {
      document.body.innerHTML = '<h1 style="color:#00c853;font-family:sans-serif;padding:40px;text-align:center;">✓ ¡Conectado!</h1><p style="font-family:sans-serif;color:#666;text-align:center;">Tu sesión de Twitch ha sido autenticada.</p><p style="font-family:sans-serif;color:#666;text-align:center;">Puedes cerrar esta ventana.</p>';
      setTimeout(() => window.close(), 3000);
    }
  </script>
</head>
<body style="background:#1f1f23;color:#efeff1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <p style="text-align:center;padding:40px;">Procesando autenticación...</p>
</body>
</html>
        `);
        return;
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    // Listen on all interfaces for localhost and 127.0.0.1
    oauthServer.listen(3000, '0.0.0.0', () => {
      console.log('[OAuth Server] Running on http://localhost:3000 and http://127.0.0.1:3000');
      resolve();
    });
  });
}

// ─── App ready ──────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Start OAuth server first
  await startOAuthServer();
  
  await SettingsManager.init();
  createMainWindow();
  
  // Check TikTok cookies on startup
  checkTikTokCookiesOnStartup();
  
  ipcHandlers.register(ipcMain, { 
    getMainWindow: () => mainWindow, 
    getSettingsWindow: () => settingsWindow, 
    getDockWindow: () => dockWindow,
    openSettingsWindow, 
    openTikTokAuthWindow,
    openTwitchOAuthWindow: (clientId) => openTwitchOAuthWindow(clientId || SettingsManager.get().twitchClientId),
    openDockWindow,
    closeDockWindow,
    openUsercardWindow: (data, x, y) => openUsercardWindow(data, x, y),
    getUsercardWindow: () => usercardWindow
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function checkTikTokCookiesOnStartup() {
  setTimeout(() => {
    const tiktokSession = session.fromPartition('persist:tiktok');

    tiktokSession.cookies.get({ domain: '.tiktok.com' }).then(cookies => {
      const sessionKey = cookies?.find(c => c.name === 'sessionid' || c.name === 'sessionid_ss');
      if (sessionKey) {
        console.log('[TikTok] Found valid cookies on startup');
        const allCookies = {};
        cookies.forEach(c => { allCookies[c.name] = c.value; });
        // Small delay to ensure renderer is ready
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tiktok:cookies-captured', allCookies);
          }
        }, 1500);
      } else {
        // Fall back to stored sessionId from settings
        const savedSessionId = SettingsManager.get().tiktokSessionId;
        if (savedSessionId) {
          console.log('[TikTok] Using saved sessionId from settings');
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('tiktok:session-restored', { sessionId: savedSessionId });
            }
          }, 1500);
        } else {
          console.log('[TikTok] No cookies or sessionId found on startup');
        }
      }
    }).catch(err => {
      console.log('[TikTok] Error checking cookies on startup:', err.message);
    });
  }, 2000);
}

// ─── Main Chat Window ────────────────────────────────────────────────────────
function createMainWindow() {
  const settings = SettingsManager.get();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: settings.mainWindowWidth || settings.windowWidth || 420,
    height: settings.mainWindowHeight || settings.windowHeight || height,
    x: settings.mainWindowX ?? settings.windowX ?? (width - (settings.mainWindowWidth || settings.windowWidth || 420)),
    y: settings.mainWindowY ?? settings.windowY ?? 0,
    minWidth: 280,
    minHeight: 400,
    frame: false,
    transparent: settings.translucent || false,
    backgroundColor: settings.translucent ? '#00000000' : '#1a1a2e',
    alwaysOnTop: settings.alwaysOnTop || false,
    resizable: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false
    },
    icon: path.join(__dirname, 'assets/icons/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'src/windows/chat/index.html'));

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('resize', () => saveWindowBounds(mainWindow, 'main'));
  mainWindow.on('move', () => saveWindowBounds(mainWindow, 'main'));
  mainWindow.on('closed', () => { mainWindow = null; });

  // Allow opening external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── Settings Window ─────────────────────────────────────────────────────────
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 640,
    height: 720,
    minWidth: 540,
    minHeight: 500,
    title: 'Chattering – Settings',
    frame: false,
    backgroundColor: '#1a1a2e',
    resizable: true,
    skipTaskbar: false,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,
      spellcheck: false
    },
    icon: path.join(__dirname, 'assets/icons/icon.png')
  });

  settingsWindow.loadFile(path.join(__dirname, 'src/windows/settings/index.html'));

  if (isDev) settingsWindow.webContents.openDevTools({ mode: 'detach' });

  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── Dock Window ────────────────────────────────────────────────────────────────
function openDockWindow() {
  if (dockWindow && !dockWindow.isDestroyed()) {
    dockWindow.focus();
    return;
  }

  const settings = SettingsManager.get();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  dockWindow = new BrowserWindow({
    width: settings.dockWidth || 300,
    height: settings.dockHeight || 400,
    x: settings.dockX || (width - 320),
    y: settings.dockY || 100,
    minWidth: 200,
    minHeight: 150,
    title: 'Eventos - Chattering',
    frame: false,
    backgroundColor: '#18181b',
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: settings.alwaysOnTop || false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,
      spellcheck: false
    },
    icon: path.join(__dirname, 'assets/icons/icon.png')
  });

  dockWindow.loadFile(path.join(__dirname, 'src/windows/dock/index.html'));

  if (isDev) dockWindow.webContents.openDevTools({ mode: 'detach' });

  // Save dock window bounds
  dockWindow.on('resize', () => {
    if (dockWindow && !dockWindow.isDestroyed()) {
      const [w, h] = dockWindow.getSize();
      SettingsManager.set({ dockWidth: w, dockHeight: h });
    }
  });

  dockWindow.on('move', () => {
    if (dockWindow && !dockWindow.isDestroyed()) {
      const [x, y] = dockWindow.getPosition();
      SettingsManager.set({ dockX: x, dockY: y });
    }
  });

  dockWindow.on('closed', () => { 
    dockWindow = null; 
    // Notify main window that dock window was closed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dock:closed');
    }
  });
}

function closeDockWindow() {
  if (dockWindow && !dockWindow.isDestroyed()) {
    dockWindow.close();
    dockWindow = null;
  }
}

// ─── TikTok Auth Window ───────────────────────────────────────────────────────
let tiktokAuthInterval = null;

function openTikTokAuthWindow(event) {
  // First check if we already have valid TikTok cookies
  const tiktokSession = session.fromPartition('persist:tiktok');
  
  tiktokSession.cookies.get({ domain: '.tiktok.com' }).then(cookies => {
    const sessionKey = cookies.find(c => c.name === 'sessionid' || c.name === 'sessionid_ss');
    const ttWebId = cookies.find(c => c.name === 'tt_webid');
    
    // If we already have cookies, still open the window to let user confirm/refresh
    // This ensures we get fresh, valid cookies
    console.log('[TikTok Auth] Existing cookies found, will refresh via auth window');
    openTikTokAuthWindowInternal(tiktokSession);
  }).catch(err => {
    console.error('[TikTok Auth] Error checking cookies:', err);
    // On error, try to open the window anyway
    const tiktokSession = session.fromPartition('persist:tiktok');
    openTikTokAuthWindowInternal(tiktokSession);
  });
}

function openTikTokAuthWindowInternal(tiktokSession) {
  if (tiktokAuthWindow && !tiktokAuthWindow.isDestroyed()) {
    tiktokAuthWindow.focus();
    return;
  }

  tiktokAuthWindow = new BrowserWindow({
    width: 520,
    height: 700,
    title: 'TikTok Login - Chattering',
    frame: true,
    backgroundColor: '#ffffff',
    resizable: true,
    minimizable: true,
    maximizable: false,
    alwaysOnTop: false,
    webPreferences: {
      session: tiktokSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Load TikTok login page
  tiktokAuthWindow.loadURL('https://www.tiktok.com/login');

  // Show instructions in console
  console.log('[TikTok Auth] Window opened. Please log in manually.');
  
  // Show message in the window title to guide user
  tiktokAuthWindow.setTitle('TikTok Login - Chattering (Por favor inicia sesión y visita un live)');

  // Listen for page navigation - capture cookies as soon as a valid session exists
  tiktokAuthWindow.webContents.on('did-navigate', async (event, url) => {
    console.log('[TikTok Auth] Navigation to:', url);

    // Skip the login page itself to avoid false-positives before the user logs in
    if (url.includes('/login') || url.includes('/signup')) return;

    try {
      const cookies = await tiktokSession.cookies.get({ domain: '.tiktok.com' });
      const sessionKey = cookies.find(c => c.name === 'sessionid' || c.name === 'sessionid_ss');

      if (sessionKey) {
        console.log('[TikTok Auth] Session cookie found – capturing');
        const allCookies = {};
        cookies.forEach(c => { allCookies[c.name] = c.value; });

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tiktok:cookies-captured', allCookies);
        }
        // Also persist sessionId to settings so reconnects work after restart
        SettingsManager.set({ tiktokSessionId: sessionKey.value });

        // Close auth window after a short delay so the user sees confirmation
        setTimeout(() => {
          if (tiktokAuthWindow && !tiktokAuthWindow.isDestroyed()) {
            tiktokAuthWindow.close();
          }
        }, 800);
      }
    } catch (e) {
      console.error('[TikTok Auth] Navigation cookie error:', e);
    }
  });

  tiktokAuthWindow.on('closed', () => {
    clearInterval(tiktokAuthInterval);
    tiktokAuthWindow = null;
  });
}

// ─── Twitch OAuth Window ───────────────────────────────────────────────────────
function openTwitchOAuthWindow(clientId) {
  // Use local HTML file as callback to capture the hash token
  // The callback.html will extract the token and send it to our server
  const redirectUri = 'http://localhost:3000/twitch-callback';
  const scope = 'chat:read chat:edit whispers:read moderation:read user:read:email';
  const oauthUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}`;

  // Open in default browser
  require('electron').shell.openExternal(oauthUrl);
  console.log('[Twitch OAuth] Opened in browser:', oauthUrl);
  console.log('[Twitch OAuth] Redirect URI:', redirectUri);
  
  // Notify user
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('twitch:oauth-opened', { 
      message: 'Se abrirá Twitch en tu navegador. Después de iniciar sesión, esta página se cerrará automáticamente.'
    });
  }
}

// ─── User Card Window ─────────────────────────────────────────────────────────
function openUsercardWindow(data, x, y) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const W = 300, H = 490;
  const wx = Math.max(0, Math.min(Math.round(x), sw - W));
  const wy = Math.max(0, Math.min(Math.round(y), sh - H));

  if (usercardWindow && !usercardWindow.isDestroyed()) {
    // Reuse existing window — just update content and reposition
    usercardWindow.setPosition(wx, wy);
    usercardWindow.webContents.send('usercard:data', data);
    usercardWindow.focus();
    return;
  }

  usercardWindow = new BrowserWindow({
    width: W,
    height: H,
    x: wx,
    y: wy,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#18181b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  usercardWindow.loadFile(path.join(__dirname, 'src/windows/usercard/usercard.html'));

  usercardWindow.webContents.once('did-finish-load', () => {
    if (usercardWindow && !usercardWindow.isDestroyed()) {
      usercardWindow.webContents.send('usercard:data', data);
    }
  });

  // Close when focus leaves the window (click outside)
  usercardWindow.on('blur', () => {
    if (usercardWindow && !usercardWindow.isDestroyed()) usercardWindow.close();
  });

  usercardWindow.on('closed', () => { usercardWindow = null; });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function saveWindowBounds(win, key) {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getSize();
  const [x, y] = win.getPosition();
  SettingsManager.set({
    [`${key}WindowWidth`]: w,
    [`${key}WindowHeight`]: h,
    [`${key}WindowX`]: x,
    [`${key}WindowY`]: y
  });
}