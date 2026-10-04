'use strict';
/**
 * Document Intelligence: parse PDF / DOCX / TXT / CSV / code / images-as-docs,
 * store extracted text, then summarize / quiz / Q&A / key-points / notes.
 */
const { Markup } = require('telegraf');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { cfg } = require('../config');
const store = require('../store');
const { getProvider } = require('../ai/providers');
const { withThinking, sendLong, editOrReply, answerCb, expired, escapeHtml } = require('../tg/helpers');
const { menuKeyboard } = require('../tg/keyboards');
const { tracked } = require('../tg/middleware');

const TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'php', 'rb', 'sql', 'html', 'css', 'xml', 'yml', 'yaml', 'env', 'log', 'srt'];

async function extractText(buffer, fileName, mime) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') {
    const data = await pdfParse(buffer);
    return (data.text || '').replace(/\s+\n/g, '\n').trim();
  }
  if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const { value } = await mammoth.extractRawText({ buffer });
    return (value || '').trim();
  }
  if (TEXT_EXTS.includes(ext) || (mime || '').startsWith('text/')) {
    return buffer.toString('utf-8').replace(/\0/g, '').trim();
  }
  throw Object.assign(new Error(`I can't read .${ext || '?'} files yet. Send PDF, DOCX, TXT, CSV, code files or an image.`), { category: 'validation' });
}

async function downloadTelegramFile(ctx, fileId, maxMb) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok) throw new Error('Could not download that file from Telegram.');
  const len = parseInt(res.headers.get('content-length') || '0', 10);
  if (len && len > maxMb * 1024 * 1024) throw Object.assign(new Error(`That file is too big (limit ${maxMb}MB).`), { category: 'validation' });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxMb * 1024 * 1024) throw Object.assign(new Error(`That file is too big (limit ${maxMb}MB).`), { category: 'validation' });
  return buf;
}

function docActions(docId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📝 Summarize', `doc:sum:${docId}`), Markup.button.callback('⭐ Key points', `doc:key:${docId}`)],
    [Markup.button.callback('❓ Quiz me', `doc:quiz:${docId}`), Markup.button.callback('🗒 Notes', `doc:notes:${docId}`)],
    [Markup.button.callback('⬅️ Back', 'menu:docs'), Markup.button.callback('🏠 Main Menu', 'menu:home')],
  ]);
}

/** Handle an uploaded document: parse, store, offer actions. Returns doc or null. */
async function handleDocument(ctx) {
  const doc = ctx.message.document;
  const fileName = doc.file_name || 'document';
  const buf = await downloadTelegramFile(ctx, doc.file_id, cfg.maxDocMb);
  const text = await withThinking(ctx, async () => {
    const t = await extractText(buf, fileName, doc.mime_type);
    if (!t || t.length < 20) throw Object.assign(new Error('I could not extract any readable text from that file.'), { category: 'validation' });
    return t;
  });
  if (!text) return null;
  const saved = await store.saveDocument(ctx.from.id, { fileName, mime: doc.mime_type, sizeBytes: buf.length, textContent: text });
  await store.updateUserState(ctx.from.id, { activeDocId: saved.id, lastSection: 'docs' });
  store.logUsage({ userId: ctx.from.id, kind: 'command', detail: 'doc_upload', success: true });
  const preview = text.slice(0, 400).replace(/\n{3,}/g, '\n\n');
  await sendLong(ctx,
    `📄 <b>${escapeHtml(fileName)}</b> received — ${text.length.toLocaleString()} characters read.\n\n<i>${escapeHtml(preview)}…</i>\n\nWhat should I do with it? Just ask in plain words, e.g. <i>“give me the 5 most important topics”</i>:`,
    docActions(saved.id));
  return saved;
}

async function askAboutDoc(ctx, docId, question) {
  const doc = await store.getDocument(ctx.from.id, docId);
  if (!doc) { await expired(ctx, 'That document is no longer available'); return ''; }
  const provider = getProvider();
  return tracked('ai_chat', ctx.from.id, () => provider.analyzeDocument({
    system: 'You answer questions about the document below. Base every claim on the document text. If the answer is not in the document, say so plainly. Keep answers phone-readable.',
    prompt: `Question: ${question}`,
    text: doc.text_content.slice(0, 30000),
  }), 'doc_qa');
}

