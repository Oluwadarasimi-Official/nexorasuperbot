'use strict';
/**
 * Tools: calculator (safe parser — never eval), unit conversion,
 * currency (Frankfurter, no key), QR codes, JSON formatter,
 * password generator, timestamps, text utilities, random.
 */
const QRCode = require('qrcode');
const crypto = require('crypto');
const store = require('../store');
const { sendLong, escapeHtml, answerCb, editOrReply } = require('../tg/helpers');
const { menuKeyboard } = require('../tg/keyboards');
const { safeEval, convertUnits, fmtNumber } = require('../utils');

function cmdText(ctx) {
  return (ctx.message.text || '').replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
}

/** Currency via Frankfurter (free, no API key). */
async function convertCurrency(amount, from, to) {
  const url = `https://api.frankfurter.app/latest?amount=${encodeURIComponent(amount)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Currency service unavailable (${res.status}).`);
  const data = await res.json();
  const rate = data?.rates?.[to.toUpperCase()];
  if (rate === undefined) throw Object.assign(new Error(`Unknown currency code: ${from}/${to}. Use 3-letter codes like USD, EUR, NGN.`), { category: 'validation' });
  return { result: rate, date: data.date };
}

async function calcExpr(ctx, expr) {
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'calc', success: true });
  try {
    const sugar = expr.replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*/gi, '($1/100)*');
    const val = safeEval(sugar);
    await ctx.reply(`\u{1F9EE} <code>${escapeHtml(expr)}</code>\n= <b>${escapeHtml(fmtNumber(val))}</b>`, { parse_mode: 'HTML' });
  } catch (e) {
    await ctx.reply(`\u26A0\uFE0F Could not calculate that: <i>${escapeHtml(e.message)}</i>`, { parse_mode: 'HTML' });
  }
}

async function convertU(ctx, value, from, to) {
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'convert', success: true });
  try {
    const out = convertUnits(value, from, to);
    await ctx.reply(`\u{1F4D0} <b>${escapeHtml(String(value))} ${escapeHtml(from)}</b> = <b>${escapeHtml(fmtNumber(out))} ${escapeHtml(to)}</b>`, { parse_mode: 'HTML' });
  } catch (e) {
    await ctx.reply(`\u26A0\uFE0F ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
  }
}

async function currencyC(ctx, amount, from, to) {
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'currency', success: true });
  try {
    const { result, date } = await convertCurrency(amount, from.toUpperCase(), to.toUpperCase());
    await ctx.reply(`\u{1F4B1} <b>${escapeHtml(String(amount))} ${from.toUpperCase()}</b> \u2248 <b>${escapeHtml(fmtNumber(result))} ${to.toUpperCase()}</b>\n<i>Rate date: ${date}</i>`, { parse_mode: 'HTML' });
  } catch (e) {
    await ctx.reply(`\u26A0\uFE0F ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
  }
}

