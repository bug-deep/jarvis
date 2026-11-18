// Расчёт стоимости запроса. Единицы: микро-рубли (1 ₽ = 1_000_000).
// Цены DeepSeek — за 1 млн токенов в долларах, по пиковому тарифу
// (консервативно: off-peak вдвое дешевле, значит маржа только вырастет).

export const MICRO = 1_000_000;

export const DEFAULT_PRICES = {
  'deepseek-flash': { inputMissUsd: 0.3, inputHitUsd: 0.006, outputUsd: 1.2 },
  'deepseek-v4-pro': { inputMissUsd: 1.32, inputHitUsd: 0.044, outputUsd: 3.96 },
};

export const DEFAULT_MODEL = 'deepseek-flash';

// Старые имена DeepSeek принимает, но считает по тарифу flash.
export function normalizeModel(model) {
  const name = String(model || '').trim();
  if (
    !name ||
    name === 'deepseek-chat' ||
    name === 'deepseek-v4-flash' ||
    name === 'deepseek-v4-flash-vision-exp'
  ) {
    return DEFAULT_MODEL;
  }
  return name;
}

export function computeCostMicro({
  model,
  inputTokens = 0,
  cacheHitTokens = 0,
  outputTokens = 0,
  usdRub = 80,
  markup = 5,
  prices = DEFAULT_PRICES,
} = {}) {
  const price = prices[model];
  if (!price) throw new Error(`unknown model: ${model}`);

  const input = Math.max(0, Number(inputTokens) || 0);
  const hit = Math.min(input, Math.max(0, Number(cacheHitTokens) || 0));
  const miss = input - hit;
  const out = Math.max(0, Number(outputTokens) || 0);

  const usd =
    (miss * price.inputMissUsd + hit * price.inputHitUsd + out * price.outputUsd) / 1_000_000;
  const rub = usd * Number(usdRub) * Number(markup);

  return {
    usd,
    rub,
    micro: Math.ceil(rub * MICRO),
    inputTokens: input,
    cacheHitTokens: hit,
    cacheMissTokens: miss,
    outputTokens: out,
  };
}

export function formatRub(micro) {
  const value = Number(micro) / MICRO;
  if (Math.abs(value) < 0.01) return '0,00 ₽';
  return `${value.toFixed(2).replace('.', ',')} ₽`;
}
