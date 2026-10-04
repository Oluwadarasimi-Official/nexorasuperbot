'use strict';
/**
 * Middleware: user session, rate limiting, admin guard, error boundary.
 */
const { cfg } = require('../config');
const store = require('../store');
const { logEvent } = require('../logger');
const { sendLong } = require('./helpers');

/* ── attach user session (upsert + admin flag) ─────────────── */
async function attachUser(ctx, next) {
  try {
    const from = ctx.from;
    if (!from) return next();
    const isAdmin = cfg.adminIds.includes(String(from.id)) || cfg.adminIds.includes(String(from.id).replace(/^/, ''));
    const user = await store.upsertUser({
      id: from.id,
      username: from.username,
      firstName: from.first_name,
      isAdmin,
    });
    ctx.state.user = user;
    ctx.state.isAdmin = Boolean(user.is_admin) || isAdmin;
    return next();
  } catch (err) {
    logEvent('middleware_user_error', { error: err.message });
    ctx.state.user = null;
    ctx.state.isAdmin = false;
    return next();
  }
}

/* ── token-bucket rate limiter (per user, per scope) ───────── */
const buckets = new Map();
const LIMITS = {
  ai: { max: 25, perMs: 60000 },       // 25 AI calls / minute
  cmd: { max: 60, perMs: 60000 },      // 60 commands / minute
  cb: { max: 120, perMs: 60000 },      // 120 button taps / minute
};
function checkLimit(key, scope) {
  const lim = LIMITS[scope] || LIMITS.cmd;
  const now = Date.now();
  let b = buckets.get(key + ':' + scope);
  if (!b || now - b.windowStart > lim.perMs) { b = { count: 0, windowStart: now }; buckets.set(key + ':' + scope, b); }
  // opportunistic cleanup
  if (buckets.size > 20000) buckets.clear();
  b.count += 1;
  return b.count <= lim.max;
}
function rateLimit(scope) {
  return async (ctx, next) => {
    const id = ctx.from?.id || 'anon';
    if (!checkLimit(String(id), scope)) {
      logEvent('rate_limited', { user: String(id), scope });
      try {
        if (ctx.callbackQuery) await ctx.answerCbQuery('⏳ Slow down a little — you are sending too fast.', { show_alert: true }).catch(() => {});
        else await ctx.reply('⏳ You are going a bit fast — give me a few seconds and try again.');
      } catch { /* ignore */ }
      return;
    }
    return next();
  };
}

/* ── admin-only guard ──────────────────────────────────────── */
function adminOnly(ctx, next) {
  if (!ctx.state.isAdmin) {
    logEvent('admin_denied', { user: String(ctx.from?.id) });
    return ctx.reply('🔒 That area is for Nexora admins only.');
  }
  return next();
}

/* ── error boundary: safe user-facing errors, structured logs ─ */
function errorBoundary(ctx, next) {
  return next().catch(async (err) => {
    const category = err.category || classifyError(err);
    logEvent('handler_error', { user: String(ctx.from?.id || 'anon'), category, error: err.message?.slice(0, 200) });
    try {
      await store.logUsage({ userId: ctx.from?.id || null, kind: 'error', detail: (ctx.updateType || 'update').slice(0, 60), success: false, errorCategory: category });
    } catch { /* never fail on logging */ }
    const friendly = {
      ai: '⚠️ The AI service hiccuped. Please try again in a moment.',
      database: '⚠️ I had trouble reaching the database. Please try again.',
      telegram: '⚠️ Telegram glitched on that one — please retry.',
      validation: `⚠️ ${err.message || 'That input did not look right.'}`,
      unsupported: `⚠️ ${err.message || 'Not supported with the current AI provider.'}`,
    }[category] || '⚠️ Something went wrong on my side. Please try again — if it persists, use /start.';
    try {
      if (ctx.callbackQuery) { try { await ctx.answerCbQuery('Something went wrong — try again.', { show_alert: true }); } catch { /* */ } }
      else await sendLong(ctx, friendly);
    } catch { /* last resort: stay silent */ }
  });
}

function classifyError(err) {
  const msg = (err.message || '').toLowerCase();
  if (err.name === 'UnsupportedError') return 'unsupported';
  if (/ai request failed|gemini|groq|empty response|malformed json/.test(msg)) return 'ai';
  if (/db:|supabase|database/.test(msg)) return 'database';
  if (/telegram|message is not modified|query is too old|bot was blocked/.test(msg)) return 'telegram';
  if (err.status === 429 || /rate limit|too many/.test(msg)) return 'ai';
  return 'unknown';
}

/** Wrap an AI call with timing + usage logging. */
async function tracked(kind, userId, fn, detail = null) {
  const t0 = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - t0;
    const tokens = out && typeof out === 'string' ? Math.ceil(out.length / 4) : null;
    store.logUsage({ userId, kind, detail, tokens, ms, success: true });
    return out;
  } catch (err) {
    store.logUsage({ userId, kind, detail, ms: Date.now() - t0, success: false, errorCategory: classifyError(err) });
    throw err;
  }
}

module.exports = { attachUser, rateLimit, adminOnly, errorBoundary, tracked, classifyError, checkLimit };
