# 🤖 NexoraSuperBot

An **all-in-one AI operating system inside Telegram**: AI chat, personal memory, study mode (quizzes/flashcards/revision), coding assistant, web research, document intelligence, productivity (todos/notes/reminders/goals/habits), creative studio, media understanding (voice + images), 9 utility tools, and a full admin system — in one polished bot.

Built with **Node.js + Telegraf + Supabase (PostgreSQL)**. Deploys to **Vercel** (webhook) or any VPS (polling).

---

## ✨ Features

| Section | What it does |
|---|---|
| 🤖 AI Assistant | Context-aware chat, 6 personas, /ask /summarize /explain /translate /brainstorm, voice + image understanding |
| 🧠 My Memory | `/remember`, `/memory`, `/forget` — persistent per-user memory injected into every chat. Never shared between users |
| 📚 Study | Interactive button quizzes with scoring + weak-topic tracking, flashcards, revision notes, 7-day revision plans, timed quizzes |
| 💻 Developer | `/code` `/debug` `/review` `/explain_code`, source-file upload analysis |
| 🔎 Research | `/research <topic>` — multi-source web search + structured report with citations and conflict flags |
| 📄 Documents | Upload PDF/DOCX/TXT/CSV/code/images → summarize, key points, quiz, notes, Q&A |
| ⚡ Productivity | Todos, notes, natural-language reminders (`remind me tomorrow at 4pm…`), daily plans, goals, habit streaks |
| 🎨 Creative | Captions, image prompts, ideas, brand kits |
| 🛠 Tools | Safe calculator, unit converter, live currency rates, QR codes, JSON formatter, password generator, timestamps, text tools, random |
| 🛡 Admin | `/admin` dashboard: user stats, usage, error logs, broadcasts — locked to `ADMIN_IDS` |

**Smart router:** just type naturally — *"Create 20 WAEC Maths questions on statistics"*, *"remind me at 7 tomorrow to pray"*, *"research cheap VPS hosting"* — the bot figures out what you need. No commands required.

---

## 🚀 Setup (phone-friendly, ~10 minutes)

### 1. Create the Telegram bot
1. Open Telegram → search **@BotFather** → `/newbot`
2. Name it (e.g. `NexoraSuperBot`) → username must end in `bot` (e.g. `nexora_super_bot`)
3. **Copy the token** BotFather gives you — you will paste it into Vercel in step 4, nowhere else.

### 2. Get your Telegram user ID (for admin)
- Open **@userinfobot** in Telegram → it replies with your numeric ID. Save it.

### 3. AI key
- **Gemini (recommended — handles text, vision AND voice):** [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Create API key → copy it.
- Or **Groq** (text only): [console.groq.com/keys](https://console.groq.com/keys).

### 4. Deploy to Vercel
1. Push this folder to GitHub (or fork it), then go to [vercel.com/new](https://vercel.com/new) → **Import** the repo → **Deploy**.
2. In the project → **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token from BotFather |
| `WEBHOOK_SECRET` | any long random string you invent |
| `PUBLIC_URL` | `https://<your-app>.vercel.app` |
| `SUPABASE_URL` | `https://tziximfuystheohpckpo.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service_role key (Supabase dashboard → Project Settings → API) |
| `AI_PROVIDER` | `gemini` |
| `AI_API_KEY` | your Gemini API key |
| `SEARCH_API_KEY` | Tavily key (optional — enables /research) |
| `ADMIN_IDS` | your Telegram user ID from step 2 |

3. **Redeploy** after adding variables (Vercel → Deployments → ⋯ → Redeploy).

### 5. Connect Telegram to your deployment (one tap)
Open this URL in your browser (replace the two parts):

```
https://<your-app>.vercel.app/api/setup-webhook?key=<WEBHOOK_SECRET>
```

You should see `{"ok":true,...}`. Done — open your bot in Telegram and send `/start` 🎉

> The database tables are **already created** (`nx_*` tables in the Supabase project) — skip any DB setup.

### Reminders
Vercel Cron pings `/api/reminders` every 5 minutes automatically (see `vercel.json`). No extra setup.

---

## 🖥 Local / VPS development

```bash
npm install
cp .env.example .env   # fill it in
npm start              # polling mode
```

For reminders on a VPS either run `npm run reminders` alongside, or set `REMINDER_WORKER=1`.

Run the test suite (no network needed): `npm test`

---

## 🏗 Architecture

```
api/                  Vercel serverless entries (webhook, reminders cron, setup)
src/
  bot.js              Central wiring + intelligent message router
  config.js           Env config (never hardcode secrets)
  store.js            Supabase data layer (every query scoped to one user)
  logger.js           Structured JSON logging (no message contents)
  utils.js            Safe math parser, unit conversion, reminder/quiz parsing
  ai/
    providers.js      AIProvider abstraction → GeminiProvider / GroqProvider
    personas.js       6 AI modes
    router.js         Intent detection for plain messages
  tg/
    keyboards.js      All inline keyboards (dashboard, sections, back/home)
    helpers.js        Thinking states, message chunking, safe HTML
    middleware.js     Sessions, rate limiting, admin guard, error boundary
  features/           One module per section: core, ai, memory, study, dev,
                      research, docs, productivity, creative, tools, admin, media
db/schema.sql         PostgreSQL schema (nx_* tables, RLS enabled)
tests/smoke.js        41 unit tests
```

**Swapping AI providers:** set `AI_PROVIDER=groq` (or add a new class in `src/ai/providers.js` implementing `generateText / generateStructured / analyzeImage / transcribeAudio / analyzeDocument`) — no feature code changes.

---

## 🔒 Security notes

- All secrets are env vars; nothing is hardcoded. The service-role key stays server-side.
- Every DB query filters by the Telegram user id — users can never see each other's data.
- RLS is enabled on all tables with no public policies.
- Rate limiting per user (AI calls + commands + button taps).
- File size caps; user code is **never executed** (the calculator is a hand-written parser, not `eval`).
- User content is wrapped in `<user_input>` delimiters and the system prompt is hardened against prompt injection.
- Logs contain metadata only — never message contents or secrets.

---

## 📋 Commands cheat sheet

```
/start /menu /help /cancel
/ask /summarize /explain /translate /brainstorm /clear
/remember /memory /forget /clear_memory
/quiz /flashcards /revise /results
/code /debug /review /explain_code
/research <topic>
/todo /note /remind /plan /goals /habit
/caption /prompt /ideas /brand
/calc /convert /currency /qr /json /password /timestamp /text /random
/admin /stats /users /logs /broadcast   (admins only)
```

Built with 🖤 by Nexora.
