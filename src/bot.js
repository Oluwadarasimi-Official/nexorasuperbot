'use strict';
/**
 * NexoraSuperBot — central wiring.
 * Middleware → feature modules → intelligent message router.
 */
const { Telegraf, Markup } = require('telegraf');
const { cfg, requireEnv } = require('./config');
const { logEvent } = require('./logger');
const store = require('./store');
const { attachUser, rateLimit, errorBoundary, checkLimit, tracked } = require('./tg/middleware');
const { withThinking, sendLong, answerCb, escapeHtml } = require('./tg/helpers');
const { mainMenu } = require('./tg/keyboards');
const { route } = require('./ai/router');

const core = require('./features/core');
const ai = require('./features/ai');
const memory = require('./features/memory');
const study = require('./features/study');
const dev = require('./features/dev');
const research = require('./features/research');
const docs = require('./features/docs');
const productivity = require('./features/productivity');
const creative = require('./features/creative');
const tools = require('./features/tools');
const admin = require('./features/admin');
const media = require('./features/media');

const AI_INTENTS = new Set(['chat', 'ask', 'summarize', 'explain', 'translate', 'brainstorm',
  'quiz', 'flashcards', 'revise', 'study_plan', 'code', 'debug', 'review', 'explain_code',
  'research', 'doc_ask', 'caption', 'prompt_gen', 'ideas', 'brand']);

function createBot() {
  requireEnv(['TELEGRAM_BOT_TOKEN']);
  const bot = new Telegraf(cfg.botToken);

  bot.use(errorBoundary);
  bot.use(attachUser);
  bot.use(rateLimit('cmd'));

  // feature modules (commands + callbacks)
  core.register(bot);
  ai.register(bot);
  memory.register(bot);
  study.register(bot);
  dev.register(bot);
  research.register(bot);
  docs.register(bot);
  productivity.register(bot);
  creative.register(bot);
  tools.register(bot);
  admin.register(bot);

  // ── plain text: pending states → unknown commands → router ──
  bot.on('text', async (ctx) => {
    const text = (ctx.message.text || '').trim();
    if (!text) return;

    // pending admin broadcast text
    const state = ctx.state.user?.state || {};
    if (state.pending === 'broadcast' && ctx.state.isAdmin) {
      await store.updateUserState(ctx.from.id, { pending: 'broadcast_confirm', pendingText: text.slice(0, 3000) });
      await ctx.reply(`📣 <b>Preview:</b>\n\n${text.slice(0, 1500)}\n\nBroadcast to all users?`, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Send broadcast', 'adm:bcast:yes'), Markup.button.callback('❌ Cancel', 'adm:bcast:no')],
        ]).reply_markup,
      });
      return;
    }

    if (text.startsWith('/')) {
      store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'unknown', success: false, errorCategory: 'validation' });
      await ctx.reply('🤔 I do not know that command. Try /menu to see everything I can do — or just tell me what you need in plain words.', mainMenu());
      return;
    }
    if (text.length > 4000) {
      await ctx.reply('📏 That message is a bit long for me — try splitting it, or upload it as a document and I will read the whole file.');
      return;
    }
    await dispatchText(ctx, text);
  });

  // ── voice / audio ──
  bot.on(['voice', 'audio'], async (ctx) => {
    try { await ctx.sendChatAction('typing'); } catch { /* */ }
    await media.handleVoice(ctx, dispatchText);
  });

  // ── photos ──
  bot.on('photo', async (ctx) => {
    try { await ctx.sendChatAction('typing'); } catch { /* */ }
    await media.handlePhoto(ctx);
  });

  // ── documents ──
  bot.on('document', async (ctx) => {
    try { await ctx.sendChatAction('typing'); } catch { /* */ }
    await docs.handleDocument(ctx);
  });

  // ── unmatched callbacks (expired buttons) ──
  bot.on('callback_query', async (ctx) => {
    await answerCb(ctx, 'That button has expired — open /menu to start fresh.', true);
  });

  bot.catch((err) => {
    logEvent('bot_catch', { error: String(err?.message || err).slice(0, 200) });
  });

  return bot;
}

