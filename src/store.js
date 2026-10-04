'use strict';
/**
 * Supabase data-access layer. Every query is scoped to a single user —
 * callers always pass the Telegram user id, so one user's private data
 * can never leak to another. Uses the service-role key server-side only.
 */
const { createClient } = require('@supabase/supabase-js');
const { cfg } = require('./config');

let client = null;
function supa() {
  if (!client) {
    if (!cfg.supabaseUrl || !cfg.supabaseKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set.');
    client = createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false } });
  }
  return client;
}

function must(rows, op) {
  if (rows && rows.error) { const e = new Error(`db:${op}: ${rows.error.message}`); e.category = 'database'; throw e; }
  return rows;
}

/* ── users ────────────────────────────────────────────────── */
async function upsertUser({ id, username, firstName, isAdmin }) {
  const now = new Date().toISOString();
  const base = { telegram_id: id, last_seen_at: now };
  if (username !== undefined) base.username = username || null;
  if (firstName !== undefined) base.first_name = firstName || null;
  if (isAdmin) base.is_admin = true;
  const r = must(await supa().from('nx_users').upsert(base, { onConflict: 'telegram_id' }).select().single(), 'upsertUser');
  return r.data;
}
async function getUser(id) {
  const r = must(await supa().from('nx_users').select('*').eq('telegram_id', id).maybeSingle(), 'getUser');
  return r.data;
}
async function updateUserState(id, patch) {
  const u = await getUser(id);
  const state = { ...(u?.state || {}), ...patch };
  must(await supa().from('nx_users').update({ state, last_seen_at: new Date().toISOString() }).eq('telegram_id', id), 'updateUserState');
  return state;
}
async function updateUserPrefs(id, patch) {
  const u = await getUser(id);
  const prefs = { ...(u?.prefs || {}), ...patch };
  must(await supa().from('nx_users').update({ prefs }).eq('telegram_id', id), 'updateUserPrefs');
  return prefs;
}
async function countUsers(since) {
  let q = supa().from('nx_users').select('telegram_id', { count: 'exact', head: true });
  if (since) q = q.gte('last_seen_at', since);
  const r = must(await q, 'countUsers');
  return r.count || 0;
}
async function recentUsers(limit = 10) {
  const r = must(await supa().from('nx_users').select('telegram_id,username,first_name,last_seen_at,created_at').order('last_seen_at', { ascending: false }).limit(limit), 'recentUsers');
  return r.data || [];
}
async function allUserIds() {
  const r = must(await supa().from('nx_users').select('telegram_id'), 'allUserIds');
  return (r.data || []).map((x) => x.telegram_id);
}

