import fs from 'node:fs';
import path from 'node:path';

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function loadState(config) {
  const raw = readJson(config.stateFile, {});
  return {
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    user: raw.user && typeof raw.user === 'object' ? raw.user : null,
    settings: {
      mode: raw.settings?.mode === 'full' ? 'full' : 'workspace',
      workspace: raw.settings?.workspace || config.workspace,
      cloudUrl: typeof raw.settings?.cloudUrl === 'string' ? raw.settings.cloudUrl : '',
      approval: raw.settings?.approval === 'ask' ? 'ask' : 'auto',
    },
  };
}

export function saveState(config, state) {
  writeJson(config.stateFile, state);
}

export function loadHistory(config) {
  const raw = readJson(config.historyFile, []);
  return Array.isArray(raw)
    ? raw.filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    : [];
}

export function appendHistory(config, message) {
  const history = loadHistory(config);
  history.push({ ...message, at: new Date().toISOString() });
  writeJson(config.historyFile, history.slice(-200));
}

export function clearHistory(config) {
  writeJson(config.historyFile, []);
}
