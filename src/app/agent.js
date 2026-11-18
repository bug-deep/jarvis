import { TOOL_DEFS, runTool } from './tools.js';

function systemPrompt(ctx) {
  const modeText =
    ctx.sandbox.mode === 'full'
      ? 'режим «Весь компьютер» — доступны любые файлы, опасные действия подтверждает пользователь'
      : 'режим «Моя папка» — можно писать только внутри рабочей папки';

  return `Ты Джарвис — ИИ-помощник, который работает прямо на компьютере пользователя.
Ты умеешь разговаривать и выполнять действия: работать с файлами, запускать команды, открывать ссылки.

Сейчас: ${modeText}.
Рабочая папка: ${ctx.sandbox.root}.

Правила:
- Отвечай по-русски, коротко и по делу.
- Если нужно что-то сделать на компьютере — вызывай инструмент, а не описывай, что пользователь мог бы сделать сам.
- Не выдумывай результаты команд: сначала вызови инструмент, потом говори.
- Опасные действия (запись, удаление, команды) пользователь подтверждает в интерфейсе — не проси подтверждение словами.
- Пути указывай относительно рабочей папки, если не просят иное.
- Не запускай команды, которые работают бесконечно или ждут ввода.
- Если задача невыполнима в текущем режиме — скажи, что включить режим «Весь компьютер».`;
}

function parseArgs(raw) {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export class Agent {
  constructor({
    cloudUrl,
    apiKey,
    model = 'deepseek-flash',
    maxSteps = 12,
    approval = 'ask',
    signal = null,
    toolCtx,
    onEvent,
    confirm,
  }) {
    this.cloudUrl = cloudUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.maxSteps = maxSteps;
    this.approval = approval;
    this.signal = signal;
    this.toolCtx = toolCtx;
    this.onEvent = onEvent || (() => {});
    this.confirm = confirm || (async () => false);
  }

  async run(history, userText) {
    const messages = [
      { role: 'system', content: systemPrompt(this.toolCtx) },
      ...history.slice(-20).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText },
    ];

    const totals = { prompt: 0, completion: 0 };
    let toolStep = 0;

    for (let step = 0; step < this.maxSteps; step += 1) {
      const { text, calls, usage } = await this.stream(messages);
      if (usage) {
        totals.prompt += Number(usage.prompt_tokens) || 0;
        totals.completion += Number(usage.completion_tokens) || 0;
      }

      if (calls.length === 0) {
        this.onEvent({ type: 'usage', ...totals, steps: step + 1 });
        return { text, steps: step + 1 };
      }

      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      });

      for (const call of calls) {
        toolStep += 1;
        const args = parseArgs(call.arguments);
        const def = TOOL_DEFS.find((t) => t.function.name === call.name);
        const startedAt = Date.now();
        this.onEvent({ type: 'tool_start', name: call.name, args, step: toolStep });

        let result;
        try {
          if (!def) throw new Error(`Неизвестный инструмент: ${call.name}`);
          if (def.confirm && this.approval !== 'auto') {
            const allowed = await this.confirm({ name: call.name, args });
            if (!allowed) {
              result = 'Пользователь отклонил действие.';
              this.onEvent({
                type: 'tool_result',
                name: call.name,
                ok: false,
                preview: result,
                step: toolStep,
                durationMs: Date.now() - startedAt,
              });
              messages.push({ role: 'tool', tool_call_id: call.id, content: result });
              continue;
            }
          }
          result = await runTool(call.name, args, this.toolCtx);
          this.onEvent({
            type: 'tool_result',
            name: call.name,
            ok: true,
            preview: String(result).slice(0, 400),
            step: toolStep,
            durationMs: Date.now() - startedAt,
          });
        } catch (err) {
          result = `Ошибка: ${err.message}`;
          this.onEvent({
            type: 'tool_result',
            name: call.name,
            ok: false,
            preview: result,
            step: toolStep,
            durationMs: Date.now() - startedAt,
          });
        }

        messages.push({ role: 'tool', tool_call_id: call.id, content: String(result) });
      }
    }

    const text = 'Не получилось закончить за разумное число шагов. Уточни задачу, пожалуйста.';
    this.onEvent({ type: 'usage', ...totals, steps: this.maxSteps });
    return { text, steps: this.maxSteps };
  }

  async stream(messages) {
    const response = await fetch(`${this.cloudUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      signal: this.signal ?? undefined,
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: TOOL_DEFS,
        stream: true,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = payload?.error?.message || `Сервер ответил ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let usage = null;
    const calls = new Map();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (event.error) throw new Error(event.error.message || 'Ошибка сервера');
        if (event.usage) usage = event.usage;

        const choice = event.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta || {};
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content;
          this.onEvent({ type: 'delta', text: delta.content });
        }

        for (const part of delta.tool_calls || []) {
          const index = part.index ?? 0;
          const current = calls.get(index) || { id: '', name: '', arguments: '' };
          if (part.id) current.id = part.id;
          if (part.function?.name) current.name += part.function.name;
          if (part.function?.arguments) current.arguments += part.function.arguments;
          calls.set(index, current);
        }
      }
    }

    const list = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => call)
      .filter((call) => call.name);

    return { text, calls: list, usage };
  }
}
