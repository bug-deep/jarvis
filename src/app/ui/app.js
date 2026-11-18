const $ = (id) => document.getElementById(id);

const TOOL_LABELS = {
  list_dir: 'Смотрю папку',
  read_file: 'Читаю файл',
  write_file: 'Пишу файл',
  make_dir: 'Создаю папку',
  delete_path: 'Удаляю',
  run_command: 'Команда',
  open_url: 'Открываю ссылку',
  system_info: 'Система',
};

const TOOL_ICONS = {
  list_dir: '▤',
  read_file: '▤',
  write_file: '✎',
  make_dir: '＋',
  delete_path: '×',
  run_command: '▶',
  open_url: '↗',
  system_info: '⌘',
};

const state = {
  activated: false,
  settings: {},
  model: 'flash',
  session: null,
  sessions: [],
  busy: false,
  stream: null,
  confirmId: null,
  poll: null,
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatRub(micro) {
  return `${(Number(micro || 0) / 1_000_000).toFixed(2).replace('.', ',')} ₽`;
}

function formatTokens(n) {
  const value = Number(n || 0);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} млн`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} тыс`;
  return String(value);
}

function plural(n, one, few, many) {
  const value = Math.abs(n) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '';
  return ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1)} с`;
}

function formatTime(iso) {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

async function api(path, options = {}) {
  const headers = options.body ? { 'content-type': 'application/json' } : {};
  const response = await fetch(path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Ошибка ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/* ---------- состояние ---------- */

async function refreshState() {
  const data = await api('/api/state');
  state.activated = data.activated;
  state.settings = data.settings;
  state.model = String(data.model || 'flash').replace('deepseek-', '');

  $('balance').textContent = formatRub(data.balance_micro);
  $('model-badge').textContent = state.model;
  $('approval-badge').textContent = data.settings.approval === 'ask' ? 'Спрашивать' : 'Авто';
  $('cloud-label').textContent = data.cloud_url;
  $('cloud-input').value = data.cloud_url;
  $('cloud-url').value = data.cloud_url;

  if (data.activated) {
    $('status').textContent = data.cloud_ok ? 'Подключён' : 'Сервер недоступен';
    $('status').className = `status ${data.cloud_ok ? 'ok' : 'bad'}`;
  } else {
    $('status').textContent = 'Не активирован';
    $('status').className = 'status';
  }

  return data;
}

/* ---------- сессии ---------- */

function renderSessions() {
  const box = $('sessions');
  box.textContent = '';

  for (const session of state.sessions) {
    const item = el('div', 'session');
    item.tabIndex = 0;
    item.classList.toggle('active', state.session?.id === session.id);
    item.appendChild(el('span', 'session-title', session.title || 'Новый чат'));
    item.appendChild(el('span', 'session-time', formatTime(session.updatedAt)));
    item.addEventListener('click', () => {
      if (state.busy) return;
      openSession(session.id).catch((error) => setStatus(error.message, 'bad'));
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !state.busy) openSession(session.id).catch(() => {});
    });

    const remove = el('button', 'session-del', '×');
    remove.title = 'Удалить сессию';
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (state.busy) return;
      if (!confirm('Удалить эту сессию?')) return;
      await api(`/api/sessions/${session.id}`, { method: 'DELETE' });
      state.sessions = state.sessions.filter((item) => item.id !== session.id);
      if (state.session?.id === session.id) {
        state.session = null;
        await newSession();
      } else {
        renderSessions();
      }
    });
    item.appendChild(remove);
    box.appendChild(item);
  }
}

async function loadSessions() {
  const data = await api('/api/sessions');
  state.sessions = data.sessions || [];
  renderSessions();
  return state.sessions;
}

async function openSession(id) {
  const session = await api(`/api/sessions/${id}`);
  state.session = session;
  $('title').value = session.title || 'Новый чат';
  renderChat();
  renderSessions();
}

async function newSession() {
  if (state.busy) return;
  const session = await api('/api/sessions', { method: 'POST' });
  state.sessions.unshift({
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    messages: 0,
  });
  await openSession(session.id);
}

async function renameCurrent(title) {
  if (!state.session) return;
  const value = title.trim();
  if (!value || value === state.session.title) return;
  const updated = await api(`/api/sessions/${state.session.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: value }),
  });
  state.session.title = updated.title;
  const row = state.sessions.find((item) => item.id === updated.id);
  if (row) row.title = updated.title;
  renderSessions();
}

/* ---------- отрисовка чата ---------- */

