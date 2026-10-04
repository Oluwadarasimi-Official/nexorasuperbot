'use strict';
/**
 * Personal memory: /remember, /memory, /forget, /clear_memory.
 * Strictly per-user — every query filters by telegram id.
 */
const store = require('../store');
const { withThinking, sendLong, escapeHtml, answerCb, editOrReply } = require('../tg/helpers');
const { menuKeyboard } = require('../tg/keyboards');
const { getProvider } = require('../ai/providers');
const { tracked } = require('../tg/middleware');

function cmdText(ctx) {
  return (ctx.message.text || '').replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
}

async function rememberContent(ctx, content) {
  await store.addMemory(ctx.from.id, content);
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'remember', success: true });
  await ctx.reply(`✅ <b>Remembered.</b>\n\n<i>${escapeHtml(content.slice(0, 300))}</i>\n\nI will use this in our future conversations.`, { parse_mode: 'HTML' });
}

async function forgetContent(ctx, q) {
  const n = await store.forgetMemory(ctx.from.id, q);
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'forget', success: true });
  await ctx.reply(n ? `🗑 Forgotten — removed ${n} matching memor${n === 1 ? 'y' : 'ies'}.` : '🔍 I could not find anything matching that in my memory of you.');
}

function register(bot) {
  bot.command('remember', async (ctx) => {
    const content = cmdText(ctx);
    if (!content) return ctx.reply('💾 What should I remember? e.g.\n<code>/remember My project is called Nexora</code>', { parse_mode: 'HTML' });
    await rememberContent(ctx, content);
  });

  const showMemory = async (ctx) => {
    const mems = await store.listMemories(ctx.from.id, 30);
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'memory', success: true });
    if (!mems.length) {
      await editOrReply(ctx, '🧠 <b>My Memory</b>\n\nNothing stored yet. Tell me something:\n\n<i>“Remember that my exam is on Monday.”</i>', menuKeyboard('memory'));
      return;
    }
    const lines = mems.map((m, i) => `${i + 1}. ${escapeHtml(m.content)}`).join('\n');
    await editOrReply(ctx, `🧠 <b>My Memory</b> — ${mems.length} item${mems.length === 1 ? '' : 's'}\n\n${lines}\n\n<i>Use /forget &lt;text&gt; to remove one.</i>`, menuKeyboard('memory'));
  };
  bot.command('memory', showMemory);

  bot.command('forget', async (ctx) => {
    const q = cmdText(ctx);
    if (!q) return ctx.reply('🗑 What should I forget? e.g.\n<code>/forget my project name</code>', { parse_mode: 'HTML' });
    await forgetContent(ctx, q);
  });

  bot.command('clear_memory', async (ctx) => {
    await store.clearMemories(ctx.from.id);
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'clear_memory', success: true });
    await ctx.reply('🧹 All memories cleared. I am starting fresh with you.');
  });

  // menu shortcuts
  bot.action('mem:add', async (ctx) => { await answerCb(ctx); await editOrReply(ctx, '💾 <b>Remember</b>\n\nJust type:\n<i>“Remember that …”</i>\n\nor use <code>/remember &lt;information&gt;</code>', { parse_mode: 'HTML', ...menuKeyboard('memory') }); });
  bot.action('mem:list', async (ctx) => { await answerCb(ctx); await withThinking(ctx, () => showMemory(ctx).then(() => '')); });
  bot.action('mem:forget', async (ctx) => { await answerCb(ctx); await editOrReply(ctx, '🗑 <b>Forget</b>\n\nType <code>/forget &lt;keyword&gt;</code> and I will remove matching memories.', { parse_mode: 'HTML', ...menuKeyboard('memory') }); });
  bot.action('mem:clear', async (ctx) => {
    await answerCb(ctx);
    await store.clearMemories(ctx.from.id);
    await editOrReply(ctx, '🧹 All memories cleared.', menuKeyboard('memory'));
  });
}

module.exports = { register, rememberContent, forgetContent };
