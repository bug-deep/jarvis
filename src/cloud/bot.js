import { Bot, InlineKeyboard } from 'grammy';
import {
  approveDeviceCode,
  findPendingCodeByUserCode,
  getBalance,
  grantBonusOnce,
  upsertUser,
} from './store.js';
import { newApiKey } from './auth.js';
import { formatRub } from '../shared/pricing.js';
import { proxyFetch } from './telegram-fetch.js';

const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

const WELCOME = `Привет. Я Джарвис — живу на твоём компьютере.

Могу написать программу, собрать Telegram-бота, навести порядок в файлах и показать, что у тебя на экране.

1. Скачай приложение и запусти его.
2. Оно покажет код из 8 символов — пришли его сюда.
`;

export function registerHandlers(bot, { db, config }) {
  async function subscribed(ctx) {
    if (!config.telegram.channelId) return null;
    try {
      const member = await ctx.api.getChatMember(config.telegram.channelId, ctx.from.id);
      return ['member', 'administrator', 'creator'].includes(member.status);
    } catch {
      return null;
    }
  }

  bot.command('start', async (ctx) => {
    upsertUser(db, {
      tgId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });

    const keyboard = new InlineKeyboard();
    if (config.telegram.downloadUrl) {
      keyboard.url('Скачать для Windows', config.telegram.downloadUrl).row();
    }
    if (config.telegram.channelId) {
      const channel = String(config.telegram.channelId).replace('@', '');
      keyboard.url('Подписаться на канал', `https://t.me/${channel}`).row();
      keyboard.text('Я подписался — получить бонус', 'bonus').row();
    }
    keyboard.text('Баланс', 'balance');

    const text = config.telegram.channelId
      ? `${WELCOME}\n3. Подпишись на канал и получи бонус на баланс.`
      : WELCOME;
    await ctx.reply(text, { reply_markup: keyboard });
  });

  bot.callbackQuery('balance', async (ctx) => {
    const user = upsertUser(db, {
      tgId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    await ctx.answerCallbackQuery();
    await ctx.reply(`Баланс: ${formatRub(getBalance(db, user.id))}`);
  });

  bot.callbackQuery('bonus', async (ctx) => {
    const user = upsertUser(db, {
      tgId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });

    if (!config.telegram.channelId) {
      await ctx.answerCallbackQuery({ text: 'Канал не настроен' });
      return;
    }

    const isMember = await subscribed(ctx);
    if (isMember === null) {
      await ctx.answerCallbackQuery({ text: 'Не могу проверить подписку. Бот админ канала?' });
      return;
    }
    if (!isMember) {
      await ctx.answerCallbackQuery({ text: 'Подписки не вижу. Подпишись и попробуй снова.' });
      return;
    }

    const result = grantBonusOnce(db, user.id, config.bonusMicro, config.telegram.channelId);
    if (!result.ok && result.reason === 'already') {
      await ctx.answerCallbackQuery({ text: 'Бонус уже получен' });
      return;
    }

    await ctx.answerCallbackQuery({ text: 'Бонус зачислен' });
    await ctx.reply(`Готово. На балансе ${formatRub(result.balanceMicro)}.`);
  });

  // Пользователь присылает код активации из приложения.
  bot.on('message:text', async (ctx) => {
    const text = String(ctx.message.text || '').trim();
    const code = CODE_RE.test(text.toUpperCase()) ? text.toUpperCase() : null;
    if (!code) {
      await ctx.reply('Пришли код из 8 символов, который показывает приложение.');
      return;
    }

    const pending = findPendingCodeByUserCode(db, code);
    if (!pending) {
      await ctx.reply('Код не найден или уже использован. Открой приложение и получи новый.');
      return;
    }

    const user = upsertUser(db, {
      tgId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });

    const key = newApiKey();
    const result = approveDeviceCode(db, {
      userCode: code,
      userId: user.id,
      deviceName: pending.device_name,
      os: pending.os,
      keyHash: key.hash,
      prefix: key.prefix,
      apiKeyPlain: key.plain,
    });

    if (!result.ok) {
      await ctx.reply(
        result.reason === 'expired'
          ? 'Код истёк. Получи новый в приложении.'
          : 'Не получилось. Попробуй ещё раз.',
      );
      return;
    }

    await ctx.reply(
      `Устройство активировано.\n\nКлюч уже отправлен в приложение — вставлять ничего не нужно.\nБаланс: ${formatRub(getBalance(db, user.id))}`,
    );
  });

  bot.command('balance', async (ctx) => {
    const user = upsertUser(db, {
      tgId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
    await ctx.reply(`Баланс: ${formatRub(getBalance(db, user.id))}`);
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'Пришли код из приложения — активирую устройство. /balance — баланс. Подписка на канал даёт бонус.',
    );
  });

  bot.catch((err) => {
    console.log(JSON.stringify({ msg: 'bot error', error: err?.message }));
  });

  return bot;
}

export function createBot({ db, config, botOptions = {} }) {
  const options = { ...botOptions };
  if (config.telegram.proxy) {
    options.client = { ...(options.client || {}), fetch: proxyFetch(config.telegram.proxy) };
  }
  const bot = new Bot(config.telegram.token, options);
  return registerHandlers(bot, { db, config });
}

export function startBot({ db, config }) {
  if (!config.telegram.token) {
    console.log(JSON.stringify({ msg: 'bot: токен не задан, пропускаю' }));
    return null;
  }

  const bot = createBot({ db, config });
  bot.start({ drop_pending_updates: true }).catch((err) => {
    console.log(JSON.stringify({ msg: 'bot start failed', error: err?.message }));
  });

  console.log(JSON.stringify({ msg: 'bot: запущен' }));
  return bot;
}
