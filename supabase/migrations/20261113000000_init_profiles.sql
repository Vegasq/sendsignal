-- supabase/migrations/20261113000000_init_profiles.sql
-- Cloud-sync schema for sscc. Run this once against your project via the
-- Supabase Dashboard → SQL Editor (or `supabase db push`).
--
-- One row per signed-in user holds that user's lightweight reader state
-- (subscriptions, folders, read ids, saved ids) as JSON. Row-level security
-- ensures a user can only read and write their own row. The shipped anon key is
-- not secret because RLS, not the key, enforces isolation.
--
-- auth.users.id is a uuid, so profiles.user_id is uuid to match the foreign key.

create table if not exists public.profiles (
  user_id    uuid      primary key references auth.users (id) on delete cascade,
  data       jsonb     not null default '{}',
  updated_at timestamptz not null default now()
);

-- RLS must be explicitly enabled; CREATE POLICY alone leaves the table open.
-- Without this, the anon key reads and writes every user's row.
alter table public.profiles enable row level security;

-- Owner-only access on every action. auth.uid() returns uuid, matching user_id.
create policy "user reads own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "user inserts own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "user updates own profile"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user deletes own profile"
  on public.profiles for delete
  using (auth.uid() = user_id);

-- Keep updated_at fresh on every write. A BEFORE trigger that assigns
-- new.updated_at avoids a recursive self-update (which a separate UPDATE would
-- trigger on the same table).
create or replace function public.handle_update_profiles()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.handle_update_profiles();
