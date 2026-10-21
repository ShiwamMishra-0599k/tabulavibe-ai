-- TabulaVibe AI: user profiles and saved reports.
--
-- Run once in the Supabase dashboard (SQL Editor → New query → paste → Run), or with
-- `supabase db push` if you use the Supabase CLI. Safe to re-run.
--
-- What is stored: the analysis settings, the calculated (aggregated) results, a data-quality
-- summary and the optional AI commentary. Raw uploaded rows and files are NOT stored.
-- Row Level Security limits every signed-in user to their own reports; the backend only ever
-- uses the public anon/publishable key plus the user's own access token.

-- ---------------------------------------------------------------------------------------------
-- Profiles: one row per account, created automatically when someone first signs in with
-- Google or GitHub (Supabase Auth). Holds only what the sign-in provider shares publicly.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  full_name    text check (char_length(full_name) <= 200),
  avatar_url   text check (char_length(avatar_url) <= 1000),
  provider     text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Runs as the table owner so it can write the profile; search_path is pinned for safety.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, provider)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'user_name'), 200),
    left(new.raw_user_meta_data ->> 'avatar_url', 1000),
    new.raw_app_meta_data ->> 'provider'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts created before this script ran get a profile too.
insert into public.profiles (id, email, full_name, avatar_url, provider)
select u.id, u.email,
       left(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'user_name'), 200),
       left(u.raw_user_meta_data ->> 'avatar_url', 1000),
       u.raw_app_meta_data ->> 'provider'
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Saved reports
-- ---------------------------------------------------------------------------------------------

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  source_name  text not null check (char_length(source_name) <= 255),
  source_type  text not null check (source_type in ('csv', 'xlsx')),
  row_count    integer not null check (row_count >= 0),
  column_count integer not null check (column_count >= 0),
  spec         jsonb not null,
  result       jsonb not null check (octet_length(result::text) <= 1000000),
  quality      jsonb not null check (octet_length(quality::text) <= 200000),
  narrative    jsonb check (narrative is null or octet_length(narrative::text) <= 50000),
  app_version  text not null,
  created_at   timestamptz not null default now()
);

create index if not exists reports_user_created_idx on public.reports (user_id, created_at desc);

alter table public.reports enable row level security;

-- Only signed-in users, and only their own rows. No UPDATE policy: saved reports are immutable.
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "reports_delete_own" on public.reports;
create policy "reports_delete_own" on public.reports
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Anonymous visitors get nothing; signed-in users get only what the policies above allow.
revoke all on public.reports from anon;
revoke all on public.reports from authenticated;
grant select, insert, delete on public.reports to authenticated;
