'use strict';
/**
 * Study Mode: interactive quizzes (inline buttons, score tracking),
 * flashcards, revision notes, results, weak topics, revision plans.
 * Quiz state lives in the DB so it survives serverless cold starts.
 */
const { Markup } = require('telegraf');
const { getProvider } = require('../ai/providers');
const store = require('../store');
const { withThinking, sendLong, editOrReply, answerCb, expired, escapeHtml } = require('../tg/helpers');
const { menuKeyboard, backMain } = require('../tg/keyboards');
const { tracked } = require('../tg/middleware');
const { parseQuizRequest, shortId } = require('../utils');

const QUIZ_SCHEMA_HINT = `{
  "questions": [
    { "q": "question text", "options": ["A","B","C","D"], "answer": 0, "explain": "why the answer is correct, 1-2 lines" }
  ]
}`;

async function generateQuiz(userId, { count, subject, topic }) {
  const provider = getProvider();
  const data = await tracked('ai_structured', userId, () => provider.generateStructured({
    system: 'You are an expert exam setter for WAEC/JAMB/GCE-style exams. Write clear, unambiguous multiple-choice questions.',
    prompt: `Create ${count} multiple-choice questions.\nSubject: ${subject}\nTopic: ${topic}\nDifficulty: realistic exam standard (not trivial). Each question has exactly 4 options, one correct answer (index 0-3), and a short explanation. Vary the correct answer positions.`,
    schemaHint: QUIZ_SCHEMA_HINT,
  }), 'quiz_generate');
  let questions = (data.questions || []).filter((q) => q && q.q && Array.isArray(q.options) && q.options.length === 4 && Number.isInteger(q.answer));
  questions = questions.slice(0, count).map((q) => ({ q: String(q.q).slice(0, 600), options: q.options.map((o) => String(o).slice(0, 200)), answer: Math.min(3, Math.max(0, q.answer)), explain: String(q.explain || '').slice(0, 400) }));
  if (!questions.length) throw new Error('The AI could not generate valid questions — please try again.');
  return questions;
}

function quizKeyboard(attemptId, qIndex, options) {
  const rows = options.map((opt, i) => [Markup.button.callback(`${['🇦', '🇧', '🇨', '🇩'][i]} ${opt.slice(0, 60)}`, `qz:a:${attemptId}:${qIndex}:${i}`)]);
  rows.push([Markup.button.callback('❌ End quiz', `qz:end:${attemptId}`)]);
  return Markup.inlineKeyboard(rows);
}

function questionText(quiz, attempt, idx) {
  const q = quiz.questions[idx];
  const total = quiz.questions.length;
  const minsLeft = attempt.time_limit_sec ? Math.max(0, Math.ceil((attempt.time_limit_sec - (Date.now() - new Date(attempt.started_at).getTime()) / 1000) / 60)) : null;
  return `❓ <b>Question ${idx + 1}/${total}</b>  <i>${escapeHtml(quiz.subject)} — ${escapeHtml(quiz.topic)}</i>${minsLeft !== null ? `\n⏱ ~${minsLeft} min left` : ''}\n\n<b>${escapeHtml(q.q)}</b>`;
}

async function sendQuestion(ctx, attemptId) {
  const attempt = await store.getAttempt(ctx.from.id, attemptId);
  if (!attempt || attempt.status !== 'in_progress') { await expired(ctx, 'This quiz is no longer active'); return; }
  const quiz = { subject: attempt.nx_quizzes.subject, topic: attempt.nx_quizzes.topic, questions: attempt.nx_quizzes.questions };
  const idx = attempt.current_index;
  if (idx >= quiz.questions.length) { await finishQuiz(ctx, attemptId); return; }
  // time limit check
  if (attempt.time_limit_sec) {
    const elapsed = (Date.now() - new Date(attempt.started_at).getTime()) / 1000;
    if (elapsed > attempt.time_limit_sec) { await finishQuiz(ctx, attemptId, true); return; }
  }
  const q = quiz.questions[idx];
  await editOrReply(ctx, questionText(quiz, attempt, idx), quizKeyboard(attemptId, idx, q.options));
}

