-- Run this script in the Supabase SQL Editor before using ZEL accounts, listings, or orders.

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
  approval_status text not null default 'approved'
    check (approval_status in ('pending', 'approved', 'rejected')),
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

alter table public.listings
  add column if not exists approval_status text not null default 'approved'
  check (approval_status in ('pending', 'approved', 'rejected'));

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
using (
  (is_active = true and approval_status = 'approved')
  or (select auth.uid()) = seller_id
);

drop policy if exists "Users create their own listings" on public.listings;
create policy "Users create their own listings"
on public.listings for insert
to authenticated
with check (
  (select auth.uid()) = seller_id
  and approval_status = 'pending'
);

drop policy if exists "Users update their own listings" on public.listings;
create policy "Users update their own listings"
on public.listings for update
to authenticated
using (
  (select auth.uid()) = seller_id
  and approval_status = 'pending'
)
with check (
  (select auth.uid()) = seller_id
  and approval_status = 'pending'
);

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
      and listing.approval_status = 'approved'
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

-- Admin membership is assigned by a project owner, never by a client account.
create table if not exists public.admin_users (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "Admins can verify their own membership" on public.admin_users;
create policy "Admins can verify their own membership"
on public.admin_users for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists "Admins read all listings" on public.listings;
create policy "Admins read all listings"
on public.listings for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "Admins create listings" on public.listings;
create policy "Admins create listings"
on public.listings for insert
to authenticated
with check ((select public.is_admin()));

drop policy if exists "Admins update listings" on public.listings;
create policy "Admins update listings"
on public.listings for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "Admins delete listings" on public.listings;
create policy "Admins delete listings"
on public.listings for delete
to authenticated
using ((select public.is_admin()));

drop policy if exists "Admins read all trade offers" on public.trade_offers;
create policy "Admins read all trade offers"
on public.trade_offers for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "Admins update trade offer status" on public.trade_offers;
create policy "Admins update trade offer status"
on public.trade_offers for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

grant update (status) on public.trade_offers to authenticated;
revoke all on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;

-- To grant admin access, first create the account in Supabase Authentication,
-- then replace the email below and run this as a project owner in SQL Editor:
-- insert into public.admin_users (id)
-- select id from auth.users where lower(email) = lower('your-admin-email@example.com')
-- on conflict (id) do nothing;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default (
    'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
  ),
  buyer_id uuid not null references auth.users (id) on delete restrict,
  buyer_email text not null check (char_length(buyer_email) between 3 and 254),
  shipping_name text not null check (char_length(shipping_name) between 1 and 120),
  shipping_email text not null check (char_length(shipping_email) between 3 and 254),
  shipping_address text not null check (char_length(shipping_address) between 1 and 300),
  city text not null check (char_length(city) between 1 and 100),
  province text not null check (char_length(province) between 1 and 100),
  postal_code text not null check (char_length(postal_code) between 1 and 20),
  payment_method text not null check (payment_method in (
    'cash_on_delivery',
    'online',
    'bank_transfer'
  )),
  payment_status text not null check (payment_status in (
    'due_on_delivery',
    'pending',
    'paid',
    'failed',
    'refunded'
  )),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  total numeric(12, 2) not null check (total >= 0),
  promo_code text not null default '',
  status text not null default 'placed' check (status in (
    'placed',
    'processing',
    'shipped',
    'completed',
    'cancelled'
  )),
  tracking_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total = subtotal - discount)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  title_snapshot text not null check (char_length(title_snapshot) between 1 and 120),
  image_snapshot text not null default '' check (char_length(image_snapshot) <= 2048),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 100),
  created_at timestamptz not null default now()
);

create index if not exists orders_buyer_created_at_idx
  on public.orders (buyer_id, created_at desc);

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

create or replace function public.set_order_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_order_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Buyers read their own orders" on public.orders;
create policy "Buyers read their own orders"
on public.orders for select
to authenticated
using (buyer_id = (select auth.uid()));

drop policy if exists "Admins read all orders" on public.orders;
create policy "Admins read all orders"
on public.orders for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "Buyers and admins read order items" on public.order_items;
create policy "Buyers and admins read order items"
on public.order_items for select
to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1
    from public.orders placed_order
    where placed_order.id = order_items.order_id
      and placed_order.buyer_id = (select auth.uid())
  )
);

revoke all on public.orders, public.order_items from anon, authenticated;
grant select on public.orders, public.order_items to authenticated;

