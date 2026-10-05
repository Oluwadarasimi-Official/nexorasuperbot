'use strict';
/**
 * Free image generation via Pollinations (no API key needed).
 * Two-stage for quality: the text AI first expands the user's short brief
 * into a rich, detailed prompt, then the image model renders THAT.
 * generateImage(prompt) -> Buffer (JPEG/PNG bytes) ready for replyWithPhoto.
 */
const { getProvider } = require('./providers');

/**
 * Stage 1 — expand a short brief into a vivid, detailed image prompt.
 * Falls back to the raw brief if the text AI hiccups.
 */
async function enhancePrompt(brief) {
  try {
    const ai = getProvider();
    const out = await ai.generateText({
      system: 'You are an elite prompt engineer for photorealistic AI image generators (Flux/SDXL).',
      messages: [{
        role: 'user',
        content:
          'Expand this into ONE vivid, highly detailed image-generation prompt. ' +
          'Describe subject, appearance, pose/action, environment, lighting, composition, ' +
          'camera angle, colors, mood, plus quality tags (ultra-detailed, 8k, sharp focus, ' +
          'professional photography). Keep it under 90 words. ' +
          'Respond with ONLY the prompt — no quotes, no commentary.\n\nBrief: ' + brief,
      }],
      maxTokens: 350,
    });
    const clean = String(out || '').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
    return clean.length > 20 ? clean : brief;
  } catch {
    return brief;
  }
}

/** Stage 2 — render an image from a (detailed) prompt. */
async function generateImage(prompt, { width = 1024, height = 1024, seed = null } = {}) {
  const s = seed == null ? Math.floor(Math.random() * 1e9) : seed;
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&seed=${s}&nologo=true&model=flux`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Image service returned HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5000) throw new Error('Image service returned an empty image.');
    return buf;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Image generation timed out — please try again.');
    throw err;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { generateImage, enhancePrompt };
