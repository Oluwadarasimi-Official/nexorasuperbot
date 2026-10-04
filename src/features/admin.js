'use strict';
/**
 * Admin system — restricted by ADMIN_IDS. Stats, users, broadcast, logs.
 * Never exposed to normal users.
 */
const { Markup } = require('telegraf');
const store = require('../store');
const { sendLong, editOrReply, answerCb, escapeHtml } = require('../tg/helpers');
const { adminOnly } = require('../tg/middleware');
const { timeAgo } = require('../utils');

function register(bot) {
  bot.command('admin', adminOnly, async (ctx) => {
    await store.logAdmin(ctx.from.id, 'admin_open');
    await sendLong(ctx, '🛡 <b>Nexora Admin</b>\n\nRestricted area. What do you need?', Markup.inlineKeyboard([
      [Markup.button.callback('📊 Stats', 'adm:stats'), Markup.button.callback('👥 Users', 'adm:users')],
      [Markup.button.callback('📣 Broadcast', 'adm:broadcast'), Markup.button.callback('🧾 Error logs', 'adm:logs')],
      [Markup.button.callback('🏠 Main Menu', 'menu:home')],
    ]));
  });

  const showStats = async (ctx) => {
    const [total, active24h, usage] = await Promise.all([
      store.countUsers(), store.countUsers(new Date(Date.now() - 864e5).toISOString()), store.usageStats(24),
    ]);
    const cmds = await store.commandStats(24);
    const topCmds = cmds.slice(0, 8).map(([c, n]) => `  • /${escapeHtml(c)} — ${n}`).join('\n');
    await editOrReply(ctx,
      '📊 <b>System stats (last 24h)</b>\n\n' +
      `👥 Total users: <b>${total}</b>\n` +
      `🟢 Active (24h): <b>${active24h}</b>\n\n` +
      `💬 AI chats: <b>${usage.ai_chat || 0}</b>\n` +
      `🧩 Structured AI: <b>${usage.ai_structured || 0}</b>\n` +
      `👁 Vision: <b>${usage.ai_vision || 0}</b> · 🎙 Voice: <b>${usage.ai_audio || 0}</b>\n` +
      `🔎 Research: <b>${usage.research || 0}</b> · ❓ Quizzes: <b>${usage.quiz || 0}</b>\n` +
      `⚠️ Errors: <b>${usage.errors || 0}</b>\n\n` +
      (topCmds ? `<b>Top commands</b>\n${topCmds}` : ''),
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'adm:home')]]));
  };
  bot.command('stats', adminOnly, async (ctx) => { await store.logAdmin(ctx.from.id, 'stats'); await showStats(ctx); });
  bot.action('adm:stats', async (ctx) => { if (!ctx.state.isAdmin) return; await answerCb(ctx); await showStats(ctx); });

  bot.command('users', adminOnly, async (ctx) => {
    await store.logAdmin(ctx.from.id, 'users');
    const users = await store.recentUsers(10);
    const lines = users.map((u) => `• <code>${u.telegram_id}</code> ${escapeHtml(u.first_name || '')} ${u.username ? '@' + escapeHtml(u.username) : ''} — <i>${timeAgo(u.last_seen_at)}</i>`).join('\n');
    await sendLong(ctx, `👥 <b>Recent users</b>\n\n${lines || 'No users yet.'}`, Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'adm:home')]]));
  });
  bot.action('adm:users', async (ctx) => {
    if (!ctx.state.isAdmin) return;
    await answerCb(ctx);
    const users = await store.recentUsers(10);
    const lines = users.map((u) => `• <code>${u.telegram_id}</code> ${escapeHtml(u.first_name || '')} — <i>${timeAgo(u.last_seen_at)}</i>`).join('\n');
    await editOrReply(ctx, `👥 <b>Recent users</b>\n\n${lines || 'No users yet.'}`, Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'adm:home')]]));
  });

  bot.command('logs', adminOnly, async (ctx) => {
    await store.logAdmin(ctx.from.id, 'logs');
    const errs = await store.recentErrors(10);
    const lines = errs.map((e) => `• [${escapeHtml(e.error_category || '?')}] ${escapeHtml(e.kind)} — <i>${escapeHtml((e.detail || '').slice(0, 80))}</i> (${timeAgo(e.created_at)})`).join('\n');
    await sendLong(ctx, `🧾 <b>Recent errors</b>\n\n${lines || 'No errors in the window. 🎉'}`, Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'adm:home')]]));
  });
  bot.action('adm:logs', async (ctx) => {
    if (!ctx.state.isAdmin) return;
    await answerCb(ctx);
    const errs = await store.recentErrors(10);
    const lines = errs.map((e) => `• [${escapeHtml(e.error_category || '?')}] ${escapeHtml(e.kind)} — <i>${escapeHtml((e.detail || '').slice(0, 80))}</i>`).join('\n');
    await editOrReply(ctx, `🧾 <b>Recent errors</b>\n\n${lines || 'No errors. 🎉'}`, Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'adm:home')]]));
  });

  bot.command('broadcast', adminOnly, async (ctx) => {
    const text = (ctx.message.text || '').replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
    if (!text) {
      await store.updateUserState(ctx.from.id, { pending: 'broadcast' });
      await ctx.reply('📣 <b>Broadcast</b>\n\nSend me the message to broadcast to all users (HTML allowed), or /cancel.', { parse_mode: 'HTML' });
      return;
    }
    await store.updateUserState(ctx.from.id, { pending: 'broadcast_confirm', pendingText: text.slice(0, 3000) });
    await ctx.reply(`📣 <b>Preview:</b>\n\n${text.slice(0, 1500)}\n\nSend <b>YES</b> to broadcast to all users, or /cancel.`, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback('✅ Send broadcast', 'adm:bcast:yes'), Markup.button.callback('❌ Cancel', 'adm:bcast:no')]]).reply_markup,
    });
  });
  bot.action('adm:broadcast', async (ctx) => {
    if (!ctx.state.isAdmin) return;
    await answerCb(ctx);
    await store.updateUserState(ctx.from.id, { pending: 'broadcast' });
    await editOrReply(ctx, '📣 <b>Broadcast</b>\n\nSend the message text now, or /cancel.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'adm:home')]]));
  });
  bot.action('adm:bcast:yes', async (ctx) => {
    if (!ctx.state.isAdmin) return;
    await answerCb(ctx, 'Broadcasting…');
    const st = (await store.getUser(ctx.from.id))?.state || {};
    const text = st.pendingText;
    if (!text) { await editOrReply(ctx, '⚠️ Nothing to broadcast.'); return; }
    await store.updateUserState(ctx.from.id, { pending: null, pendingText: null });
    await store.logAdmin(ctx.from.id, 'broadcast', text.slice(0, 200));
    const ids = await store.allUserIds();
    let ok = 0, fail = 0;
    await editOrReply(ctx, `📣 Broadcasting to ${ids.length} users…`);
    for (const id of ids) {
      try { await ctx.telegram.sendMessage(id, text, { parse_mode: 'HTML', disable_web_page_preview: true }); ok += 1; }
      catch { fail += 1; }
      if ((ok + fail) % 25 === 0) await new Promise((r) => setTimeout(r, 1000)); // respect flood limits
    }
    await ctx.reply(`📣 <b>Broadcast done</b>\n✅ Delivered: ${ok}\n❌ Failed: ${fail}`, { parse_mode: 'HTML' });
  });
  bot.action('adm:bcast:no', async (ctx) => {
    if (!ctx.state.isAdmin) return;
    await answerCb(ctx, 'Cancelled');
    await store.updateUserState(ctx.from.id, { pending: null, pendingText: null });
    await editOrReply(ctx, '📣 Broadcast cancelled.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'adm:home')]]));
  });

  bot.action('adm:home', async (ctx) => {
    if (!ctx.state.isAdmin) return;
    await answerCb(ctx);
    await editOrReply(ctx, '🛡 <b>Nexora Admin</b>', Markup.inlineKeyboard([
      [Markup.button.callback('📊 Stats', 'adm:stats'), Markup.button.callback('👥 Users', 'adm:users')],
      [Markup.button.callback('📣 Broadcast', 'adm:broadcast'), Markup.button.callback('🧾 Error logs', 'adm:logs')],
      [Markup.button.callback('🏠 Main Menu', 'menu:home')],
    ]));
  });
}

module.exports = { register };
