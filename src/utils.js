'use strict';
const crypto = require('crypto');

/* ── text helpers ─────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function chunkMessage(text, max = 4000) {
  const out = [];
  let t = String(text || '');
  while (t.length > max) {
    let cut = t.lastIndexOf('\n', max);
    if (cut < max * 0.4) cut = max;
    out.push(t.slice(0, cut));
    t = t.slice(cut).replace(/^\n+/, '');
  }
  if (t) out.push(t);
  return out.length ? out : [''];
}

function shortId(bytes = 6) {
  return crypto.randomBytes(bytes).toString('hex');
}

function clampText(s, max) {
  s = String(s || '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function timeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  return d + 'd ago';
}

/* ── safe math evaluator (no eval, no Function) ───────────── */
const MATH_FUNCS = {
  sqrt: (x) => Math.sqrt(x), cbrt: (x) => Math.cbrt(x),
  sin: (x) => Math.sin(x), cos: (x) => Math.cos(x), tan: (x) => Math.tan(x),
  asin: (x) => Math.asin(x), acos: (x) => Math.acos(x), atan: (x) => Math.atan(x),
  log: (x) => Math.log10(x), ln: (x) => Math.log(x), log2: (x) => Math.log2(x),
  abs: (x) => Math.abs(x), exp: (x) => Math.exp(x), floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x), round: (x) => Math.round(x),
};
const MATH_CONSTS = { pi: Math.PI, e: Math.E };

function safeEval(expr) {
  // Tokenize
  const tokens = [];
  const re = /\s*([0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?|[a-zA-Z_][a-zA-Z0-9_]*|[+\-*/%^(),!])/gy;
  let m; let last = 0;
  const src = String(expr).trim().slice(0, 200);
  if (!src) throw new Error('empty expression');
  while ((m = re.exec(src)) !== null) { tokens.push(m[1]); last = re.lastIndex; }
  if (last !== src.length) throw new Error('invalid characters in expression');

  // Shunting-yard → RPN
  const out = []; const ops = [];
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, neg: 3, '^': 4 }; // ^ binds tighter than unary minus: -3^2 = -(3^2)
  const rightAssoc = { '^': true, neg: true };
  const isOp = (t) => '+-*/%^'.includes(t);
  let prev = null;
  for (const t of tokens) {
    if (/^[0-9]/.test(t)) out.push({ t: 'num', v: parseFloat(t) });
    else if (MATH_CONSTS[t.toLowerCase()] !== undefined) out.push({ t: 'num', v: MATH_CONSTS[t.toLowerCase()] });
    else if (MATH_FUNCS[t.toLowerCase()]) ops.push(t.toLowerCase());
    else if (t === ',') { while (ops.length && ops[ops.length - 1] !== '(') out.push({ t: 'op', v: ops.pop() }); }
    else if (t === '(') ops.push(t);
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push({ t: 'op', v: ops.pop() });
      if (!ops.length) throw new Error('mismatched parentheses');
      ops.pop();
      if (ops.length && MATH_FUNCS[ops[ops.length - 1]]) out.push({ t: 'fn', v: ops.pop() });
    } else if (t === '!') out.push({ t: 'fact' });
    else if (isOp(t)) {
      let op = t;
      if ((t === '-' || t === '+') && (prev === null || prev === '(' || isOp(prev) || prev === ',')) op = t === '-' ? 'neg' : null;
      if (op) {
        while (ops.length && ops[ops.length - 1] !== '(' &&
          (prec[ops[ops.length - 1]] > prec[op] || (prec[ops[ops.length - 1]] === prec[op] && !rightAssoc[op]))) {
          const o = ops.pop();
          out.push(MATH_FUNCS[o] ? { t: 'fn', v: o } : { t: 'op', v: o });
        }
        ops.push(op);
      }
    } else throw new Error('unknown token: ' + t);
    prev = t;
  }
  while (ops.length) { const o = ops.pop(); if (o === '(') throw new Error('mismatched parentheses'); out.push(MATH_FUNCS[o] ? { t: 'fn', v: o } : { t: 'op', v: o }); }

  // Evaluate RPN
  const st = [];
  const fact = (n) => { if (n < 0 || n > 170 || n % 1 !== 0) throw new Error('factorial out of range'); let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  for (const node of out) {
    if (node.t === 'num') st.push(node.v);
    else if (node.t === 'fn') { const a = st.pop(); if (a === undefined) throw new Error('bad expression'); st.push(MATH_FUNCS[node.v](a)); }
    else if (node.t === 'fact') { const a = st.pop(); if (a === undefined) throw new Error('bad expression'); st.push(fact(a)); }
    else {
      if (node.v === 'neg') { const a = st.pop(); if (a === undefined) throw new Error('bad expression'); st.push(-a); continue; }
      const b = st.pop(); const a = st.pop();
      if (a === undefined || b === undefined) throw new Error('bad expression');
      let r;
      switch (node.v) {
        case '+': r = a + b; break; case '-': r = a - b; break;
        case '*': r = a * b; break; case '/': if (b === 0) throw new Error('division by zero'); r = a / b; break;
        case '%': r = a % b; break; case '^': r = Math.pow(a, b); break;
        default: throw new Error('unknown operator');
      }
      st.push(r);
    }
  }
  if (st.length !== 1 || !isFinite(st[0])) throw new Error('could not evaluate expression');
  return st[0];
}

