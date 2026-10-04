'use strict';
/** Manual webhook setup (terminal): npm run webhook:set */
require('dotenv').config();
const { cfg } = require('../src/config');

(async () => {
  if (!cfg.botToken || !cfg.publicUrl || !cfg.webhookSecret) {
    console.error('Set TELEGRAM_BOT_TOKEN, PUBLIC_URL and WEBHOOK_SECRET first.');
    process.exit(1);
  }
  const url = `${cfg.publicUrl}/api/webhook?secret=${encodeURIComponent(cfg.webhookSecret)}`;
  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/setWebhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }),
  });
  console.log(await res.text());
})();
