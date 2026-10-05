'use strict';
require('dotenv').config();

const cfg = {
  nodeEnv: process.env.NODE_ENV || 'development',
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  cronSecret: process.env.CRON_SECRET || process.env.WEBHOOK_SECRET || '',
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_KEY || '',
  aiProvider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),
  aiApiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || '',
  groqApiKey: process.env.GROQ_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  searchProvider: (process.env.SEARCH_PROVIDER || 'tavily').toLowerCase(),
  searchApiKey: process.env.SEARCH_API_KEY || '',
  adminIds: (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  maxDocMb: parseInt(process.env.MAX_DOC_MB || '10', 10),
  maxImageMb: parseInt(process.env.MAX_IMAGE_MB || '5', 10),
  maxVoiceMb: parseInt(process.env.MAX_VOICE_MB || '20', 10),
  reminderTz: process.env.REMINDER_TZ || 'Africa/Lagos',
  historyLimit: parseInt(process.env.HISTORY_LIMIT || '20', 10),
};

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n] || !String(process.env[n]).trim());
  if (missing.length) throw new Error('Missing required env vars: ' + missing.join(', '));
}

module.exports = { cfg, requireEnv };