/* ── unit conversion ──────────────────────────────────────── */
const UNIT_TABLE = {
  length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
  mass: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237 },
  time: { ms: 0.001, s: 1, sec: 1, min: 60, h: 3600, hr: 3600, day: 86400, week: 604800 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, kmh: 1 / 3.6, mph: 0.44704, knot: 0.514444, 'ft/s': 0.3048 },
  data: { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 },
  volume: { ml: 0.001, l: 1, gal: 3.78541 },
};
const UNIT_ALIASES = {
  millimeter: 'mm', millimeters: 'mm', centimeter: 'cm', centimeters: 'cm', meter: 'm', meters: 'm',
  kilometre: 'km', kilometer: 'km', kilometers: 'km', kilometres: 'km', inch: 'in', inches: 'in',
  foot: 'ft', feet: 'ft', yard: 'yd', yards: 'yd', mile: 'mi', miles: 'mi',
  milligram: 'mg', gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg', tonne: 't', ton: 't',
  ounce: 'oz', ounces: 'oz', pound: 'lb', pounds: 'lb', lbs: 'lb',
  second: 's', seconds: 's', minute: 'min', minutes: 'min', hour: 'h', hours: 'h',
  celsius: 'c', fahrenheit: 'f', kelvin: 'k', celcius: 'c',
  kilobyte: 'kb', megabyte: 'mb', gigabyte: 'gb', terabyte: 'tb',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', milliliter: 'ml', gallon: 'gal', gallons: 'gal',
};
function normUnit(u) {
  u = String(u).trim().toLowerCase();
  return UNIT_ALIASES[u] || u;
}
function convertUnits(value, from, to) {
  from = normUnit(from); to = normUnit(to);
  if ((from === 'c' || from === 'f' || from === 'k') && (to === 'c' || to === 'f' || to === 'k')) {
    let c = from === 'c' ? value : from === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
    const r = to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15;
    return r;
  }
  for (const cat of Object.values(UNIT_TABLE)) {
    if (cat[from] !== undefined && cat[to] !== undefined) return (value * cat[from]) / cat[to];
  }
  throw new Error(`can't convert ${from} → ${to}`);
}

/* ── reminder natural-language parsing ──────────────────────
   Lagos (Africa/Lagos) is UTC+1 with no DST — constant offset.   */
const LAGOS_OFFSET_MS = 3600000;
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function lagosNow() { return new Date(Date.now() + LAGOS_OFFSET_MS); }
function lagosToUtc(y, mo, d, h, mi) { return new Date(Date.UTC(y, mo, d, h, mi) - LAGOS_OFFSET_MS); }

function parseTimeToken(h, min, ap) {
  let hh = parseInt(h, 10); const mm = min ? parseInt(min, 10) : 0;
  if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0; }
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

function extractReminderText(raw, stripRe) {
  let t = raw.replace(stripRe, ' ').replace(/^(please\s+)?remind\s+me\s+/i, '').trim();
  t = t.replace(/^(to|that|about)\s+/i, '').replace(/\s+/g, ' ').trim();
  return t || 'Reminder';
}

