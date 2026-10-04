'use strict';
/**
 * Research Mode: /research <topic> — searches the web (Tavily or Serper),
 * then synthesizes a structured, honest report with sources.
 * Never presents guesses as facts.
 */
const { cfg } = require('../config');
const { getProvider } = require('../ai/providers');
const store = require('../store');
const { withThinking, sendLong, escapeHtml, answerCb, editOrReply } = require('../tg/helpers');
const { menuKeyboard } = require('../tg/keyboards');
const { tracked } = require('../tg/middleware');

async function webSearch(query) {
  if (!cfg.searchApiKey) {
    throw Object.assign(new Error('Research needs a SEARCH_API_KEY (Tavily or Serper). The bot owner must set it in the environment.'), { category: 'validation' });
  }
  if (cfg.searchProvider === 'serper') {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': cfg.searchApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 8 }),
    });
    if (!res.ok) throw new Error(`Search API error (${res.status})`);
    const data = await res.json();
    return (data.organic || []).slice(0, 8).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet }));
  }
  // Tavily (default)
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: cfg.searchApiKey, query, search_depth: 'advanced', max_results: 8, include_answer: true }),
  });
  if (!res.ok) throw new Error(`Search API error (${res.status})`);
  const data = await res.json();
  return (data.results || []).slice(0, 8).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 400) }));
}

async function researchTopic(userId, topic) {
  const results = await tracked('research', userId, () => webSearch(topic), topic.slice(0, 80));
  if (!results.length) return '🔎 I could not find solid sources on that topic. Try rephrasing your query.';
  const sources = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet || ''}`).join('\n\n');
  const provider = getProvider();
  const report = await tracked('ai_chat', userId, () => provider.generateText({
    system:
      'You are Nexora Researcher. Write a structured research report from the search results below. ' +
      'Rules: use ONLY what the sources support; distinguish confirmed facts from uncertain claims; ' +
      'explicitly flag conflicting information between sources; never invent facts; ' +
      'cite sources as [1], [2] etc. Structure: TL;DR (3 bullets), Key findings (bullets), ' +
      'Conflicts / uncertainties, Bottom line. Keep it phone-readable.',
    messages: [{ role: 'user', content: `Topic: ${topic}\n\nSearch results:\n${sources.slice(0, 9000)}` }],
    maxTokens: 3000,
  }), 'research_synthesis');
  const refs = results.map((r, i) => `[${i + 1}] <a href="${r.url}">${escapeHtml(r.title.slice(0, 70))}</a>`).join('\n');
  return `${report}\n\n<b>Sources</b>\n${refs}`;
}

function register(bot) {
  bot.command('research', async (ctx) => {
    const topic = (ctx.message.text || '').replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
    if (!topic) return ctx.reply('🔎 What should I research? e.g.\n<code>/research Best free databases for a Next.js app</code>', { parse_mode: 'HTML' });
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'research', success: true });
    await withThinking(ctx, () => researchTopic(ctx.from.id, topic));
  });

  bot.action('res:new', async (ctx) => {
    await answerCb(ctx);
    await editOrReply(ctx, '🔎 <b>Research</b>\n\nType <code>/research &lt;topic&gt;</code> — or just type “research …”.\n\nI search multiple sources, compare them, flag conflicts, and give you a structured report with references.', { parse_mode: 'HTML', ...menuKeyboard('research') });
  });
  bot.action('res:tips', async (ctx) => {
    await answerCb(ctx);
    await editOrReply(ctx, '💡 <b>Research tips</b>\n\n• Be specific: <i>“cheapest VPS for Node.js in 2026”</i> beats <i>“hosting”</i>\n• Ask me to compare: <i>“research Supabase vs Firebase for auth”</i>\n• I will tell you when sources disagree — and when I am unsure.', menuKeyboard('research'));
  });
}

module.exports = { register, researchTopic };
