'use strict';
/**
 * Telegram UX helpers: thinking states, long-message chunking,
 * safe HTML, callback-data safety.
 */
const { chunkMessage, escapeHtml } = require('../utils');

const THINKING_TEXT = '🧠 <i>Nexora is thinking…</i>';

/** Send a "thinking" placeholder, run fn, then edit the message with the result. */
async function withThinking(ctx, fn) {
  let msg = null;
  try { msg = await ctx.reply(THINKING_TEXT, { parse_mode: 'HTML' }); } catch { /* ignore */ }
  try {
    const result = await fn();
    if (msg) {
      try {
        if (typeof result === 'string' && result) {
          const chunks = chunkMessage(result);
          await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, chunks[0], { parse_mode: 'HTML', disable_web_page_preview: true });
          for (const c of chunks.slice(1)) await sendLong(ctx, c);
        } else {
          await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        }
      } catch {
        // edit failed (e.g. Telegram rejected the HTML) — fall back to fresh messages
        // instead of leaving the user staring at "thinking" forever.
        try { await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {}); } catch { /* no-op */ }
        if (typeof result === 'string' && result) {
          try { await sendLong(ctx, result); } catch { /* last resort */ }
        }
      }
    } else if (typeof result === 'string' && result) {
      await sendLong(ctx, result);
    }
    return result;
  } catch (err) {
    if (msg) {
      try { await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {}); } catch { /* no-op */ }
    }
    throw err;
  }
}

/** Send long text split into Telegram-safe chunks. */
async function sendLong(ctx, text, extra = {}) {
  const chunks = chunkMessage(String(text || ''));
  let last = null;
  for (const c of chunks) {
    last = await ctx.reply(c, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  }
  return last;
}

/** Edit a message's text safely (falls back to reply on failure). */
async function editOrReply(ctx, text, extra = {}) {
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  } catch {
    await sendLong(ctx, text, extra.reply_markup ? { reply_markup: extra.reply_markup } : {});
  }
}

/** Answer a callback query, tolerating "query too old" errors. */
async function answerCb(ctx, text = '', showAlert = false) {
  try { await ctx.answerCbQuery(text ? String(text).slice(0, 180) : '', { show_alert: showAlert }); }
  catch { /* expired query — ignore */ }
}

/** Expired/missing state for a callback. */
async function expired(ctx, what = 'This button has expired') {
  await answerCb(ctx, `${what} — please start again from the menu.`, true);
}

module.exports = { withThinking, sendLong, editOrReply, answerCb, expired, escapeHtml, THINKING_TEXT };
