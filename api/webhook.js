'use strict';
/**
 * Vercel serverless webhook entry.
 * Set the Telegram webhook to: https://<app>.vercel.app/api/webhook?secret=<WEBHOOK_SECRET>
 */
const { createBot } = require('../src/bot');
const { cfg } = require('../src/config');
const { logEvent } = require('../src/logger');

let bot = null;

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    if (!cfg.webhookSecret || req.query.secret !== cfg.webhookSecret) {
      logEvent('webhook_forbidden', {});
      res.status(403).end();
      return;
    }
    if (!bot) bot = createBot();
    await bot.handleUpdate(req.body, res);
    if (!res.headersSent) res.status(200).end();
  } catch (err) {
    logEvent('webhook_error', { error: String(err?.message || err).slice(0, 200) });
    if (!res.headersSent) res.status(200).end(); // always 200 to avoid Telegram retry storms
  }
};
