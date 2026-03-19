'use strict';

const { app, BrowserWindow, ipcMain, screen, shell, session } = require('electron');
const path = require('path');
const http = require('http');
const SettingsManager = require('./src/managers/settings-manager');
const ipcHandlers = require('./src/ipc/handlers');

// ─── Performance: disable hardware acceleration ──────────────────────────────
// These must be called before app.ready - use will-finish-launching event
app.on('will-finish-launching', () => {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('force-color-profile', 'srgb');
});

// ─── Globals ────────────────────────────────────────────────────────────────
let mainWindow = null;
let settingsWindow = null;
let dockWindow = null;
let tiktokAuthWindow = null;
let twitchOAuthWindow = null;
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
        
        if (accessToken) {
          console.log('[OAuth Server] Twitch token received!');
          
          // Save token to settings
          SettingsManager.set({ twitchToken: accessToken });
          
          // Notify main window
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('twitch:oauth-captured', { token: accessToken });
          }
          
          // Send success response
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                       display: flex; align-items: center; justify-content: center; 
                       height: 100vh; margin: 0; background: #1f1f23; color: #efeff1; }
                .container { text-align: center; padding: 40px; }
                .success { color: #00c853; font-size: 48px; }
                h1 { margin: 20px 0 10px; }
                p { color: #adadb8; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="success">✓</div>
                <h1>¡Conectado!</h1>
                <p>Tu sesión de Twitch ha sido autenticada.</p>
                <p>Puedes cerrar esta ventana y usar Chattering.</p>
              </div>
              <script>setTimeout(() => window.close(), 3000);</script>
            </body>
            </html>
          `);
        } else if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error: ${error}</h1><p>Cierra esta ventana e intenta de nuevo.</p>`);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Token no recibido</h1><p>Cierra esta ventana e intenta de nuevo.</p>');
        }
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
    closeDockWindow
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Check TikTok cookies on startup ───────────────────────────────────────────
function checkTikTokCookiesOnStartup() {
  // Delay slightly to ensure window is ready
  setTimeout(() => {
    const tiktokSession = session.fromPartition('persist:tiktok');
    
    tiktokSession.cookies.get({ domain: '.tiktok.com' }).then(cookies => {
      console.log('[TikTok] Cookies found on startup:', cookies?.length || 0);
      const sessionKey = cookies?.find(c => c.name === 'sessionid' || c.name === 'sessionid_ss');
      const ttWebId = cookies?.find(c => c.name === 'tt_webid');
      
      if (sessionKey && ttWebId) {
        console.log('[TikTok] Found valid cookies on startup');
        const allCookies = {};
        cookies.forEach(c => { allCookies[c.name] = c.value; });
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tiktok:cookies-captured', allCookies);
        }
      } else {
        console.log('[TikTok] No cookies found on startup');
      }
    }).catch(err => {
      console.log('[TikTok] Error checking cookies on startup:', err.message);
    });
  }, 2000); // Wait 2 seconds for window to fully load
}

// ─── Main Chat Window ────────────────────────────────────────────────────────
function createMainWindow() {
  const settings = SettingsManager.get();
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: settings.windowWidth || 420,
    height: settings.windowHeight || height,
    x: settings.windowX || (width - (settings.windowWidth || 420)),
    y: settings.windowY || 0,
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

  // Listen for page navigation - capture cookies ONLY after user navigates to a live page
  tiktokAuthWindow.webContents.on('did-navigate', async (event, url) => {
    console.log('[TikTok Auth] Navigation to:', url);
    
    // Only capture cookies after user successfully logs in and visits a live page
    if (url.includes('/live') || url.includes('/@')) {
      try {
        const cookies = await tiktokSession.cookies.get({ domain: '.tiktok.com' });
        const sessionKey = cookies.find(c => c.name === 'sessionid' || c.name === 'sessionid_ss');
        const ttWebId = cookies.find(c => c.name === 'tt_webid');
        
        if (sessionKey && ttWebId) {
          clearInterval(tiktokAuthInterval);
          console.log('[TikTok Auth] Live page detected - capturing cookies');
          const allCookies = {};
          cookies.forEach(c => { allCookies[c.name] = c.value; });
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tiktok:cookies-captured', allCookies);
          }
          // Close the window after successful capture
          setTimeout(() => {
            if (tiktokAuthWindow && !tiktokAuthWindow.isDestroyed()) {
              tiktokAuthWindow.close();
            }
          }, 1000);
        }
      } catch (e) {
        console.error('[TikTok Auth] Navigation cookie error:', e);
      }
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
