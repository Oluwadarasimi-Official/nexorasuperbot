'use strict';
/**
 * Local / VPS entry: long-polling mode.
 * (Vercel uses api/webhook.js instead — never call launch() there.)
 */
const { createBot } = require('./bot');
const { logEvent } = require('./logger');

const bot = createBot();

bot.launch().then(() => {
  logEvent('bot_started', { mode: 'polling' });
  console.log('🤖 NexoraSuperBot is running (polling). Press Ctrl+C to stop.');
});

// Optional embedded reminder worker for single-process VPS hosting:
// set REMINDER_WORKER=1 to also deliver reminders from this process.
if (process.env.REMINDER_WORKER === '1') {
  const { processDueReminders } = require('./features/productivity');
  const tick = async () => {
    try {
      const n = await processDueReminders(async (userId, html) => {
        await bot.telegram.sendMessage(userId, html, { parse_mode: 'HTML' });
      });
      if (n) logEvent('reminders_delivered', { count: n });
    } catch (err) {
      logEvent('reminder_worker_error', { error: String(err?.message || err).slice(0, 200) });
    }
  };
  setInterval(tick, 30000);
  tick();
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
