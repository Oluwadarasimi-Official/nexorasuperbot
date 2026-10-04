'use strict';
/**
 * Productivity: to-dos, notes, reminders (natural language + worker delivery),
 * daily plans, goals, habits.
 */
const { Markup } = require('telegraf');
const store = require('../store');
const { withThinking, sendLong, editOrReply, answerCb, escapeHtml } = require('../tg/helpers');
const { menuKeyboard } = require('../tg/keyboards');
const { parseReminder, fmtDateTime } = require('../utils');
const { chatReply } = require('./ai');

function cmdText(ctx) {
  return (ctx.message.text || '').replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
}

async function addTodoText(ctx, title) {
  const m = title.match(/^(high|medium|low)\s*:\s*(.+)$/i);
  const task = await store.addTask(ctx.from.id, { title: m ? m[2] : title, priority: m ? m[1].toLowerCase() : 'medium' });
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'todo', success: true });
  await ctx.reply(`✅ Added to your to-dos${m ? ` (<b>${m[1]}</b> priority)` : ''}:\n<i>${escapeHtml(task.title)}</i>`, { parse_mode: 'HTML' });
  return task;
}

async function createReminderText(ctx, raw) {
  const parsed = parseReminder(raw);
  if (!parsed) {
    await ctx.reply('🤔 I could not understand the time. Try:\n• <code>/remind me in 30 minutes to drink water</code>\n• <code>/remind me tomorrow at 4pm to study chemistry</code>\n• <code>/remind me on monday at 9am to call mom</code>', { parse_mode: 'HTML' });
    return null;
  }
  const rem = await store.addReminder(ctx.from.id, { text: parsed.text, dueAt: parsed.dueAt.toISOString() });
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'remind', success: true });
  await ctx.reply(`⏰ <b>Reminder set!</b>\n\n<i>${escapeHtml(rem.text)}</i>\n🕓 ${fmtDateTime(rem.due_at)}\n\nI will ping you here in Telegram.`, { parse_mode: 'HTML' });
  return rem;
}

async function addNoteText(ctx, body) {
  await store.addNote(ctx.from.id, { body });
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'note', success: true });
  await ctx.reply('📝 Note saved.');
}

async function planToday(ctx) {
  await withThinking(ctx, async () => {
    const tasks = await store.listTasks(ctx.from.id);
    const habits = await store.listHabits(ctx.from.id);
    const rems = await store.listReminders(ctx.from.id);
    const brief = `Open tasks: ${tasks.map((t) => t.title).join('; ') || 'none'}\nHabits: ${habits.map((h) => h.name).join(', ') || 'none'}\nReminders today: ${rems.map((r) => r.text).join('; ') || 'none'}`;
    return chatReply(ctx.from.id, `You are Nexora Coach. Build today's daily plan from this brief. Prioritize ruthlessly: top 3 must-dos, time blocks, one thing to drop. Keep it short and motivating.\n\n${brief}`);
  });
}

