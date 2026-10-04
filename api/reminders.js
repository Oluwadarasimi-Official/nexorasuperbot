'use strict';
/**
 * Cron endpoint: delivers due reminders.
 * Vercel cron hits this every 5 minutes (see vercel.json).
 * Protect with ?key=<CRON_SECRET>.
 */
const { Telegraf } = require('telegraf');
const { cfg } = require('../src/config');
const { logEvent } = require('../src/logger');
const { processDueReminders } = require('../src/features/productivity');

module.exports = async (req, res) => {
  try {
    // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically;
    // manual triggers can use ?key=<CRON_SECRET>.
    const header = req.headers.authorization || '';
    const authed = req.query.key === cfg.cronSecret || header === `Bearer ${cfg.cronSecret}`;
    if (!cfg.cronSecret || !authed) { res.status(403).json({ ok: false }); return; }
    const tg = new Telegraf(cfg.botToken).telegram;
    const n = await processDueReminders(async (userId, html) => {
      await tg.sendMessage(userId, html, { parse_mode: 'HTML', disable_web_page_preview: true });
    });
    logEvent('cron_reminders', { delivered: n });
    res.status(200).json({ ok: true, delivered: n });
  } catch (err) {
    logEvent('cron_error', { error: String(err?.message || err).slice(0, 200) });
    res.status(500).json({ ok: false });
  }
};
