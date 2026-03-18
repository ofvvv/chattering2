'use strict';

const { app, BrowserWindow, ipcMain, screen, shell, session } = require('electron');
const path = require('path');
const SettingsManager = require('./src/managers/settings-manager');
const ipcHandlers = require('./src/ipc/handlers');

// ─── Globals ────────────────────────────────────────────────────────────────
let mainWindow = null;
let settingsWindow = null;
let tiktokAuthWindow = null;
const isDev = process.argv.includes('--dev');

// ─── Performance: disable hardware acceleration if translucency is off ───────
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// ─── App ready ──────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await SettingsManager.init();
  createMainWindow();
  ipcHandlers.register(ipcMain, { getMainWindow: () => mainWindow, getSettingsWindow: () => settingsWindow, openSettingsWindow, openTikTokAuthWindow });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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

// ─── TikTok Auth Window ───────────────────────────────────────────────────────
function openTikTokAuthWindow(event) {
  if (tiktokAuthWindow && !tiktokAuthWindow.isDestroyed()) {
    tiktokAuthWindow.focus();
    return;
  }

  // Create a persistent session partition for TikTok cookies
  const tiktokSession = session.fromPartition('persist:tiktok');

  tiktokAuthWindow = new BrowserWindow({
    width: 480,
    height: 660,
    title: 'TikTok Login',
    frame: true,
    backgroundColor: '#ffffff',
    resizable: true,
    webPreferences: {
      session: tiktokSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  tiktokAuthWindow.loadURL('https://www.tiktok.com/login');

  // Poll for successful login by checking cookies
  const checkCookieInterval = setInterval(async () => {
    if (!tiktokAuthWindow || tiktokAuthWindow.isDestroyed()) {
      clearInterval(checkCookieInterval);
      return;
    }
    const cookies = await tiktokSession.cookies.get({ domain: '.tiktok.com' });
    const sessionKey = cookies.find(c => c.name === 'sessionid');
    if (sessionKey) {
      clearInterval(checkCookieInterval);
      const allCookies = {};
      cookies.forEach(c => { allCookies[c.name] = c.value; });
      // Send cookies back to main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tiktok:cookies-captured', allCookies);
      }
      tiktokAuthWindow.close();
    }
  }, 1500);

  tiktokAuthWindow.on('closed', () => {
    clearInterval(checkCookieInterval);
    tiktokAuthWindow = null;
  });
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
