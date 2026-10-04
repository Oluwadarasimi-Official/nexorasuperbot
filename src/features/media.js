'use strict';
/**
 * Media intelligence: voice notes → transcribe → understand → act;
 * photos → analyze / describe / OCR / answer questions.
 */
const { getProvider } = require('../ai/providers');
const store = require('../store');
const { withThinking, sendLong, escapeHtml } = require('../tg/helpers');
const { downloadTelegramFile } = require('./docs');
const { tracked } = require('../tg/middleware');
const { route } = require('../ai/router');

/** Voice message pipeline: transcribe, then route the text like a typed message. */
async function handleVoice(ctx, dispatchText) {
  const voice = ctx.message.voice || ctx.message.audio;
  if (!voice) return;
  const buf = await downloadTelegramFile(ctx, voice.file_id, 20);
  const mime = voice.mime_type || 'audio/ogg';
  const transcript = await withThinking(ctx, async () => {
    const provider = getProvider();
    const text = await tracked('ai_audio', ctx.from.id, () => provider.transcribeAudio({ audioBuffer: buf, mimeType: mime }), 'transcribe');
    if (!text) throw Object.assign(new Error('I could not hear any speech in that voice note.'), { category: 'validation' });
    return text;
  });
  if (!transcript) return;
  await ctx.reply(`🎙 <i>Heard:</i> “${escapeHtml(transcript.slice(0, 300))}”`, { parse_mode: 'HTML' });
  // Run the transcribed request through the same router as typed text
  await dispatchText(ctx, transcript);
}

/** Photo pipeline: caption-aware analysis. */
async function handlePhoto(ctx) {
  const photos = ctx.message.photo || [];
  if (!photos.length) return;
  const best = photos[photos.length - 1];
  const caption = (ctx.message.caption || '').trim();
  const buf = await downloadTelegramFile(ctx, best.file_id, 5);
  const result = await withThinking(ctx, async () => {
    const provider = getProvider();
    const prompt = caption
      ? `The user sent this image with the caption: "${caption}". Answer/fulfill the caption request about the image. If the caption asks a question, answer it precisely from the image.`
      : 'Analyze this image thoroughly: describe what you see, read out any visible text (OCR), and note anything interesting or important.';
    return tracked('ai_vision', ctx.from.id, () => provider.analyzeImage({ prompt, imageBuffer: buf, mimeType: 'image/jpeg' }), caption.slice(0, 80) || 'describe');
  });
  if (result) await sendLong(ctx, `🖼 <b>Image analysis</b>\n\n${result}`);
}

module.exports = { handleVoice, handlePhoto };
