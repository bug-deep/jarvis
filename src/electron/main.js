import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { startApp } from '../app/main.js';

let win = null;
let server = null;
let serverUrl = '';

function iconFile() {
  return path.join(app.getAppPath(), 'build', 'icon.png');
}

// Переносимый конфиг рядом с .exe: {"cloudUrl": "http://..."}.
// Нужен, чтобы раздать сборку с уже прописанным сервером.
function loadPortableConfig() {
  try {
    const file = path.join(path.dirname(app.getPath('exe')), 'jarvis.json');
    if (!fs.existsSync(file)) return;
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof config.cloudUrl === 'string' && config.cloudUrl) {
      process.env.CLOUD_URL = config.cloudUrl;
    }
  } catch {
    // битый конфиг не должен мешать запуску
  }
}

async function boot() {
  loadPortableConfig();
  try {
    const started = await startApp({ port: 0, open: false });
    server = started.app;
    serverUrl = started.url;
  } catch (error) {
    dialog.showErrorBox('Jarvis не запустился', String(error?.message || error));
    app.quit();
    return;
  }

  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#070a12',
    title: 'Jarvis',
    show: false,
    autoHideMenuBar: true,
    icon: fs.existsSync(iconFile()) ? iconFile() : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(serverUrl);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(serverUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.on('closed', () => {
    win = null;
  });

  // Для проверки сборки: снять скриншот окна и выйти.
  if (process.env.JARVIS_SHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage();
          fs.writeFileSync(process.env.JARVIS_SHOT, image.toPNG());
          console.log(JSON.stringify({ msg: 'screenshot', file: process.env.JARVIS_SHOT }));
        } finally {
          app.quit();
        }
      }, 2000);
    });
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('ru.jarvis.desktop');
    Menu.setApplicationMenu(null);
    boot();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) boot();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (server) {
    server.close().catch(() => {});
    server = null;
  }
});
