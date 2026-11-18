import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openStore } from './store.js';
import { buildApp } from './server.js';
import { startBot } from './bot.js';

export async function startCloud() {
  const config = loadConfig();
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  const db = openStore(config.dbPath);
  const app = buildApp({ db, config });

  await app.listen({ port: config.port, host: config.bind });
  app.log.info({ port: config.port, db: config.dbPath }, 'jarvis-cloud запущен');

  const bot = startBot({ db, config });

  const shutdown = async (signal) => {
    app.log.info({ signal }, 'останавливаюсь');
    try {
      if (bot) await bot.stop();
    } catch {
      // бот мог не успеть запуститься
    }
    await app.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return app;
}
