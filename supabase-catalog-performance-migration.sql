-- Catalog query indexes for paginated storefront browsing.
-- Run this migration in the Supabase SQL Editor.

create index if not exists products_category_created_at_idx
  on public.products (category, created_at desc);

create index if not exists products_created_at_idx
  on public.products (created_at desc);

-- Trigram search makes the storefront name search efficient for partial matches.
create extension if not exists pg_trgm;

create index if not exists products_name_trgm_idx
  on public.products using gin (name gin_trgm_ops);
