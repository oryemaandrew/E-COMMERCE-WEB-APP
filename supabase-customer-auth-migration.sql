-- Customer authentication and order ownership migration.
-- Run this in Supabase Dashboard > SQL Editor after the orders migration.

alter table public.orders
  add column if not exists customer_id uuid references auth.users(id) on delete set null;

create index if not exists orders_customer_id_idx
  on public.orders(customer_id);

alter table public.payment_transactions enable row level security;

-- Checkout inserts are performed by the trusted server using the service role.
-- Do not grant browser clients direct insert access to order totals or items.
drop policy if exists customer_checkout_insert_orders on public.orders;
drop policy if exists customer_checkout_insert_order_items on public.order_items;
drop policy if exists customer_checkout_insert_orders_anon on public.orders;
drop policy if exists customer_checkout_insert_orders_authenticated on public.orders;
drop policy if exists customer_checkout_insert_order_items_anon on public.order_items;
drop policy if exists customer_checkout_insert_order_items_authenticated on public.order_items;

-- Customers can read only their own orders. Cashiers and admins retain access
-- to the orders they operate or administer.
drop policy if exists customer_orders_select on public.orders;
create policy customer_orders_select
  on public.orders for select
  to authenticated
  using (
    customer_id = auth.uid()
    or cashier_id = auth.uid()
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists customer_order_items_select on public.order_items;
create policy customer_order_items_select
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders
      where orders.id = order_items.order_id
        and (
          orders.customer_id = auth.uid()
          or orders.cashier_id = auth.uid()
          or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        )
    )
  );

drop policy if exists customer_payment_transactions_select on public.payment_transactions;
create policy customer_payment_transactions_select
  on public.payment_transactions for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders
      where orders.id = payment_transactions.order_id
        and (
          orders.customer_id = auth.uid()
          or orders.cashier_id = auth.uid()
          or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        )
    )
  );

notify pgrst, 'reload schema';
