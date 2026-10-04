'use strict';
/** Standalone reminder worker for VPS hosting: npm run reminders */
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { cfg, requireEnv } = require('../src/config');
const { logEvent } = require('../src/logger');
const { processDueReminders } = require('../src/features/productivity');

requireEnv(['TELEGRAM_BOT_TOKEN']);
const tg = new Telegraf(cfg.botToken).telegram;

const tick = async () => {
  try {
    const n = await processDueReminders(async (userId, html) => {
      await tg.sendMessage(userId, html, { parse_mode: 'HTML', disable_web_page_preview: true });
    });
    if (n) logEvent('reminders_delivered', { count: n });
  } catch (err) {
    logEvent('reminder_worker_error', { error: String(err?.message || err).slice(0, 200) });
  }
};
console.log('⏰ NexoraSuperBot reminder worker running (30s interval).');
setInterval(tick, 30000);
tick();
