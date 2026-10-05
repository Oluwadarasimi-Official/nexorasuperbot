'use strict';
/**
 * Markdown -> Telegram-safe HTML.
 * Escapes everything, then converts fenced code blocks to <pre>,
 * inline code to <code>, **bold** and *italic*.
 */

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineFmt(t) {
  let e = esc(t);
  e = e.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  e = e.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  e = e.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  return e;
}

function mdToTelegramHtml(md) {
  const parts = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(md))) {
    if (m.index > last) parts.push(inlineFmt(md.slice(last, m.index)));
    // Split long code into <pre> chunks so message chunking never breaks a tag.
    for (const c of splitCode(esc(m[2].replace(/\n+$/, '')))) parts.push('<pre>' + c + '</pre>');
    last = m.index + m[0].length;
  }
  if (last < md.length) parts.push(inlineFmt(md.slice(last)));
  return parts.join('\n').trim();
}

/** Split escaped code into <=3000-char pieces at newline boundaries. */
function splitCode(code, max = 3000) {
  const out = [];
  let t = code;
  while (t.length > max) {
    let cut = t.lastIndexOf('\n', max);
    if (cut < max * 0.4) cut = max;
    out.push(t.slice(0, cut));
    t = t.slice(cut).replace(/^\n+/, '');
  }
  if (t) out.push(t);
  return out.length ? out : [''];
}

/** Extract fenced code blocks: [{lang, code}]. */
function extractCodeBlocks(md) {
  const out = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md))) out.push({ lang: (m[1] || '').toLowerCase(), code: m[2].replace(/\n+$/, '') });
  return out;
}

const LANG_EXT = {
  html: 'html', css: 'css', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
  python: 'py', py: 'py', java: 'java', c: 'c', cpp: 'cpp', cs: 'cs', go: 'go',
  rust: 'rs', php: 'php', ruby: 'rb', swift: 'swift', kotlin: 'kt', sql: 'sql',
  json: 'json', xml: 'xml', yaml: 'yml', sh: 'sh', bash: 'sh',
};

function extFor(lang, fallback = 'txt') {
  return LANG_EXT[lang] || fallback;
}

module.exports = { esc, mdToTelegramHtml, extractCodeBlocks, extFor };
