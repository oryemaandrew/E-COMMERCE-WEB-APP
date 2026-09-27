-- Create the real cashier identity model in Supabase.
-- Run this in Supabase SQL Editor.

create table if not exists public.cashiers (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null,
  cashier_code text unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.cashiers
  add column if not exists email text;

update public.cashiers as cashier
set email = auth_user.email
from auth.users as auth_user
where auth_user.id = cashier.id
  and (cashier.email is null or btrim(cashier.email) = '');

create unique index if not exists cashiers_email_unique_idx
  on public.cashiers(email)
  where email is not null;

create or replace function public.ensure_cashier_role()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update auth.users
  set raw_app_meta_data = jsonb_set(
    coalesce(raw_app_meta_data, '{}'::jsonb),
    '{role}',
    '"cashier"'::jsonb,
    true
  )
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists cashier_role_sync on public.cashiers;
create trigger cashier_role_sync
after insert or update of email, is_active
on public.cashiers
for each row
execute function public.ensure_cashier_role();

alter table public.cashiers enable row level security;

drop policy if exists cashier_self_access on public.cashiers;
create policy cashier_self_access
  on public.cashiers for select
  to authenticated
  using (
    id = auth.uid() or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists cashier_admin_manage on public.cashiers;
create policy cashier_admin_manage
  on public.cashiers for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.is_cashier_session()
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('cashier', 'admin'), false);
$$;

notify pgrst, 'reload schema';

-- Example creation flow:
-- 1. Create a Supabase Auth user in the dashboard for the cashier.
-- 2. Set the user's app_metadata.role to 'cashier'.
-- 3. Insert the cashier record using that same user id and email.
-- 4. Sign in with the accountant's email/password from the app.