function register(bot) {
  /* ── to-dos ── */
  bot.command('todo', async (ctx) => {
    const arg = cmdText(ctx);
    if (arg) { await addTodoText(ctx, arg); return; }
    await showTodos(ctx);
  });

  const showTodos = async (ctx) => {
    const tasks = await store.listTasks(ctx.from.id);
    if (!tasks.length) { await editOrReply(ctx, '✅ <b>To-dos</b>\n\nAll clear! Add one with <code>/todo Buy groceries</code>\nor <code>/todo high: Finish report</code>', { parse_mode: 'HTML', ...menuKeyboard('prod') }); return; }
    const prio = { high: '🔴', medium: '🟡', low: '🟢' };
    const rows = tasks.slice(0, 10).map((t) => [
      Markup.button.callback(`${prio[t.priority] || '🟡'} ${t.title.slice(0, 32)}`, `td:done:${t.id}`),
    ]);
    rows.push([Markup.button.callback('➕ Add', 'prod:todos:add'), Markup.button.callback('🗑 Clear done', 'td:clear')]);
    rows.push([Markup.button.callback('⬅️ Back', 'menu:prod'), Markup.button.callback('🏠 Main Menu', 'menu:home')]);
    await editOrReply(ctx, '✅ <b>Your to-dos</b>\n\nTap a task to mark it done:', Markup.inlineKeyboard(rows));
  };

  bot.action(/^td:done:([a-f0-9-]+)$/, async (ctx) => {
    await store.completeTask(ctx.from.id, ctx.match[1]);
    await answerCb(ctx, 'Done! 🎉');
    await showTodos(ctx);
  });
  bot.action('td:clear', async (ctx) => {
    const done = await store.listTasks(ctx.from.id, true).then((ts) => ts.filter((t) => t.done));
    for (const t of done) await store.deleteTask(ctx.from.id, t.id);
    await answerCb(ctx, 'Cleared');
    await showTodos(ctx);
  });

  /* ── notes ── */
  bot.command('note', async (ctx) => {
    const body = cmdText(ctx);
    if (body) { await addNoteText(ctx, body); return; }
    await showNotes(ctx);
  });
  const showNotes = async (ctx) => {
    const notes = await store.listNotes(ctx.from.id, 8);
    if (!notes.length) { await editOrReply(ctx, '📝 <b>Notes</b>\n\nNo notes yet. Save one:\n<code>/note Buy milk tomorrow</code>', { parse_mode: 'HTML', ...menuKeyboard('prod') }); return; }
    const lines = notes.map((n, i) => `${i + 1}. ${escapeHtml(n.body.slice(0, 120))}${n.body.length > 120 ? '…' : ''}`).join('\n\n');
    await editOrReply(ctx, `📝 <b>Your notes</b>\n\n${lines}\n\n<i>New: /note &lt;text&gt;</i>`, menuKeyboard('prod'));
  };

  /* ── reminders ── */
  bot.command('remind', async (ctx) => {
    const raw = cmdText(ctx);
    if (!raw) {
      const rems = await store.listReminders(ctx.from.id);
      if (!rems.length) { await ctx.reply('⏰ No reminders set. Try:\n<code>/remind me tomorrow at 4pm to study chemistry</code>', { parse_mode: 'HTML' }); return; }
      const rows = rems.map((r) => [Markup.button.callback(`⏰ ${fmtDateTime(r.due_at)} — ${r.text.slice(0, 30)}`, `rm:del:${r.id}`)]);
      rows.push([Markup.button.callback('⬅️ Back', 'menu:prod')]);
      await ctx.reply('⏰ <b>Your reminders</b> — tap to cancel:', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
      return;
    }
    await createReminderText(ctx, raw);
  });
  bot.action(/^rm:del:([a-f0-9-]+)$/, async (ctx) => {
    await store.cancelReminder(ctx.from.id, ctx.match[1]);
    await answerCb(ctx, 'Reminder cancelled');
    await editOrReply(ctx, '⏰ Reminder cancelled.', menuKeyboard('prod'));
  });

  /* ── daily plan ── */
  bot.command('plan', async (ctx) => {
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'plan', success: true });
    await planToday(ctx);
  });

  /* ── goals & habits ── */
  bot.command('goals', async (ctx) => {
    const arg = cmdText(ctx);
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'goals', success: true });
    if (arg && !/^list$/i.test(arg)) {
      const g = await store.addGoal(ctx.from.id, { title: arg });
      await ctx.reply(`🎯 Goal set: <i>${escapeHtml(g.title)}</i>\n\nUpdate progress with <code>/goals</code> → tap, or tell me “set my goal progress to 50%”.`, { parse_mode: 'HTML' });
      return;
    }
    const goals = await store.listGoals(ctx.from.id);
    if (!goals.length) { await ctx.reply('🎯 No goals yet. Set one:\n<code>/goals Learn React in 30 days</code>', { parse_mode: 'HTML' }); return; }
    const rows = goals.map((g) => [Markup.button.callback(`🎯 ${g.title.slice(0, 28)} — ${g.progress}%`, `gl:prog:${g.id}`)]);
    rows.push([Markup.button.callback('⬅️ Back', 'menu:prod')]);
    await ctx.reply('🎯 <b>Your goals</b> — tap to bump progress +10%:', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });
  bot.action(/^gl:prog:([a-f0-9-]+)$/, async (ctx) => {
    const goals = await store.listGoals(ctx.from.id);
    const g = goals.find((x) => x.id === ctx.match[1]);
    if (!g) { await answerCb(ctx, 'Goal not found'); return; }
    const next = Math.min(100, g.progress + 10);
    await store.setGoalProgress(ctx.from.id, g.id, next);
    await answerCb(ctx, next >= 100 ? '🏆 Goal complete!' : `Progress: ${next}%`);
    await editOrReply(ctx, `🎯 <b>${escapeHtml(g.title)}</b>\n\n${'█'.repeat(next / 10)}${'░'.repeat(10 - next / 10)} <b>${next}%</b>`, menuKeyboard('prod'));
  });
  bot.command('habit', async (ctx) => {
    const name = cmdText(ctx);
    if (!name) {
      const habits = await store.listHabits(ctx.from.id);
      if (!habits.length) { await ctx.reply('🔥 No habits tracked. Start one:\n<code>/habit Read 20 pages</code>', { parse_mode: 'HTML' }); return; }
      await ctx.reply('🔥 <b>Your habits</b>\n\n' + habits.map((h) => `• ${escapeHtml(h.name)} — <b>${h.streak} day streak</b> 🔥`).join('\n'), { parse_mode: 'HTML' });
      return;
    }
    const h = await store.checkinHabit(ctx.from.id, name.slice(0, 100));
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'habit', success: true });
    await ctx.reply(`🔥 Checked in: <b>${escapeHtml(h.name)}</b>\nStreak: <b>${h.streak} day${h.streak === 1 ? '' : 's'}</b> — keep it burning!`, { parse_mode: 'HTML' });
  });

  /* ── menu shortcuts ── */
  bot.action('prod:todos', async (ctx) => { await answerCb(ctx); await showTodos(ctx); });
  bot.action('prod:todos:add', async (ctx) => { await answerCb(ctx); await editOrReply(ctx, '➕ <b>Add a to-do</b>\n\n<code>/todo &lt;task&gt;</code> or <code>/todo high: &lt;task&gt;</code>', { parse_mode: 'HTML', ...menuKeyboard('prod') }); });
  bot.action('prod:notes', async (ctx) => { await answerCb(ctx); await showNotes(ctx); });
  bot.action('prod:reminders', async (ctx) => {
    await answerCb(ctx);
    const rems = await store.listReminders(ctx.from.id);
    const rows = rems.slice(0, 8).map((r) => [Markup.button.callback(`⏰ ${fmtDateTime(r.due_at)} — ${r.text.slice(0, 28)}`, `rm:del:${r.id}`)]);
    rows.push([Markup.button.callback('⬅️ Back', 'menu:prod'), Markup.button.callback('🏠 Main Menu', 'menu:home')]);
    await editOrReply(ctx, rems.length ? '⏰ <b>Reminders</b> — tap to cancel.\n\nNew: <code>/remind me tomorrow at 4pm to …</code>' : '⏰ <b>Reminders</b>\n\nNone set. Try:\n<code>/remind me in 30 minutes to stretch</code>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
  });
  bot.action('prod:plan', async (ctx) => {
    await answerCb(ctx);
    await withThinking(ctx, async () => {
      const tasks = await store.listTasks(ctx.from.id);
      const brief = `Open tasks: ${tasks.map((t) => t.title).join('; ') || 'none'}`;
      const out = await chatReply(ctx.from.id, `You are Nexora Coach. Build today's daily plan from this brief. Top 3 must-dos, time blocks, one thing to drop. Short and motivating.\n\n${brief}`);
      await sendLong(ctx, out);
      return '';
    });
  });
  bot.action('prod:goals', async (ctx) => {
    await answerCb(ctx);
    const goals = await store.listGoals(ctx.from.id);
    if (!goals.length) { await editOrReply(ctx, '🎯 <b>Goals</b>\n\nSet one: <code>/goals Learn React in 30 days</code>', { parse_mode: 'HTML', ...menuKeyboard('prod') }); return; }
    const rows = goals.map((g) => [Markup.button.callback(`🎯 ${g.title.slice(0, 28)} — ${g.progress}%`, `gl:prog:${g.id}`)]);
    rows.push([Markup.button.callback('⬅️ Back', 'menu:prod')]);
    await editOrReply(ctx, '🎯 <b>Your goals</b> — tap to bump +10%:', Markup.inlineKeyboard(rows));
  });
  bot.action('prod:habits', async (ctx) => {
    await answerCb(ctx);
    const habits = await store.listHabits(ctx.from.id);
    await editOrReply(ctx, habits.length
      ? '🔥 <b>Your habits</b>\n\n' + habits.map((h) => `• ${escapeHtml(h.name)} — <b>${h.streak}🔥</b>`).join('\n') + '\n\nCheck in: <code>/habit &lt;name&gt;</code>'
      : '🔥 <b>Habits</b>\n\nStart one: <code>/habit Read 20 pages</code> — then check in daily to build your streak.', { parse_mode: 'HTML', ...menuKeyboard('prod') });
  });
}

/** Deliver due reminders (called by cron/worker). `send` delivers one message. */
async function processDueReminders(send) {
  const due = await store.dueReminders(50);
  let delivered = 0;
  for (const r of due) {
    try {
      await send(r.user_id, `⏰ <b>Reminder</b>\n\n${escapeHtml(r.text)}`);
      await store.markReminderSent(r.id, r.repeat);
      delivered += 1;
    } catch (err) {
      // user may have blocked the bot — mark sent to avoid infinite retry
      await store.markReminderSent(r.id, null).catch(() => {});
    }
  }
  return delivered;
}

module.exports = { register, processDueReminders, addTodoText, createReminderText, addNoteText, planToday };
