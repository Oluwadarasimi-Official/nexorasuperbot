'use strict';
const { Markup } = require('telegraf');

const backMain = () => Markup.inlineKeyboard([
  [Markup.button.callback('⬅️ Back', 'menu:back'), Markup.button.callback('🏠 Main Menu', 'menu:home')],
]);

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🤖 AI Assistant', 'menu:ai'), Markup.button.callback('🧠 My Memory', 'menu:memory')],
    [Markup.button.callback('📚 Study', 'menu:study'), Markup.button.callback('💻 Developer', 'menu:dev')],
    [Markup.button.callback('🔎 Research', 'menu:research'), Markup.button.callback('📄 Documents', 'menu:docs')],
    [Markup.button.callback('⚡ Productivity', 'menu:prod'), Markup.button.callback('🎨 Creative', 'menu:creative')],
    [Markup.button.callback('🛠 Tools', 'menu:tools'), Markup.button.callback('⚙️ Settings', 'menu:settings')],
  ]);
}

function sectionMenu(section, buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([Markup.button.callback('⬅️ Back', 'menu:back'), Markup.button.callback('🏠 Main Menu', 'menu:home')]);
  return Markup.inlineKeyboard(rows);
}

const MENUS = {
  ai: [
    ['💬 Chat', 'ai:chat'], ['🎭 Modes', 'ai:modes'],
    ['📝 Summarize', 'ai:summarize'], ['💡 Explain', 'ai:explain'],
    ['🌍 Translate', 'ai:translate'], ['🧠 Brainstorm', 'ai:brainstorm'],
    ['🗑 Clear history', 'ai:clear'],
  ],
  memory: [
    ['💾 Remember', 'mem:add'], ['📋 View memory', 'mem:list'],
    ['🗑 Forget', 'mem:forget'], ['🧹 Clear all', 'mem:clear'],
  ],
  study: [
    ['❓ New quiz', 'study:quiz'], ['🃏 Flashcards', 'study:flash'],
    ['📖 Revise', 'study:revise'], ['📊 My results', 'study:results'],
    ['🎯 Weak topics', 'study:weak'], ['🗓 Revision plan', 'study:plan'],
  ],
  dev: [
    ['⚡ Generate code', 'dev:code'], ['🐞 Debug', 'dev:debug'],
    ['🔍 Review code', 'dev:review'], ['📖 Explain code', 'dev:explain'],
    ['📤 Upload source file', 'dev:upload'],
  ],
  research: [
    ['🔎 New research', 'res:new'],
    ['💡 Tips', 'res:tips'],
  ],
  docs: [
    ['📤 Upload document', 'docs:upload'], ['📚 My documents', 'docs:list'],
    ['❓ Ask about a doc', 'docs:ask'],
  ],
  prod: [
    ['✅ To-dos', 'prod:todos'], ['📝 Notes', 'prod:notes'],
    ['⏰ Reminders', 'prod:reminders'], ['🗓 Daily plan', 'prod:plan'],
    ['🎯 Goals', 'prod:goals'], ['🔥 Habits', 'prod:habits'],
  ],
  creative: [
    ['📸 Caption', 'cre:caption'], ['🖼 Image prompt', 'cre:prompt'],
    ['💡 Ideas', 'cre:ideas'], ['🏷 Brand kit', 'cre:brand'],
  ],
  tools: [
    ['🧮 Calculator', 'tool:calc'], ['📐 Convert units', 'tool:convert'],
    ['💱 Currency', 'tool:currency'], ['🔳 QR code', 'tool:qr'],
    ['📝 Text tools', 'tool:text'], ['🔣 JSON format', 'tool:json'],
    ['🔑 Password', 'tool:password'], ['⏱ Timestamp', 'tool:time'],
    ['🎲 Random', 'tool:random'],
  ],
  settings: [
    ['🎭 AI persona', 'set:persona'], ['🧹 Clear chat history', 'set:clear'],
    ['ℹ️ About', 'set:about'],
  ],
};

function menuKeyboard(section) {
  const defs = MENUS[section] || [];
  const buttons = defs.map(([label, data]) => Markup.button.callback(label, data));
  return sectionMenu(section, buttons);
}

const SECTION_TITLES = {
  ai: '🤖 <b>AI Assistant</b>',
  memory: '🧠 <b>My Memory</b>',
  study: '📚 <b>Study Mode</b>',
  dev: '💻 <b>Developer Mode</b>',
  research: '🔎 <b>Research Mode</b>',
  docs: '📄 <b>Documents</b>',
  prod: '⚡ <b>Productivity</b>',
  creative: '🎨 <b>Creative Studio</b>',
  tools: '🛠 <b>Tools</b>',
  settings: '⚙️ <b>Settings</b>',
};

const SECTION_HINTS = {
  ai: 'Chat naturally, or try /ask, /summarize, /explain, /translate, /brainstorm.',
  memory: 'Tell me things to remember, e.g. “Remember that my project is called Nexora.” Private to you.',
  study: 'Generate quizzes, flashcards and revision notes. I track your scores and weak topics.',
  dev: 'Paste code or upload a source file — I can explain, debug, review or generate code.',
  research: 'Ask me to research any topic — I search the web and write a structured report with sources.',
  docs: 'Upload a PDF, DOCX, TXT, CSV or image and I will read it, summarize it and answer questions.',
  prod: 'To-dos, notes, reminders, goals and habits — your command center.',
  creative: 'Captions, ideas, brand names, slogans and image prompts.',
  tools: 'Calculator, conversions, QR codes, JSON, passwords and more.',
  settings: 'Choose your AI persona and manage your data.',
};

module.exports = { mainMenu, backMain, menuKeyboard, sectionMenu, SECTION_TITLES, SECTION_HINTS, MENUS };