function register(bot) {
  bot.command('calc', async (ctx) => {
    const expr = cmdText(ctx);
    if (!expr) return ctx.reply('🧮 Usage: <code>/calc (15% of 2400) + sqrt(81)</code>', { parse_mode: 'HTML' });
    await calcExpr(ctx, expr);
  });

  bot.command('convert', async (ctx) => {
    const arg = cmdText(ctx);
    const m = arg.match(/^([\d.]+)\s*([a-zA-Z/%]+)\s+to\s+([a-zA-Z/%]+)$/);
    if (!m) return ctx.reply('📐 Usage: <code>/convert 5 km to miles</code>\n<code>/convert 100 c to f</code>', { parse_mode: 'HTML' });
    await convertU(ctx, parseFloat(m[1]), m[2], m[3]);
  });

  bot.command('currency', async (ctx) => {
    const arg = cmdText(ctx);
    const m = arg.match(/^([\d.]+)\s*([a-zA-Z]{3})\s+(?:to|in)\s+([a-zA-Z]{3})$/);
    if (!m) return ctx.reply('💱 Usage: <code>/currency 100 USD to NGN</code>', { parse_mode: 'HTML' });
    await currencyC(ctx, parseFloat(m[1]), m[2], m[3]);
  });

  bot.command('qr', async (ctx) => {
    const text = cmdText(ctx);
    if (!text) return ctx.reply('🔳 Usage: <code>/qr https://example.com</code>', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'qr', success: true });
    try {
      const png = await QRCode.toBuffer(text.slice(0, 1000), { width: 512, margin: 2 });
      await ctx.replyWithPhoto({ source: png }, { caption: `🔳 QR code for:\n<code>${escapeHtml(text.slice(0, 200))}</code>`, parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply('⚠️ Could not generate that QR code.');
    }
  });

  bot.command('json', async (ctx) => {
    const raw = cmdText(ctx);
    if (!raw) return ctx.reply('🔣 Paste JSON after /json and I will pretty-print + validate it.', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'json', success: true });
    try {
      const obj = JSON.parse(raw);
      const pretty = JSON.stringify(obj, null, 2).slice(0, 3500);
      await ctx.reply(`✅ <b>Valid JSON</b>\n<pre>${escapeHtml(pretty)}</pre>`, { parse_mode: 'HTML' });
    } catch (e) {
      await ctx.reply(`❌ <b>Invalid JSON</b>\n<i>${escapeHtml(e.message)}</i>`, { parse_mode: 'HTML' });
    }
  });

  bot.command('password', async (ctx) => {
    const arg = cmdText(ctx);
    const len = Math.min(64, Math.max(8, parseInt(arg, 10) || 16));
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'password', success: true });
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_';
    const bytes = crypto.randomBytes(len);
    let pw = '';
    for (const b of bytes) pw += chars[b % chars.length];
    await ctx.reply(`🔑 <b>Generated password</b> (${len} chars):\n<code>${escapeHtml(pw)}</code>\n\n<i>Copy it now — I do not store it.</i>`, { parse_mode: 'HTML' });
  });

  bot.command('timestamp', async (ctx) => {
    const arg = cmdText(ctx);
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'timestamp', success: true });
    const now = Math.floor(Date.now() / 1000);
    if (!arg) {
      await ctx.reply(`⏱ <b>Now</b>\nUnix: <code>${now}</code>\nUTC: <code>${new Date().toISOString()}</code>\nLagos: <code>${new Date(Date.now() + 3600000).toISOString().replace('T', ' ').slice(0, 19)}</code>`, { parse_mode: 'HTML' });
      return;
    }
    if (/^\d{9,}$/.test(arg.trim())) {
      const d = new Date(parseInt(arg.trim(), 10) * 1000);
      await ctx.reply(`⏱ <code>${arg.trim()}</code> =\nUTC: <code>${d.toISOString()}</code>`, { parse_mode: 'HTML' });
    } else {
      const d = new Date(arg);
      if (isNaN(d)) { await ctx.reply('⚠️ I could not parse that date. Try <code>/timestamp 2026-10-04 18:00</code> or a unix timestamp.', { parse_mode: 'HTML' }); return; }
      await ctx.reply(`⏱ <b>${escapeHtml(arg)}</b>\nUnix: <code>${Math.floor(d.getTime() / 1000)}</code>\nUTC: <code>${d.toISOString()}</code>`, { parse_mode: 'HTML' });
    }
  });

  bot.command('text', async (ctx) => {
    const raw = cmdText(ctx);
    const m = raw.match(/^(upper|lower|title|reverse|words|count)\s+([\s\S]+)$/i);
    if (!m) return ctx.reply('📝 Usage: <code>/text upper|lower|title|reverse|words &lt;text&gt;</code>', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'text', success: true });
    const [, op, t] = m;
    let out;
    switch (op.toLowerCase()) {
      case 'upper': out = t.toUpperCase(); break;
      case 'lower': out = t.toLowerCase(); break;
      case 'title': out = t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()); break;
      case 'reverse': out = [...t].reverse().join(''); break;
      case 'words': case 'count': {
        const words = t.trim().split(/\s+/).filter(Boolean).length;
        await ctx.reply(`📝 <b>Stats</b>\nWords: <b>${words}</b>\nCharacters: <b>${t.length}</b>\nCharacters (no spaces): <b>${t.replace(/\s/g, '').length}</b>`, { parse_mode: 'HTML' });
        return;
      }
      default: out = t;
    }
    await ctx.reply(`📝 <b>Result:</b>\n${escapeHtml(out.slice(0, 3000))}`, { parse_mode: 'HTML' });
  });

  bot.command('random', async (ctx) => {
    const arg = cmdText(ctx);
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'random', success: true });
    const m = arg.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const n = lo + crypto.randomInt(hi - lo + 1);
      await ctx.reply(`🎲 Random number between ${lo} and ${hi}: <b>${n}</b>`, { parse_mode: 'HTML' });
      return;
    }
    if (/coin/i.test(arg)) { await ctx.reply(`🪙 Coin flip: <b>${crypto.randomInt(2) ? 'Heads' : 'Tails'}</b>`, { parse_mode: 'HTML' }); return; }
    if (/dice/i.test(arg)) { await ctx.reply(`🎲 Dice roll: <b>${1 + crypto.randomInt(6)}</b>`, { parse_mode: 'HTML' }); return; }
    await ctx.reply('🎲 Usage:\n<code>/random 1-100</code> — number in range\n<code>/random coin</code> — coin flip\n<code>/random dice</code> — dice roll', { parse_mode: 'HTML' });
  });

  /* menu shortcuts */
  const hint = (title, usage) => async (ctx) => {
    await answerCb(ctx);
    await editOrReply(ctx, `${title}\n\n${usage}`, { parse_mode: 'HTML', ...menuKeyboard('tools') });
  };
  bot.action('tool:calc', hint('🧮 <b>Calculator</b>', '<code>/calc 2*(3+4)^2</code>\nSupports + − × ÷ ^ % √(), sin, cos, log, pi…'));
  bot.action('tool:convert', hint('📐 <b>Unit converter</b>', '<code>/convert 5 km to miles</code>\n<code>/convert 100 c to f</code>'));
  bot.action('tool:currency', hint('💱 <b>Currency converter</b>', '<code>/currency 100 USD to NGN</code>\nLive rates, no key needed.'));
  bot.action('tool:qr', hint('🔳 <b>QR generator</b>', '<code>/qr &lt;text or link&gt;</code>'));
  bot.action('tool:text', hint('📝 <b>Text tools</b>', '<code>/text upper|lower|title|reverse|words &lt;text&gt;</code>'));
  bot.action('tool:json', hint('🔣 <b>JSON formatter</b>', '<code>/json {\"a\":1}</code> — validates + pretty-prints.'));
  bot.action('tool:password', hint('🔑 <b>Password generator</b>', '<code>/password 20</code> — cryptographically random.'));
  bot.action('tool:time', hint('⏱ <b>Timestamps</b>', '<code>/timestamp</code> — now\n<code>/timestamp 1728000000</code> — decode'));
  bot.action('tool:random', hint('🎲 <b>Random</b>', '<code>/random 1-100</code> · <code>/random coin</code> · <code>/random dice</code>'));
}

module.exports = { register, convertCurrency, calcExpr, convertU, currencyC };
