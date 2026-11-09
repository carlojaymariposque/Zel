-- Run this script in the Supabase SQL Editor before using ZEL accounts or listings.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'ZEL member'
    check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  category text not null check (category in (
    'Smartphones',
    'Laptops',
    'Tablets',
    'Gaming Consoles',
    'Custom PCs / Parts',
    'Audio & Accessories'
  )),
  condition text not null check (condition in (
    'Brand New',
    'Refurbished',
    'Pre-Owned',
    'Pre-Owned Fair'
  )),
  price numeric(10, 2) not null check (price >= 10),
  trade_value numeric(10, 2) not null check (trade_value >= 0),
  trade_eligible boolean not null default false,
  specs text not null check (char_length(specs) between 1 and 2000),
  image text not null default '' check (char_length(image) <= 2048),
  rating numeric(2, 1) not null default 5.0,
  stock integer not null default 1 check (stock >= 0),
  description text not null default '' check (char_length(description) <= 2100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listings_active_created_at_idx
  on public.listings (created_at desc)
  where is_active = true;

create index if not exists listings_seller_created_at_idx
  on public.listings (seller_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists listings_set_updated_at on public.listings;
create trigger listings_set_updated_at
before update on public.listings
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'ZEL member'), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select
  id,
  left(coalesce(nullif(trim(raw_user_meta_data ->> 'display_name'), ''), 'ZEL member'), 80)
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.listings enable row level security;

drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable"
on public.profiles for select
to anon, authenticated
using (true);

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Active listings are public" on public.listings;
create policy "Active listings are public"
on public.listings for select
to anon, authenticated
using (is_active = true or (select auth.uid()) = seller_id);

drop policy if exists "Users create their own listings" on public.listings;
create policy "Users create their own listings"
on public.listings for insert
to authenticated
with check ((select auth.uid()) = seller_id);

drop policy if exists "Users update their own listings" on public.listings;
create policy "Users update their own listings"
on public.listings for update
to authenticated
using ((select auth.uid()) = seller_id)
with check ((select auth.uid()) = seller_id);

drop policy if exists "Users delete their own listings" on public.listings;
create policy "Users delete their own listings"
on public.listings for delete
to authenticated
using ((select auth.uid()) = seller_id);

grant select on public.profiles to anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.listings to anon, authenticated;
grant insert, update, delete on public.listings to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception 'Supabase Realtime publication is unavailable.';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'listings'
  ) then
    alter publication supabase_realtime add table public.listings;
  end if;
end;
$$;
