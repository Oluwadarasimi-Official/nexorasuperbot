'use strict';
/**
 * One-tap webhook setup (phone-friendly): after deploying to Vercel and
 * setting env vars, open this URL once in a browser:
 *
 *   https://<app>.vercel.app/api/setup-webhook?key=<WEBHOOK_SECRET>
 *
 * It registers the Telegram webhook to this deployment. No terminal needed.
 */
const { cfg } = require('../src/config');
const { logEvent } = require('../src/logger');

module.exports = async (req, res) => {
  try {
    if (req.query.key !== cfg.webhookSecret || !cfg.webhookSecret) {
      res.status(403).json({ ok: false, error: 'bad key' });
      return;
    }
    if (!cfg.publicUrl || !cfg.botToken) {
      res.status(500).json({ ok: false, error: 'PUBLIC_URL and TELEGRAM_BOT_TOKEN must be set' });
      return;
    }
    const webhookUrl = `${cfg.publicUrl}/api/webhook?secret=${encodeURIComponent(cfg.webhookSecret)}`;
    const tgRes = await fetch(`https://api.telegram.org/bot${cfg.botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }),
    });
    const data = await tgRes.json();
    logEvent('webhook_setup', { ok: !!data.ok });
    res.status(200).json({ ok: !!data.ok, webhookUrl, telegram: data });
  } catch (err) {
    logEvent('webhook_setup_error', { error: String(err?.message || err).slice(0, 200) });
    res.status(500).json({ ok: false, error: 'setup failed' });
  }
};
