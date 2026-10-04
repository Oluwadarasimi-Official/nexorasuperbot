'use strict';
/**
 * AI provider abstraction. Swap providers via AI_PROVIDER env var
 * without touching any feature code.
 *
 *   AIProvider
 *   ├── generateText({ system, messages, maxTokens })
 *   ├── generateStructured({ system, prompt, schemaHint })
 *   ├── analyzeImage({ system, prompt, imageBuffer, mimeType })
 *   ├── transcribeAudio({ audioBuffer, mimeType })
 *   └── analyzeDocument({ system, prompt, text })
 */
const { cfg } = require('../config');

class UnsupportedError extends Error {
  constructor(feature, provider) {
    super(`${provider} does not support ${feature} — switch AI_PROVIDER to a provider that does (e.g. gemini).`);
    this.name = 'UnsupportedError';
  }
}

/** Base provider interface — all providers implement these methods. */
class AIProvider {
  async generateText() { throw new Error('not implemented'); }
  async generateStructured() { throw new Error('not implemented'); }
  async analyzeImage() { throw new Error('not implemented'); }
  async transcribeAudio() { throw new Error('not implemented'); }
  async analyzeDocument() { throw new Error('not implemented'); }
}

async function fetchJson(url, { method = 'POST', headers = {}, body = undefined, timeoutMs = 90000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) {
      const msg = (data && (data.error?.message || data.error || data.message)) || text.slice(0, 300) || `HTTP ${res.status}`;
      const err = new Error(`AI request failed (${res.status}): ${msg}`);
      err.status = res.status;
      err.retryable = res.status === 429 || res.status >= 500;
      throw err;
    }
    return data;
  } finally { clearTimeout(t); }
}

function toBase64(buf) { return Buffer.from(buf).toString('base64'); }

/* ── Gemini (multimodal) ──────────────────────────────────── */
class GeminiProvider extends AIProvider {
  constructor() { super(); this.name = 'gemini'; }
  base() { return `https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiModel}`; }
  key() { return cfg.aiApiKey; }

  _contents(messages) {
    return (messages || []).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  }

  async generateText({ system = '', messages = [], maxTokens = 2048 } = {}) {
    const body = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: this._contents(messages),
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    };
    const data = await fetchJson(`${this.base()}:generateContent?key=${encodeURIComponent(this.key())}`, { body });
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text) throw new Error('Gemini returned an empty response.');
    return text.trim();
  }

  async generateStructured({ system = '', prompt = '', schemaHint = '' } = {}) {
    const text = await this.generateText({
      system: system + '\nRespond with ONLY valid JSON, no markdown fences, no commentary.',
      messages: [{ role: 'user', content: prompt + (schemaHint ? `\n\nJSON shape:\n${schemaHint}` : '') }],
      maxTokens: 8192,
    });
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try { return JSON.parse(cleaned); }
    catch (e) {
      // Try to salvage the first JSON object/array in the output
      const m = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (m) { try { return JSON.parse(m[1]); } catch { /* fallthrough */ } }
      throw new Error('AI returned malformed JSON for structured output.');
    }
  }

  async analyzeImage({ system = '', prompt = 'Describe this image in detail.', imageBuffer, mimeType = 'image/jpeg' } = {}) {
    const body = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [
        { inline_data: { mime_type: mimeType, data: toBase64(imageBuffer) } },
        { text: prompt },
      ] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.4 },
    };
    const data = await fetchJson(`${this.base()}:generateContent?key=${encodeURIComponent(this.key())}`, { body });
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text) throw new Error('Gemini returned an empty response.');
    return text.trim();
  }

  async transcribeAudio({ audioBuffer, mimeType = 'audio/ogg' } = {}) {
    const body = {
      contents: [{ role: 'user', parts: [
        { inline_data: { mime_type: mimeType, data: toBase64(audioBuffer) } },
        { text: 'Transcribe this audio verbatim. Return only the transcription, no commentary. If there is no speech, reply with an empty string.' },
      ] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
    };
    const data = await fetchJson(`${this.base()}:generateContent?key=${encodeURIComponent(this.key())}`, { body });
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    return text.trim();
  }

  async analyzeDocument({ system = '', prompt = '', text = '' } = {}) {
    return this.generateText({
      system,
      messages: [{ role: 'user', content: `${prompt}\n\n<document>\n${text}\n</document>` }],
      maxTokens: 4096,
    });
  }
}

/* ── Groq (text) ──────────────────────────────────────────── */
class GroqProvider extends AIProvider {
  constructor() { super(); this.name = 'groq'; }

  async _chat({ system = '', messages = [], json = false, maxTokens = 2048 }) {
    const body = {
      model: cfg.groqModel,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    };
    const data = await fetchJson('https://api.groq.com/openai/v1/chat/completions', {
      headers: { Authorization: `Bearer ${cfg.aiApiKey}`, 'Content-Type': 'application/json' }, body,
    });
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('Groq returned an empty response.');
    return text.trim();
  }

  async generateText(opts = {}) { return this._chat(opts); }

  async generateStructured({ system = '', prompt = '', schemaHint = '' } = {}) {
    const text = await this._chat({
      system: (system || '') + '\nRespond with ONLY a valid JSON object, no markdown fences, no commentary.',
      messages: [{ role: 'user', content: prompt + (schemaHint ? `\n\nJSON shape:\n${schemaHint}` : '') }],
      json: true, maxTokens: 8192,
    });
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try { return JSON.parse(cleaned); }
    catch { throw new Error('AI returned malformed JSON for structured output.'); }
  }

  async analyzeImage() { throw new UnsupportedError('image analysis', 'groq'); }
  async transcribeAudio() { throw new UnsupportedError('audio transcription', 'groq'); }
  async analyzeDocument({ system = '', prompt = '', text = '' } = {}) {
    return this.generateText({ system, messages: [{ role: 'user', content: `${prompt}\n\n<document>\n${text}\n</document>` }], maxTokens: 4096 });
  }
}

/* ── factory ──────────────────────────────────────────────── */
let singleton = null;
function getProvider(name) {
  const which = (name || cfg.aiProvider).toLowerCase();
  if (singleton && singleton.name === which) return singleton;
  if (which === 'groq') singleton = new GroqProvider();
  else if (which === 'gemini') singleton = new GeminiProvider();
  else throw new Error(`Unknown AI_PROVIDER "${which}". Use "gemini" or "groq".`);
  if (!cfg.aiApiKey) throw new Error('AI_API_KEY is not set.');
  return singleton;
}

module.exports = { AIProvider, GeminiProvider, GroqProvider, UnsupportedError, getProvider };
