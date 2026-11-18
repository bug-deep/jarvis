import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBot } from '../src/cloud/bot.js';
import { createDeviceCode, getBalance, openStore, pickUpDeviceKey } from '../src/cloud/store.js';
import { sha256 } from '../src/cloud/auth.js';

async function startFakeApi() {
  const calls = [];

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const payload = raw ? JSON.parse(raw) : {};
    const method = req.url.split('/').pop();
    calls.push({ method, payload });

    let result = true;
    if (method === 'getMe') {
      result = { id: 42, is_bot: true, first_name: 'Jarvis', username: 'jarvis_test_bot' };
    } else if (method === 'sendMessage') {
      result = {
        message_id: calls.length,
        date: 1,
        chat: { id: payload.chat_id, type: 'private' },
        text: payload.text,
      };
    } else if (method === 'getChatMember') {
      result = {
        status: 'member',
        user: { id: payload.user_id, is_bot: false, first_name: 'Tester' },
      };
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, calls, port: server.address().port };
}

let seq = 1;

function messageUpdate(text, fromId = 555) {
  const command = text.startsWith('/') ? text.split(/\s+/)[0].slice(1).split('@')[0] : null;
  return {
    update_id: seq++,
    message: {
      message_id: seq,
      date: 1,
      chat: { id: fromId, type: 'private' },
      from: { id: fromId, is_bot: false, first_name: 'Tester', username: 'tester' },
      text,
      entities: command
        ? [{ type: 'bot_command', offset: 0, length: command.length + 1 }]
        : undefined,
    },
  };
}

function callbackUpdate(data, fromId = 555) {
  return {
    update_id: seq++,
    callback_query: {
      id: String(seq),
      from: { id: fromId, is_bot: false, first_name: 'Tester' },
      chat_instance: '1',
      data,
      message: { message_id: 1, date: 1, chat: { id: fromId, type: 'private' } },
    },
  };
}

test('бот: /start, активация кодом и бонус за канал', async (t) => {
  const { server, calls, port } = await startFakeApi();
  const db = openStore(':memory:');
  t.after(() => {
    server.close();
    db.close();
  });

  const config = {
    telegram: {
      token: '123:TEST',
      username: 'jarvis_test_bot',
      channelId: '@jarvis_test',
      adminTgId: '999',
      downloadUrl: 'http://example.test/',
    },
    bonusMicro: 30_000_000,
  };

  const bot = createBot({
    db,
    config,
    botOptions: { client: { apiRoot: `http://127.0.0.1:${port}` } },
  });

  await bot.init();
  await bot.handleUpdate(messageUpdate('/start'));
  const startReply = calls.filter((call) => call.method === 'sendMessage').at(-1);
  assert.match(startReply.payload.text, /Я Джарвис/);
  const markup = JSON.stringify(startReply.payload.reply_markup || {});
  assert.match(markup, /Скачать для Windows/);
  assert.match(markup, /example\.test/);

  const deviceCode = 'test-device-code';
  createDeviceCode(db, {
    codeHash: sha256(deviceCode),
    userCode: 'ABCD2345',
    deviceName: 'test-pc',
    os: 'linux',
    ttlSec: 600,
  });

  await bot.handleUpdate(messageUpdate('ABCD2345'));
  const activated = calls.filter((call) => call.method === 'sendMessage').at(-1);
  assert.match(activated.payload.text, /Устройство активировано/);

  const picked = pickUpDeviceKey(db, sha256(deviceCode));
  assert.ok(picked);
  assert.match(picked.apiKey, /^jv_/);

  await bot.handleUpdate(callbackUpdate('bonus'));
  const member = calls.find((call) => call.method === 'getChatMember');
  assert.equal(member.payload.chat_id, '@jarvis_test');
  assert.equal(getBalance(db, picked.user.id), 30_000_000);

  await bot.handleUpdate(callbackUpdate('bonus'));
  const answers = calls.filter((call) => call.method === 'answerCallbackQuery');
  assert.equal(answers.at(-1).payload.text, 'Бонус уже получен');
  assert.equal(getBalance(db, picked.user.id), 30_000_000);
});