function emptyState() {
  const empty = el('div', 'empty');
  empty.appendChild(el('h1', '', 'Чем займёмся?'));
  empty.appendChild(
    el(
      'p',
      '',
      'Джарвис видит файлы, выполняет команды и пишет код. Сессии сохраняются — можно вернуться позже.',
    ),
  );
  const chips = el('div', 'chips');
  const prompts = [
    'Что ты умеешь?',
    'Покажи, что лежит в рабочей папке',
    'Создай файл plan.txt с планом на день',
    'Сколько свободного места на диске?',
  ];
  for (const prompt of prompts) {
    const button = el('button', '', prompt);
    button.dataset.prompt = prompt;
    chips.appendChild(button);
  }
  empty.appendChild(chips);
  return empty;
}

function renderChat() {
  const chat = $('chat');
  chat.textContent = '';

  const messages = state.session?.messages || [];
  if (messages.length === 0) {
    chat.appendChild(emptyState());
    return;
  }

  for (const message of messages) {
    if (message.role === 'user') {
      const turn = el('div', 'turn user');
      turn.appendChild(el('div', 'bubble', message.content));
      chat.appendChild(turn);
    } else {
      chat.appendChild(renderAssistant(message));
    }
  }
  chat.scrollTop = chat.scrollHeight;
}

function renderAssistant(message) {
  const turn = el('div', 'turn assistant');
  turn.appendChild(el('div', 'avatar', 'J'));
  const body = el('div', 'body');
  const segments = el('div', 'segments');

  const list =
    Array.isArray(message.segments) && message.segments.length
      ? message.segments
      : [{ type: 'text', text: message.content || '' }];

  for (const segment of list) {
    if (segment.type === 'text') {
      if (segment.text) segments.appendChild(el('div', 'text', segment.text));
    } else if (segment.type === 'tool') {
      segments.appendChild(toolCard(segment));
    }
  }

  body.appendChild(segments);
  if (message.usage) body.appendChild(usageLine(message.usage, list));
  turn.appendChild(body);
  return turn;
}

function usageLine(usage, segments) {
  const tokens = Number(usage.prompt || 0) + Number(usage.completion || 0);
  const steps = segments.filter((segment) => segment.type === 'tool').length;
  const parts = [`${formatTokens(tokens)} токенов`];
  if (steps) parts.push(`${steps} ${plural(steps, 'шаг', 'шага', 'шагов')}`);
  return el('div', 'usage', parts.join(' · '));
}

function toolArgsSummary(args) {
  if (!args || typeof args !== 'object') return '';
  return String(args.path || args.command || args.url || '');
}

function toolCard(segment) {
  const card = el('div', 'tool');
  const head = el('div', 'tool-head');
  head.appendChild(el('span', 'tool-icon', TOOL_ICONS[segment.name] || '•'));
  head.appendChild(el('span', 'tool-name', TOOL_LABELS[segment.name] || segment.name));
  head.appendChild(el('span', 'tool-args', toolArgsSummary(segment.args)));
  head.appendChild(
    el(
      'span',
      `tool-status ${segment.ok === false ? 'fail' : segment.ok ? 'ok' : ''}`,
      segment.ok === false ? '✗' : segment.ok ? '✓' : '…',
    ),
  );
  if (segment.durationMs !== undefined) {
    head.appendChild(el('span', 'tool-time', formatDuration(segment.durationMs)));
  }
  head.addEventListener('click', () => card.classList.toggle('open'));

  const body = el('div', 'tool-body');
  body.appendChild(el('span', 'tool-label', 'запрос'));
  body.appendChild(el('pre', '', JSON.stringify(segment.args || {}, null, 2)));
  if (segment.preview) {
    body.appendChild(el('span', 'tool-label', 'результат'));
    body.appendChild(el('pre', '', segment.preview));
  }

  card.append(head, body);
  return card;
}

function setStatus(text, kind = '') {
  const node = $('status');
  node.textContent = text;
  node.className = `status ${kind}`;
}

/* ---------- стрим ---------- */

function scrollIfNearBottom() {
  const chat = $('chat');
  if (chat.scrollHeight - chat.scrollTop - chat.clientHeight < 140) {
    chat.scrollTop = chat.scrollHeight;
  }
}

function startAssistantTurn() {
  const chat = $('chat');
  const turn = el('div', 'turn assistant');
  turn.appendChild(el('div', 'avatar', 'J'));
  const body = el('div', 'body');
  const segments = el('div', 'segments');
  body.appendChild(segments);
  turn.appendChild(body);
  chat.appendChild(turn);
  chat.scrollTop = chat.scrollHeight;

  return {
    turn,
    body,
    segments,
    text: null,
    tools: new Map(),
    usage: null,
  };
}