async function finishQuiz(ctx, attemptId, timedOut = false) {
  const attempt = await store.getAttempt(ctx.from.id, attemptId);
  if (!attempt || attempt.status === 'finished') return;
  const quiz = attempt.nx_quizzes;
  const answers = attempt.answers || [];
  const score = answers.filter((a) => a.correct).length;
  const total = quiz.questions.length;
  await store.finishAttempt(ctx.from.id, attemptId, score, total);
  const pct = Math.round((score / total) * 100);
  const verdict = pct >= 80 ? '🏆 Excellent!' : pct >= 60 ? '👏 Good work!' : pct >= 40 ? '💪 Fair — keep pushing!' : '📚 More practice needed — I have got you.';
  let review = '';
  answers.forEach((a, i) => {
    if (!a.correct) {
      const q = quiz.questions[i];
      review += `\n\n❌ <b>Q${i + 1}:</b> ${escapeHtml(q.q.slice(0, 120))}\n✅ Correct: <b>${escapeHtml(q.options[q.answer])}</b>\n💡 ${escapeHtml(q.explain)}`;
    }
  });
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('🔁 Retake', `qz:retake:${attempt.quiz_id}`), Markup.button.callback('📊 My results', 'study:results')],
    [Markup.button.callback('⬅️ Back', 'menu:study'), Markup.button.callback('🏠 Main Menu', 'menu:home')],
  ]);
  await editOrReply(ctx,
    `${timedOut ? '⏱ <b>Time up!</b>\n\n' : ''}📊 <b>Quiz complete!</b>\n\n${verdict}\n<b>Score: ${score}/${total} (${pct}%)</b>\n<i>${escapeHtml(quiz.subject)} — ${escapeHtml(quiz.topic)}</i>` +
    (review ? `\n\n<b>Review your misses:</b>${review.slice(0, 2500)}` : '\n\n✨ Flawless — not a single miss!'),
    kb);
}

async function startQuizFlow(ctx, { count, subject, topic }) {
  const quiz = await withThinking(ctx, async () => {
    const questions = await generateQuiz(ctx.from.id, { count, subject, topic });
    const saved = await store.saveQuiz(ctx.from.id, { subject, topic, questionCount: questions.length, questions });
    const timeLimitSec = questions.length * 60; // 60s per question
    const attempt = await store.startAttempt(ctx.from.id, saved.id, timeLimitSec);
    store.logUsage({ userId: ctx.from.id, kind: 'quiz', detail: `${subject}/${topic}`, success: true });
    await store.updateUserState(ctx.from.id, { lastSection: 'study' });
    return { attemptId: attempt.id };
  });
  if (quiz && quiz.attemptId) await sendQuestion(ctx, quiz.attemptId);
}

async function startFlashcards(ctx, topic) {
  const deck = await withThinking(ctx, async () => {
    const provider = getProvider();
    const data = await tracked('ai_structured', ctx.from.id, () => provider.generateStructured({
      system: 'You are an expert tutor creating study flashcards.',
      prompt: `Create 10 flashcards on: ${topic}. Each card: a clear question/prompt on the front and a concise answer on the back.`,
      schemaHint: `{ "cards": [ { "front": "...", "back": "..." } ] }`,
    }), 'flashcards_generate');
    const cards = (data.cards || []).filter((c) => c.front && c.back).slice(0, 12)
      .map((c) => ({ front: String(c.front).slice(0, 400), back: String(c.back).slice(0, 600) }));
    if (!cards.length) throw new Error('Could not generate flashcards — try again.');
    return store.saveFlashcards(ctx.from.id, topic, cards);
  });
  if (deck) await sendFlashcard(ctx, deck.id, 0);
}

async function reviseTopic(ctx, topic) {
  let t = topic;
  if (!t) {
    const weak = await store.weakTopics(ctx.from.id, 3);
    t = weak.length ? weak.map((w) => w.topic).join(', ') : 'general knowledge';
  }
  const { chatReply } = require('./ai');
  await withThinking(ctx, () => chatReply(ctx.from.id,
    `Write concise WAEC/JAMB-standard revision notes on: ${t}. Structure: key definitions, must-know points as bullets, common exam traps, and 3 quick self-test questions (no answers). Keep it phone-readable.`));
}