/** Route a plain (or transcribed) message to the right feature. */
async function dispatchText(ctx, text) {
  const t0 = Date.now();
  const { intent, params } = route(text);
  logEvent('route', { user: String(ctx.from.id), intent });

  if (AI_INTENTS.has(intent) && !checkLimit(String(ctx.from.id), 'ai')) {
    await ctx.reply('⏳ You are firing off AI requests fast — give me ~30 seconds and try again.');
    return;
  }

  try {
    switch (intent) {
      // ── memory ──
      case 'remember': await memory.rememberContent(ctx, params.content); break;
      case 'forget': await memory.forgetContent(ctx, params.content); break;
      case 'memory_list': await showMemoryList(ctx); break;

      // ── study ──
      case 'quiz': await study.startQuizFlow(ctx, params); break;
      case 'flashcards': await study.startFlashcards(ctx, params.topic); break;
      case 'revise': await study.reviseTopic(ctx, params.topic); break;
      case 'results': await showResultsList(ctx); break;
      case 'study_plan':
        await withThinking(ctx, async () => {
          const weak = await store.weakTopics(ctx.from.id, 5);
          const focus = weak.length ? weak.map((w) => w.topic).join(', ') : 'balanced coverage';
          return ai.chatReply(ctx.from.id, `Create a focused 7-day revision plan. Weak areas: ${focus}. Each day: theme + 2-3 concrete tasks. One rest day. Short, motivating, phone-readable.`);
        });
        break;

      // ── developer ──
      case 'code':
        await withThinking(ctx, () => ai.chatReply(ctx.from.id, `You are Nexora Coder, a senior engineer. Write clean, working code for: ${params.spec}. Brief comments, handle edge cases, 2-line usage note at the end.`));
        break;
      case 'debug':
        await withThinking(ctx, () => ai.chatReply(ctx.from.id, `You are Nexora Coder debugging. Find the bug(s), explain the root cause simply, then show the FIXED code. Do not execute anything.\n\n<pre>${escapeHtml(params.code.slice(0, 3000))}</pre>`));
        break;
      case 'review':
        await withThinking(ctx, () => ai.chatReply(ctx.from.id, `You are Nexora Coder reviewing code. Format: ✅ What's good, ⚠️ Issues (with severity), 💡 Improved key parts.\n\n<pre>${escapeHtml(params.code.slice(0, 3000))}</pre>`));
        break;
      case 'explain_code':
        await withThinking(ctx, () => ai.chatReply(ctx.from.id, `You are Nexora Coder teaching. Explain this code: overall purpose, then step-by-step walkthrough in plain language, ending with one gotcha.\n\n<pre>${escapeHtml(params.code.slice(0, 3000))}</pre>`));
        break;

      // ── research ──
      case 'research':
        if (!params.topic) { await ctx.reply('🔎 What should I research? e.g. <i>“research the best free PostgreSQL hosting”</i>', { parse_mode: 'HTML' }); break; }
        await withThinking(ctx, () => research.researchTopic(ctx.from.id, params.topic));
        break;

      // ── documents ──
      case 'doc_ask': {
        const docId = ctx.state.user?.state?.activeDocId;
        if (!docId) { await ctx.reply('📄 Upload a document first, then ask me about it.', mainMenu()); break; }
        await withThinking(ctx, () => docs.askAboutDoc(ctx, docId, text));
        break;
      }

      // ── productivity ──
      case 'todo_add': await productivity.addTodoText(ctx, params.title || text); break;
      case 'todo_list': await showTodoList(ctx); break;
      case 'note_add': await productivity.addNoteText(ctx, params.body); break;
      case 'note_list': await showNoteList(ctx); break;
      case 'remind':
        if (params.needsClarify) { await ctx.reply('⏰ When should I remind you? e.g. <i>“remind me tomorrow at 4pm to study chemistry”</i>', { parse_mode: 'HTML' }); break; }
        await productivity.createReminderText(ctx, text);
        break;
      case 'plan': await productivity.planToday(ctx); break;
      case 'goals': await showGoalList(ctx); break;

      // ── creative ──
      case 'caption': await creative.genCaption(ctx, params.brief); break;
      case 'prompt_gen': await creative.genPrompt(ctx, params.brief); break;
      case 'ideas': await creative.genIdeas(ctx, params.brief); break;
      case 'brand': await creative.genBrand(ctx, params.brief); break;

      // ── AI helpers ──
      case 'ask':
        await withThinking(ctx, () => ai.chatReply(ctx.from.id, params.text || text));
        break;
      case 'summarize':
        await withThinking(ctx, () => ai.oneShot(ctx.from.id, 'Summarize clearly and concisely: short bullets for key ideas, then a one-line takeaway.', params.text));
        break;
      case 'explain':
        await withThinking(ctx, () => ai.oneShot(ctx.from.id, 'Explain like a great teacher: one-sentence plain definition, key ideas with an example/analogy, one line on why it matters.', params.topic));
        break;
      case 'translate':
        await withThinking(ctx, () => ai.oneShot(ctx.from.id, `Translate into ${params.lang}. Reply with ONLY the translation.`, params.text));
        break;
      case 'brainstorm':
        await withThinking(ctx, () => ai.oneShot(ctx.from.id, 'Brainstorm: 8-10 punchy distinct ideas as a numbered list, bold names, one-line detail each.', params.topic || text));
        break;

      // ── tools ──
      case 'tool_calc': await tools.calcExpr(ctx, params.expr); break;
      case 'tool_convert': await tools.convertU(ctx, params.value, params.from, params.to); break;
      case 'tool_currency': await tools.currencyC(ctx, params.amount, params.from, params.to); break;

      // ── default: context-aware chat (with doc follow-up detection) ──
      case 'chat':
      default: {
        const docId = ctx.state.user?.state?.activeDocId;
        const looksDocRelated = docId && /(document|pdf|the file|this file|chapter|in (it|this)|summariz)/i.test(text);
        if (looksDocRelated) {
          await withThinking(ctx, () => docs.askAboutDoc(ctx, docId, text));
        } else {
          await withThinking(ctx, () => ai.chatReply(ctx.from.id, text));
        }
        break;
      }
    }
  } catch (err) {
    // dispatch-level errors bubble to errorBoundary; log intent context
    logEvent('dispatch_error', { intent, error: String(err?.message || err).slice(0, 200) });
    throw err;
  }
  store.logUsage({ userId: ctx.from.id, kind: 'dispatch', detail: intent, ms: Date.now() - t0, success: true });
}

