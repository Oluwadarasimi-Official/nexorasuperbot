'use strict';
/**
 * Developer Mode: /code, /debug, /review, /explain_code + source-file uploads.
 * Never executes user code — analysis only.
 */
const { chatReply, oneShot } = require('./ai');
const store = require('../store');
const { withThinking, sendLong, escapeHtml, answerCb, editOrReply } = require('../tg/helpers');
const { mdToTelegramHtml, extractCodeBlocks, extFor } = require('../tg/html');
const { menuKeyboard } = require('../tg/keyboards');

function cmdText(ctx) {
  return (ctx.message.text || '').replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
}
function codeBlock(s) {
  return `<pre>${escapeHtml(s.slice(0, 3000))}</pre>`;
}


const THINKING = '\ud83e\udde0 Nexora is thinking\u2026';

/** Summarize: text outside code fences, truncated. */
function summaryOf(raw, max = 400) {
  return raw.replace(/```(\w*)\n([\s\S]*?)```/g, '').trim().slice(0, max);
}

/**
 * Core /code flow, shared by the /code command and the menu button.
 * Big code -> editable file + short summary; small snippets -> chat message.
 */
async function genCode(ctx, spec) {
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'code', success: true });
  const thinking = await ctx.reply(THINKING);
  try {
    const raw = await oneShot(ctx.from.id,
      'You are Nexora Coder, a senior engineer. Write clean, working code for the request. Include brief comments, handle obvious edge cases, and add a 2-line usage note at the end. Format all code in fenced blocks with language tags.',
      spec);
    const blocks = extractCodeBlocks(raw);
    const codeLen = blocks.reduce((n, b) => n + b.code.length, 0);
    await ctx.telegram.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {});
    if (blocks.length && codeLen > 800) {
      const main = blocks.slice().sort((a, b) => b.code.length - a.code.length)[0];
      const filename = `nexora-code.${extFor(main.lang, 'txt')}`;
      const summary = summaryOf(raw);
      const caption = summary
        ? mdToTelegramHtml(summary).slice(0, 900)
        : '\ud83d\udcc4 Your code is ready \u2014 open the file to view and edit.';
      await ctx.replyWithDocument(
        { source: Buffer.from(main.code, 'utf8'), filename },
        { caption, parse_mode: 'HTML' }
      );
      if (blocks.length > 1) {
        await ctx.reply(`\u2139\ufe0f ${blocks.length} code blocks generated \u2014 the main one is in the file above.`);
      }
    } else {
      await sendLong(ctx, mdToTelegramHtml(raw));
    }
  } catch (err) {
    await ctx.telegram.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {});
    throw err;
  }
}

async function genDebug(ctx, code) {
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'debug', success: true });
  const out = await oneShot(ctx.from.id,
    'You are Nexora Coder debugging. Analyze the code, find the bug(s), explain the root cause simply, then show the FIXED code. Do not execute anything. Format code in fenced blocks.',
    code);
  return mdToTelegramHtml(out);
}

async function genReview(ctx, code) {
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'review', success: true });
  const out = await oneShot(ctx.from.id,
    "You are Nexora Coder doing a code review. Review for: correctness, bugs, security issues, performance, readability. Format: \u2705 What\u2019s good (1-2 lines), \u26a0\ufe0f Issues found (bullets with severity), \ud83d\udca1 Improved version of the key parts. Format code in fenced blocks.",
    code);
  return mdToTelegramHtml(out);
}

async function genExplain(ctx, code) {
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'explain_code', success: true });
  const out = await oneShot(ctx.from.id,
    'You are Nexora Coder teaching. Explain the code clearly: what it does overall, then walk through the important parts step by step in plain language. End with one gotcha to watch for. Format code in fenced blocks.',
    code);
  return mdToTelegramHtml(out);
}

function register(bot) {
  bot.command('code', async (ctx) => {
    const spec = cmdText(ctx);
    if (!spec) return ctx.reply('\u26a1 Describe what to build: <code>/code a Python function that validates emails</code>', { parse_mode: 'HTML' });
    await genCode(ctx, spec);
  });

  bot.command('debug', async (ctx) => {
    const code = cmdText(ctx);
    if (!code) return ctx.reply('\ud83d\udc1e Paste the buggy code after /debug, or just paste code in chat and I will spot the issue.');
    await withThinking(ctx, () => genDebug(ctx, code));
  });

  bot.command('review', async (ctx) => {
    const code = cmdText(ctx);
    if (!code) return ctx.reply('\ud83d\udd0d Paste code after /review and I will review it like a senior engineer.');
    await withThinking(ctx, () => genReview(ctx, code));
  });

  bot.command('explain_code', async (ctx) => {
    const code = cmdText(ctx);
    if (!code) return ctx.reply('\ud83d\udcd6 Paste code after /explain_code and I will explain it line by line.');
    await withThinking(ctx, () => genExplain(ctx, code));
  });

  // menu shortcuts
  const hint = (title, usage) => async (ctx) => {
    await answerCb(ctx);
    await editOrReply(ctx, `${title}\n\n${usage}`, { parse_mode: 'HTML', ...menuKeyboard('dev') });
  };
  bot.action('dev:code', hint('⚡ <b>Generate code</b>', '<code>/code &lt;describe what to build&gt;</code>\ne.g. <code>/code a login form in React</code>'));
  bot.action('dev:debug', hint('🐞 <b>Debug</b>', '<code>/debug &lt;paste buggy code&gt;</code>\nOr just paste code in chat — I will detect it.'));
  bot.action('dev:review', hint('🔍 <b>Review code</b>', '<code>/review &lt;paste code&gt;</code> — correctness, security, style.'));
  bot.action('dev:explain', hint('📖 <b>Explain code</b>', '<code>/explain_code &lt;paste code&gt;</code> — plain-language walkthrough.'));
  bot.action('dev:upload', hint('📤 <b>Upload source file</b>', 'Send me a <code>.js</code>, <code>.py</code>, <code>.ts</code>, <code>.java</code> etc. file and I will analyze it. Then ask me anything about it.'));
}



module.exports = { register, genCode, genDebug, genReview, genExplain };
