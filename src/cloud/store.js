import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  tg_id         TEXT UNIQUE,
  username      TEXT,
  first_name    TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  balance_micro INTEGER NOT NULL DEFAULT 0,
  bonus_granted_at TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  name         TEXT,
  os           TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  device_id    INTEGER REFERENCES devices(id),
  prefix       TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE,
  label        TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);

CREATE TABLE IF NOT EXISTS device_codes (
  id               INTEGER PRIMARY KEY,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code        TEXT NOT NULL UNIQUE,
  user_id          INTEGER,
  device_name      TEXT,
  os               TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  approved_at      TEXT,
  api_key_plain    TEXT
);

CREATE TABLE IF NOT EXISTS ledger (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  delta_micro INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  ref         TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_idem ON ledger(kind, ref) WHERE ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS usage (
  id               INTEGER PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  request_id       TEXT UNIQUE,
  model            TEXT NOT NULL,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
  cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_micro       INTEGER NOT NULL DEFAULT 0,
  price_micro      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_user_time ON usage(user_id, created_at);
`;

export function openStore(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

const now = () => new Date().toISOString();

export function upsertUser(db, { tgId, username, firstName }) {
  db.prepare(
    `INSERT INTO users (tg_id, username, first_name, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET
       username = COALESCE(excluded.username, users.username),
       first_name = COALESCE(excluded.first_name, users.first_name)`,
  ).run(String(tgId), username || null, firstName || null, now());
  return db.prepare('SELECT * FROM users WHERE tg_id = ?').get(String(tgId));
}

export function findUserByTg(db, tgId) {
  return db.prepare('SELECT * FROM users WHERE tg_id = ?').get(String(tgId));
}

export function findUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getBalance(db, userId) {
  const row = db.prepare('SELECT balance_micro FROM users WHERE id = ?').get(userId);
  return row ? row.balance_micro : 0;
}

export function createDeviceCode(db, { codeHash, userCode, deviceName, os, ttlSec }) {
  const created = Date.now();
  db.prepare(
    `INSERT INTO device_codes (device_code_hash, user_code, device_name, os, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    codeHash,
    userCode,
    deviceName || null,
    os || null,
    new Date(created).toISOString(),
    new Date(created + ttlSec * 1000).toISOString(),
  );
}

export function findPendingCodeByUserCode(db, userCode) {
  return db
    .prepare(
      `SELECT * FROM device_codes
       WHERE user_code = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
    )
    .get(String(userCode).toUpperCase());
}

export function findCodeByHash(db, codeHash) {
  return db.prepare('SELECT * FROM device_codes WHERE device_code_hash = ?').get(codeHash);
}

export function expireCode(db, id) {
  db.prepare("UPDATE device_codes SET status = 'expired' WHERE id = ?").run(id);
}

// Одобрение кода ботом: создаёт устройство и ключ, кладёт ключ в awaiting pickup.
// Возвращает { ok, deviceId, keyId } либо { ok: false, reason }.
export function approveDeviceCode(
  db,
  { userCode, userId, deviceName, os, keyHash, prefix, apiKeyPlain },
) {
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        "SELECT * FROM device_codes WHERE user_code = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get(String(userCode).toUpperCase());
    if (!row) return { ok: false, reason: 'not_found' };
    if (Date.parse(row.expires_at) < Date.now()) {
      expireCode(db, row.id);
      return { ok: false, reason: 'expired' };
    }

    const device = db
      .prepare('INSERT INTO devices (user_id, name, os, created_at) VALUES (?, ?, ?, ?)')
      .run(userId, deviceName || row.device_name || null, os || row.os || null, now());
    const key = db
      .prepare(
        'INSERT INTO api_keys (user_id, device_id, prefix, hash, label, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        userId,
        device.lastInsertRowid,
        prefix,
        keyHash,
        deviceName || row.device_name || null,
        now(),
      );

    db.prepare(
      `UPDATE device_codes
       SET status = 'approved', user_id = ?, approved_at = ?, api_key_plain = ?
       WHERE id = ?`,
    ).run(userId, now(), apiKeyPlain, row.id);

    return {
      ok: true,
      deviceId: Number(device.lastInsertRowid),
      keyId: Number(key.lastInsertRowid),
    };
  });
  return tx();
}

// Выдача ключа приложению: ровно один раз.
export function pickUpDeviceKey(db, codeHash) {
  const tx = db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM device_codes WHERE device_code_hash = ? AND status = 'approved'")
      .get(codeHash);
    if (!row || !row.api_key_plain) return null;

    const user = findUserById(db, row.user_id);
    if (!user) return null;

    db.prepare('UPDATE device_codes SET api_key_plain = NULL WHERE id = ?').run(row.id);
    return {
      apiKey: row.api_key_plain,
      user: { id: user.id, tgId: user.tg_id, username: user.username, firstName: user.first_name },
      balanceMicro: user.balance_micro,
    };
  });
  return tx();
}

export function findKeyByHash(db, hash) {
  const row = db
    .prepare(
      `SELECT k.*, u.tg_id, u.username, u.first_name, u.status AS user_status, u.balance_micro
       FROM api_keys k JOIN users u ON u.id = k.user_id
       WHERE k.hash = ? AND k.revoked_at IS NULL`,
    )
    .get(hash);
  if (!row) return null;
  if (row.user_status !== 'active') return null;
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(now(), row.id);
  return row;
}

export function listDevices(db, userId) {
  return db
    .prepare(
      `SELECT k.id, k.prefix, k.label, k.created_at, k.last_used_at, k.revoked_at,
              d.name AS device_name, d.os
       FROM api_keys k LEFT JOIN devices d ON d.id = k.device_id
       WHERE k.user_id = ? ORDER BY k.id DESC`,
    )
    .all(userId);
}

export function revokeKey(db, userId, keyId) {
  const info = db
    .prepare(
      'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    )
    .run(now(), keyId, userId);
  return info.changes > 0;
}

// Начисление/списание. Идемпотентно по (kind, ref).
export function addLedger(db, { userId, deltaMicro, kind, ref = null, note = null }) {
  const tx = db.transaction(() => {
    if (ref) {
      const dup = db.prepare('SELECT id FROM ledger WHERE kind = ? AND ref = ?').get(kind, ref);
      if (dup) return { ok: false, duplicate: true, balanceMicro: getBalance(db, userId) };
    }
    db.prepare('UPDATE users SET balance_micro = balance_micro + ? WHERE id = ?').run(
      deltaMicro,
      userId,
    );
    db.prepare(
      'INSERT INTO ledger (user_id, delta_micro, kind, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, deltaMicro, kind, ref, note, now());
    return { ok: true, balanceMicro: getBalance(db, userId) };
  });
  return tx();
}

export function grantBonusOnce(db, userId, micro, channel) {
  const tx = db.transaction(() => {
    const user = findUserById(db, userId);
    if (!user) return { ok: false, reason: 'no_user' };
    if (user.bonus_granted_at)
      return { ok: false, reason: 'already', balanceMicro: user.balance_micro };

    db.prepare('UPDATE users SET bonus_granted_at = ? WHERE id = ?').run(now(), userId);
    const res = addLedger(db, {
      userId,
      deltaMicro: micro,
      kind: 'bonus_channel',
      ref: `channel:${channel}:${userId}`,
      note: 'бонус за подписку на канал',
    });
    return { ok: true, balanceMicro: res.balanceMicro };
  });
  return tx();
}

export function addUsage(db, row) {
  db.prepare(
    `INSERT INTO usage
       (user_id, request_id, model, input_tokens, cache_hit_tokens, cache_miss_tokens,
        output_tokens, cost_micro, price_micro, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.userId,
    row.requestId,
    row.model,
    row.inputTokens,
    row.cacheHitTokens,
    row.cacheMissTokens,
    row.outputTokens,
    row.costMicro,
    row.priceMicro,
    now(),
  );
}

export function usageSummary(db, userId, days = 30) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(cache_hit_tokens), 0) AS cache_hit_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cost_micro), 0) AS cost_micro
       FROM usage WHERE user_id = ? AND created_at >= ?`,
    )
    .get(userId, since);

  const daily = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day,
              COUNT(*) AS requests,
              COALESCE(SUM(cost_micro), 0) AS cost_micro,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
       FROM usage WHERE user_id = ? AND created_at >= ?
       GROUP BY day ORDER BY day DESC LIMIT 30`,
    )
    .all(userId, since);

  const last = db
    .prepare(
      `SELECT model, input_tokens, cache_hit_tokens, output_tokens, cost_micro, created_at
       FROM usage WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
    )
    .all(userId);

  return { totals, daily, last };
}

export function adminStats(db) {
  const users = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(balance_micro), 0) AS balance_micro,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_7d
       FROM users`,
    )
    .get(new Date(Date.now() - 7 * 86400_000).toISOString());

  const usage = db
    .prepare(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(cost_micro), 0) AS cost_micro
       FROM usage WHERE created_at >= ?`,
    )
    .get(new Date(Date.now() - 30 * 86400_000).toISOString());

  const keys = db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE revoked_at IS NULL').get();

  return { users, usage, keys };
}

export function adminUsers(db, limit = 100) {
  return db
    .prepare(
      `SELECT u.id, u.tg_id, u.username, u.first_name, u.balance_micro, u.created_at,
              (SELECT COUNT(*) FROM usage WHERE user_id = u.id) AS requests,
              (SELECT COALESCE(SUM(cost_micro), 0) FROM usage WHERE user_id = u.id) AS spent_micro
       FROM users u ORDER BY u.id DESC LIMIT ?`,
    )
    .all(Math.min(Math.max(Number(limit) || 100, 1), 500));
}

export function listPendingCodes(db, limit = 20) {
  return db
    .prepare(
      `SELECT id, user_code, device_name, os, created_at, expires_at
       FROM device_codes
       WHERE status = 'pending' AND expires_at > ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(new Date().toISOString(), Math.min(Math.max(Number(limit) || 20, 1), 100));
}
