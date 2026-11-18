import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSandbox } from '../src/app/tools.js';

function tempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ws-'));
  fs.writeFileSync(path.join(dir, 'note.txt'), 'hello');
  return dir;
}

function outsideFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-out-'));
  const file = path.join(dir, 'secret.txt');
  fs.writeFileSync(file, 'secret');
  return file;
}

test('внутри рабочей папки путь разрешён', () => {
  const dir = tempWorkspace();
  const sandbox = createSandbox({ workspace: dir, mode: 'workspace' });
  assert.equal(sandbox.resolve('note.txt'), fs.realpathSync(path.join(dir, 'note.txt')));
});

test('выход через .. запрещён', () => {
  const dir = tempWorkspace();
  const sandbox = createSandbox({ workspace: dir, mode: 'workspace' });
  assert.throws(() => sandbox.resolve('../secret.txt'), /вне рабочей папки/);
});

test('симлинк наружу запрещён', { skip: process.platform === 'win32' }, () => {
  const dir = tempWorkspace();
  fs.symlinkSync(outsideFile(), path.join(dir, 'link.txt'));
  const sandbox = createSandbox({ workspace: dir, mode: 'workspace' });
  assert.throws(() => sandbox.resolve('link.txt'), /вне рабочей папки/);
});

test('новый файл проверяется по родительской папке', () => {
  const dir = tempWorkspace();
  const sandbox = createSandbox({ workspace: dir, mode: 'workspace' });
  const resolved = sandbox.resolve('sub/new.txt');
  assert.equal(resolved, path.join(fs.realpathSync(dir), 'sub', 'new.txt'));
});

test('режим «весь компьютер» пускает наружу', () => {
  const dir = tempWorkspace();
  const outside = outsideFile();
  const sandbox = createSandbox({ workspace: dir, mode: 'full' });
  assert.equal(sandbox.resolve(outside), path.normalize(outside));
});
