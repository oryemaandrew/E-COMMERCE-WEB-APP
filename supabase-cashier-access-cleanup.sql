-- Keep Namina Jamali active and suspend all other cashier profiles.
-- This preserves Supabase Auth users and all orders/payment history.
-- Run in Supabase SQL Editor after supabase-cashier-role-setup.sql.

do $$
declare
  target_count integer;
begin
  select count(*)
  into target_count
  from public.cashiers
  where lower(btrim(email)) = 'cashier@gmail.com'
    and lower(btrim(full_name)) = 'namina jamali';

  if target_count <> 1 then
    raise exception 'Expected exactly one cashier named Namina Jamali with cashier@gmail.com; found %; no access changes were made.', target_count;
  end if;
end;
$$;

update public.cashiers
set is_active = case
  when lower(btrim(email)) = 'cashier@gmail.com'
    and lower(btrim(full_name)) = 'namina jamali' then true
  else false
end
where is_active is distinct from case
  when lower(btrim(email)) = 'cashier@gmail.com'
    and lower(btrim(full_name)) = 'namina jamali' then true
  else false
end;