function register(bot) {
  bot.command('quiz', async (ctx) => {
    const raw = (ctx.message.text || '').replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
    const parsed = parseQuizRequest(raw || 'general knowledge');
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'quiz', success: true });
    await startQuizFlow(ctx, parsed);
  });

  bot.command('flashcards', async (ctx) => {
    const topic = (ctx.message.text || '').replace(/^\/\w+(?:@\w+)?\s*/, '').trim() || 'general knowledge';
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'flashcards', success: true });
    await startFlashcards(ctx, topic);
  });

  bot.command('revise', async (ctx) => {
    const topic = (ctx.message.text || '').replace(/^\/\w+(?:@\w+)?\s*/, '').trim();
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'revise', success: true });
    await reviseTopic(ctx, topic);
  });

  bot.command('results', async (ctx) => {
    store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'results', success: true });
    const attempts = await store.recentAttempts(ctx.from.id, 10);
    if (!attempts.length) { await ctx.reply('📊 No quiz results yet — run /quiz to start your first one!'); return; }
    const lines = attempts.map((a) => {
      const pct = a.total ? Math.round((a.score / a.total) * 100) : 0;
      const when = new Date(a.finished_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return `• <b>${escapeHtml(a.nx_quizzes?.subject || '')}</b> — ${escapeHtml(a.nx_quizzes?.topic || '')}: <b>${a.score}/${a.total} (${pct}%)</b> <i>${when}</i>`;
    }).join('\n');
    const total = attempts.length;
    const avg = Math.round(attempts.reduce((s, a) => s + (a.total ? a.score / a.total : 0), 0) / total * 100);
    await sendLong(ctx, `📊 <b>Your quiz results</b>\n\n${lines}\n\n<b>Average: ${avg}%</b> across last ${total} quizzes.`, menuKeyboard('study'));
  });

  // ── menu shortcuts ──
  bot.action('study:quiz', async (ctx) => { await answerCb(ctx); await editOrReply(ctx, '❓ <b>New quiz</b>\n\nTell me what to quiz you on, e.g.:\n<i>“Create 20 WAEC Mathematics questions on statistics”</i>\n\nOr use <code>/quiz 10 physics on motion</code>', { parse_mode: 'HTML', ...menuKeyboard('study') }); });
  bot.action('study:flash', async (ctx) => { await answerCb(ctx); await editOrReply(ctx, '🃏 <b>Flashcards</b>\n\nTell me the topic, e.g. <i>“Flashcards on organic chemistry”</i>\nor <code>/flashcards photosynthesis</code>', { parse_mode: 'HTML', ...menuKeyboard('study') }); });
  bot.action('study:revise', async (ctx) => { await answerCb(ctx); await editOrReply(ctx, '📖 <b>Revise</b>\n\nType <i>“Revise me on …”</i> or <code>/revise &lt;topic&gt;</code>.\nLeave it blank and I will revise your weakest topics.', { parse_mode: 'HTML', ...menuKeyboard('study') }); });
  bot.action('study:results', async (ctx) => { await answerCb(ctx); await withThinking(ctx, async () => { const attempts = await store.recentAttempts(ctx.from.id, 10); if (!attempts.length) return '📊 No quiz results yet — run /quiz to start!'; const lines = attempts.map((a) => `• <b>${escapeHtml(a.nx_quizzes?.subject || '')}</b> — ${escapeHtml(a.nx_quizzes?.topic || '')}: <b>${a.score}/${a.total}</b>`).join('\n'); return `📊 <b>Your quiz results</b>\n\n${lines}`; }); });
  bot.action('study:weak', async (ctx) => {
    await answerCb(ctx);
    const weak = await store.weakTopics(ctx.from.id);
    if (!weak.length) { await editOrReply(ctx, '🎯 <b>Weak topics</b>\n\nNo weak spots detected yet — take a quiz first!', menuKeyboard('study')); return; }
    const rows = weak.map((w) => [Markup.button.callback(`📖 Revise: ${w.topic.slice(0, 30)}`, `study:revise:${shortId()}`)]);
    await store.updateUserState(ctx.from.id, { weakTopics: weak.map((w) => w.topic) });
    const kb = Markup.inlineKeyboard([...rows.slice(0, 6), [Markup.button.callback('⬅️ Back', 'menu:study'), Markup.button.callback('🏠 Main Menu', 'menu:home')]]);
    await editOrReply(ctx, '🎯 <b>Your weak topics</b> (most-missed first):\n\n' + weak.map((w, i) => `${i + 1}. <b>${escapeHtml(w.topic)}</b> — ${w.wrong} miss${w.wrong === 1 ? '' : 'es'}`).join('\n') + '\n\nTap to revise any of them.', kb);
  });
  bot.action(/^study:revise:([a-f0-9]+)$/, async (ctx) => {
    await answerCb(ctx);
    const st = (await store.getUser(ctx.from.id))?.state || {};
    const topics = st.weakTopics || [];
    const topic = topics[0] || 'general';
    await withThinking(ctx, async () => {
      const { chatReply } = require('./ai');
      return chatReply(ctx.from.id, `Write concise WAEC/JAMB-standard revision notes on: ${topic}. Key definitions, must-know bullets, exam traps, 3 self-test questions.`);
    });
  });
  bot.action('study:plan', async (ctx) => {
    await answerCb(ctx);
    await withThinking(ctx, async () => {
      const weak = await store.weakTopics(ctx.from.id, 5);
      const { chatReply } = require('./ai');
      const focus = weak.length ? weak.map((w) => w.topic).join(', ') : 'balanced coverage';
      return chatReply(ctx.from.id, `Create a focused 7-day revision plan. Weak areas to prioritize: ${focus}. Give each day a theme, 2-3 concrete tasks, and one rest day. Phone-readable, motivating.`);
    });
  });

  // ── quiz answer callbacks ──
  bot.action(/^qz:a:([a-f0-9]+):(\d+):(\d)$/, async (ctx) => {
    const [, attemptId, qIdxStr, optStr] = ctx.match;
    const qIdx = parseInt(qIdxStr, 10); const opt = parseInt(optStr, 10);
    const attempt = await store.getAttempt(ctx.from.id, attemptId);
    if (!attempt || attempt.status !== 'in_progress') { await expired(ctx, 'This quiz has ended'); return; }
    if (qIdx !== attempt.current_index) { await answerCb(ctx, 'You already answered that one 🙂'); return; }
    const quiz = attempt.nx_quizzes;
    const q = quiz.questions[qIdx];
    const correct = opt === q.answer;
    const answers = [...(attempt.answers || []), { q: qIdx, picked: opt, correct }];
    await store.updateAttempt(ctx.from.id, attemptId, { answers, current_index: qIdx + 1 });
    await answerCb(ctx, correct ? '✅ Correct!' : `❌ Not quite — answer: ${['A', 'B', 'C', 'D'][q.answer]}`);
    // brief feedback then next question
    const fb = correct ? '✅ <b>Correct!</b>' : `❌ <b>Not quite.</b> The answer is <b>${['A', 'B', 'C', 'D'][q.answer]} — ${escapeHtml(q.options[q.answer])}</b>\n💡 ${escapeHtml(q.explain)}`;
    try { await ctx.editMessageText(fb + '\n\n<i>Next question loading…</i>', { parse_mode: 'HTML' }); } catch { /* */ }
    setTimeout(async () => {
      try {
        const fresh = await store.getAttempt(ctx.from.id, attemptId);
        if (!fresh || fresh.status !== 'in_progress') return;
        // use a synthetic ctx-like for sendQuestion — reuse edit path via callback ctx
        await sendQuestion(ctx, attemptId);
      } catch { /* */ }
    }, 1400);
  });

  bot.action(/^qz:end:([a-f0-9]+)$/, async (ctx) => {
    await answerCb(ctx, 'Quiz ended');
    await finishQuiz(ctx, ctx.match[1]);
  });

  bot.action(/^qz:retake:([a-f0-9-]+)$/, async (ctx) => {
    await answerCb(ctx);
    const quizId = ctx.match[1];
    const attempt = await store.startAttempt(ctx.from.id, quizId, 60 * 10);
    await sendQuestion(ctx, attempt.id);
  });

  // ── flashcard callbacks ──
  bot.action(/^fc:(show|next|prev):([a-f0-9]+):(\d+)$/, async (ctx) => {
    const [, dir, deckId, iStr] = ctx.match;
    const i = parseInt(iStr, 10);
    const deck = await store.getFlashcards(ctx.from.id, deckId);
    if (!deck) { await expired(ctx, 'These flashcards expired'); return; }
    await answerCb(ctx);
    const idx = dir === 'next' ? Math.min(deck.cards.length - 1, i + 1) : dir === 'prev' ? Math.max(0, i - 1) : i;
    await sendFlashcard(ctx, deckId, idx, dir === 'show');
  });
}

async function sendFlashcard(ctx, deckId, idx, showBack = false) {
  const deck = await store.getFlashcards(ctx.from.id, deckId);
  if (!deck) { await expired(ctx, 'These flashcards expired'); return; }
  const card = deck.cards[idx];
  const kb = Markup.inlineKeyboard([
    showBack
      ? [Markup.button.callback('➡️ Next', `fc:next:${deckId}:${idx}`)]
      : [Markup.button.callback('👁 Show answer', `fc:show:${deckId}:${idx}`)],
    [Markup.button.callback('⬅️ Prev', `fc:prev:${deckId}:${idx}`), Markup.button.callback('➡️ Next', `fc:next:${deckId}:${idx}`)],
    [Markup.button.callback('❌ Done', 'menu:study')],
  ]);
  await editOrReply(ctx,
    `🃏 <b>Flashcards:</b> ${escapeHtml(deck.topic)} <i>(${idx + 1}/${deck.cards.length})</i>\n\n<b>Q:</b> ${escapeHtml(card.front)}` +
    (showBack ? `\n\n<b>A:</b> ${escapeHtml(card.back)}` : ''),
    kb);
}

module.exports = { register, startQuizFlow, startFlashcards, reviseTopic };
