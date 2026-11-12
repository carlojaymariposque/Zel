-- Run this script in the Supabase SQL Editor before using ZEL accounts or listings.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'ZEL member'
    check (char_length(display_name) between 1 and 80),
  avatar_url text not null default ''
    check (char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists avatar_url text not null default ''
  check (char_length(avatar_url) <= 2048);

create table if not exists public.member_private_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text not null default '' check (char_length(phone) <= 30),
  location text not null default '' check (char_length(location) <= 120),
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
  images text[] not null default '{}' check (cardinality(images) <= 6),
  rating numeric(2, 1) not null default 5.0,
  stock integer not null default 1 check (stock >= 0),
  description text not null default '' check (char_length(description) <= 2100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trade_offers (
  id uuid primary key default gen_random_uuid(),
  proposer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  target_listing_id uuid references public.listings (id) on delete set null,
  target_listing_title text not null check (char_length(target_listing_title) between 1 and 120),
  target_listing_value numeric(10, 2) not null check (target_listing_value >= 0),
  offered_device_name text not null check (char_length(offered_device_name) between 2 and 120),
  offered_category text not null check (offered_category in (
    'Smartphones',
    'Laptops',
    'Tablets',
    'Gaming Consoles',
    'Custom PCs / Parts',
    'Audio & Accessories'
  )),
  offered_condition text not null check (offered_condition in ('Mint', 'Good', 'Fair', 'Damaged Screen')),
  estimated_value numeric(10, 2) not null check (estimated_value >= 20),
  cash_delta numeric(10, 2) not null default 0 check (cash_delta >= 0),
  cash_direction text not null default 'i_pay' check (cash_direction in ('i_pay', 'they_pay')),
  notes text not null default '' check (char_length(notes) <= 2000),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 6),
  status text not null default 'pending' check (status in (
    'pending',
    'countered',
    'accepted',
    'declined',
    'cancelled'
  )),
  last_offer_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposer_id <> seller_id)
);

create index if not exists trade_offers_proposer_created_at_idx
  on public.trade_offers (proposer_id, created_at desc);

create index if not exists trade_offers_seller_created_at_idx
  on public.trade_offers (seller_id, created_at desc);

alter table public.listings
  add column if not exists images text[] not null default '{}'
  check (cardinality(images) <= 6);

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

drop trigger if exists trade_offers_set_updated_at on public.trade_offers;
create trigger trade_offers_set_updated_at
before update on public.trade_offers
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
  insert into public.member_private_profiles (id)
  values (new.id)
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

insert into public.member_private_profiles (id)
select id from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.member_private_profiles enable row level security;
alter table public.listings enable row level security;
alter table public.trade_offers enable row level security;

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

drop policy if exists "Users read their own private profile" on public.member_private_profiles;
create policy "Users read their own private profile"
on public.member_private_profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users update their own private profile" on public.member_private_profiles;
create policy "Users update their own private profile"
on public.member_private_profiles for update
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

drop policy if exists "Trade participants read their offers" on public.trade_offers;
create policy "Trade participants read their offers"
on public.trade_offers for select
to authenticated
using ((select auth.uid()) in (proposer_id, seller_id));

drop policy if exists "Users create trade offers for eligible listings" on public.trade_offers;
create policy "Users create trade offers for eligible listings"
on public.trade_offers for insert
to authenticated
with check (
  proposer_id = (select auth.uid())
  and last_offer_by = proposer_id
  and status = 'pending'
  and cardinality(photo_paths) between 1 and 6
  and exists (
    select 1
    from public.listings listing
    where listing.id = target_listing_id
      and listing.seller_id = trade_offers.seller_id
      and listing.trade_eligible = true
      and listing.is_active = true
  )
);

drop policy if exists "Proposers cancel their open trade offers" on public.trade_offers;
create policy "Proposers cancel their open trade offers"
on public.trade_offers for delete
to authenticated
using (
  proposer_id = (select auth.uid())
  and status in ('pending', 'countered')
);

grant select on public.profiles to anon, authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
grant select on public.member_private_profiles to authenticated;
grant update (phone, location) on public.member_private_profiles to authenticated;
grant select on public.listings to anon, authenticated;
grant insert, update, delete on public.listings to authenticated;
grant select, insert, delete on public.trade_offers to authenticated;
revoke update on public.trade_offers from anon, authenticated;

