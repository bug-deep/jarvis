import crypto from 'node:crypto';
import { authenticate, createRateLimiter } from './auth.js';
import { DEFAULT_PRICES, computeCostMicro, normalizeModel } from '../shared/pricing.js';
import { addLedger, addUsage, getBalance } from './store.js';

function badRequest(reply, message) {
  return reply.code(400).send({ error: { message, type: 'invalid_request_error' } });
}

function settle({ db, config, key, model, usage, requestId }) {
  if (!usage) return null;
  const cost = computeCostMicro({
    model,
    inputTokens: usage.prompt_tokens,
    cacheHitTokens: usage.prompt_cache_hit_tokens ?? 0,
    outputTokens: usage.completion_tokens,
    usdRub: config.pricing.usdRub,
    markup: config.pricing.markup,
  });

  addUsage(db, {
    userId: key.user_id,
    requestId,
    model,
    inputTokens: cost.inputTokens,
    cacheHitTokens: cost.cacheHitTokens,
    cacheMissTokens: cost.cacheMissTokens,
    outputTokens: cost.outputTokens,
    costMicro: cost.micro,
    priceMicro: cost.micro,
  });

  addLedger(db, {
    userId: key.user_id,
    deltaMicro: -cost.micro,
    kind: 'usage',
    ref: requestId,
    note: model,
  });

  return cost;
}

export function registerGateway(app, { db, config }) {
  const allow = createRateLimiter(config.rateLimitPerMinute);

  app.get('/v1/models', async () => ({
    object: 'list',
    data: Object.keys(DEFAULT_PRICES).map((id) => ({
      id,
      object: 'model',
      owned_by: 'deepseek',
      pricing_usd_per_million: DEFAULT_PRICES[id],
    })),
  }));

  app.post('/v1/chat/completions', async (req, reply) => {
    const key = authenticate(db, req.headers.authorization);
    if (!key) {
      return reply
        .code(401)
        .send({ error: { message: 'Неверный или отозванный ключ', type: 'auth_error' } });
    }

    if (!allow(key.user_id)) {
      return reply.code(429).send({
        error: { message: 'Слишком много запросов, подождите минуту', type: 'rate_limit' },
      });
    }

    if (!config.deepseek.apiKey) {
      return reply
        .code(503)
        .send({ error: { message: 'Ключ DeepSeek не настроен на сервере', type: 'config_error' } });
    }

    const body = req.body || {};
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return badRequest(reply, 'messages обязателен');
    }

    const model = normalizeModel(body.model || config.deepseek.model);
    if (!DEFAULT_PRICES[model]) return badRequest(reply, `модель не поддерживается: ${model}`);

    const balance = getBalance(db, key.user_id);
    if (balance < config.minBalanceMicro) {
      return reply.code(402).send({
        error: {
          message: 'Баланс закончился',
          type: 'insufficient_balance',
          balance_micro: balance,
        },
      });
    }

    const isStream = body.stream !== false;
    const maxTokens = Math.min(
      Math.max(1, Number(body.max_tokens) || config.deepseek.maxTokens),
      config.deepseek.maxTokens,
    );

    const payload = {
      model,
      messages: body.messages,
      stream: isStream,
      max_tokens: maxTokens,
    };
    if (typeof body.temperature === 'number') payload.temperature = body.temperature;
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      payload.tools = body.tools;
      if (body.tool_choice) payload.tool_choice = body.tool_choice;
    }
    if (isStream) payload.stream_options = { include_usage: true };

    const requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.deepseek.timeoutMs);

    let upstream;
    try {
      upstream = await fetch(`${config.deepseek.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.deepseek.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err?.name === 'AbortError';
      return reply.code(aborted ? 504 : 502).send({
        error: {
          message: aborted ? 'DeepSeek не ответил вовремя' : 'Ошибка соединения с DeepSeek',
          type: 'upstream_error',
        },
      });
    }

    if (!upstream.ok) {
      clearTimeout(timer);
      const text = await upstream.text().catch(() => '');
      app.log.warn({ status: upstream.status, body: text.slice(0, 500) }, 'deepseek error');
      return reply.code(502).send({
        error: {
          message: `DeepSeek вернул ${upstream.status}`,
          type: 'upstream_error',
          detail: text.slice(0, 300),
        },
      });
    }

    if (!isStream) {
      const data = await upstream.json();
      clearTimeout(timer);
      settle({ db, config, key, model, usage: data.usage, requestId });
      return reply.send(data);
    }

    reply.hijack();
    const out = reply.raw;
    out.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    let closed = false;
    out.on('close', () => {
      closed = true;
      controller.abort();
    });

    const decoder = new TextDecoder();
    let buffer = '';
    let usage = null;

    try {
      for await (const chunk of upstream.body) {
        if (closed) break;
        out.write(chunk);

        buffer += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.usage) usage = parsed.usage;
          } catch {
            // неполный JSON — не повод рвать поток
          }
        }
      }
    } catch (err) {
      if (!closed) {
        out.write(
          `data: ${JSON.stringify({ error: { message: 'Поток прерван', type: 'stream_error' } })}\n\n`,
        );
      }
      app.log.warn({ err: err?.message }, 'stream failed');
    } finally {
      clearTimeout(timer);
      settle({ db, config, key, model, usage, requestId });
      if (!closed) {
        out.write('data: [DONE]\n\n');
        out.end();
      }
    }

    return reply;
  });
}
