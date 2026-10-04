'use strict';
/**
 * Free image generation via Pollinations (no API key needed).
 * generateImage(prompt) -> Buffer (JPEG/PNG bytes) ready for replyWithPhoto.
 */
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

module.exports = { generateImage };