/* ── conversations & messages ─────────────────────────────── */
async function getActiveConversation(userId) {
  const r = must(await supa().from('nx_conversations').select('*').eq('user_id', userId).eq('active', true).order('updated_at', { ascending: false }).limit(1).maybeSingle(), 'getActiveConversation');
  if (r.data) return r.data;
  const c = must(await supa().from('nx_conversations').insert({ user_id: userId, title: 'Chat' }).select().single(), 'createConversation');
  return c.data;
}
async function newConversation(userId, persona = 'default') {
  must(await supa().from('nx_conversations').update({ active: false }).eq('user_id', userId).eq('active', true), 'deactivateConversations');
  const c = must(await supa().from('nx_conversations').insert({ user_id: userId, title: 'Chat', persona }).select().single(), 'newConversation');
  return c.data;
}
async function addMessage(conversationId, role, content) {
  must(await supa().from('nx_messages').insert({ conversation_id: conversationId, role, content: String(content).slice(0, 12000) }), 'addMessage');
  must(await supa().from('nx_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId), 'touchConversation');
}
async function getHistory(conversationId, limit = 20) {
  const r = must(await supa().from('nx_messages').select('role,content').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(limit), 'getHistory');
  return (r.data || []).reverse();
}

/* ── memories ─────────────────────────────────────────────── */
async function addMemory(userId, content) {
  const r = must(await supa().from('nx_memories').insert({ user_id: userId, content: content.slice(0, 2000) }).select().single(), 'addMemory');
  return r.data;
}
async function listMemories(userId, limit = 50) {
  const r = must(await supa().from('nx_memories').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit), 'listMemories');
  return r.data || [];
}
async function memoryContext(userId, limit = 20) {
  const mems = await listMemories(userId, limit);
  return mems.reverse().map((m) => `- ${m.content}`).join('\n');
}
async function forgetMemory(userId, query) {
  const mems = await listMemories(userId, 100);
  const q = query.toLowerCase();
  const hits = mems.filter((m) => m.content.toLowerCase().includes(q));
  for (const h of hits) must(await supa().from('nx_memories').delete().eq('id', h.id).eq('user_id', userId), 'forgetMemory');
  return hits.length;
}
async function clearMemories(userId) {
  must(await supa().from('nx_memories').delete().eq('user_id', userId), 'clearMemories');
}

/* ── documents ────────────────────────────────────────────── */
async function saveDocument(userId, { fileName, mime, sizeBytes, textContent }) {
  const r = must(await supa().from('nx_documents').insert({
    user_id: userId, file_name: fileName, mime, size_bytes: sizeBytes,
    text_content: (textContent || '').slice(0, 120000),
  }).select().single(), 'saveDocument');
  return r.data;
}
async function getDocument(userId, id) {
  const r = must(await supa().from('nx_documents').select('*').eq('id', id).eq('user_id', userId).maybeSingle(), 'getDocument');
  return r.data;
}
async function listDocuments(userId, limit = 10) {
  const r = must(await supa().from('nx_documents').select('id,file_name,mime,size_bytes,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit), 'listDocuments');
  return r.data || [];
}
async function setDocumentSummary(userId, id, summary) {
  must(await supa().from('nx_documents').update({ summary }).eq('id', id).eq('user_id', userId), 'setDocumentSummary');
}

/* ── quizzes ──────────────────────────────────────────────── */
async function saveQuiz(userId, { subject, topic, questionCount, questions }) {
  const r = must(await supa().from('nx_quizzes').insert({ user_id: userId, subject, topic, question_count: questionCount, questions }).select().single(), 'saveQuiz');
  return r.data;
}
async function startAttempt(userId, quizId, timeLimitSec) {
  const id = require('./utils').shortId();
  const quiz = must(await supa().from('nx_quizzes').select('questions').eq('id', quizId).eq('user_id', userId).single(), 'getQuiz').data;
  const r = must(await supa().from('nx_quiz_attempts').insert({
    id, quiz_id: quizId, user_id: userId, time_limit_sec: timeLimitSec || null, total: quiz.questions.length,
  }).select().single(), 'startAttempt');
  return r.data;
}
async function getAttempt(userId, attemptId) {
  const r = must(await supa().from('nx_quiz_attempts').select('*, nx_quizzes(subject,topic,questions)').eq('id', attemptId).eq('user_id', userId).maybeSingle(), 'getAttempt');
  return r.data;
}
async function updateAttempt(userId, attemptId, patch) {
  must(await supa().from('nx_quiz_attempts').update(patch).eq('id', attemptId).eq('user_id', userId), 'updateAttempt');
}
async function finishAttempt(userId, attemptId, score, total) {
  must(await supa().from('nx_quiz_attempts').update({ status: 'finished', score, total, finished_at: new Date().toISOString() }).eq('id', attemptId).eq('user_id', userId), 'finishAttempt');
}
async function recentAttempts(userId, limit = 10) {
  const r = must(await supa().from('nx_quiz_attempts').select('*, nx_quizzes(subject,topic)').eq('user_id', userId).eq('status', 'finished').order('finished_at', { ascending: false }).limit(limit), 'recentAttempts');
  return r.data || [];
}
async function weakTopics(userId, limit = 8) {
  const attempts = await recentAttempts(userId, 15);
  const miss = {};
  for (const a of attempts) {
    const topic = a.nx_quizzes?.topic || a.nx_quizzes?.subject || 'general';
    const answers = a.answers || [];
    const wrong = answers.filter((x) => !x.correct).length;
    if (wrong > 0) miss[topic] = (miss[topic] || 0) + wrong;
  }
  return Object.entries(miss).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([topic, wrong]) => ({ topic, wrong }));
}

/* ── flashcards ───────────────────────────────────────────── */
async function saveFlashcards(userId, topic, cards) {
  const id = require('./utils').shortId();
  const r = must(await supa().from('nx_flashcards').insert({ id, user_id: userId, topic, cards }).select().single(), 'saveFlashcards');
  return r.data;
}
async function getFlashcards(userId, id) {
  const r = must(await supa().from('nx_flashcards').select('*').eq('id', id).eq('user_id', userId).maybeSingle(), 'getFlashcards');
  return r.data;
}

/* ── productivity ─────────────────────────────────────────── */
async function addTask(userId, { title, priority = 'medium', dueAt = null }) {
  const r = must(await supa().from('nx_tasks').insert({ user_id: userId, title: title.slice(0, 500), priority, due_at: dueAt }).select().single(), 'addTask');
  return r.data;
}
async function listTasks(userId, includeDone = false) {
  let q = supa().from('nx_tasks').select('*').eq('user_id', userId);
  if (!includeDone) q = q.eq('done', false);
  const r = must(await q.order('created_at', { ascending: false }).limit(30), 'listTasks');
  return r.data || [];
}
async function completeTask(userId, id) {
  must(await supa().from('nx_tasks').update({ done: true, done_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId), 'completeTask');
}
async function deleteTask(userId, id) {
  must(await supa().from('nx_tasks').delete().eq('id', id).eq('user_id', userId), 'deleteTask');
}
async function addNote(userId, { title = null, body, tags = [] }) {
  const r = must(await supa().from('nx_notes').insert({ user_id: userId, title, body: body.slice(0, 10000), tags }).select().single(), 'addNote');
  return r.data;
}
async function listNotes(userId, limit = 10) {
  const r = must(await supa().from('nx_notes').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(limit), 'listNotes');
  return r.data || [];
}
async function searchNotes(userId, q) {
  const r = must(await supa().from('nx_notes').select('*').eq('user_id', userId).ilike('body', `%${q.slice(0, 60)}%`).order('updated_at', { ascending: false }).limit(10), 'searchNotes');
  return r.data || [];
}
async function addReminder(userId, { text, dueAt, repeat = null }) {
  const r = must(await supa().from('nx_reminders').insert({ user_id: userId, text: text.slice(0, 500), due_at: dueAt, repeat }).select().single(), 'addReminder');
  return r.data;
}
async function listReminders(userId) {
  const r = must(await supa().from('nx_reminders').select('*').eq('user_id', userId).eq('sent', false).order('due_at').limit(20), 'listReminders');
  return r.data || [];
}
async function cancelReminder(userId, id) {
  must(await supa().from('nx_reminders').delete().eq('id', id).eq('user_id', userId), 'cancelReminder');
}
async function dueReminders(limit = 50) {
  const r = must(await supa().from('nx_reminders').select('*').eq('sent', false).lte('due_at', new Date().toISOString()).order('due_at').limit(limit), 'dueReminders');
  return r.data || [];
}
async function markReminderSent(id, repeat) {
  if (repeat === 'daily' || repeat === 'weekly') {
    const days = repeat === 'daily' ? 1 : 7;
    const r = must(await supa().from('nx_reminders').select('due_at').eq('id', id).single(), 'getReminderDue');
    const next = new Date(new Date(r.data.due_at).getTime() + days * 864e5).toISOString();
    must(await supa().from('nx_reminders').update({ due_at: next }).eq('id', id), 'rescheduleReminder');
  } else {
    must(await supa().from('nx_reminders').update({ sent: true }).eq('id', id), 'markReminderSent');
  }
}
async function addGoal(userId, { title, target = null }) {
  const r = must(await supa().from('nx_goals').insert({ user_id: userId, title: title.slice(0, 300), target }).select().single(), 'addGoal');
  return r.data;
}
async function listGoals(userId) {
  const r = must(await supa().from('nx_goals').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20), 'listGoals');
  return r.data || [];
}
async function setGoalProgress(userId, id, progress) {
  must(await supa().from('nx_goals').update({ progress, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId), 'setGoalProgress');
}
async function checkinHabit(userId, name) {
  const today = new Date().toISOString().slice(0, 10);
  const ex = must(await supa().from('nx_habits').select('*').eq('user_id', userId).eq('name', name).maybeSingle(), 'getHabit');
  if (!ex.data) {
    const r = must(await supa().from('nx_habits').insert({ user_id: userId, name, streak: 1, last_done: today }).select().single(), 'createHabit');
    return r.data;
  }
  if (ex.data.last_done === today) return ex.data;
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const streak = ex.data.last_done === yesterday ? ex.data.streak + 1 : 1;
  const r = must(await supa().from('nx_habits').update({ streak, last_done: today }).eq('id', ex.data.id).select().single(), 'updateHabit');
  return r.data;
}
async function listHabits(userId) {
  const r = must(await supa().from('nx_habits').select('*').eq('user_id', userId).order('streak', { ascending: false }).limit(20), 'listHabits');
  return r.data || [];
}

/* ── observability ────────────────────────────────────────── */
async function logUsage({ userId = null, kind, detail = null, tokens = null, ms = null, success = true, errorCategory = null }) {
  try {
    await supa().from('nx_usage').insert({ user_id: userId, kind, detail: detail ? String(detail).slice(0, 300) : null, tokens, ms, success, error_category: errorCategory });
  } catch { /* usage logging must never break the bot */ }
}
async function logAdmin(adminId, action, detail = null) {
  try { await supa().from('nx_admin_logs').insert({ admin_id: adminId, action, detail: detail ? String(detail).slice(0, 500) : null }); } catch { /* no-op */ }
}
async function usageStats(sinceHours = 24) {
  const since = new Date(Date.now() - sinceHours * 36e5).toISOString();
  const kinds = ['ai_chat', 'ai_structured', 'ai_vision', 'ai_audio', 'research', 'quiz', 'command'];
  const out = {};
  for (const k of kinds) {
    const r = await supa().from('nx_usage').select('id', { count: 'exact', head: true }).eq('kind', k).gte('created_at', since);
    out[k] = r.count || 0;
  }
  const err = await supa().from('nx_usage').select('id', { count: 'exact', head: true }).eq('success', false).gte('created_at', since);
  out.errors = err.count || 0;
  return out;
}
async function recentErrors(limit = 10) {
  const r = must(await supa().from('nx_usage').select('kind,detail,error_category,created_at,user_id').eq('success', false).order('created_at', { ascending: false }).limit(limit), 'recentErrors');
  return r.data || [];
}
async function commandStats(sinceHours = 24) {
  const since = new Date(Date.now() - sinceHours * 36e5).toISOString();
  const r = must(await supa().from('nx_usage').select('detail').eq('kind', 'command').gte('created_at', since).limit(2000), 'commandStats');
  const counts = {};
  for (const row of r.data || []) counts[row.detail || '?'] = (counts[row.detail || '?'] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
}

module.exports = {
  supa,
  upsertUser, getUser, updateUserState, updateUserPrefs, countUsers, recentUsers, allUserIds,
  getActiveConversation, newConversation, addMessage, getHistory,
  addMemory, listMemories, memoryContext, forgetMemory, clearMemories,
  saveDocument, getDocument, listDocuments, setDocumentSummary,
  saveQuiz, startAttempt, getAttempt, updateAttempt, finishAttempt, recentAttempts, weakTopics,
  saveFlashcards, getFlashcards,
  addTask, listTasks, completeTask, deleteTask,
  addNote, listNotes, searchNotes,
  addReminder, listReminders, cancelReminder, dueReminders, markReminderSent,
  addGoal, listGoals, setGoalProgress, checkinHabit, listHabits,
  logUsage, logAdmin, usageStats, recentErrors, commandStats,
};
