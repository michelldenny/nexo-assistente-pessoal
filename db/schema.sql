create extension if not exists pgcrypto;

create table profiles (
  id uuid primary key,
  display_name text not null,
  currency char(3) not null default 'BRL',
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  name text not null,
  kind text not null check (kind in ('cash','checking','savings','wallet','credit_card')),
  opening_balance_cents bigint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  name text not null,
  kind text not null check (kind in ('expense','income','both')),
  color text,
  parent_id uuid references categories(id),
  unique (user_id, name)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  account_id uuid not null references accounts(id),
  category_id uuid references categories(id),
  kind text not null check (kind in ('expense','income','transfer')),
  status text not null default 'posted' check (status in ('pending','posted','void')),
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  occurred_on date not null,
  notes text,
  source text not null default 'manual' check (source in ('manual','assistant','import','whatsapp')),
  idempotency_key text,
  installment_group_id uuid,
  installment_number integer,
  installment_total integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, idempotency_key)
);

create index idx_transactions_user_date on transactions(user_id, occurred_on desc) where deleted_at is null;
create index idx_transactions_user_category_date on transactions(user_id, category_id, occurred_on) where deleted_at is null;

create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  channel text not null default 'web' check (channel in ('web','whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content jsonb not null,
  response_id text,
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

-- Fase 2+: cards, billing_cycles, installment_groups, recurring_rules.
-- Fase 3+: tasks, projects, calendar_events, reminders.
-- Fase 4+: documents, document_chunks, imports, import_rows.
