'use strict';
/**
 * Vercel serverless webhook entry.
 * Set the Telegram webhook to: https://<app>.vercel.app/api/webhook?secret=<WEBHOOK_SECRET>
 */
const { createBot } = require('../src/bot');
const { cfg } = require('../src/config');
const { logEvent } = require('../src/logger');
const { Telegraf } = require('telegraf');
const { processDueReminders } = require('../src/features/productivity');

let bot = null;
let tg = null;

function telegram() {
  if (!tg) tg = new Telegraf(cfg.botToken).telegram;
  return tg;
}

// Vercel Hobby only allows daily crons, so reminders are also delivered
// opportunistically on every incoming message as a backstop.
function deliverDueReminders() {
  return processDueReminders((userId, html) =>
    telegram().sendMessage(userId, html, { parse_mode: 'HTML', disable_web_page_preview: true })
  ).catch((e) => logEvent('webhook_reminder_error', { error: String(e?.message || e).slice(0, 120) }));
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    if (!cfg.webhookSecret || req.query.secret !== cfg.webhookSecret) {
      logEvent('webhook_forbidden', {});
      res.status(403).end();
      return;
    }
    if (!bot) bot = createBot();
    await Promise.all([bot.handleUpdate(req.body, res), deliverDueReminders()]);
    if (!res.headersSent) res.status(200).end();
  } catch (err) {
    logEvent('webhook_error', { error: String(err?.message || err).slice(0, 200) });
    if (!res.headersSent) res.status(200).end(); // always 200 to avoid Telegram retry storms
  }
};
