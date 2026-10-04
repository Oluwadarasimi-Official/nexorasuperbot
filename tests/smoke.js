'use strict';
/**
 * Smoke tests — pure logic, no network, no Telegram, no DB.
 * Run: npm test
 */
const assert = require('assert');
const { route } = require('../src/ai/router');
const { safeEval, convertUnits, parseReminder, parseQuizRequest, chunkMessage, escapeHtml, fmtNumber } = require('../src/utils');
const { personaSystem, personaList } = require('../src/ai/personas');

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}
const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

console.log('router');
t('remember intent', () => { const r = route('Remember that my project is called Nexora'); assert.equal(r.intent, 'remember'); assert.match(r.params.content, /Nexora/); });
t('quiz intent with count/subject/topic', () => { const r = route('Create 20 WAEC Mathematics questions on statistics'); assert.equal(r.intent, 'quiz'); assert.equal(r.params.count, 20); assert.equal(r.params.subject, 'WAEC'); assert.match(r.params.topic, /statistics/i); });
t('quiz me intent', () => { assert.equal(route('quiz me on algebra').intent, 'quiz'); });
t('flashcards intent', () => { const r = route('flashcards on organic chemistry'); assert.equal(r.intent, 'flashcards'); assert.match(r.params.topic, /organic chemistry/); });
t('remind intent parses time', () => { const r = route('Remind me tomorrow at 4 PM to study Chemistry'); assert.equal(r.intent, 'remind'); assert.ok(r.params.dueAt > new Date()); assert.match(r.params.text, /study Chemistry/i); });
t('debug intent from code', () => { const r = route('why does this crash?\n```js\nconst x = null;\nx.foo();\n```'); assert.equal(r.intent, 'debug'); });
t('research intent', () => { const r = route('research the best free PostgreSQL hosting'); assert.equal(r.intent, 'research'); assert.match(r.params.topic, /PostgreSQL/); });
t('calc intent', () => { const r = route('calculate 2*(3+4)^2'); assert.equal(r.intent, 'tool_calc'); });
t('convert intent', () => { const r = route('convert 5 km to miles'); assert.equal(r.intent, 'tool_convert'); assert.equal(r.params.value, 5); });
t('currency intent', () => { const r = route('100 USD to NGN'); assert.equal(r.intent, 'tool_currency'); assert.equal(r.params.from, 'USD'); });
t('caption intent', () => { assert.equal(route('write an instagram caption for my project launch').intent, 'caption'); });
t('chat fallback', () => { const r = route('what is the meaning of life?'); assert.equal(r.intent, 'chat'); });
t('todo intent', () => { const r = route('add buy groceries to my todos'); assert.equal(r.intent, 'todo_add'); });
t('note intent', () => { const r = route('note: call the bank tomorrow'); assert.equal(r.intent, 'note_add'); });

console.log('safeEval');
t('arithmetic', () => assert.equal(safeEval('2*(3+4)^2'), 98));
t('functions+constants', () => approx(safeEval('sqrt(16)+sin(0)+pi'), Math.PI + 4));
t('unary minus', () => assert.equal(safeEval('-3^2'), -9));
t('percent sugar via caller pattern', () => approx(safeEval('(15/100)*2400'), 360));
t('factorial', () => assert.equal(safeEval('5!'), 120));
t('rejects code injection', () => assert.throws(() => safeEval('process.exit(1)'), /invalid|unknown/));
t('rejects eval tricks', () => assert.throws(() => safeEval('1+2; console.log(1)'), /invalid/));
t('division by zero', () => assert.throws(() => safeEval('1/0'), /zero/));

console.log('convertUnits');
t('km→mi', () => approx(convertUnits(5, 'km', 'mi'), 3.10686, 1e-4));
t('c→f', () => approx(convertUnits(100, 'c', 'f'), 212));
t('f→c', () => approx(convertUnits(32, 'f', 'c'), 0));
t('aliases', () => approx(convertUnits(1, 'kilometers', 'meters'), 1000));
t('unknown pair throws', () => assert.throws(() => convertUnits(1, 'km', 'kg'), /can't convert/));

console.log('parseReminder');
const now = new Date('2026-10-04T12:00:00Z').getTime(); // 13:00 Lagos
t('in 30 minutes', () => { const r = parseReminder('remind me in 30 minutes to drink water', now); assert.equal(r.dueAt.getTime(), now + 30 * 60000); assert.equal(r.text, 'drink water'); });
t('tomorrow at 4pm', () => { const r = parseReminder('remind me tomorrow at 4pm to study chemistry', now); assert.equal(r.text, 'study chemistry'); const d = r.dueAt; assert.equal(d.getUTCHours(), 15); assert.equal(d.getUTCDate(), 5); }); // 16:00 Lagos = 15:00 UTC
t('at 7 tomorrow', () => { const r = parseReminder('remind me at 7 tomorrow to wake up', now); assert.equal(r.dueAt.getUTCHours(), 6); });
t('past time rolls to tomorrow', () => { const r = parseReminder('remind me at 6am to wake up', now); assert.equal(r.dueAt.getUTCDate(), 5); });
t('on monday at 9am', () => { const r = parseReminder('remind me on monday at 9am to call mom', now); assert.equal(r.dueAt.getUTCDay(), 1); });
t('garbage returns null', () => assert.equal(parseReminder('remind me someday maybe', now), null));

console.log('parseQuizRequest');
t('full request', () => { const r = parseQuizRequest('Create 20 WAEC Mathematics questions on statistics'); assert.equal(r.count, 20); assert.equal(r.subject, 'WAEC'); assert.match(r.topic, /statistics/); });
t('defaults', () => { const r = parseQuizRequest('quiz me'); assert.equal(r.count, 10); });
t('count clamp', () => { const r = parseQuizRequest('create 99 questions on biology'); assert.equal(r.count, 30); });

console.log('text utils');
t('escapeHtml', () => assert.equal(escapeHtml('<b>&"'), '&lt;b&gt;&amp;"'));
t('chunkMessage splits long', () => { const c = chunkMessage('a'.repeat(9000)); assert.ok(c.length >= 3 && c.every((x) => x.length <= 4000)); });
t('fmtNumber', () => assert.equal(fmtNumber(98), '98'));

console.log('personas');
t('six personas', () => assert.equal(personaList().length, 6));
t('memory injected, injection hardened', () => { const s = personaSystem('default', '- likes cats'); assert.match(s, /likes cats/); assert.match(s, /never instructions/i); });

console.log(`\n${pass} tests passed${process.exitCode ? ' (WITH FAILURES)' : ''}.`);
