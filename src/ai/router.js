'use strict';
/**
 * Personalized command router — detects what the user needs from a plain
 * message so they don't have to memorize commands. Heuristic-first (fast,
 * no AI call); ambiguous input falls through to normal chat.
 *
 * Returns { intent, params } where intent is one of:
 * chat | ask | summarize | explain | translate | brainstorm |
 * remember | memory_list | forget |
 * quiz | flashcards | revise | results | study_plan |
 * code | debug | review | explain_code |
 * research | doc_ask |
 * todo_add | todo_list | note_add | note_list | remind | plan | goals |
 * caption | prompt_gen | ideas | brand |
 * tool_calc | tool_convert | tool_currency
 */
const { parseQuizRequest, parseReminder } = require('../utils');

const CODE_HINT = /```|function\s+\w+\s*\(|const\s+\w+\s*=|import\s+.*from|def\s+\w+\s*\(|class\s+\w+|<\/?[a-z][^>]*>|;.*\{|Traceback|SyntaxError|TypeError|NullPointer|undefined is not|npm\s|pip\s|git\s/i;

function route(rawText) {
  const text = String(rawText || '').trim();
  const low = text.toLowerCase();
  if (!text) return { intent: 'chat', params: {} };

  // ── memory ──
  let m = text.match(/^(please\s+)?remember\s+(that\s+)?(.+)$/i);
  if (m) return { intent: 'remember', params: { content: m[3].trim() } };
  if (/^(what do you remember|show (me )?my memor|list (my )?memor)/i.test(low)) return { intent: 'memory_list', params: {} };
  m = text.match(/^(please\s+)?forget\s+(that\s+)?(.+)$/i);
  if (m) return { intent: 'forget', params: { content: m[3].trim() } };

  // ── productivity ──
  if (/^(please\s+)?remind\s+me\b/i.test(low) || /\bremind\s+me\b/i.test(low)) {
    const parsed = parseReminder(text);
    if (parsed) return { intent: 'remind', params: parsed };
    return { intent: 'remind', params: { needsClarify: true, raw: text } };
  }
  let tm = text.match(/^add\s+(.+?)\s+to\s+my\s+(to-?dos?|tasks?)\b/i);
  if (tm) return { intent: 'todo_add', params: { title: tm[1].trim() } };
  tm = text.match(/^(?:please\s+)?(?:add\s+|create\s+)?(to-?do|task)\s*:?\s*(.+)?$/i);
  if (tm && (tm[2] || '').trim()) return { intent: 'todo_add', params: { title: tm[2].trim() } };
  if (/^(show|list|my)\s+(to-?dos?|tasks?)\b/i.test(low) || low === 'todos' || low === 'tasks' || low === 'todo') return { intent: 'todo_list', params: {} };
  m = text.match(/^(note|jot (this )?down|save (this )?note)\s*:?\s*(.+)$/i);
  if (m) return { intent: 'note_add', params: { body: m[4].trim() } };
  if (/^(show|list|my)\s+notes?/i.test(low)) return { intent: 'note_list', params: {} };
  if (/\b(plan my day|daily plan|today'?s plan)\b/i.test(low)) return { intent: 'plan', params: {} };
  if (/\b(my )?goals?\b/i.test(low) && /^(show|list|my|track)/i.test(low)) return { intent: 'goals', params: {} };

  // ── study ──
  if (/\b(\d+\s*)?(questions?|mcqs?)\b/i.test(low) && /(create|generate|make|give|quiz|test me|practice)/i.test(low)) {
    return { intent: 'quiz', params: parseQuizRequest(text) };
  }
  if (/\bquiz\s+me\b/i.test(low) || /^(start\s+)?quiz\b/i.test(low)) {
    return { intent: 'quiz', params: parseQuizRequest(text) };
  }
  if (/\bflashcards?\b/i.test(low)) {
    const topic = text.replace(/^(please\s+)?(create|generate|make|give\s+me)\s+/i, '').replace(/\bflashcards?\b\s*(on|about|for)?\s*/i, '').trim();
    return { intent: 'flashcards', params: { topic: topic || 'general' } };
  }
  if (/\b(revise|revision notes|revise me on|help me revise)\b/i.test(low)) {
    const topic = text.replace(/^(please\s+)?(help me\s+)?revise\s+(me\s+on\s+)?/i, '').replace(/\b(revision notes|revise)\b/i, '').replace(/^(on|about|for)\s+/i, '').trim();
    return { intent: 'revise', params: { topic: topic || '' } };
  }
  if (/\b(my )?(quiz\s+)?(results|scores?|performance)\b/i.test(low)) return { intent: 'results', params: {} };
  if (/\b(revision|study)\s+plan\b/i.test(low)) return { intent: 'study_plan', params: {} };

  // ── developer ──
  if (CODE_HINT.test(text) || /\b(code|script|program)\b/i.test(low)) {
    if (/(debug|fix|why.*(error|crash|fail|not working)|what'?s wrong)/i.test(low)) return { intent: 'debug', params: { code: text } };
    if (/(review|improve|refactor)/i.test(low)) return { intent: 'review', params: { code: text } };
    if (/(explain|what does)/i.test(low)) return { intent: 'explain_code', params: { code: text } };
    if (/(write|generate|create|build).*(code|function|script|program|component)/i.test(low)) return { intent: 'code', params: { spec: text } };
    if (CODE_HINT.test(text)) return { intent: 'debug', params: { code: text } };
  }

  // ── research ──
  if (/^(research|investigate|look (into|up)|find out)\b/i.test(low)) {
    const topic = text.replace(/^(research|investigate|look (into|up)|find out)\s+(about\s+|on\s+)?/i, '').trim();
    return { intent: 'research', params: { topic } };
  }

  // ── creative ──
  if (/(instagram\s+)?caption/i.test(low)) return { intent: 'caption', params: { brief: text } };
  if (/(image|midjourney|dall-?e|picture).*(prompt)/i.test(low) || /^prompt\s+for/i.test(low)) return { intent: 'prompt_gen', params: { brief: text } };
  if (/(slogan|brand name|business name|name ideas)/i.test(low)) return { intent: 'brand', params: { brief: text } };
  if (/(ideas? for|give me ideas|brainstorm)/i.test(low)) return { intent: 'ideas', params: { brief: text } };
  if (/^brainstorm\b/i.test(low)) return { intent: 'brainstorm', params: { topic: text.replace(/^brainstorm\s*/i, '') } };

  // ── documents ──
  if (/(summariz|summaris).*(pdf|document|doc|file)/i.test(low)) return { intent: 'doc_ask', params: { action: 'summarize' } };

  // ── tools ──
  m = text.match(/^(calculate|calc|what (is|are)|solve|compute)\s+(.+)$/i);
  if (m && /^[\d\s+\-*/%^().,a-z]+$/i.test(m[3]) && /\d/.test(m[3])) return { intent: 'tool_calc', params: { expr: m[3] } };
  m = text.match(/convert\s+([\d.]+)\s*([a-z/%]+)\s+to\s+([a-z/%]+)/i);
  if (m) return { intent: 'tool_convert', params: { value: parseFloat(m[1]), from: m[2], to: m[3] } };
  m = text.match(/([\d.]+)\s*([a-z]{3})\s+(to|in)\s+([a-z]{3})/i);
  if (m && m[2].length === 3 && m[4].length === 3) return { intent: 'tool_currency', params: { amount: parseFloat(m[1]), from: m[2].toUpperCase(), to: m[4].toUpperCase() } };

  // ── AI helpers ──
  m = text.match(/^(summarize|summarise)\s+(.+)$/is);
  if (m) return { intent: 'summarize', params: { text: m[2].trim() } };
  m = text.match(/^explain\s+(.+)$/is);
  if (m) return { intent: 'explain', params: { topic: m[1].trim() } };
  m = text.match(/^translate\s+(.+?)\s+to\s+([a-z\s]+)$/is);
  if (m) return { intent: 'translate', params: { text: m[1].trim(), lang: m[2].trim() } };

  // ── fallback: normal chat ──
  return { intent: 'chat', params: { text } };
}

module.exports = { route };
