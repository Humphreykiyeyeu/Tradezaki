-- Tradezaki initial schema.
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query),
-- or via `supabase db push` once the CLI is linked.
--
-- Design notes:
--   * Row Level Security is ON for every table, and every policy is scoped to
--     auth.uid(). The publishable/anon key is meant to be public, so RLS is the
--     only thing standing between one user's data and another's — a table
--     without it is effectively world-readable.
--   * Deriv access tokens are NOT stored here yet. They can place real-money
--     trades, and Postgres columns are the wrong place for them: they'd be
--     readable by anyone with a database backup. The runner will hold them
--     encrypted with a KMS-held key (PLAN.md §5). deriv_accounts records only
--     non-secret identifiers.

-- ---------------------------------------------------------------- profiles --
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Keep profiles in step with auth.users automatically.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------- deriv accounts --
create table if not exists public.deriv_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  account_id    text not null,                -- e.g. "DOT93366786"
  account_type  text not null check (account_type in ('demo','real')),
  currency      text not null default 'USD',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (user_id, account_id)
);

alter table public.deriv_accounts enable row level security;

create policy "own deriv accounts" on public.deriv_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists deriv_accounts_user_idx on public.deriv_accounts(user_id);

-- ------------------------------------------------------------ risk config --
-- Per Deriv account, not per user: demo and real are separate money, and a
-- limit hit while practising must never lock the real account.
create table if not exists public.risk_configs (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  deriv_account_id            text not null,
  enabled                     boolean not null default false,
  daily_loss_limit            numeric(12,2) not null default 0,
  max_consecutive_losses      int not null default 0,
  cooldown_seconds            int not null default 300,
  max_stake_percent_of_balance numeric(5,2) not null default 0,
  updated_at                  timestamptz not null default now(),
  unique (user_id, deriv_account_id)
);

alter table public.risk_configs enable row level security;

create policy "own risk configs" on public.risk_configs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------- trades --
create table if not exists public.trades (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  deriv_account_id  text not null,
  contract_id       bigint not null,
  bot_id            uuid,                       -- null when placed by hand
  symbol            text not null,
  contract_type     text not null,
  stake             numeric(12,2) not null,
  buy_price         numeric(12,2),
  payout            numeric(12,2),
  result            text not null default 'open' check (result in ('open','won','lost')),
  profit            numeric(12,2) not null default 0,
  opened_at         timestamptz not null default now(),
  settled_at        timestamptz,
  unique (user_id, contract_id)                 -- idempotent on retry/reconnect
);

alter table public.trades enable row level security;

create policy "own trades" on public.trades
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists trades_user_opened_idx
  on public.trades(user_id, opened_at desc);
create index if not exists trades_account_idx
  on public.trades(user_id, deriv_account_id, opened_at desc);
create index if not exists trades_open_idx
  on public.trades(user_id) where result = 'open';

-- ------------------------------------------------------------- strategies --
-- A strategy is the reusable definition; a bot is one running instance of it
-- bound to an account. Separating them is what later allows one strategy to be
-- published and followed by many people.
create table if not exists public.strategies (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  source       text not null default 'builder' check (source in ('builder','dbot_xml')),
  definition   jsonb not null,       -- internal strategy IR
  raw_xml      text,                 -- original upload, kept for re-parsing
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.strategies enable row level security;

create policy "own strategies" on public.strategies
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "published strategies are readable" on public.strategies
  for select using (is_published = true);

-- ------------------------------------------------------------------- bots --
create table if not exists public.bots (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  strategy_id      uuid not null references public.strategies(id) on delete cascade,
  deriv_account_id text not null,
  name             text not null,
  status           text not null default 'stopped'
                     check (status in ('stopped','starting','running','stopping','error')),
  status_detail    text,                    -- why it stopped, in plain language
  settings         jsonb not null default '{}'::jsonb,
  last_heartbeat   timestamptz,             -- runner liveness; stale = crashed
  started_at       timestamptz,
  stopped_at       timestamptz,
  created_at       timestamptz not null default now()
);

alter table public.bots enable row level security;

create policy "own bots" on public.bots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists bots_user_idx on public.bots(user_id);
create index if not exists bots_running_idx on public.bots(status) where status = 'running';

-- -------------------------------------------------------------- bot events --
-- Append-only log. This is what the user reads when a bot stops overnight and
-- they want to know why — so write plain sentences, not stack traces.
create table if not exists public.bot_events (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  bot_id     uuid not null references public.bots(id) on delete cascade,
  level      text not null default 'info' check (level in ('info','warn','error')),
  message    text not null,
  context    jsonb,
  created_at timestamptz not null default now()
);

alter table public.bot_events enable row level security;

create policy "own bot events" on public.bot_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists bot_events_bot_idx on public.bot_events(bot_id, created_at desc);

-- ------------------------------------------------------------- timestamps --
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists strategies_touch on public.strategies;
create trigger strategies_touch before update on public.strategies
  for each row execute function public.touch_updated_at();

drop trigger if exists risk_configs_touch on public.risk_configs;
create trigger risk_configs_touch before update on public.risk_configs
  for each row execute function public.touch_updated_at();
