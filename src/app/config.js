import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function defaultHome() {
  if (process.env.JARVIS_HOME) return path.resolve(process.env.JARVIS_HOME);
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Jarvis',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Jarvis');
  }
  return path.join(os.homedir(), '.config', 'jarvis');
}

export function loadAppConfig(envFile = path.join(ROOT, 'config', 'jarvis-desktop.env')) {
  if (envFile && fs.existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // конфиг необязателен: значения по умолчанию рабочие
    }
  }

  let portable = {};
  try {
    portable = JSON.parse(fs.readFileSync(path.join(ROOT, 'jarvis.json'), 'utf8'));
  } catch {
    portable = {};
  }

  const home = defaultHome();
  const workspace = process.env.WORKSPACE_DIR || path.join(home, 'workspace');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });

  return {
    root: ROOT,
    home,
    workspace,
    stateFile: path.join(home, 'state.json'),
    historyFile: path.join(home, 'history.json'),
    port: Number(process.env.APP_PORT || portable.port || 8096),
    bind: process.env.APP_BIND || '127.0.0.1',
    cloudUrl: (process.env.CLOUD_URL || portable.cloudUrl || 'http://127.0.0.1:8098').replace(
      /\/$/,
      '',
    ),
    model: process.env.APP_MODEL || 'deepseek-flash',
    maxSteps: Number(process.env.AGENT_MAX_STEPS || 12),
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
  };
}
