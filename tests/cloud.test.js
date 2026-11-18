import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/cloud/server.js';
import { findUserByTg, grantBonusOnce, openStore, upsertUser } from '../src/cloud/store.js';

function config(overrides = {}) {
  return {
    logLevel: 'silent',
    adminToken: 'test-admin',
    deviceCodeTtlSec: 600,
    bonusMicro: 30_000_000,
    minBalanceMicro: 500_000,
    rateLimitPerMinute: 100,
    pricing: { usdRub: 80, markup: 5 },
    deepseek: {
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      maxTokens: 2048,
      timeoutMs: 1000,
    },
    telegram: { username: '', channelId: '', token: '', adminTgId: '' },
    ...overrides,
  };
}

async function makeApp(overrides) {
  const db = openStore(':memory:');
  const app = buildApp({ db, config: config(overrides), logger: false });
  await app.ready();
  return { db, app };
}

async function activate(app, tgId = '42') {
  const code = await app.inject({
    method: 'POST',
    url: '/v1/device/code',
    payload: { device_name: 'test-pc' },
  });
  assert.equal(code.statusCode, 200);
  const { user_code, device_code } = code.json();

  const approve = await app.inject({
    method: 'POST',
    url: '/v1/admin/device/approve',
    headers: { 'x-admin-token': 'test-admin' },
    payload: { user_code, tg_id: tgId },
  });
  assert.equal(approve.statusCode, 200, approve.body);

  const token = await app.inject({
    method: 'GET',
    url: `/v1/device/token?device_code=${device_code}`,
  });
  assert.equal(token.statusCode, 200, token.body);
  return { userCode: user_code, deviceCode: device_code, apiKey: token.json().api_key };
}

test('полный цикл активации и баланса', async () => {
  const { app, db } = await makeApp();

  const { apiKey, deviceCode } = await activate(app);
  assert.match(apiKey, /^jv_/);

  // ключ выдаётся один раз
  const second = await app.inject({
    method: 'GET',
    url: `/v1/device/token?device_code=${deviceCode}`,
  });
  assert.equal(second.statusCode, 202);

  const me = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.balance_micro, 0);

  const credit = await app.inject({
    method: 'POST',
    url: '/v1/admin/credit',
    headers: { 'x-admin-token': 'test-admin' },
    payload: { tg_id: '42', amount_rub: 100 },
  });
  assert.equal(credit.statusCode, 200, credit.body);

  const after = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(after.json().user.balance_micro, 100_000_000);

  const usage = await app.inject({
    method: 'GET',
    url: '/v1/me/usage',
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(usage.statusCode, 200);

  const user = findUserByTg(db, '42');
  assert.ok(user);
  await app.close();
});

test('без ключа и с чужим ключом — 401', async () => {
  const { app } = await makeApp();
  const none = await app.inject({ method: 'GET', url: '/v1/me' });
  assert.equal(none.statusCode, 401);

  const fake = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: 'Bearer jv_fake_fake_fake_fake_fake' },
  });
  assert.equal(fake.statusCode, 401);
  await app.close();
});

test('админка закрыта без токена', async () => {
  const { app } = await makeApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/admin/credit',
    payload: { tg_id: '42', amount_rub: 10 },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test('без ключа DeepSeek шлюз отвечает 503', async () => {
  const { app } = await makeApp();
  const { apiKey } = await activate(app);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${apiKey}` },
    payload: { model: 'deepseek-flash', messages: [{ role: 'user', content: 'привет' }] },
  });
  assert.equal(res.statusCode, 503);
  await app.close();
});

test('бонус за канал начисляется один раз', async () => {
  const { app, db } = await makeApp();
  const user = upsertUser(db, { tgId: '777', username: 'tester', firstName: 'Тест' });

  const first = grantBonusOnce(db, user.id, 30_000_000, '@channel');
  assert.equal(first.ok, true);
  assert.equal(first.balanceMicro, 30_000_000);

  const second = grantBonusOnce(db, user.id, 30_000_000, '@channel');
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'already');
  await app.close();
});

test('админ-страница отдаётся', async () => {
  const { app } = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/admin/' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /JARVIS/);
  await app.close();
});

test('активация без бота: pending-список и approve по ADMIN_TG_ID', async () => {
  const { app } = await makeApp({
    telegram: { username: '', channelId: '', token: '', adminTgId: '999' },
  });

  const created = await app.inject({
    method: 'POST',
    url: '/v1/device/code',
    payload: { device_name: 'windows-test' },
  });
  const { user_code: userCode } = created.json();

  const pending = await app.inject({
    method: 'GET',
    url: '/v1/admin/devices/pending',
    headers: { 'x-admin-token': 'test-admin' },
  });
  assert.ok(pending.json().codes.some((code) => code.user_code === userCode));

  const approved = await app.inject({
    method: 'POST',
    url: '/v1/admin/device/approve',
    headers: { 'x-admin-token': 'test-admin' },
    payload: { user_code: userCode },
  });
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().user.tg_id, '999');

  await app.close();
});
