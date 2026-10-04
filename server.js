'use strict';
/**
 * Rumpty Cloud / VPS entry: HTTP health server + Telegram long-polling
 * in one process. Starts the HTTP server even without a bot token so the
 * platform health check passes; polling begins once TELEGRAM_BOT_TOKEN
 * is set (add it in the console env vars — no rebuild of code needed).
 */
const http = require('http');
const { cfg } = require('./src/config');
const { logEvent } = require('./src/logger');

const PORT = parseInt(process.env.PORT || '8080', 10);
let pollingActive = false;

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/api/health' || url === '/health' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'nexorasuperbot', polling: pollingActive, ts: new Date().toISOString() }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  logEvent('http_listen', { port: PORT });
  console.log(`🤖 NexoraSuperBot HTTP on :${PORT}`);
});

if (cfg.botToken) {
  const { createBot } = require('./src/bot');
  const bot = createBot();
  bot.launch()
    .then(() => { pollingActive = true; logEvent('bot_started', { mode: 'polling' }); console.log('✅ Telegram polling active'); })
    .catch((e) => logEvent('bot_launch_error', { error: String(e && e.message || e).slice(0, 200) }));

  // inline reminder delivery (no external cron needed)
  const { processDueReminders } = require('./src/features/productivity');
  const tick = async () => {
    try {
      const n = await processDueReminders(async (userId, html) => {
        await bot.telegram.sendMessage(userId, html, { parse_mode: 'HTML', disable_web_page_preview: true });
      });
      if (n) logEvent('reminders_delivered', { count: n });
    } catch (e) { logEvent('reminder_tick_error', { error: String(e && e.message || e).slice(0, 200) }); }
  };
  setInterval(tick, 60000);
  setTimeout(tick, 15000);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  logEvent('bot_waiting_for_token', {});
  console.log('⚠️  TELEGRAM_BOT_TOKEN not set — HTTP is up, polling will start once the token is added.');
}
