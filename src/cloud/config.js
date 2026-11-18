import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function projectRoot() {
  return ROOT;
}

export function loadConfig(
  envFiles = [
    path.join(ROOT, 'config', 'jarvis-desktop.env'),
    path.join(ROOT, 'config', 'secrets.env'),
    path.join(ROOT, 'config', 'deepseek.env'),
  ],
) {
  for (const envFile of envFiles) {
    if (!envFile || !fs.existsSync(envFile)) continue;
    try {
      process.loadEnvFile(envFile);
    } catch (err) {
      if (process.env.JARVIS_STRICT_ENV === '1') throw err;
    }
  }

  return {
    port: Number(process.env.CLOUD_PORT || process.env.PORT || 8098),
    bind: process.env.CLOUD_BIND || '127.0.0.1',
    dbPath: process.env.CLOUD_DB || path.join(ROOT, 'data', 'cloud.db'),
    logLevel: process.env.LOG_LEVEL || 'info',

    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: process.env.DEFAULT_MODEL || 'deepseek-flash',
      maxTokens: Number(process.env.OUTPUT_LIMIT || 2048),
      timeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS || 120000),
    },

    pricing: {
      usdRub: Number(process.env.USD_RUB || 80),
      markup: Number(process.env.MARKUP || 5),
    },

    telegram: {
      token: process.env.TELEGRAM_BOT_TOKEN || '',
      username: process.env.TELEGRAM_BOT_USERNAME || '',
      channelId: process.env.TELEGRAM_CHANNEL_ID || '',
      adminTgId: process.env.ADMIN_TG_ID || '',
      proxy: process.env.TELEGRAM_PROXY || '',
      downloadUrl: process.env.DOWNLOAD_URL || '',
    },

    adminToken: process.env.ADMIN_TOKEN || '',
    bonusMicro: Math.round(Number(process.env.BONUS_RUB || 30) * 1_000_000),
    minBalanceMicro: Math.round(Number(process.env.MIN_BALANCE_RUB || 0.5) * 1_000_000),
    rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 20),
    deviceCodeTtlSec: Number(process.env.DEVICE_CODE_TTL_SEC || 600),
  };
}
