import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ID_RE = /^[a-z0-9-]{8,64}$/;

function dir(config) {
  const target = path.join(config.home, 'sessions');
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function file(config, id) {
  if (!ID_RE.test(String(id))) throw new Error('Некорректный id сессии');
  return path.join(dir(config), `${id}.json`);
}

function write(config, session) {
  const target = file(config, session.id);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function titleFrom(text) {
  const line = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line) return 'Новый чат';
  return line.length > 64 ? `${line.slice(0, 61)}…` : line;
}

export function listSessions(config) {
  const result = [];
  for (const name of fs.readdirSync(dir(config))) {
    if (!name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir(config), name), 'utf8'));
      result.push({
        id: data.id,
        title: data.title,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        messages: Array.isArray(data.messages) ? data.messages.length : 0,
      });
    } catch {
      // битый файл не должен ломать список
    }
  }
  return result.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function createSession(config) {
  const now = new Date().toISOString();
  const session = {
    id: crypto.randomUUID(),
    title: 'Новый чат',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  write(config, session);
  return session;
}

export function getSession(config, id) {
  return JSON.parse(fs.readFileSync(file(config, id), 'utf8'));
}

export function saveSession(config, session) {
  session.updatedAt = new Date().toISOString();
  write(config, session);
  return session;
}

export function deleteSession(config, id) {
  fs.rmSync(file(config, id), { force: true });
}

export function renameSession(config, id, title) {
  const session = getSession(config, id);
  session.title = titleFrom(title);
  return saveSession(config, session);
}

export function appendExchange(config, id, exchange) {
  const session = getSession(config, id);
  if (session.title === 'Новый чат' && exchange.user?.content) {
    session.title = titleFrom(exchange.user.content);
  }
  if (exchange.user) session.messages.push(exchange.user);
  if (exchange.assistant) session.messages.push(exchange.assistant);
  return saveSession(config, session);
}
