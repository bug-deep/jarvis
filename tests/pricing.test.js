import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCostMicro, normalizeModel } from '../src/shared/pricing.js';

test('flash: миллион входных токенов без кэша', () => {
  const cost = computeCostMicro({
    model: 'deepseek-flash',
    inputTokens: 1_000_000,
    usdRub: 80,
    markup: 5,
  });
  assert.equal(cost.micro, 120_000_000);
  assert.equal(cost.cacheMissTokens, 1_000_000);
});

test('flash: кэш-хит дешевле в 50 раз', () => {
  const cost = computeCostMicro({
    model: 'deepseek-flash',
    inputTokens: 1_000_000,
    cacheHitTokens: 1_000_000,
    usdRub: 80,
    markup: 5,
  });
  assert.equal(cost.micro, 2_400_000);
});

test('flash: выход дороже входа', () => {
  const cost = computeCostMicro({
    model: 'deepseek-flash',
    outputTokens: 1_000_000,
    usdRub: 80,
    markup: 5,
  });
  assert.equal(cost.micro, 480_000_000);
});

test('смешанный запрос считается по частям', () => {
  const cost = computeCostMicro({
    model: 'deepseek-flash',
    inputTokens: 1000,
    cacheHitTokens: 900,
    outputTokens: 300,
    usdRub: 80,
    markup: 5,
  });
  assert.equal(cost.cacheMissTokens, 100);
  assert.ok(Math.abs(cost.micro - 158_160) <= 1, `получилось ${cost.micro}`);
});

test('неизвестная модель — ошибка', () => {
  assert.throws(() => computeCostMicro({ model: 'gpt-4' }), /unknown model/);
});

test('старое имя deepseek-chat ведёт на flash', () => {
  assert.equal(normalizeModel('deepseek-chat'), 'deepseek-flash');
  assert.equal(normalizeModel(''), 'deepseek-flash');
  assert.equal(normalizeModel('deepseek-v4-pro'), 'deepseek-v4-pro');
});
