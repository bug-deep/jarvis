import crypto from 'node:crypto';
import { findKeyByHash } from './store.js';

// Без похожих символов: I/O/0/1 не должны путаться при вводе с телефона.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomUserCode(length = 8) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function newApiKey() {
  const plain = `jv_${randomToken(32)}`;
  return { plain, hash: sha256(plain), prefix: plain.slice(0, 10) };
}

export function authenticate(db, authorization) {
  const match = /^Bearer (jv_[A-Za-z0-9_-]{20,})$/.exec(String(authorization || ''));
  if (!match) return null;
  return findKeyByHash(db, sha256(match[1]));
}

// Простое окно в минуту на пользователя. Для одного процесса этого достаточно.
export function createRateLimiter(limitPerMinute) {
  const buckets = new Map();
  return function allow(userId) {
    const now = Date.now();
    const bucket = buckets.get(userId);
    if (!bucket || now - bucket.start >= 60_000) {
      buckets.set(userId, { start: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= limitPerMinute;
  };
}
