import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadAppConfig } from './config.js';
import { buildAppServer } from './server.js';

function windowsBrowser() {
  const bases = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);
  const candidates = [];
  for (const base of bases) {
    candidates.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidates.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  return candidates.find((file) => fs.existsSync(file));
}

// На Windows открываем в отдельном окне Chrome/Edge без адресной строки — как приложение.
function openBrowser(url) {
  if (process.platform === 'win32') {
    const browser = windowsBrowser();
    if (browser) {
      spawn(browser, [`--app=${url}`, '--window-size=1180,800', '--no-first-run'], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    }
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

// port: 0 — взять свободный (нужно Electron, чтобы не конфликтовать с сервисом).
export async function startApp({ open = process.env.JARVIS_OPEN === '1', port } = {}) {
  const config = loadAppConfig();
  if (port !== undefined) config.port = Number(port);

  const app = buildAppServer({ config });
  await app.listen({ port: config.port, host: config.bind });

  const address = app.server.address();
  const actualPort = address && typeof address === 'object' ? address.port : config.port;
  const host = config.bind === '0.0.0.0' ? '127.0.0.1' : config.bind;
  const url = `http://${host}:${actualPort}`;

  console.log(JSON.stringify({ msg: 'jarvis app запущен', url, workspace: config.workspace }));
  if (open) openBrowser(url);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { app, url, config };
}