function parseReminder(raw, nowMs = Date.now()) {
  const original = String(raw || '');
  const s = ' ' + original.toLowerCase() + ' ';
  const lagos = new Date(nowMs + LAGOS_OFFSET_MS);
  const Y = lagos.getUTCFullYear(), Mo = lagos.getUTCMonth(), D = lagos.getUTCDate();

  // "in 30 minutes" / "in 2 hours" / "in 3 days"
  let m = s.match(/in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|h|days?|d)\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2][0] === 'm' && m[2][1] === 'i' ? 'min' : m[2][0];
    const ms = unit === 'd' ? n * 864e5 : unit === 'h' ? n * 36e5 : n * 6e4;
    if (ms <= 0 || ms > 365 * 864e5) return null;
    return { text: extractReminderText(original, /in\s+\d+\s*(minutes?|mins?|hours?|hrs?|h|days?|d)\b/i), dueAt: new Date(nowMs + ms), repeat: null };
  }

  const timeRe = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/;
  const atTime = (tm, dayOffset) => {
    const t = parseTimeToken(tm[1], tm[2], tm[3]);
    if (!t) return null;
    let due = lagosToUtc(Y, Mo, D + dayOffset, t.hh, t.mm);
    if (due.getTime() <= nowMs + 60000) due = new Date(due.getTime() + 864e5);
    return due;
  };

  // "tomorrow at 4pm" / "today at 09:30"
  m = s.match(/(tomorrow|today)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m) {
    const due = atTime([0, m[2], m[3], m[4]], m[1] === 'tomorrow' ? 1 : 0);
    if (due) return { text: extractReminderText(original, /(tomorrow|today)\s+at\s+\d{1,2}(?::\d{2})?\s*(am|pm)?/i), dueAt: due, repeat: null };
  }
  // "at 7 tomorrow" / "at 4pm today"
  m = s.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(tomorrow|today)/);
  if (m) {
    const due = atTime([0, m[1], m[2], m[3]], m[4] === 'tomorrow' ? 1 : 0);
    if (due) return { text: extractReminderText(original, /at\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\s+(tomorrow|today)/i), dueAt: due, repeat: null };
  }
  // "on monday at 9am"
  m = s.match(/on\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m) {
    const t = parseTimeToken(m[2], m[3], m[4]);
    if (t) {
      const target = WEEKDAYS[m[1]];
      let delta = (target - lagos.getUTCDay() + 7) % 7;
      let due = lagosToUtc(Y, Mo, D + delta, t.hh, t.mm);
      if (due.getTime() <= nowMs + 60000) due = new Date(due.getTime() + 7 * 864e5);
      return { text: extractReminderText(original, /on\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+at\s+\d{1,2}(?::\d{2})?\s*(am|pm)?/i), dueAt: due, repeat: null };
    }
  }
  // "at 4pm" (today, else tomorrow)
  m = s.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m) {
    const due = atTime([0, m[1], m[2], m[3]], 0);
    if (due) return { text: extractReminderText(original, /at\s+\d{1,2}(?::\d{2})?\s*(am|pm)\b/i), dueAt: due, repeat: null };
  }
  return null;
}

/* ── quiz request parsing ─────────────────────────────────── */
function parseQuizRequest(raw) {
  const s = String(raw || '');
  let count = 10;
  const cm = s.match(/(\d{1,2})\s+(?:\w+\s+){0,4}?(questions?|mcqs?)/i);
  if (cm) count = Math.min(30, Math.max(3, parseInt(cm[1], 10)));
  let rest = s.replace(/^(please\s+)?(create|generate|make|give\s+me|quiz\s+me\s+(on|about))\s+/i, '')
    .replace(/(\d{1,2})\s+((?:\w+\s+){0,4}?)(questions?|mcqs?)\s*/i, '$2')
    .replace(/^(questions?|mcqs?)\s+/i, '')
    .replace(/^(on|about|for)\s+/i, '').trim();
  let subject = '', topic = '';
  const subjMatch = rest.match(/^(waec|jamb|gce|neco|ielts|gre|sat)\b\s*/i);
  if (subjMatch) { subject = subjMatch[1].toUpperCase(); rest = rest.slice(subjMatch[0].length).trim(); }
  // "mathematics questions on statistics" → subject=mathematics, topic=statistics
  const onSplit = rest.split(/\s+on\s+/i);
  if (onSplit.length > 1) { subject = subject || onSplit[0].trim(); topic = onSplit.slice(1).join(' on ').trim(); }
  else { subject = subject || rest; }
  subject = subject.replace(/\s+(quiz|test|exam).*$/i, '').trim();
  return { count, subject: subject || 'General Knowledge', topic: topic || subject || 'mixed' };
}

/* ── misc ─────────────────────────────────────────────────── */
function fmtNumber(n) {
  if (!isFinite(n)) return 'undefined';
  const r = Math.abs(n) < 1e-12 ? 0 : n;
  return Number(r.toPrecision(10)).toLocaleString('en-US', { maximumFractionDigits: 8 });
}

function fmtDateTime(d, tz = 'Africa/Lagos') {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(d));
}

module.exports = {
  escapeHtml, chunkMessage, shortId, clampText, timeAgo,
  safeEval, convertUnits, normUnit,
  parseReminder, parseQuizRequest,
  fmtNumber, fmtDateTime, lagosToUtc, LAGOS_OFFSET_MS,
};
