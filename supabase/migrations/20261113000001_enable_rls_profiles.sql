-- Enable RLS on profiles.
--
-- The original migration (20261113000000) created the table and policies but
-- omitted `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, so the deployed table was
-- open: the anon key could read and write every user's row. This migration
-- turns RLS on. It is idempotent (enabling an already-enabled table is a no-op),
-- so it is also safe on a fresh project where the base migration already enabled
-- RLS.

alter table public.profiles enable row level security;
