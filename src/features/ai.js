'use strict';
/**
 * AI Assistant: context-aware chat, /ask, /summarize, /explain,
 * /translate, /brainstorm, /clear, persona modes. Plain messages
 * that the router leaves as "chat" land here too.
 */
const { Markup } = require('telegraf');
const { getProvider } = require('../ai/providers');
const { personaSystem, personaLabel } = require('../ai/personas');
const store = require('../store');
const { cfg } = require('../config');
const { withThinking, sendLong, escapeHtml, answerCb, editOrReply } = require('../tg/helpers');
const { menuKeyboard } = require('../tg/keyboards');
const { tracked } = require('../tg/middleware');
const { clampText } = require('../utils');

async function buildContext(userId) {
  const conv = await store.getActiveConversation(userId);
  const history = await store.getHistory(conv.id, cfg.historyLimit);
  const user = await store.getUser(userId);
  const persona = user?.prefs?.persona || conv.persona || 'default';
  const memCtx = await store.memoryContext(userId);
  return { conv, history, persona, system: personaSystem(persona, memCtx) };
}

async function chatReply(userId, userText) {
  const { conv, history, system } = await buildContext(userId);
  const messages = [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: `<user_input>\n${userText}\n</user_input>` }];
  const provider = getProvider();
  const reply = await tracked('ai_chat', userId, () => provider.generateText({ system, messages, maxTokens: 2048 }), 'chat');
  await store.addMessage(conv.id, 'user', userText);
  await store.addMessage(conv.id, 'assistant', reply);
  return reply;
}

async function oneShot(userId, systemExtra, prompt, kind = 'ai_chat') {
  const { system } = await buildContext(userId);
  const provider = getProvider();
  return tracked(kind, userId, () => provider.generateText({
    system: system + '\n' + systemExtra,
    messages: [{ role: 'user', content: `<user_input>\n${prompt}\n</user_input>` }],
    maxTokens: 2048,
  }), kind);
}

function cmdText(ctx) {
  // strips "/command@botname " prefix
  const t = ctx.message.text || '';
  return t.replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
}

function register(bot) {
  bot.command('ask', async (ctx) => {
    const q = cmdText(ctx);
    if (!q) return ctx.reply('❓ Ask me something: <code>/ask What is photosynthesis?</code>', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'ask', success: true });
    await withThinking(ctx, () => chatReply(ctx.from.id, q));
  });

  bot.command('summarize', async (ctx) => {
    const t = cmdText(ctx);
    if (!t) return ctx.reply('📝 Give me text to summarize: <code>/summarize &lt;paste text&gt;</code>\n\nTip: you can also upload a document and I will summarize the file itself.', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'summarize', success: true });
    await withThinking(ctx, () => oneShot(ctx.from.id,
      'Summarize the user input clearly and concisely. Use short bullet points for key ideas, then a one-line takeaway. Keep it phone-readable.',
      t, 'ai_chat'));
  });

  bot.command('explain', async (ctx) => {
    const t = cmdText(ctx);
    if (!t) return ctx.reply('💡 What should I explain? e.g. <code>/explain quantum entanglement</code>', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'explain', success: true });
    await withThinking(ctx, () => oneShot(ctx.from.id,
      'Explain the topic simply and clearly, as a great teacher would. Start with a one-sentence plain-English definition, then the key ideas with a concrete example or analogy. End with one line on why it matters. Phone-readable formatting.',
      t, 'ai_chat'));
  });

  bot.command('translate', async (ctx) => {
    const t = cmdText(ctx);
    const m = t.match(/^(.+?)\s+to\s+([a-zA-Z\s]+)$/);
    if (!m) return ctx.reply('🌍 Usage: <code>/translate Hello, how are you? to French</code>', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'translate', success: true });
    await withThinking(ctx, () => oneShot(ctx.from.id,
      `Translate the user's text into ${m[2].trim()}. Reply with ONLY the translation, no commentary.`,
      m[1].trim(), 'ai_chat'));
  });

  bot.command('brainstorm', async (ctx) => {
    const t = cmdText(ctx) || 'a new project';
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'brainstorm', success: true });
    await withThinking(ctx, () => oneShot(ctx.from.id,
      'Brainstorm on the user\'s topic. Give 8-10 punchy, distinct ideas as a numbered list, each one line with a tiny spark of detail. Bold the idea names. End with: "Want me to expand any of these?"',
      t, 'ai_chat'));
  });

  bot.command('clear', async (ctx) => {
    await store.newConversation(ctx.from.id);
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'clear', success: true });
    await ctx.reply('🧹 Conversation history cleared. What is on your mind?');
  });

  // section menu shortcuts
  bot.action('ai:chat', async (ctx) => { await answerCb(ctx); await editOrReply(ctx, '💬 <b>Chat</b>\n\nJust type anything — I will understand what you need. Try:\n\n• <i>Explain photosynthesis</i>\n• <i>Remind me tomorrow at 4pm to study</i>\n• <i>Create 10 questions on algebra</i>', menuKeyboard('ai')); });
  bot.action('ai:modes', async (ctx) => {
    await answerCb(ctx);
    const { personaList } = require('../ai/personas');
    const kb = personaList().map((p) => [Markup.button.callback(p.label, `set:persona:${p.id}`)]);
    kb.push([Markup.button.callback('⬅️ Back', 'menu:ai'), Markup.button.callback('🏠 Main Menu', 'menu:home')]);
    await editOrReply(ctx, '🎭 <b>AI modes</b> — pick a persona:', Markup.inlineKeyboard(kb));
  });
  bot.action('ai:summarize', async (ctx) => { await answerCb(ctx); await editOrReply(ctx, '📝 <b>Summarize</b>\n\nSend me text with <code>/summarize &lt;text&gt;</code>, or upload a document and I will summarize the file.', { parse_mode: 'HTML', ...menuKeyboard('ai') }); });
  bot.action('ai:explain', async (ctx) => { await answerCb(ctx); await editOrReply(ctx, '💡 <b>Explain</b>\n\nType <code>/explain &lt;topic&gt;</code> — or just type “explain …” naturally.', { parse_mode: 'HTML', ...menuKeyboard('ai') }); });
  bot.action('ai:translate', async (ctx) => { await answerCb(ctx); await editOrReply(ctx, '🌍 <b>Translate</b>\n\n<code>/translate &lt;text&gt; to &lt;language&gt;</code>\n\ne.g. <code>/translate Good morning to Yoruba</code>', { parse_mode: 'HTML', ...menuKeyboard('ai') }); });
  bot.action('ai:brainstorm', async (ctx) => { await answerCb(ctx); await editOrReply(ctx, '🧠 <b>Brainstorm</b>\n\n<code>/brainstorm &lt;topic&gt;</code> — or just type “brainstorm …”.', { parse_mode: 'HTML', ...menuKeyboard('ai') }); });
  bot.action('ai:clear', async (ctx) => { await answerCb(ctx); await store.newConversation(ctx.from.id); await editOrReply(ctx, '🧹 History cleared. Fresh start ✨', menuKeyboard('ai')); });
}

module.exports = { register, chatReply, oneShot, buildContext };
