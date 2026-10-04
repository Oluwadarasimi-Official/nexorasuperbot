'use strict';
/**
 * Core: /start onboarding + dashboard, /help, /menu, section menus,
 * settings (persona picker, clear history, about). All navigation
 * edits messages in place instead of spamming new ones.
 */
const { Markup } = require('telegraf');
const store = require('../store');
const { mainMenu, menuKeyboard, SECTION_TITLES, SECTION_HINTS } = require('../tg/keyboards');
const { editOrReply, answerCb, sendLong, escapeHtml } = require('../tg/helpers');
const { personaList, personaLabel } = require('../ai/personas');
const { logUsage } = require('../store');

const WELCOME =
  '👋 <b>Welcome to NexoraSuperBot.</b>\n\n' +
  'Your AI-powered command center inside Telegram.\n\n' +
  'Ask questions, study, code, research, analyze files, manage tasks, create content and more — all from one place.\n\n' +
  '👇 <b>Choose where to start:</b>\n\n' +
  '🛠 <i>Built by David Oluwadarasimi</i>';

async function showHome(ctx) {
  await editOrReply(ctx, WELCOME, mainMenu());
}

async function showSection(ctx, section) {
  const title = SECTION_TITLES[section] || 'Nexora';
  const hint = SECTION_HINTS[section] || '';
  await editOrReply(ctx, `${title}\n\n${escapeHtml(hint)}`, menuKeyboard(section));
}

function register(bot) {
  bot.command('start', async (ctx) => {
    const user = ctx.state.user;
    const first = user && (await store.getUser(ctx.from.id));
    const isNew = first && (Date.now() - new Date(first.created_at).getTime() < 15000);
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'start', success: true });
    if (isNew) {
      await sendLong(ctx, WELCOME, mainMenu());
    } else {
      await sendLong(ctx, `👋 Welcome back, <b>${escapeHtml(ctx.from.first_name || 'friend')}</b>!\n\nWhat are we doing today?\n\n🛠 <i>Built by David Oluwadarasimi</i>`, mainMenu());
    }
  });

  bot.command('menu', async (ctx) => {
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'menu', success: true });
    await sendLong(ctx, '🏠 <b>Nexora dashboard</b> — pick a section:', mainMenu());
  });

  bot.command('help', async (ctx) => {
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'help', success: true });
    await sendLong(ctx,
      '🆘 <b>NexoraSuperBot help</b>\n\n' +
      'Just talk to me — I figure out what you need. Or use commands:\n\n' +
      '<b>AI</b>: /ask /summarize /explain /translate /brainstorm /clear\n' +
      '<b>Memory</b>: /remember /memory /forget /clear_memory\n' +
      '<b>Study</b>: /quiz /flashcards /revise /results\n' +
      '<b>Dev</b>: /code /debug /review /explain_code\n' +
      '<b>Research</b>: /research &lt;topic&gt;\n' +
      '<b>Productivity</b>: /todo /note /remind /plan /goals\n' +
      '<b>Creative</b>: /caption /prompt /imagine /ideas /brand\n' +
      '<b>Tools</b>: /calc /convert /currency /qr /json /password /timestamp\n' +
      '<b>Other</b>: /menu /settings /cancel\n\n' +
      '📎 Send me voice notes, photos, PDFs or documents — I understand them all.',
      mainMenu());
  });

  bot.command('settings', async (ctx) => {
    await sendLong(ctx, `${SECTION_TITLES.settings}\n\n${escapeHtml(SECTION_HINTS.settings)}`, menuKeyboard('settings'));
  });

  bot.command('cancel', async (ctx) => {
    await store.updateUserState(ctx.from.id, { activeFlow: null, activeDocId: null, pending: null });
    await ctx.reply('❌ Cancelled. Fresh slate — what next?', mainMenu());
  });

  // ── menu navigation callbacks ──
  bot.action(/^menu:(.+)$/, async (ctx) => {
    const target = ctx.match[1];
    await answerCb(ctx);
    if (target === 'home' || target === 'back') {
      // "back" from a section goes home (sections are one level deep)
      await showHome(ctx);
    } else {
      await showSection(ctx, target);
      // remember for back navigation
      await store.updateUserState(ctx.from.id, { lastSection: target });
    }
  });

  // ── settings callbacks ──
  bot.action('set:persona', async (ctx) => {
    await answerCb(ctx);
    const rows = personaList().map((p) => [Markup.button.callback(`${p.label}`, `set:persona:${p.id}`)]);
    rows.push([Markup.button.callback('⬅️ Back', 'menu:settings'), Markup.button.callback('🏠 Main Menu', 'menu:home')]);
    await editOrReply(ctx, '🎭 <b>Choose your AI persona</b> — this changes how I talk and reason:', Markup.inlineKeyboard(rows));
  });

  bot.action(/^set:persona:([a-z]+)$/, async (ctx) => {
    const id = ctx.match[1];
    await store.updateUserPrefs(ctx.from.id, { persona: id });
    await answerCb(ctx, `Persona set to ${personaLabel(id)}`);
    await editOrReply(ctx, `🎭 Persona set to <b>${escapeHtml(personaLabel(id))}</b>.\n\nIt applies to all AI chats from now on.`, menuKeyboard('settings'));
  });

  bot.action('set:clear', async (ctx) => {
    await answerCb(ctx);
    await store.newConversation(ctx.from.id);
    await editOrReply(ctx, '🧹 Chat history cleared. Starting fresh.', menuKeyboard('settings'));
  });

  bot.action('set:about', async (ctx) => {
    await answerCb(ctx);
    await editOrReply(ctx,
      'ℹ️ <b>NexoraSuperBot v1.0</b>\n\n' +
      'An all-in-one AI operating system inside Telegram: chat, memory, study, code, research, documents, productivity, creative tools and utilities.\n\n' +
      '🔒 Your data is private to you and stored securely. Admins never see message contents.',
      menuKeyboard('settings'));
  });
}

module.exports = { register, showHome, showSection };