create or replace function public.place_marketplace_order(
  p_items jsonb,
  p_shipping_name text,
  p_shipping_email text,
  p_shipping_address text,
  p_city text,
  p_province text,
  p_postal_code text,
  p_payment_method text,
  p_promo_code text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := (select auth.uid());
  v_buyer_email text;
  v_order public.orders%rowtype;
  v_item_count integer;
  v_unique_item_count integer;
  v_available_item_count integer;
  v_subtotal numeric(12, 2);
  v_discount numeric(12, 2);
  v_promo_code text := upper(trim(coalesce(p_promo_code, '')));
begin
  if v_buyer is null then
    raise exception 'Sign in before placing an order.';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Your cart must contain between 1 and 20 products.';
  end if;
  if jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Your cart must contain between 1 and 20 products.';
  end if;
  if p_shipping_name is null or char_length(trim(p_shipping_name)) not between 1 and 120
    or p_shipping_email is null
    or char_length(trim(p_shipping_email)) not between 3 and 254
    or trim(p_shipping_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    or p_shipping_address is null or char_length(trim(p_shipping_address)) not between 1 and 300
    or p_city is null or char_length(trim(p_city)) not between 1 and 100
    or p_province is null or char_length(trim(p_province)) not between 1 and 100
    or p_postal_code is null or char_length(trim(p_postal_code)) not between 1 and 20 then
    raise exception 'Enter a valid shipping address.';
  end if;
  if p_payment_method is null
    or p_payment_method not in ('cash_on_delivery', 'online', 'bank_transfer') then
    raise exception 'Choose a valid payment method.';
  end if;
  if v_promo_code <> '' and v_promo_code not in ('NEON2025', 'CYBERTRADE') then
    raise exception 'This promo code is invalid.';
  end if;

  select email
  into v_buyer_email
  from auth.users
  where id = v_buyer;

  if v_buyer_email is null then
    raise exception 'Your account email could not be verified.';
  end if;

  select count(*), count(distinct item.listing_id)
  into v_item_count, v_unique_item_count
  from jsonb_to_recordset(p_items) as item(listing_id uuid, quantity integer);

  if v_item_count = 0 or v_item_count <> v_unique_item_count
    or exists (
      select 1
      from jsonb_to_recordset(p_items) as item(listing_id uuid, quantity integer)
      where item.listing_id is null
        or item.quantity is null
        or item.quantity not between 1 and 100
    ) then
    raise exception 'Your cart contains invalid products or quantities.';
  end if;

  perform listing.id
  from public.listings listing
  join jsonb_to_recordset(p_items) as item(listing_id uuid, quantity integer)
    on item.listing_id = listing.id
  order by listing.id
  for update of listing;

  select count(*)
  into v_available_item_count
  from public.listings listing
  join jsonb_to_recordset(p_items) as item(listing_id uuid, quantity integer)
    on item.listing_id = listing.id
  where listing.is_active
    and listing.approval_status = 'approved'
    and listing.seller_id <> v_buyer
    and listing.stock >= item.quantity;

  if v_available_item_count <> v_item_count then
    raise exception 'One or more products are unavailable or out of stock. Refresh your cart and try again.';
  end if;

  select coalesce(sum(listing.price * item.quantity), 0)
  into v_subtotal
  from public.listings listing
  join jsonb_to_recordset(p_items) as item(listing_id uuid, quantity integer)
    on item.listing_id = listing.id;

  v_discount := case when v_promo_code <> '' then round(v_subtotal * 0.15, 2) else 0 end;

  insert into public.orders (
    buyer_id,
    buyer_email,
    shipping_name,
    shipping_email,
    shipping_address,
    city,
    province,
    postal_code,
    payment_method,
    payment_status,
    subtotal,
    discount,
    total,
    promo_code
  )
  values (
    v_buyer,
    v_buyer_email,
    trim(p_shipping_name),
    lower(trim(p_shipping_email)),
    trim(p_shipping_address),
    trim(p_city),
    trim(p_province),
    trim(p_postal_code),
    p_payment_method,
    case when p_payment_method = 'cash_on_delivery' then 'due_on_delivery' else 'pending' end,
    v_subtotal,
    v_discount,
    v_subtotal - v_discount,
    v_promo_code
  )
  returning * into v_order;

  insert into public.order_items (
    order_id,
    listing_id,
    title_snapshot,
    image_snapshot,
    unit_price,
    quantity
  )
  select
    v_order.id,
    listing.id,
    listing.title,
    listing.image,
    listing.price,
    item.quantity
  from public.listings listing
  join jsonb_to_recordset(p_items) as item(listing_id uuid, quantity integer)
    on item.listing_id = listing.id;

  update public.listings listing
  set stock = listing.stock - item.quantity,
      is_active = case when listing.stock - item.quantity = 0 then false else listing.is_active end
  from jsonb_to_recordset(p_items) as item(listing_id uuid, quantity integer)
  where item.listing_id = listing.id;

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'total', v_order.total,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'created_at', v_order.created_at
  );
end;
$$;

revoke all on function public.place_marketplace_order(
  jsonb, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.place_marketplace_order(
  jsonb, text, text, text, text, text, text, text, text
) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'The supabase_realtime publication is unavailable. Enable Supabase Realtime, then rerun this script.';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_items'
  ) then
    execute 'alter publication supabase_realtime add table public.order_items';
  end if;
end;
$$;

notify pgrst, 'reload schema';
