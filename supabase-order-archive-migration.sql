-- Reversible order archiving for the admin dashboard.
-- Run after supabase-orders-payments-migration.sql.

alter table public.orders
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id);

create index if not exists orders_archived_at_idx
  on public.orders(archived_at, created_at desc);

notify pgrst, 'reload schema';