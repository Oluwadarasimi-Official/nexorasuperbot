-- NexoraSuperBot schema (Supabase / PostgreSQL)
-- All tables are prefixed nx_ to avoid collisions on shared projects.
-- Run once in the Supabase SQL editor (or via the management API).

create extension if not exists "pgcrypto";

-- ── users ──────────────────────────────────────────────────
create table if not exists nx_users (
  telegram_id bigint primary key,
  username text,
  first_name text,
  is_admin boolean not null default false,
  prefs jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ── conversations & messages (AI chat history) ─────────────
create table if not exists nx_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references nx_users(telegram_id) on delete cascade,
  title text,
  persona text not null default 'default',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nx_conversations_user_idx on nx_conversations(user_id, updated_at desc);

create table if not exists nx_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references nx_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists nx_messages_conv_idx on nx_messages(conversation_id, created_at);

-- ── personal memory ────────────────────────────────────────
create table if not exists nx_memories (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references nx_users(telegram_id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nx_memories_user_idx on nx_memories(user_id);

-- ── documents ──────────────────────────────────────────────
create table if not exists nx_documents (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references nx_users(telegram_id) on delete cascade,
  file_name text not null,
  mime text,
  size_bytes integer,
  text_content text,
  summary text,
  created_at timestamptz not null default now()
);
create index if not exists nx_documents_user_idx on nx_documents(user_id, created_at desc);

-- ── study: quizzes, attempts, flashcards ───────────────────
create table if not exists nx_quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references nx_users(telegram_id) on delete cascade,
  subject text not null,
  topic text not null,
  question_count integer not null,
  questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists nx_quizzes_user_idx on nx_quizzes(user_id, created_at desc);

create table if not exists nx_quiz_attempts (
  id text primary key,
  quiz_id uuid not null references nx_quizzes(id) on delete cascade,
  user_id bigint not null references nx_users(telegram_id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress','finished','expired')),
  current_index integer not null default 0,
  answers jsonb not null default '[]'::jsonb,
  score integer,
  total integer,
  time_limit_sec integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists nx_quiz_attempts_user_idx on nx_quiz_attempts(user_id, started_at desc);

create table if not exists nx_flashcards (
  id text primary key,
  user_id bigint not null references nx_users(telegram_id) on delete cascade,
  topic text not null,
  cards jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists nx_flashcards_user_idx on nx_flashcards(user_id, created_at desc);

-- ── productivity ───────────────────────────────────────────
create table if not exists nx_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references nx_users(telegram_id) on delete cascade,
  title text not null,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  due_at timestamptz,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists nx_tasks_user_idx on nx_tasks(user_id, done, created_at desc);

create table if not exists nx_notes (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references nx_users(telegram_id) on delete cascade,
  title text,
  body text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nx_notes_user_idx on nx_notes(user_id, updated_at desc);

create table if not exists nx_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references nx_users(telegram_id) on delete cascade,
  text text not null,
  due_at timestamptz not null,
  repeat text check (repeat in ('daily','weekly') or repeat is null),
  sent boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists nx_reminders_due_idx on nx_reminders(sent, due_at) where sent = false;

create table if not exists nx_goals (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references nx_users(telegram_id) on delete cascade,
  title text not null,
  target text,
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nx_goals_user_idx on nx_goals(user_id);

create table if not exists nx_habits (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references nx_users(telegram_id) on delete cascade,
  name text not null,
  streak integer not null default 0,
  last_done date,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

-- ── observability ──────────────────────────────────────────
create table if not exists nx_usage (
  id uuid primary key default gen_random_uuid(),
  user_id bigint,
  kind text not null,
  detail text,
  tokens integer,
  ms integer,
  success boolean not null default true,
  error_category text,
  created_at timestamptz not null default now()
);
create index if not exists nx_usage_kind_idx on nx_usage(kind, created_at desc);
create index if not exists nx_usage_user_idx on nx_usage(user_id, created_at desc);

create table if not exists nx_admin_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id bigint,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists nx_admin_logs_idx on nx_admin_logs(created_at desc);

-- ── row-level security: locked down; only the service role
-- (used server-side by the bot, which enforces per-user filtering
-- in code on every query) can read/write. ──────────────────
alter table nx_users enable row level security;
alter table nx_conversations enable row level security;
alter table nx_messages enable row level security;
alter table nx_memories enable row level security;
alter table nx_documents enable row level security;
alter table nx_quizzes enable row level security;
alter table nx_quiz_attempts enable row level security;
alter table nx_flashcards enable row level security;
alter table nx_tasks enable row level security;
alter table nx_notes enable row level security;
alter table nx_reminders enable row level security;
alter table nx_goals enable row level security;
alter table nx_habits enable row level security;
alter table nx_usage enable row level security;
alter table nx_admin_logs enable row level security;
-- (service_role bypasses RLS; no public policies are created,
-- so anon/authenticated keys cannot touch these tables)
