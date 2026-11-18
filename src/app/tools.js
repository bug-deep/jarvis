import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const norm = (p) => (IS_WIN ? p.toLowerCase() : p);

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'Показать содержимое папки. Путь можно указывать относительно рабочей папки.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь к папке, по умолчанию рабочая папка' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Прочитать текстовый файл целиком или первые N байт.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь к файлу' },
          max_bytes: { type: 'integer', description: 'Сколько байт прочитать, по умолчанию 65536' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Создать или перезаписать текстовый файл. Требует подтверждения пользователя.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь к файлу' },
          content: { type: 'string', description: 'Содержимое файла' },
        },
        required: ['path', 'content'],
      },
    },
    confirm: true,
  },
  {
    type: 'function',
    function: {
      name: 'make_dir',
      description: 'Создать папку (вместе с родительскими).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Путь к папке' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_path',
      description: 'Удалить файл или папку. Требует подтверждения пользователя.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Что удалить' } },
        required: ['path'],
      },
    },
    confirm: true,
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Выполнить команду в терминале (cmd/PowerShell на Windows, bash на Linux). Требует подтверждения.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Команда целиком' },
          cwd: { type: 'string', description: 'Рабочая папка для команды' },
        },
        required: ['command'],
      },
    },
    confirm: true,
  },
  {
    type: 'function',
    function: {
      name: 'open_url',
      description: 'Открыть ссылку в браузере по умолчанию.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'http(s) ссылка' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'system_info',
      description: 'Информация о компьютере: ОС, архитектура, рабочая папка, режим доступа.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export function createSandbox({ workspace, mode }) {
  const root = path.resolve(workspace);
  const full = mode === 'full';

  function resolve(input) {
    const raw = String(input || '.').trim() || '.';
    const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(root, raw);

    if (full) return abs;

    const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
    let real;
    if (fs.existsSync(abs)) {
      real = fs.realpathSync(abs);
    } else {
      const parent = path.dirname(abs);
      const realParent = fs.existsSync(parent) ? fs.realpathSync(parent) : parent;
      real = path.join(realParent, path.basename(abs));
    }

    const inside =
      norm(real) === norm(realRoot) || norm(real).startsWith(`${norm(realRoot)}${path.sep}`);
    if (!inside) {
      throw new Error(
        `Путь вне рабочей папки: ${input}. Включи режим «Весь компьютер», если это нужно.`,
      );
    }
    return real;
  }

  return { root, mode: full ? 'full' : 'workspace', resolve };
}

function truncate(text, limit = 20000) {
  const str = String(text ?? '');
  if (str.length <= limit) return str;
  return `${str.slice(0, limit)}\n… обрезано, всего ${str.length} символов`;
}

function runCommand(command, cwd, timeoutMs = 60000) {
  return new Promise((resolve) => {
    let out = '';
    let finished = false;
    let timer = null;

    const finish = (code, error) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve({ code, error: error || null, output: truncate(out) });
    };

    const child = spawn(command, {
      shell: true,
      cwd,
      windowsHide: true,
      env: { ...process.env },
    });

    timer = setTimeout(() => {
      child.kill();
      finish(null, 'таймаут 60 секунд');
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      out += d.toString('utf8');
      if (out.length > 60000) out = out.slice(0, 60000);
    });
    child.stderr.on('data', (d) => {
      out += d.toString('utf8');
      if (out.length > 60000) out = out.slice(0, 60000);
    });
    child.on('error', (err) => finish(null, err.message));
    child.on('close', (code) => finish(code));
  });
}

function openUrl(url) {
  const safe = String(url || '');
  if (!/^https?:\/\//i.test(safe)) throw new Error('Разрешены только http(s) ссылки');
  if (IS_WIN) spawn('cmd', ['/c', 'start', '', safe], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin')
    spawn('open', [safe], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [safe], { detached: true, stdio: 'ignore' }).unref();
  return `Открываю ${safe}`;
}

export async function runTool(name, args, ctx) {
  const sandbox = ctx.sandbox;

  switch (name) {
    case 'list_dir': {
      const dir = sandbox.resolve(args.path || '.');
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const items = [];
      for (const entry of entries.slice(0, 200)) {
        const full = path.join(dir, entry.name);
        let size = null;
        try {
          size = (await fsp.stat(full)).size;
        } catch {
          size = null;
        }
        items.push({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file', size });
      }
      return JSON.stringify({ path: dir, count: entries.length, items }, null, 2);
    }

    case 'read_file': {
      const file = sandbox.resolve(args.path);
      const stat = await fsp.stat(file);
      if (stat.isDirectory()) throw new Error('Это папка, а не файл');
      const limit = Math.min(Math.max(Number(args.max_bytes) || 65536, 1), 200000);
      const handle = await fsp.open(file, 'r');
      try {
        const buf = Buffer.alloc(Math.min(limit, stat.size));
        await handle.read(buf, 0, buf.length, 0);
        if (buf.includes(0)) return `[бинарный файл, ${stat.size} байт]`;
        return truncate(buf.toString('utf8'), 60000);
      } finally {
        await handle.close();
      }
    }

    case 'write_file': {
      const file = sandbox.resolve(args.path);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, String(args.content ?? ''), 'utf8');
      const stat = await fsp.stat(file);
      return `Записано ${stat.size} байт: ${file}`;
    }

    case 'make_dir': {
      const dir = sandbox.resolve(args.path);
      await fsp.mkdir(dir, { recursive: true });
      return `Папка создана: ${dir}`;
    }

    case 'delete_path': {
      const target = sandbox.resolve(args.path);
      if (norm(target) === norm(sandbox.root) && sandbox.mode === 'workspace') {
        throw new Error('Нельзя удалить саму рабочую папку');
      }
      await fsp.rm(target, { recursive: true, force: true });
      return `Удалено: ${target}`;
    }

    case 'run_command': {
      const cwd = sandbox.resolve(args.cwd || '.');
      const result = await runCommand(String(args.command || ''), cwd);
      return JSON.stringify(result, null, 2);
    }

    case 'open_url':
      return openUrl(args.url);

    case 'system_info':
      return JSON.stringify(
        {
          platform: process.platform,
          arch: process.arch,
          release: os.release(),
          workspace: sandbox.root,
          mode: sandbox.mode,
          node: process.version,
        },
        null,
        2,
      );

    default:
      throw new Error(`Неизвестный инструмент: ${name}`);
  }
}
