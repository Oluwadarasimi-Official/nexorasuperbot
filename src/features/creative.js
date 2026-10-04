'use strict';
/**
 * Creative Studio: /caption, /prompt (image-gen), /ideas, /brand.
 */
const store = require('../store');
const { chatReply } = require('./ai');
const { withThinking, sendLong, escapeHtml, answerCb, editOrReply } = require('../tg/helpers');
const { menuKeyboard } = require('../tg/keyboards');

function cmdText(ctx) {
  return (ctx.message.text || '').replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
}

async function genCaption(ctx, brief) {
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'caption', success: true });
  await withThinking(ctx, () => chatReply(ctx.from.id,
    `Write 5 Instagram caption options for: ${brief}. Mix of short punchy and storytelling styles. Include 3-5 relevant hashtags per caption. Number them.`));
}
async function genPrompt(ctx, brief) {
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'prompt', success: true });
  await withThinking(ctx, () => chatReply(ctx.from.id,
    `Write ONE masterful AI image-generation prompt for: ${brief}. Include subject, style, lighting, composition, mood, quality tags. Then give 2 shorter variations. Format the main prompt in a code block.`));
}
async function genIdeas(ctx, brief) {
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'ideas', success: true });
  await withThinking(ctx, () => chatReply(ctx.from.id,
    `Generate 10 creative ideas for: ${brief}. Make them specific and non-generic, each one line with a hook. Bold the idea titles.`));
}
async function genBrand(ctx, brief) {
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'brand', success: true });
  await withThinking(ctx, () => chatReply(ctx.from.id,
    `Create a mini brand kit for: ${brief}. Include: 8 name ideas (bolded), 5 slogans/taglines, suggested brand voice (1 line), and 3 color-mood directions. Keep it sharp.`));
}

function register(bot) {
  bot.command('caption', async (ctx) => {
    const brief = cmdText(ctx);
    if (!brief) return ctx.reply('📸 What is the post about? e.g.\n<code>/caption Launching my fashion brand, bold and confident vibe</code>', { parse_mode: 'HTML' });
    await genCaption(ctx, brief);
  });

  bot.command('prompt', async (ctx) => {
    const brief = cmdText(ctx);
    if (!brief) return ctx.reply('🖼 Describe the image you want: e.g.\n<code>/prompt A cyberpunk Lagos street at night, neon signs</code>', { parse_mode: 'HTML' });
    await genPrompt(ctx, brief);
  });

  bot.command('ideas', async (ctx) => {
    const brief = cmdText(ctx) || 'content';
    await genIdeas(ctx, brief);
  });

  bot.command('brand', async (ctx) => {
    const brief = cmdText(ctx);
    if (!brief) return ctx.reply('🏷 What is the brand about? e.g.\n<code>/brand A premium streetwear label for Lagos youth</code>', { parse_mode: 'HTML' });
    await genBrand(ctx, brief);
  });

  const hint = (title, usage) => async (ctx) => {
    await answerCb(ctx);
    await editOrReply(ctx, `${title}\n\n${usage}`, { parse_mode: 'HTML', ...menuKeyboard('creative') });
  };
  bot.action('cre:caption', hint('📸 <b>Caption writer</b>', '<code>/caption &lt;what is the post about?&gt;</code>'));
  bot.action('cre:prompt', hint('🖼 <b>Image prompt engineer</b>', '<code>/prompt &lt;describe the image&gt;</code> — optimized for Midjourney / DALL-E / Flux.'));
  bot.action('cre:ideas', hint('💡 <b>Idea generator</b>', '<code>/ideas &lt;topic&gt;</code> — 10 sharp, specific ideas.'));
  bot.action('cre:brand', hint('🏷 <b>Brand kit</b>', '<code>/brand &lt;what is the brand about?&gt;</code> — names, slogans, voice, colors.'));
}

module.exports = { register, genCaption, genPrompt, genIdeas, genBrand };