function appendDelta(stream, text) {
  if (!stream.text) {
    stream.text = el('div', 'text', '');
    stream.segments.appendChild(stream.text);
  }
  stream.text.textContent += text;
  scrollIfNearBottom();
}

function onToolStart(stream, event) {
  stream.text = null;
  const segment = {
    type: 'tool',
    step: event.step,
    name: event.name,
    args: event.args,
    ok: null,
  };
  const card = toolCard(segment);
  stream.tools.set(event.step, { segment, card });
  stream.segments.appendChild(card);
  scrollIfNearBottom();
}

function onToolResult(stream, event) {
  const entry = stream.tools.get(event.step);
  if (!entry) return;
  entry.segment.ok = event.ok;
  entry.segment.preview = event.preview;
  entry.segment.durationMs = event.durationMs;

  const head = entry.card.querySelector('.tool-head');
  const status = head.querySelector('.tool-status');
  status.textContent = event.ok ? '✓' : '✗';
  status.className = `tool-status ${event.ok ? 'ok' : 'fail'}`;
  if (event.durationMs !== undefined) {
    head.appendChild(el('span', 'tool-time', formatDuration(event.durationMs)));
  }
  if (event.preview) {
    const body = entry.card.querySelector('.tool-body');
    body.appendChild(el('span', 'tool-label', 'результат'));
    body.appendChild(el('pre', '', event.preview));
  }
}

