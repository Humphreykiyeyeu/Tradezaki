-- Deriv credentials for the cloud runner.
--
-- READ THIS BEFORE RUNNING IT. This table is a real change in what Tradezaki
-- holds on your behalf.
--
-- Until now the app stored no trading credential server-side: the browser held
-- a token, and the server only ever borrowed it for the length of one request.
-- A cloud bot cannot work that way — "keeps trading with your phone off" means
-- the server must be able to authenticate as the user while the user is absent.
--
-- So this table exists, and it is the most sensitive thing in the system. The
-- protections, in order of how much they actually matter:
--
--   1. Ciphertext only. Tokens are sealed with AES-256-GCM before they ever
--      reach Postgres. A database dump, a leaked backup, or a read-only SQL
--      breach yields nothing without the key, which lives outside the database.
--   2. The key is NEVER stored here, in Supabase, or in the repo. It is an
--      environment variable on the runner host alone.
--   3. RLS denies everything by default. No policy grants SELECT to end users,
--      so even an authenticated user cannot read their own row through the
--      public API — only the service role, which the runner holds, can.
--   4. Rows are deleted when a user disconnects, not merely flagged.
--
-- What this does NOT protect against: someone who obtains both the database and
-- the runner's environment. That is the residual risk, and the mitigation is
-- ordinary host hygiene plus rotating DERIV_TOKEN_KEY if the host is ever
-- suspected.

create table if not exists public.deriv_credentials (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,

  -- AES-256-GCM. iv and auth_tag are stored alongside; neither is secret, and
  -- GCM needs both to detect tampering as well as to decrypt.
  access_token_enc  text not null,
  access_token_iv   text not null,
  access_token_tag  text not null,

  -- The refresh token is what lets a bot outlive the access token's lifetime.
  -- Without it a bot dies within the hour, which defeats the entire product.
  refresh_token_enc text,
  refresh_token_iv  text,
  refresh_token_tag text,

  expires_at        timestamptz,
  -- Lets us refuse to decrypt with the wrong key after a rotation, instead of
  -- failing with an opaque GCM error.
  key_version       int not null default 1,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id)
);

alter table public.deriv_credentials enable row level security;

-- Deliberately no policies. RLS with zero policies denies every request from
-- anon and authenticated roles; the service role bypasses RLS and is the only
-- thing that can read this table. Adding a "users can read their own token"
-- policy would put a trade-capable credential behind nothing but a JWT.
revoke all on public.deriv_credentials from anon, authenticated;

-- Users can disconnect. This is the one thing they may do to their own row.
create policy "disconnect removes credentials" on public.deriv_credentials
  for delete using (auth.uid() = user_id);

grant delete on public.deriv_credentials to authenticated;

drop trigger if exists deriv_credentials_touch on public.deriv_credentials;
create trigger deriv_credentials_touch before update on public.deriv_credentials
  for each row execute function public.touch_updated_at();
