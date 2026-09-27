alter table public.products
add column if not exists image_url text;

-- Keep this migration safe to run again after a partial setup.
drop policy if exists "Authenticated users can upload product images" on storage.objects;
drop policy if exists "Authenticated users can update product images" on storage.objects;

-- Make sure the product-images storage bucket is public so catalog images can render.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

create policy "Authenticated users can upload product images"
on storage.objects for insert to authenticated
with check (bucket_id = 'product-images');

create policy "Authenticated users can update product images"
on storage.objects for update to authenticated
using (bucket_id = 'product-images')
with check (bucket_id = 'product-images');

notify pgrst, 'reload schema';