create or replace function public.respond_to_trade_offer(
  p_offer_id uuid,
  p_action text,
  p_cash_delta numeric default null,
  p_cash_direction text default null
)
returns public.trade_offers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_offer public.trade_offers%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in to respond to a trade offer.';
  end if;

  select *
  into v_offer
  from public.trade_offers
  where id = p_offer_id
  for update;

  if not found or v_actor not in (v_offer.proposer_id, v_offer.seller_id) then
    raise exception 'Trade offer not found or access denied.';
  end if;

  if p_action = 'counter' then
    if v_offer.status not in ('pending', 'countered')
      or (v_offer.status = 'pending' and v_actor <> v_offer.seller_id)
      or (v_offer.status = 'countered' and v_actor = v_offer.last_offer_by) then
      raise exception 'You cannot counter this trade offer right now.';
    end if;
    if p_cash_delta is null or p_cash_delta < 0
      or p_cash_direction not in ('i_pay', 'they_pay') then
      raise exception 'Enter a valid cash adjustment.';
    end if;

    update public.trade_offers
    set cash_delta = p_cash_delta,
        cash_direction = p_cash_direction,
        status = 'countered',
        last_offer_by = v_actor
    where id = p_offer_id
    returning * into v_offer;
  elsif p_action = 'accept' then
    if v_offer.status = 'pending' then
      if v_actor <> v_offer.seller_id then
        raise exception 'Only the listing seller can accept the initial offer.';
      end if;
    elsif v_offer.status = 'countered' then
      if v_actor = v_offer.last_offer_by then
        raise exception 'The other participant must respond to the latest counter-offer.';
      end if;
    else
      raise exception 'This trade offer is no longer open.';
    end if;

    update public.trade_offers
    set status = 'accepted'
    where id = p_offer_id
    returning * into v_offer;
  elsif p_action = 'decline' then
    if v_actor <> v_offer.seller_id or v_offer.status not in ('pending', 'countered') then
      raise exception 'Only the seller can decline an open trade offer.';
    end if;

    update public.trade_offers
    set status = 'declined'
    where id = p_offer_id
    returning * into v_offer;
  elsif p_action = 'cancel' then
    if v_actor <> v_offer.proposer_id or v_offer.status not in ('pending', 'countered') then
      raise exception 'Only the proposer can cancel an open trade offer.';
    end if;

    update public.trade_offers
    set status = 'cancelled'
    where id = p_offer_id
    returning * into v_offer;
  else
    raise exception 'Unsupported trade offer action.';
  end if;

  return v_offer;
end;
$$;

revoke all on function public.respond_to_trade_offer(uuid, text, numeric, text) from public, anon;
grant execute on function public.respond_to_trade_offer(uuid, text, numeric, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public profile avatars are readable" on storage.objects;
create policy "Public profile avatars are readable"
on storage.objects for select
to public
using (bucket_id = 'profile-avatars');

drop policy if exists "Users upload their own profile avatars" on storage.objects;
create policy "Users upload their own profile avatars"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users update their own profile avatars" on storage.objects;
create policy "Users update their own profile avatars"
on storage.objects for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete their own profile avatars" on storage.objects;
create policy "Users delete their own profile avatars"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public product photos are readable" on storage.objects;
create policy "Public product photos are readable"
on storage.objects for select
to public
using (bucket_id = 'product-images');

drop policy if exists "Users upload their own product photos" on storage.objects;
create policy "Users upload their own product photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users update their own product photos" on storage.objects;
create policy "Users update their own product photos"
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete their own product photos" on storage.objects;
create policy "Users delete their own product photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trade-condition-photos',
  'trade-condition-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload their own trade condition photos" on storage.objects;
create policy "Users upload their own trade condition photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'trade-condition-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Trade participants read condition photos" on storage.objects;
create policy "Trade participants read condition photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'trade-condition-photos'
  and exists (
    select 1
    from public.trade_offers offer
    where offer.id::text = (storage.foldername(name))[2]
      and offer.proposer_id::text = (storage.foldername(name))[1]
      and (select auth.uid()) in (offer.proposer_id, offer.seller_id)
  )
);

drop policy if exists "Users delete their own trade condition photos" on storage.objects;
create policy "Users delete their own trade condition photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'trade-condition-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

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

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trade_offers'
  ) then
    alter publication supabase_realtime add table public.trade_offers;
  end if;
end;
$$;