function register(bot) {
  bot.action(/^doc:(sum|key|quiz|notes):([a-f0-9-]+)$/, async (ctx) => {
    const [, action, docId] = ctx.match;
    await answerCb(ctx, 'Working on your document…');
    const doc = await store.getDocument(ctx.from.id, docId);
    if (!doc) { await expired(ctx, 'That document is no longer available'); return; }
    const provider = getProvider();
    if (action === 'quiz') {
      const questions = await withThinking(ctx, async () => {
        const data = await tracked('ai_structured', ctx.from.id, () => provider.generateStructured({
          system: 'You are an expert exam setter. Base every question strictly on the document text.',
          prompt: `Create 10 multiple-choice questions from this document.\n\n<document>\n${doc.text_content.slice(0, 15000)}\n</document>`,
          schemaHint: `{ "questions": [ { "q": "...", "options": ["A","B","C","D"], "answer": 0, "explain": "..." } ] }`,
        }), 'doc_quiz');
        const qs = (data.questions || []).filter((q) => q.q && Array.isArray(q.options) && q.options.length === 4).slice(0, 10)
          .map((q) => ({ q: String(q.q).slice(0, 600), options: q.options.map((o) => String(o).slice(0, 200)), answer: Math.min(3, Math.max(0, q.answer | 0)), explain: String(q.explain || '').slice(0, 400) }));
        if (!qs.length) throw new Error('Could not generate questions from this document.');
        return qs;
      });
      if (questions && questions.length) {
        const saved = await store.saveQuiz(ctx.from.id, { subject: 'Document', topic: doc.file_name.slice(0, 60), questionCount: questions.length, questions });
        const attempt = await store.startAttempt(ctx.from.id, saved.id, questions.length * 60);
        const q = questions[0];
        const rows = q.options.map((opt, i) => [Markup.button.callback(`${['🇦', '🇧', '🇨', '🇩'][i]} ${opt.slice(0, 60)}`, `qz:a:${attempt.id}:0:${i}`)]);
        rows.push([Markup.button.callback('❌ End quiz', `qz:end:${attempt.id}`)]);
        await sendLong(ctx, `❓ <b>Quiz ready</b> — ${questions.length} questions from <b>${escapeHtml(doc.file_name)}</b>.\n\n<b>Q1:</b> ${escapeHtml(q.q)}`, Markup.inlineKeyboard(rows));
      }
      return;
    }
    const prompts = {
      sum: 'Summarize this document clearly. Start with a 3-line TL;DR, then key sections as short bullets. Phone-readable.',
      key: 'List the 5-7 most important topics/ideas in this document as a numbered list, each with a one-line explanation of why it matters.',
      notes: 'Convert this document into clean study notes: headings, bullet points, key terms bolded, and a 5-line recap at the end.',
    };
    await withThinking(ctx, async () => {
      const out = await tracked('ai_chat', ctx.from.id, () => provider.analyzeDocument({
        system: 'You analyze documents precisely and concisely.',
        prompt: prompts[action],
        text: doc.text_content.slice(0, 30000),
      }), 'doc_' + action);
      await sendLong(ctx, out, docActions(docId));
      return '';
    });
  });

  bot.action('docs:upload', async (ctx) => {
    await answerCb(ctx);
    await editOrReply(ctx, '📤 <b>Upload a document</b>\n\nSend me a PDF, DOCX, TXT, CSV, code file or image — I will read it, then you can summarize it, quiz yourself on it, or ask questions.', menuKeyboard('docs'));
  });
  bot.action('docs:list', async (ctx) => {
    await answerCb(ctx);
    const docs = await store.listDocuments(ctx.from.id, 10);
    if (!docs.length) { await editOrReply(ctx, '📚 No documents yet — upload one and I will read it.', menuKeyboard('docs')); return; }
    const rows = docs.map((d) => [Markup.button.callback(`📄 ${d.file_name.slice(0, 40)}`, `docs:open:${d.id}`)]);
    rows.push([Markup.button.callback('⬅️ Back', 'menu:docs'), Markup.button.callback('🏠 Main Menu', 'menu:home')]);
    await editOrReply(ctx, '📚 <b>Your documents</b> — tap one to work with it:', Markup.inlineKeyboard(rows));
  });
  bot.action(/^docs:open:([a-f0-9-]+)$/, async (ctx) => {
    await answerCb(ctx);
    const doc = await store.getDocument(ctx.from.id, ctx.match[1]);
    if (!doc) { await expired(ctx, 'Document not found'); return; }
    await store.updateUserState(ctx.from.id, { activeDocId: doc.id });
    await editOrReply(ctx, `📄 <b>${escapeHtml(doc.file_name)}</b>\n<i>${(doc.text_content || '').length.toLocaleString()} characters</i>\n\nAsk me anything about it in plain words:`, docActions(doc.id));
  });
  bot.action('docs:ask', async (ctx) => {
    await answerCb(ctx);
    await editOrReply(ctx, '❓ <b>Ask about a document</b>\n\nUpload a document first (or pick one from 📚 My documents), then just ask your question naturally — e.g. <i>“what are the five most important topics?”</i>', menuKeyboard('docs'));
  });
}

module.exports = { register, handleDocument, askAboutDoc, downloadTelegramFile, extractText };
