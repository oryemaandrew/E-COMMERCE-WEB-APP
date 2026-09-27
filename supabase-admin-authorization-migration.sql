-- Admin authorization hardening.
-- Run after the existing product and order migrations.
-- Assign roles through Supabase Auth app_metadata, not user_metadata:
--   { "role": "admin" }

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

-- Products remain publicly readable for the storefront. Only admins can mutate them.
alter table public.products enable row level security;

drop policy if exists "Public can view products" on public.products;
drop policy if exists "Authenticated users can insert products" on public.products;
drop policy if exists "Authenticated users can update products" on public.products;
drop policy if exists "Authenticated users can delete products" on public.products;
drop policy if exists admin_products_insert on public.products;
drop policy if exists admin_products_update on public.products;
drop policy if exists admin_products_delete on public.products;

create policy "Public can view products"
  on public.products for select
  to anon, authenticated
  using (true);

create policy admin_products_insert
  on public.products for insert
  to authenticated
  with check (public.is_admin());

create policy admin_products_update
  on public.products for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy admin_products_delete
  on public.products for delete
  to authenticated
  using (public.is_admin());

-- Admins can review and correct operational records. Customers retain the
-- ownership policies from supabase-customer-auth-migration.sql.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists admin_orders_select on public.orders;
create policy admin_orders_select
  on public.orders for select
  to authenticated
  using (public.is_admin());

drop policy if exists admin_orders_update on public.orders;
create policy admin_orders_update
  on public.orders for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists admin_orders_delete on public.orders;

drop policy if exists admin_order_items_select on public.order_items;
create policy admin_order_items_select
  on public.order_items for select
  to authenticated
  using (public.is_admin());

-- Order deletion is intentionally disabled. Use status changes such as
-- 'cancelled' and a refund/cancellation workflow instead of permanent deletes.

-- Replace broad authenticated image mutation policies with admin-only policies.
drop policy if exists "Authenticated users can upload product images" on storage.objects;
drop policy if exists "Authenticated users can update product images" on storage.objects;
drop policy if exists admin_product_images_insert on storage.objects;
drop policy if exists admin_product_images_update on storage.objects;
drop policy if exists admin_product_images_delete on storage.objects;

create policy admin_product_images_insert
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

create policy admin_product_images_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

create policy admin_product_images_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

notify pgrst, 'reload schema';
