import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Agent } from './agent.js';
import { createSandbox } from './tools.js';
import { loadState, saveState } from './store.js';
import {
  appendExchange,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  renameSession,
} from './sessions.js';

function cloudError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function textOf(segments) {
  return segments
    .filter((segment) => segment.type === 'text')
    .map((segment) => segment.text)
    .join('\n')
    .trim();
}

export function buildAppServer({ config }) {
  const app = Fastify({
    logger: { level: process.env.APP_LOG_LEVEL || 'info' },
    bodyLimit: 2 * 1024 * 1024,
  });

  const state = loadState(config);
  let activation = null;
  let busy = false;
  let activeController = null;
  const pendingConfirms = new Map();

  app.register(fastifyStatic, {
    root: path.join(config.root, 'src', 'app', 'ui'),
    prefix: '/',
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    );
    return payload;
  });

  const cloudBase = () => (state.settings.cloudUrl || config.cloudUrl).replace(/\/$/, '');

  async function cloudGet(pathname) {
    const response = await fetch(`${cloudBase()}${pathname}`, {
      headers: { authorization: `Bearer ${state.apiKey}` },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw cloudError(
        payload?.error?.message || `Сервер ответил ${response.status}`,
        response.status,
      );
    }
    return response.json();
  }

  app.get('/api/health', async () => ({
    ok: true,
    version: config.version,
    cloud: config.cloudUrl,
  }));

  app.get('/api/state', async () => {
    let user = state.user;
    let balance = Number(state.user?.balance_micro) || 0;
    let cloudOk = true;

    if (state.apiKey) {
      try {
        const me = await cloudGet('/v1/me');
        user = me.user;
        balance = me.user.balance_micro;
        state.user = user;
        saveState(config, state);
      } catch {
        cloudOk = false;
      }
    }

    return {
      activated: Boolean(state.apiKey),
      cloud_ok: cloudOk,
      user,
      balance_micro: balance,
      settings: state.settings,
      cloud_url: cloudBase(),
      version: config.version,
      model: config.model,
    };
  });

  app.post('/api/activate/start', async () => {
    const response = await fetch(`${cloudBase()}/v1/device/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device_name: os.hostname(),
        os: `${process.platform} ${os.release()}`,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw cloudError(payload?.error?.message || 'Сервер активации недоступен', 502);
    }

    const data = await response.json();
    activation = {
      deviceCode: data.device_code,
      userCode: data.user_code,
      botUrl: data.bot_url,
      expiresAt: Date.now() + Number(data.expires_in || 600) * 1000,
    };

    return {
      user_code: data.user_code,
      bot_url: data.bot_url,
      expires_in: data.expires_in,
      interval: data.interval || 2,
    };
  });

  app.get('/api/activate/status', async () => {
    if (state.apiKey) return { activated: true, user: state.user };
    if (!activation) return { activated: false, status: 'idle' };
    if (Date.now() > activation.expiresAt) {
      activation = null;
      return { activated: false, status: 'expired' };
    }

    const response = await fetch(
      `${cloudBase()}/v1/device/token?device_code=${encodeURIComponent(activation.deviceCode)}`,
    );

    if (response.status === 200) {
      const data = await response.json();
      if (!data.api_key) return { activated: false, status: 'pending' };
      state.apiKey = data.api_key;
      state.user = data.user;
      saveState(config, state);
      activation = null;
      return { activated: true, user: data.user, balance_micro: data.balance_micro };
    }

    if (response.status === 410) {
      activation = null;
      return { activated: false, status: 'expired' };
    }

    return { activated: false, status: 'pending' };
  });

  app.post('/api/deactivate', async () => {
    state.apiKey = '';
    state.user = null;
    saveState(config, state);
    activation = null;
    return { ok: true };
  });

  app.post('/api/settings', async (req, reply) => {
    const body = req.body || {};
    if (body.mode && !['workspace', 'full'].includes(body.mode)) {
      return reply.code(400).send({ error: { message: 'Режим: workspace или full' } });
    }
    if (body.approval && !['auto', 'ask'].includes(body.approval)) {
      return reply.code(400).send({ error: { message: 'Подтверждения: auto или ask' } });
    }

    if (body.workspace) {
      const workspace = path.resolve(String(body.workspace));
      fs.mkdirSync(workspace, { recursive: true });
      state.settings.workspace = workspace;
    }
    if (body.mode) state.settings.mode = body.mode;
    if (body.approval) state.settings.approval = body.approval;

    if (typeof body.cloudUrl === 'string') {
      const url = body.cloudUrl.trim();
      if (url && !/^https?:\/\//i.test(url)) {
        return reply
          .code(400)
          .send({ error: { message: 'Адрес сервера должен начинаться с http:// или https://' } });
      }
      state.settings.cloudUrl = url.replace(/\/$/, '');
    }

    saveState(config, state);
    return { ok: true, settings: state.settings };
  });

  app.get('/api/sessions', async () => ({ sessions: listSessions(config) }));

  app.post('/api/sessions', async () => createSession(config));

  app.get('/api/sessions/:id', async (req, reply) => {
    try {
      return getSession(config, req.params.id);
    } catch {
      return reply.code(404).send({ error: { message: 'Сессия не найдена' } });
    }
  });

  app.patch('/api/sessions/:id', async (req, reply) => {
    const title = String(req.body?.title || '').trim();
    if (!title) return reply.code(400).send({ error: { message: 'Пустое название' } });
    try {
      return renameSession(config, req.params.id, title);
    } catch {
      return reply.code(404).send({ error: { message: 'Сессия не найдена' } });
    }
  });

  app.delete('/api/sessions/:id', async (req) => {
    deleteSession(config, req.params.id);
    return { ok: true };
  });

  app.get('/api/usage', async (req, reply) => {
    if (!state.apiKey) return reply.code(401).send({ error: { message: 'Не активирован' } });
    try {
      const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 90);
      const data = await cloudGet(`/v1/me/usage?days=${days}`);
      return { ...data, balance_micro: data.balance_micro, settings: state.settings };
    } catch (err) {
      return reply.code(err.status || 502).send({ error: { message: err.message } });
    }
  });

  app.post('/api/confirm', async (req) => {
    const { id, allow } = req.body || {};
    const pending = pendingConfirms.get(String(id));
    if (pending) {
      pending.resolve(Boolean(allow));
      pendingConfirms.delete(String(id));
    }
    return { ok: true };
  });

  app.post('/api/stop', async () => {
    if (activeController) activeController.abort();
    for (const pending of pendingConfirms.values()) pending.resolve(false);
    pendingConfirms.clear();
    return { ok: true };
  });

  app.post('/api/chat', async (req, reply) => {
    if (!state.apiKey)
      return reply.code(401).send({ error: { message: 'Сначала активируйте Джарвиса' } });
    if (busy)
      return reply.code(409).send({ error: { message: 'Джарвис ещё думает над прошлой задачей' } });

    const message = String(req.body?.message || '').trim();
    if (!message) return reply.code(400).send({ error: { message: 'Пустое сообщение' } });
    if (message.length > 8000)
      return reply.code(400).send({ error: { message: 'Слишком длинное сообщение' } });

    let session;
    try {
      session = req.body?.session_id
        ? getSession(config, req.body.session_id)
        : createSession(config);
    } catch {
      return reply.code(404).send({ error: { message: 'Сессия не найдена' } });
    }

    busy = true;
    const controller = new AbortController();
    activeController = controller;

    reply.hijack();
    const out = reply.raw;
    out.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });

    const send = (event) => {
      if (!out.writableEnded) out.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const sandbox = createSandbox({
      workspace: state.settings.workspace,
      mode: state.settings.mode,
    });
    const history = session.messages
      .slice(-20)
      .map((item) => ({ role: item.role, content: item.content }));

    const segments = [];
    let currentText = null;
    let usage = null;

    const onEvent = (event) => {
      if (event.type === 'delta') {
        if (!currentText) {
          currentText = { type: 'text', text: '' };
          segments.push(currentText);
        }
        currentText.text += event.text;
      } else if (event.type === 'tool_start') {
        currentText = null;
        segments.push({
          type: 'tool',
          step: event.step,
          name: event.name,
          args: event.args,
          ok: null,
        });
      } else if (event.type === 'tool_result') {
        const segment = [...segments]
          .reverse()
          .find((item) => item.type === 'tool' && item.step === event.step);
        if (segment) {
          segment.ok = event.ok;
          segment.preview = event.preview;
          segment.durationMs = event.durationMs;
        }
      } else if (event.type === 'usage') {
        usage = { prompt: event.prompt, completion: event.completion };
      }
      send(event);
    };

    try {
      const agent = new Agent({
        cloudUrl: cloudBase(),
        apiKey: state.apiKey,
        model: config.model,
        maxSteps: config.maxSteps,
        approval: state.settings.approval,
        signal: controller.signal,
        toolCtx: { sandbox },
        onEvent,
        confirm: ({ name, args }) =>
          new Promise((resolve) => {
            const id = crypto.randomUUID();
            const timer = setTimeout(() => {
              pendingConfirms.delete(id);
              resolve(false);
            }, 120000);
            pendingConfirms.set(id, {
              resolve: (value) => {
                clearTimeout(timer);
                resolve(value);
              },
            });
            send({ type: 'confirm', id, name, args });
          }),
      });

      const result = await agent.run(history, message);
      const now = new Date().toISOString();
      appendExchange(config, session.id, {
        user: { role: 'user', content: message, at: now },
        assistant: {
          role: 'assistant',
          content: result.text,
          at: now,
          usage,
          segments,
        },
      });
      send({ type: 'done', text: result.text, usage, session_id: session.id });
    } catch (err) {
      if (controller.signal.aborted) {
        const partial = textOf(segments);
        if (partial || segments.length > 0) {
          appendExchange(config, session.id, {
            user: { role: 'user', content: message, at: new Date().toISOString() },
            assistant: {
              role: 'assistant',
              content: partial,
              at: new Date().toISOString(),
              usage,
              segments,
              stopped: true,
            },
          });
        }
        send({ type: 'stopped', session_id: session.id });
      } else {
        send({ type: 'error', message: err.message, status: err.status || 0 });
      }
    } finally {
      busy = false;
      activeController = null;
      if (!out.writableEnded) {
        out.write('data: [DONE]\n\n');
        out.end();
      }
    }

    return reply;
  });

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'app request failed');
    if (reply.sent) return;
    reply.code(err.statusCode || 500).send({ error: { message: err.message || 'Ошибка' } });
  });

  return app;
}