async function sendMessage(text) {
  if (state.busy || !state.activated) return;
  const value = text.trim();
  if (!value) return;

  if (!state.session) await newSession();
  if (!state.session) return;
  const chat = $('chat');
  const empty = chat.querySelector('.empty');
  if (empty) empty.remove();

  const userTurn = el('div', 'turn user');
  userTurn.appendChild(el('div', 'bubble', value));
  chat.appendChild(userTurn);

  state.busy = true;
  $('send').disabled = true;
  $('stop').hidden = false;
  const stream = startAssistantTurn();
  state.stream = stream;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: state.session.id, message: value }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error?.message || `Ошибка ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      buffer += decoder.decode(chunk, { stream: true });

      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;

        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }

        if (event.type === 'delta') appendDelta(stream, event.text);
        else if (event.type === 'tool_start') onToolStart(stream, event);
        else if (event.type === 'tool_result') onToolResult(stream, event);
        else if (event.type === 'confirm') showConfirm(event);
        else if (event.type === 'usage') stream.usage = event;
        else if (event.type === 'done') {
          if (stream.usage) {
            const toolSegments = [...stream.tools.values()].map((entry) => entry.segment);
            stream.body.appendChild(usageLine(stream.usage, toolSegments));
          }
          scrollIfNearBottom();
        } else if (event.type === 'stopped') {
          const note = el('div', 'usage', 'остановлено');
          stream.body.appendChild(note);
        } else if (event.type === 'error') {
          const note = el('div', 'usage', event.message || 'Ошибка');
          note.style.color = 'var(--danger)';
          stream.body.appendChild(note);
        }
      }
    }
  } catch (error) {
    const note = el('div', 'usage', error.message);
    note.style.color = 'var(--danger)';
    stream.body.appendChild(note);
  } finally {
    state.busy = false;
    state.stream = null;
    $('send').disabled = false;
    $('stop').hidden = true;
    await loadSessions().catch(() => {});
    if (state.session) {
      const current = state.sessions.find((item) => item.id === state.session.id);
      if (current) {
        state.session.title = current.title;
        $('title').value = current.title;
      }
    }
    refreshState().catch(() => {});
  }
}

async function stopGeneration() {
  if (!state.busy) return;
  await api('/api/stop', { method: 'POST' }).catch(() => {});
}

/* ---------- подтверждения ---------- */

function showConfirm(event) {
  state.confirmId = event.id;
  $('confirm-name').textContent = TOOL_LABELS[event.name] || event.name;
  $('confirm-args').textContent = JSON.stringify(event.args || {}, null, 2);
  $('confirm').hidden = false;
}

async function answerConfirm(allow) {
  const id = state.confirmId;
  state.confirmId = null;
  $('confirm').hidden = true;
  if (id) await api('/api/confirm', { method: 'POST', body: JSON.stringify({ id, allow }) });
}

/* ---------- активация ---------- */

function showActivate() {
  $('activate').hidden = false;
}

function hideActivate() {
  $('activate').hidden = true;
  if (state.poll) clearInterval(state.poll);
  state.poll = null;
}

async function startActivation() {
  if (state.poll) clearInterval(state.poll);
  $('code').textContent = '••••••••';
  $('activate-status').textContent = 'Создаю код…';

  try {
    const data = await api('/api/activate/start', { method: 'POST', body: '{}' });
    $('code').textContent = data.user_code;
    if (data.bot_url) {
      $('bot-link').href = data.bot_url;
      $('bot-link').hidden = false;
    }
    $('activate-status').textContent = 'Ждём подтверждения в боте…';
    state.poll = setInterval(pollActivation, 2500);
  } catch (error) {
    $('activate-status').textContent = error.message;
  }
}

async function pollActivation() {
  try {
    const data = await api('/api/activate/status');
    if (data.activated) {
      hideActivate();
      await refreshState();
      await loadSessions();
      if (!state.sessions.length) await newSession();
      else await openSession(state.sessions[0].id);
      return;
    }
    if (data.status === 'expired') {
      clearInterval(state.poll);
      state.poll = null;
      $('activate-status').textContent = 'Код истёк. Получи новый.';
    }
  } catch {
    // сеть моргнула — попробуем ещё
  }
}

/* ---------- настройки ---------- */

function openSettings() {
  for (const radio of document.querySelectorAll('input[name="approval"]')) {
    radio.checked = radio.value === (state.settings.approval || 'auto');
  }
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.checked = radio.value === (state.settings.mode || 'workspace');
  }
  $('workspace').value = state.settings.workspace || '';
  $('cloud-url').value = state.settings.cloudUrl || $('cloud-label').textContent || '';
  $('settings-note').textContent = '';
  $('settings').hidden = false;
}

async function saveSettings() {
  const approval = document.querySelector('input[name="approval"]:checked')?.value || 'auto';
  const mode = document.querySelector('input[name="mode"]:checked')?.value || 'workspace';
  $('settings-note').textContent = 'Сохраняю…';
  try {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        approval,
        mode,
        workspace: $('workspace').value,
        cloudUrl: $('cloud-url').value,
      }),
    });
    await refreshState();
    $('settings').hidden = true;
  } catch (error) {
    $('settings-note').textContent = error.message;
  }
}

/* ---------- привязка ---------- */

function bindUI() {
  $('new-chat').addEventListener('click', () =>
    newSession().catch((e) => setStatus(e.message, 'bad')),
  );
  $('settings-btn').addEventListener('click', openSettings);
  $('approval-badge').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => {
    $('settings').hidden = true;
  });
  $('settings-save').addEventListener('click', saveSettings);

  $('composer').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('input');
    const text = input.value;
    input.value = '';
    input.style.height = 'auto';
    sendMessage(text);
  });

  $('input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('composer').requestSubmit();
    }
  });

  $('input').addEventListener('input', (event) => {
    const node = event.target;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
  });

  $('chat').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-prompt]');
    if (chip) sendMessage(chip.dataset.prompt);
  });

  $('title').addEventListener('change', () => {
    renameCurrent($('title').value).catch((e) => setStatus(e.message, 'bad'));
  });
  $('title').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $('title').blur();
    }
  });

  $('stop').addEventListener('click', stopGeneration);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!$('confirm').hidden) answerConfirm(false);
      else if (state.busy) stopGeneration();
    }
  });

  $('allow').addEventListener('click', () => answerConfirm(true));
  $('deny').addEventListener('click', () => answerConfirm(false));

  $('new-code').addEventListener('click', startActivation);
  $('cloud-save').addEventListener('click', async () => {
    try {
      await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ cloudUrl: $('cloud-input').value }),
      });
      await refreshState();
      await startActivation();
    } catch (error) {
      $('activate-status').textContent = error.message;
    }
  });

  $('deactivate').addEventListener('click', async () => {
    if (!confirm('Отключить это устройство? Ключ будет удалён.')) return;
    await api('/api/deactivate', { method: 'POST', body: '{}' });
    location.reload();
  });
}

async function init() {
  bindUI();
  try {
    const data = await refreshState();
    if (!data.activated) {
      showActivate();
      await startActivation();
      return;
    }
    await loadSessions();
    if (!state.sessions.length) {
      await newSession();
    } else {
      await openSession(state.sessions[0].id);
    }
  } catch (error) {
    setStatus('Сервер недоступен', 'bad');
    $('chat').appendChild(el('div', 'usage', error.message));
  }
}

init();