/* ── small list renderers for router intents ──────────────── */
async function showMemoryList(ctx) {
  const mems = await store.listMemories(ctx.from.id, 30);
  if (!mems.length) { await ctx.reply('🧠 Nothing stored yet. Tell me something: <i>“Remember that my exam is on Monday.”</i>', { parse_mode: 'HTML' }); return; }
  await sendLong(ctx, '🧠 <b>What I remember about you</b>\n\n' + mems.map((m, i) => `${i + 1}. ${escapeHtml(m.content)}`).join('\n'));
}
async function showResultsList(ctx) {
  const attempts = await store.recentAttempts(ctx.from.id, 8);
  if (!attempts.length) { await ctx.reply('📊 No quiz results yet — say <i>“quiz me on algebra”</i> to start!', { parse_mode: 'HTML' }); return; }
  const lines = attempts.map((a) => `• <b>${escapeHtml(a.nx_quizzes?.subject || '')}</b> — ${escapeHtml(a.nx_quizzes?.topic || '')}: <b>${a.score}/${a.total}</b>`).join('\n');
  await sendLong(ctx, `📊 <b>Your quiz results</b>\n\n${lines}`);
}
async function showTodoList(ctx) {
  const tasks = await store.listTasks(ctx.from.id);
  if (!tasks.length) { await ctx.reply('✅ All clear! Add one: <i>“add buy groceries to my todos”</i>', { parse_mode: 'HTML' }); return; }
  const prio = { high: '🔴', medium: '🟡', low: '🟢' };
  await sendLong(ctx, '✅ <b>Your to-dos</b>\n\n' + tasks.slice(0, 15).map((t) => `${prio[t.priority] || '🟡'} ${escapeHtml(t.title)}`).join('\n') + '\n\n<i>Manage them with /todo</i>');
}
async function showNoteList(ctx) {
  const notes = await store.listNotes(ctx.from.id, 8);
  if (!notes.length) { await ctx.reply('📝 No notes yet. Say <i>“note: buy milk tomorrow”</i>', { parse_mode: 'HTML' }); return; }
  await sendLong(ctx, '📝 <b>Your notes</b>\n\n' + notes.map((n, i) => `${i + 1}. ${escapeHtml(n.body.slice(0, 140))}`).join('\n\n'));
}
async function showGoalList(ctx) {
  const goals = await store.listGoals(ctx.from.id);
  if (!goals.length) { await ctx.reply('🎯 No goals yet. Set one: <code>/goals Learn React in 30 days</code>', { parse_mode: 'HTML' }); return; }
  await sendLong(ctx, '🎯 <b>Your goals</b>\n\n' + goals.map((g) => `• ${escapeHtml(g.title)} — <b>${g.progress}%</b>`).join('\n') + '\n\n<i>Manage with /goals</i>');
}

module.exports = { createBot, dispatchText };
