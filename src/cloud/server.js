import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  addLedger,
  adminStats,
  adminUsers,
  approveDeviceCode,
  createDeviceCode,
  findCodeByHash,
  findUserByTg,
  getBalance,
  listDevices,
  listPendingCodes,
  pickUpDeviceKey,
  revokeKey,
  upsertUser,
  usageSummary,
} from './store.js';
import { authenticate, newApiKey, randomToken, randomUserCode, sha256 } from './auth.js';
import { registerGateway } from './gateway.js';

const DIST = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'dist');
const LANDING = fileURLToPath(new URL('./ui/landing.html', import.meta.url));

function latestFile(prefix, extension) {
  try {
    const files = fs
      .readdirSync(DIST)
      .filter((name) => name.startsWith(prefix) && name.endsWith(extension))
      .sort();
    return files.length ? path.join(DIST, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

function sendDownload(reply, file) {
  if (!file) {
    return reply.code(404).send({ error: { message: 'Файл ещё не собран' } });
  }
  const stat = fs.statSync(file);
  reply.header('content-type', 'application/octet-stream');
  reply.header('content-disposition', `attachment; filename="${path.basename(file)}"`);
  reply.header('content-length', stat.size);
  return reply.send(fs.createReadStream(file));
}

function publicUser(db, user) {
  return {
    id: user.id,
    tg_id: user.tg_id,
    username: user.username,
    first_name: user.first_name,
    balance_micro: getBalance(db, user.id),
  };
}

export function buildApp({ db, config, logger = true }) {
  const app = Fastify({
    logger: logger ? { level: config.logLevel } : false,
    bodyLimit: 4 * 1024 * 1024,
    trustProxy: true,
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    if (req.url.startsWith('/admin')) {
      reply.header(
        'content-security-policy',
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:",
      );
    }
    return payload;
  });

  const uiRoot = fileURLToPath(new URL('./ui/', import.meta.url));
  app.register(fastifyStatic, { root: uiRoot, prefix: '/admin/', index: ['admin.html'] });
  app.get('/admin', async (_req, reply) => reply.redirect('/admin/'));

  app.get('/', async (_req, reply) => {
    try {
      return reply.type('text/html; charset=utf-8').send(fs.readFileSync(LANDING));
    } catch {
      return reply.type('text/html; charset=utf-8').send('<h1>Jarvis</h1>');
    }
  });

  app.get('/download/windows', async (_req, reply) =>
    sendDownload(reply, latestFile('Jarvis-Setup-', '.exe')),
  );

  app.get('/download/portable', async (_req, reply) =>
    sendDownload(reply, latestFile('Jarvis-portable-', '.zip')),
  );

  app.get('/health', async () => ({
    ok: true,
    service: 'jarvis-cloud',
    time: new Date().toISOString(),
  }));

  registerGateway(app, { db, config });

  // --- Активация устройства -------------------------------------------------

  app.post('/v1/device/code', async (req, reply) => {
    const body = req.body || {};
    const deviceName = String(body.device_name || '').slice(0, 64) || null;
    const os = String(body.os || '').slice(0, 64) || null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const userCode = randomUserCode(8);
      const deviceCode = randomToken(32);
      try {
        createDeviceCode(db, {
          codeHash: sha256(deviceCode),
          userCode,
          deviceName,
          os,
          ttlSec: config.deviceCodeTtlSec,
        });
        return {
          device_code: deviceCode,
          user_code: userCode,
          expires_in: config.deviceCodeTtlSec,
          interval: 2,
          bot_url: config.telegram.username ? `https://t.me/${config.telegram.username}` : null,
        };
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) continue;
        throw err;
      }
    }
    return reply.code(500).send({ error: { message: 'Не удалось создать код' } });
  });

  app.get('/v1/device/token', async (req, reply) => {
    const deviceCode = String(req.query?.device_code || '');
    if (!deviceCode) return reply.code(400).send({ error: { message: 'device_code обязателен' } });

    const hash = sha256(deviceCode);
    const picked = pickUpDeviceKey(db, hash);
    if (picked) {
      return {
        status: 'approved',
        api_key: picked.apiKey,
        user: picked.user,
        balance_micro: picked.balanceMicro,
      };
    }

    const row = findCodeByHash(db, hash);
    if (!row) return reply.code(404).send({ error: { message: 'Код не найден' } });
    if (Date.parse(row.expires_at) < Date.now()) {
      return reply.code(410).send({ status: 'expired', error: { message: 'Код истёк' } });
    }
    return reply.code(202).send({ status: 'pending' });
  });

  // --- Админ ----------------------------------------------------------------

  function requireAdmin(req, reply) {
    if (!config.adminToken) {
      reply.code(503).send({ error: { message: 'Админка отключена (ADMIN_TOKEN не задан)' } });
      return false;
    }
    if (String(req.headers['x-admin-token'] || '') !== config.adminToken) {
      reply.code(403).send({ error: { message: 'Нет доступа' } });
      return false;
    }
    return true;
  }

  app.get('/v1/admin/devices/pending', async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply;
    return { codes: listPendingCodes(db, Number(req.query?.limit)) };
  });

  app.post('/v1/admin/device/approve', async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply;
    const body = req.body || {};
    const userCode = String(body.user_code || '').toUpperCase();
    if (!userCode) return reply.code(400).send({ error: { message: 'user_code обязателен' } });

    const tgId = body.tg_id || config.telegram.adminTgId;
    if (!tgId) {
      return reply.code(400).send({ error: { message: 'Нужен tg_id (или задай ADMIN_TG_ID)' } });
    }
    const user = upsertUser(db, {
      tgId,
      username: body.username,
      firstName: body.first_name,
    });
    const key = newApiKey();
    const result = approveDeviceCode(db, {
      userCode,
      userId: user.id,
      deviceName: body.device_name,
      os: body.os,
      keyHash: key.hash,
      prefix: key.prefix,
      apiKeyPlain: key.plain,
    });
    if (!result.ok) {
      return reply
        .code(result.reason === 'expired' ? 410 : 404)
        .send({ error: { message: result.reason } });
    }
    return { ok: true, user: publicUser(db, user) };
  });

  app.post('/v1/admin/credit', async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply;
    const body = req.body || {};
    const amount = Number(body.amount_rub);
    if (!Number.isFinite(amount) || amount === 0) {
      return reply.code(400).send({ error: { message: 'amount_rub обязателен' } });
    }
    const user = findUserByTg(db, body.tg_id);
    if (!user) return reply.code(404).send({ error: { message: 'Пользователь не найден' } });

    const res = addLedger(db, {
      userId: user.id,
      deltaMicro: Math.round(amount * 1_000_000),
      kind: 'admin_credit',
      ref: randomToken(8),
      note: String(body.note || '').slice(0, 200),
    });
    return { ok: true, balance_micro: res.balanceMicro };
  });

  app.get('/v1/admin/stats', async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply;
    return adminStats(db);
  });

  app.get('/v1/admin/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply;
    return { users: adminUsers(db, Number(req.query?.limit)) };
  });

  // --- Пользователь ---------------------------------------------------------

  app.get('/v1/me', async (req, reply) => {
    const key = authenticate(db, req.headers.authorization);
    if (!key) return reply.code(401).send({ error: { message: 'Нет доступа' } });
    const user = {
      id: key.user_id,
      tg_id: key.tg_id,
      username: key.username,
      first_name: key.first_name,
    };
    return { user: publicUser(db, user), key: { id: key.id, prefix: key.prefix } };
  });

  app.get('/v1/me/usage', async (req, reply) => {
    const key = authenticate(db, req.headers.authorization);
    if (!key) return reply.code(401).send({ error: { message: 'Нет доступа' } });
    const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 90);
    return { balance_micro: getBalance(db, key.user_id), ...usageSummary(db, key.user_id, days) };
  });

  app.get('/v1/me/devices', async (req, reply) => {
    const key = authenticate(db, req.headers.authorization);
    if (!key) return reply.code(401).send({ error: { message: 'Нет доступа' } });
    return { devices: listDevices(db, key.user_id) };
  });

  app.post('/v1/me/devices/:id/revoke', async (req, reply) => {
    const key = authenticate(db, req.headers.authorization);
    if (!key) return reply.code(401).send({ error: { message: 'Нет доступа' } });
    const ok = revokeKey(db, key.user_id, Number(req.params.id));
    return { ok };
  });

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'request failed');
    if (reply.sent) return;
    reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({
      error: {
        message: err.statusCode && err.statusCode < 500 ? err.message : 'Внутренняя ошибка',
      },
    });
  });

  return app;
}
