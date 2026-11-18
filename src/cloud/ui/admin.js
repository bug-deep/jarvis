const $ = (id) => document.getElementById(id);
const KEY = 'jarvis_admin_token';

let token = localStorage.getItem(KEY) || '';

function formatRub(micro) {
  return `${(Number(micro || 0) / 1_000_000).toFixed(2).replace('.', ',')} ₽`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'x-admin-token': token,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Ошибка ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showLogin(message = '') {
  $('login').hidden = false;
  $('dashboard').hidden = true;
  $('logout').hidden = true;
  $('login-error').textContent = message;
}

function showDashboard() {
  $('login').hidden = true;
  $('dashboard').hidden = false;
  $('logout').hidden = false;
}

function renderCodes(codes) {
  const tbody = $('codes');
  tbody.textContent = '';
  $('no-codes').hidden = codes.length > 0;

  for (const code of codes) {
    const tr = document.createElement('tr');
    const values = [
      code.user_code,
      code.device_name || '—',
      code.os || '—',
      new Date(code.created_at).toLocaleTimeString('ru-RU'),
    ];
    for (const value of values) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    }

    const td = document.createElement('td');
    const button = document.createElement('button');
    button.className = 'small';
    button.textContent = 'Активировать';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api('/v1/admin/device/approve', {
          method: 'POST',
          body: JSON.stringify({ user_code: code.user_code }),
        });
        await load();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });
    td.appendChild(button);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function renderUsers(users) {
  const tbody = $('users');
  tbody.textContent = '';
  $('empty').hidden = users.length > 0;

  for (const user of users) {
    const tr = document.createElement('tr');

    const cells = [
      String(user.id),
      user.tg_id,
      user.username ? `@${user.username}` : user.first_name || '—',
      formatRub(user.balance_micro),
      String(user.requests),
      formatRub(user.spent_micro),
    ];

    for (const [index, value] of cells.entries()) {
      const td = document.createElement('td');
      td.textContent = value;
      if (index >= 3 && index <= 5) td.className = 'num';
      tr.appendChild(td);
    }

    const actions = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'credit';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.placeholder = '100';
    const button = document.createElement('button');
    button.className = 'small';
    button.textContent = 'OK';
    button.addEventListener('click', async () => {
      const amount = Number(input.value);
      if (!amount || amount <= 0) return;
      button.disabled = true;
      try {
        const result = await api('/v1/admin/credit', {
          method: 'POST',
          body: JSON.stringify({ tg_id: user.tg_id, amount_rub: amount, note: 'admin ui' }),
        });
        input.value = '';
        await load();
        alert(`Начислено. Баланс: ${formatRub(result.balance_micro)}`);
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
    wrap.append(input, button);
    actions.appendChild(wrap);
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

async function load() {
  try {
    const [stats, users, pending] = await Promise.all([
      api('/v1/admin/stats'),
      api('/v1/admin/users?limit=200'),
      api('/v1/admin/devices/pending'),
    ]);
    showDashboard();

    $('stat-users').textContent = String(stats.users.total);
    $('stat-balance').textContent = formatRub(stats.users.balance_micro);
    $('stat-requests').textContent = String(stats.usage.requests);
    $('stat-cost').textContent = formatRub(stats.usage.cost_micro);
    renderCodes(pending.codes || []);
    renderUsers(users.users || []);
  } catch (error) {
    if (error.status === 403 || error.status === 503) {
      token = '';
      localStorage.removeItem(KEY);
      showLogin(error.message);
    } else {
      showLogin(error.message);
    }
  }
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  token = $('token').value.trim();
  if (!token) return;
  localStorage.setItem(KEY, token);
  await load();
});

$('logout').addEventListener('click', () => {
  token = '';
  localStorage.removeItem(KEY);
  showLogin();
});

$('refresh').addEventListener('click', load);
$('refresh-codes').addEventListener('click', load);

if (token) load();
else showLogin();

setInterval(() => {
  if (token && !$('dashboard').hidden) load().catch(() => {});
}, 30000);
