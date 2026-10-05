'use strict';
/**
 * Developer Mode: /code, /debug, /review, /explain_code + source-file uploads.
 * Never executes user code — analysis only.
 */
const { chatReply, oneShot } = require('./ai');
const store = require('../store');
const { withThinking, sendLong, escapeHtml, answerCb, editOrReply } = require('../tg/helpers');
const { menuKeyboard } = require('../tg/keyboards');

function cmdText(ctx) {
  return (ctx.message.text || '').replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
}
function codeBlock(s) {
  return `<pre>${escapeHtml(s.slice(0, 3000))}</pre>`;
}

function register(bot) {
  bot.command('code', async (ctx) => {
    const spec = cmdText(ctx);
    if (!spec) return ctx.reply('⚡ Describe what to build: <code>/code a Python function that validates emails</code>', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'code', success: true });
    await withThinking(ctx, () => oneShot(ctx.from.id,
      'You are Nexora Coder, a senior engineer. Write clean, working code for the request. Include brief comments, handle obvious edge cases, and add a 2-line usage note at the end.',
      spec));
  });

  bot.command('debug', async (ctx) => {
    const code = cmdText(ctx);
    if (!code) return ctx.reply('🐞 Paste the buggy code after /debug, or just paste code in chat and I will spot the issue.', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'debug', success: true });
    await withThinking(ctx, () => oneShot(ctx.from.id,
      'You are Nexora Coder debugging. Analyze the code, find the bug(s), explain the root cause simply, then show the FIXED code. Do not execute anything.',
      code));
  });

  bot.command('review', async (ctx) => {
    const code = cmdText(ctx);
    if (!code) return ctx.reply('🔍 Paste code after /review and I will review it like a senior engineer.', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'review', success: true });
    await withThinking(ctx, () => oneShot(ctx.from.id,
      'You are Nexora Coder doing a code review. Review for: correctness, bugs, security issues, performance, readability. Format: ✅ What\'s good (1-2 lines), ⚠️ Issues found (bullets with severity), 💡 Improved version of the key parts.',
      code));
  });

  bot.command('explain_code', async (ctx) => {
    const code = cmdText(ctx);
    if (!code) return ctx.reply('📖 Paste code after /explain_code and I will explain it line by line.', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'explain_code', success: true });
    await withThinking(ctx, () => oneShot(ctx.from.id,
      'You are Nexora Coder teaching. Explain the code clearly: what it does overall, then walk through the important parts step by step in plain language. End with one gotcha to watch for.',
      code));
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

module.exports = { register };
