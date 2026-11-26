-- Homebound schema / migration. Run in Supabase SQL Editor with administrator privileges.
-- Safe to run on an existing project containing the previous Homebound tables.
BEGIN;

create extension if not exists pgcrypto;

create table if not exists public.landlords (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null default '',
    approved_at timestamptz not null default now()
);

create table if not exists public.listings (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    title text not null check (char_length(btrim(title)) between 3 and 160),
    type text not null check (type in ('Dormitory','Bedspace','Apartment')),
    location_zone text not null,
    distance text not null default '',
    min_price numeric(12,2) not null check (min_price >= 0),
    max_price numeric(12,2) not null check (max_price >= min_price),
    price_range_str text not null,
    lat double precision check (lat between -90 and 90),
    lng double precision check (lng between -180 and 180),
    owner_name text not null,
    owner_phone text not null default '',
    main_image text not null default '',
    note text not null default '',
    rooms jsonb not null default '[]'::jsonb
        check (jsonb_typeof(rooms) = 'array' and jsonb_array_length(rooms) > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Upgrade older schema in-place; coordinates are optional for free-text addresses.
alter table public.listings add column if not exists note text not null default '';
alter table public.listings alter column lat drop not null;
alter table public.listings alter column lng drop not null;
create index if not exists listings_owner_id_idx on public.listings(owner_id);
create index if not exists listings_updated_at_idx on public.listings(updated_at desc);

create or replace function public.homebound_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists listings_updated_at_trigger on public.listings;
create trigger listings_updated_at_trigger before update on public.listings
for each row execute function public.homebound_set_updated_at();

alter table public.landlords enable row level security;
alter table public.listings enable row level security;
drop policy if exists "Landlord can read own approval" on public.landlords;
create policy "Landlord can read own approval" on public.landlords for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "Anyone can read listings" on public.listings;
create policy "Anyone can read listings" on public.listings for select to anon, authenticated using (true);
drop policy if exists "Approved landlord can add own listings" on public.listings;
create policy "Approved landlord can add own listings" on public.listings for insert to authenticated
with check (owner_id = (select auth.uid()) and exists
    (select 1 from public.landlords where user_id = (select auth.uid())));
drop policy if exists "Approved landlord can update own listings" on public.listings;
create policy "Approved landlord can update own listings" on public.listings for update to authenticated
using (owner_id = (select auth.uid()) and exists
    (select 1 from public.landlords where user_id = (select auth.uid())))
with check (owner_id = (select auth.uid()) and exists
    (select 1 from public.landlords where user_id = (select auth.uid())));
drop policy if exists "Approved landlord can delete own listings" on public.listings;
create policy "Approved landlord can delete own listings" on public.listings for delete to authenticated
using (owner_id = (select auth.uid()) and exists
    (select 1 from public.landlords where user_id = (select auth.uid())));

-- Student-initiated holds. The request token is a browser-held secret used to
-- retrieve or cancel that request; it must not be exposed through public SELECT.
create table if not exists public.hold_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  room_name text not null,
  student_name text not null,
  student_phone text not null,
  student_email text not null,
  visit_date date not null,
  visit_time time not null,
  request_token uuid not null,
  status text not null default 'Pending Approval'
    check (status in ('Pending Approval','Confirmed Visit','Declined','Cancelled by Student')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists hold_requests_owner_idx on public.hold_requests(owner_id, created_at desc);
create index if not exists hold_requests_listing_idx on public.hold_requests(listing_id);
alter table public.hold_requests enable row level security;
drop policy if exists "Owners read their hold requests" on public.hold_requests;
create policy "Owners read their hold requests" on public.hold_requests for select to authenticated
using (owner_id = (select auth.uid()) and exists
    (select 1 from public.landlords where user_id = (select auth.uid())));
-- All student writes/reads use token-aware RPCs. Owners update status via dedicated RPC.

create or replace function public.homebound_create_hold(
  p_listing_id uuid, p_room_name text, p_student_name text, p_student_phone text,
  p_student_email text, p_visit_date date, p_visit_time time, p_request_token uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_id uuid; v_rooms jsonb;
begin
  if p_request_token is null or length(btrim(p_student_name)) < 2
     or length(btrim(p_student_name)) > 150 or length(p_student_phone) > 35
     or length(p_student_email) > 250 or length(btrim(p_room_name)) = 0
     or p_visit_date is null or p_visit_date < current_date or p_visit_date > current_date + 180
     or p_visit_time is null then
    raise exception 'Please provide valid visitation details.';
  end if;
  select owner_id, rooms into v_owner, v_rooms from public.listings where id = p_listing_id;
  if v_owner is null or not exists (
    select 1 from jsonb_array_elements(v_rooms) r
      where r->>'name' = p_room_name and coalesce(r->>'status','Available') ilike 'Available%'
  ) then raise exception 'The selected room is not available.'; end if;
  insert into public.hold_requests (listing_id,owner_id,room_name,student_name,
    student_phone,student_email,visit_date,visit_time,request_token)
  values (p_listing_id,v_owner,p_room_name,btrim(p_student_name),p_student_phone,
    p_student_email,p_visit_date,p_visit_time,p_request_token)
  returning id into v_id;
  return jsonb_build_object('id',v_id,'status','Pending Approval');
end;
$$;

create or replace function public.homebound_get_hold(p_id uuid,p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',h.id,'status',
    case when h.expires_at < now() and h.status = 'Pending Approval'
      then 'Expired' else h.status end,
    'expires_at',h.expires_at, 'visit_date',h.visit_date,'visit_time',h.visit_time)
  from public.hold_requests h where h.id = p_id and h.request_token = p_token;
$$;

create or replace function public.homebound_cancel_hold(p_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  update public.hold_requests set status = 'Cancelled by Student'
    where id = p_id and request_token = p_token
      and status in ('Pending Approval','Confirmed Visit');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.homebound_owner_set_hold_status(p_id uuid,p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  if p_status not in ('Confirmed Visit','Declined') then
    raise exception 'Invalid hold status.';
  end if;
  update public.hold_requests set status = p_status
    where id = p_id and status = 'Pending Approval' and expires_at > now()
    and owner_id = auth.uid()
    and exists (select 1 from public.landlords where user_id = auth.uid());
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- Student -> landlord messaging, with student token-based read access.
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_token uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_conversations_owner_idx on public.chat_conversations(owner_id,updated_at desc);
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender text not null check (sender in ('student','owner')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_conversation_idx on public.chat_messages(conversation_id,created_at);

create or replace function public.homebound_touch_conversation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists chat_message_touch on public.chat_messages;
create trigger chat_message_touch after insert on public.chat_messages
for each row execute function public.homebound_touch_conversation();

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
drop policy if exists "Owners read their conversations" on public.chat_conversations;
create policy "Owners read their conversations" on public.chat_conversations
for select to authenticated using (owner_id = (select auth.uid()) and exists
  (select 1 from public.landlords where user_id = (select auth.uid())));
drop policy if exists "Owners read conversation messages" on public.chat_messages;
create policy "Owners read conversation messages" on public.chat_messages
for select to authenticated using (exists (
  select 1 from public.chat_conversations c where c.id = conversation_id
  and c.owner_id = (select auth.uid()) and exists
    (select 1 from public.landlords where user_id = (select auth.uid()))
));
drop policy if exists "Owners reply to their conversations" on public.chat_messages;
create policy "Owners reply to their conversations" on public.chat_messages
for insert to authenticated with check (sender = 'owner' and exists (
  select 1 from public.chat_conversations c where c.id = conversation_id
  and c.owner_id = (select auth.uid()) and exists
    (select 1 from public.landlords where user_id = (select auth.uid()))
));

create or replace function public.homebound_student_send(
  p_listing_id uuid,p_conversation_id uuid,p_token uuid,p_message text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;v_owner uuid;
begin
  if p_token is null or length(btrim(p_message)) not between 1 and 2000 then
    raise exception 'Enter a message of up to 2000 characters.';
  end if;
  if p_conversation_id is null then
    select owner_id into v_owner from public.listings where id = p_listing_id;
    if v_owner is null then raise exception 'Property no longer exists.'; end if;
    insert into public.chat_conversations (listing_id,owner_id,student_token)
       values (p_listing_id,v_owner,p_token) returning id into v_id;
  else
    select id into v_id from public.chat_conversations
      where id = p_conversation_id and listing_id = p_listing_id and student_token = p_token;
    if v_id is null then raise exception 'Conversation access denied.'; end if;
  end if;
  insert into public.chat_messages (conversation_id,sender,body)
     values (v_id,'student',btrim(p_message));
  return v_id;
end;
$$;

create or replace function public.homebound_student_messages(p_id uuid,p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'sender',m.sender,
     'body',m.body,'created_at',m.created_at) order by m.created_at),'[]'::jsonb)
  from (select id from public.chat_conversations where id=p_id and student_token=p_token) c
  join lateral (
     select id,sender,body,created_at from public.chat_messages
     where conversation_id=c.id order by created_at desc limit 200
  ) m on true;
$$;

-- Browser roles do not get direct INSERT/UPDATE/DELETE on sensitive hold/chat tables.
grant usage on schema public to anon,authenticated;
grant select on public.listings to anon,authenticated;
grant insert,update,delete on public.listings to authenticated;
grant select on public.landlords to authenticated;
grant select on public.hold_requests,public.chat_conversations to authenticated;
grant select,insert on public.chat_messages to authenticated;
revoke insert,update,delete on public.landlords from anon,authenticated;
revoke insert,update,delete on public.hold_requests from anon,authenticated;
revoke insert,update,delete on public.chat_conversations from anon,authenticated;
revoke update,delete on public.chat_messages from anon,authenticated;
revoke all on function public.homebound_create_hold(uuid,text,text,text,text,date,time,uuid) from public;
revoke all on function public.homebound_get_hold(uuid,uuid) from public;
revoke all on function public.homebound_cancel_hold(uuid,uuid) from public;
revoke all on function public.homebound_owner_set_hold_status(uuid,text) from public;
revoke all on function public.homebound_student_send(uuid,uuid,uuid,text) from public;
revoke all on function public.homebound_student_messages(uuid,uuid) from public;
grant execute on function public.homebound_create_hold(uuid,text,text,text,text,date,time,uuid) to anon,authenticated;
grant execute on function public.homebound_get_hold(uuid,uuid) to anon,authenticated;
grant execute on function public.homebound_cancel_hold(uuid,uuid) to anon,authenticated;
grant execute on function public.homebound_owner_set_hold_status(uuid,text) to authenticated;
grant execute on function public.homebound_student_send(uuid,uuid,uuid,text) to anon,authenticated;
grant execute on function public.homebound_student_messages(uuid,uuid) to anon,authenticated;

-- Publicly viewable listing photos; uploads restricted to approved landlord UUID folder.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('listing-images','listing-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "Homebound photo upload" on storage.objects;
create policy "Homebound photo upload" on storage.objects for insert to authenticated
with check (bucket_id='listing-images' and (storage.foldername(name))[1]=auth.uid()::text
  and exists (select 1 from public.landlords where user_id=auth.uid()));
drop policy if exists "Homebound photo owner delete" on storage.objects;
create policy "Homebound photo owner delete" on storage.objects for delete to authenticated
using (bucket_id='listing-images' and (storage.foldername(name))[1]=auth.uid()::text
  and exists (select 1 from public.landlords where user_id=auth.uid()));

-- Supabase Realtime for landlord-listing and owner message notifications.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='listings') then
    alter publication supabase_realtime add table public.listings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='hold_requests') then
    alter publication supabase_realtime add table public.hold_requests;
  end if;
end $$;

-- Approve each landlord manually with their real Supabase Auth user UUID:
-- insert into public.landlords (user_id,display_name)
-- values ('REPLACE-WITH-AUTH-UUID','Landlord Name')
-- on conflict (user_id) do update set display_name=excluded.display_name;

-- ============================================================================
-- TENANT ASSIGNMENTS + AUTOMATIC MONTHLY RENT SCHEDULES
-- One approved landlord manages multiple listings and the tenants assigned to rooms.
-- Run the entire schema once in Supabase SQL Editor. Safe to re-run: existing
-- tenant, payment and rental data is preserved. No real payment or SMS gateway.
-- ============================================================================

-- Existing approved hold requests can become actual recorded rentals.
alter table public.hold_requests drop constraint if exists hold_requests_status_check;
alter table public.hold_requests add constraint hold_requests_status_check
  check (status in ('Pending Approval','Confirmed Visit','Declined','Cancelled by Student','Rented'));

create table if not exists public.tenancies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete restrict,
  room_name text not null,
  tenant_name text not null check (length(btrim(tenant_name)) between 2 and 150),
  tenant_phone text not null check (length(btrim(tenant_phone)) between 7 and 35),
  tenant_email text not null default '',
  monthly_rent numeric(12,2) not null check (monthly_rent > 0),
  start_date date not null,
  due_day integer not null check (due_day between 1 and 31),
  source_hold_id uuid unique references public.hold_requests(id) on delete set null,
  status text not null default 'Active' check (status in ('Active','Ended')),
  end_date date,
  created_at timestamptz not null default now()
);
create index if not exists tenancies_owner_active_idx on public.tenancies(owner_id,status);
create index if not exists tenancies_room_active_idx on public.tenancies(listing_id,room_name,status);

create table if not exists public.rent_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  due_date date not null,
  amount_due numeric(12,2) not null check (amount_due > 0),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(tenancy_id,due_date)
);
create index if not exists rent_payments_owner_due_idx on public.rent_payments(owner_id,due_date desc);

alter table public.tenancies enable row level security;
alter table public.rent_payments enable row level security;
drop policy if exists "Landlord reads own tenancies" on public.tenancies;
create policy "Landlord reads own tenancies" on public.tenancies for select to authenticated
using (owner_id = (select auth.uid()) and exists
  (select 1 from public.landlords where user_id = (select auth.uid())));
drop policy if exists "Landlord reads own rent payments" on public.rent_payments;
create policy "Landlord reads own rent payments" on public.rent_payments for select to authenticated
using (owner_id = (select auth.uid()) and exists
  (select 1 from public.landlords where user_id = (select auth.uid())));
-- Students never have table read access to tenant names, phones, or payments.
revoke all on public.tenancies,public.rent_payments from anon,authenticated;
grant select on public.tenancies,public.rent_payments to authenticated;

-- '4 Bedspaces' means four separate renters can be assigned. A private unit
-- (for example '2-3 Persons' or '1 Person') counts as ONE rental agreement.
create or replace function public.homebound_room_slots(p_capacity text)
returns integer language sql immutable set search_path = '' as $$
  select case when coalesce(p_capacity,'') ~* 'bedspace|beds?'
     then greatest(1, least(100, coalesce(
         nullif(substring(p_capacity from '[0-9]+'), '')::integer, 1)))
     else 1 end;
$$;

-- Prevent listing-editor changes that remove an occupied room or show a FULL
-- room as Available. Transactional tenancy RPCs can update the room status.
create or replace function public.homebound_protect_occupied_rooms()
returns trigger language plpgsql set search_path = '' as $$
declare rec record; room jsonb; slots integer;
begin
  for rec in select room_name,count(*)::integer as occupied
     from public.tenancies where listing_id = new.id and status = 'Active'
     group by room_name
  loop
    select r.value into room from jsonb_array_elements(new.rooms) r
      where r.value->>'name'=rec.room_name limit 1;
    if room is null then raise exception 'Cannot remove occupied room "%". End its tenancy first.', rec.room_name; end if;
    slots := public.homebound_room_slots(room->>'capacity');
    if rec.occupied > slots then
      raise exception 'Room "%" has more tenants than its new capacity.', rec.room_name;
    end if;
    if rec.occupied >= slots and coalesce(room->>'status','Available') ilike 'Available%' then
      raise exception 'Room "%" is fully occupied. End the tenancy to reopen it.', rec.room_name;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists homebound_occupied_room_guard on public.listings;
create trigger homebound_occupied_room_guard before update of rooms on public.listings
for each row execute function public.homebound_protect_occupied_rooms();

-- Assign the tenant to the chosen room, check capacity, and update public
-- availability IN ONE database transaction. The listing row lock prevents
-- concurrent assignments from overbooking a bedspace.
create or replace function public.homebound_create_tenancy(
  p_listing_id uuid,p_room_name text,p_tenant_name text,p_phone text,p_email text,
  p_start_date date,p_due_day integer,p_monthly_rent numeric,p_hold_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_rooms jsonb; v_room jsonb; v_slots integer;
  v_occupied integer; v_new_count integer; v_id uuid; v_status text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.landlords where user_id=auth.uid()) then
    raise exception 'Approved landlord login required.';
  end if;
  if length(btrim(coalesce(p_tenant_name,''))) not between 2 and 150
     or length(btrim(coalesce(p_phone,''))) not between 7 and 35
     or length(coalesce(p_email,'')) > 250
     or p_start_date is null or p_start_date < date '2000-01-01'
     or p_start_date > current_date + 730
     or p_due_day not between 1 and 31
     or p_monthly_rent is null or p_monthly_rent <= 0
     or p_monthly_rent > 10000000 then
    raise exception 'Please provide valid tenant and monthly rental details.';
  end if;
  select owner_id,rooms into v_owner,v_rooms from public.listings
    where id=p_listing_id for update;
  if v_owner is null or v_owner<>auth.uid() then raise exception 'Property access denied.'; end if;
  if (select count(*) from jsonb_array_elements(v_rooms) r
      where r->>'name'=p_room_name) <> 1 then
    raise exception 'Select a unique existing room name.';
  end if;
  select r into v_room from jsonb_array_elements(v_rooms) r
    where r->>'name'=p_room_name limit 1;
  if coalesce(v_room->>'status','Available') not ilike 'Available%' then
    raise exception 'The selected room is not marked available.';
  end if;
  v_slots := public.homebound_room_slots(v_room->>'capacity');
  select count(*) into v_occupied from public.tenancies
    where listing_id=p_listing_id and room_name=p_room_name and status='Active';
  if v_occupied >= v_slots then raise exception 'This room is already fully rented.'; end if;
  if p_hold_id is not null and not exists (
    select 1 from public.hold_requests where id=p_hold_id
    and listing_id=p_listing_id and room_name=p_room_name
    and owner_id=auth.uid() and status='Confirmed Visit'
  ) then raise exception 'Only a confirmed visitation for this room can be linked.'; end if;
  insert into public.tenancies(owner_id,listing_id,room_name,tenant_name,tenant_phone,
    tenant_email,monthly_rent,start_date,due_day,source_hold_id)
  values(auth.uid(),p_listing_id,p_room_name,btrim(p_tenant_name),btrim(p_phone),
    btrim(coalesce(p_email,'')),p_monthly_rent,p_start_date,p_due_day,p_hold_id)
  returning id into v_id;
  v_new_count:=v_occupied+1;
  v_status:=case when v_new_count >= v_slots then 'Full / Occupied'
    when v_slots=1 then 'Available'
    else format('Available (%s bed%s left)',v_slots-v_new_count,case when v_slots-v_new_count=1 then '' else 's' end) end;
  update public.listings set rooms=(
    select jsonb_agg(case when r.value->>'name'=p_room_name
      then jsonb_set(r.value,'{status}',to_jsonb(v_status),true)
      else r.value end order by r.ordinality)
    from jsonb_array_elements(v_rooms) with ordinality r(value,ordinality)
  ) where id=p_listing_id;
  if p_hold_id is not null then
    update public.hold_requests set status='Rented' where id=p_hold_id;
  end if;
  return v_id;
end;
$$;

-- Ending a tenancy retains historic payment records but frees the rental slot.
create or replace function public.homebound_end_tenancy(p_tenancy_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_t public.tenancies%rowtype; v_rooms jsonb; v_room jsonb;
  v_occupied integer; v_slots integer; v_status text;
begin
  if auth.uid() is null or not exists (select 1 from public.landlords where user_id=auth.uid())
    then raise exception 'Approved landlord login required.'; end if;
  select * into v_t from public.tenancies where id=p_tenancy_id and owner_id=auth.uid();
  if not found or v_t.status<>'Active' then return false; end if;
  select rooms into v_rooms from public.listings where id=v_t.listing_id for update;
  update public.tenancies set status='Ended',end_date=(now() at time zone 'Asia/Manila')::date
    where id=v_t.id and owner_id=auth.uid() and status='Active';
  -- Do not bill upcoming months after move-out (keep amounts already marked paid).
  delete from public.rent_payments
    where tenancy_id=v_t.id and paid_at is null
    and due_date > (now() at time zone 'Asia/Manila')::date;
  select r into v_room from jsonb_array_elements(v_rooms) r
    where r->>'name'=v_t.room_name limit 1;
  if v_room is not null then
    v_slots:=public.homebound_room_slots(v_room->>'capacity');
    select count(*) into v_occupied from public.tenancies
      where listing_id=v_t.listing_id and room_name=v_t.room_name and status='Active';
    v_status:=case when v_occupied >= v_slots then 'Full / Occupied'
      when v_slots=1 then 'Available'
      else format('Available (%s bed%s left)',v_slots-v_occupied,case when v_slots-v_occupied=1 then '' else 's' end) end;
    update public.listings set rooms=(
      select jsonb_agg(case when r.value->>'name'=v_t.room_name
        then jsonb_set(r.value,'{status}',to_jsonb(v_status),true)
        else r.value end order by r.ordinality)
      from jsonb_array_elements(v_rooms) with ordinality r(value,ordinality)
    ) where id=v_t.listing_id;
  end if;
  return true;
end;
$$;

-- Generate due dates for past/current months and ONE upcoming month. The
-- unique key keeps repeated dashboard refreshes from duplicating payments.
-- A due day of 29/30/31 is clamped to the last day of shorter months.
create or replace function public.homebound_sync_payments()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_added integer;
begin
  if auth.uid() is null or not exists (select 1 from public.landlords where user_id=auth.uid())
    then raise exception 'Approved landlord login required.'; end if;
  insert into public.rent_payments(owner_id,tenancy_id,due_date,amount_due)
  select t.owner_id,t.id,dates.due_date,t.monthly_rent
  from public.tenancies t
  cross join lateral generate_series(
    date_trunc('month',greatest(t.start_date,(now() at time zone 'Asia/Manila')::date - interval '24 months')),
    date_trunc('month',(now() at time zone 'Asia/Manila')::date + interval '1 month'),
    interval '1 month') as months(first_day)
  cross join lateral (
    select (months.first_day::date
      + (least(t.due_day, extract(day from (months.first_day + interval '1 month - 1 day'))::integer)-1))::date as due_date
  ) dates
  where t.owner_id=auth.uid()
    and dates.due_date>=t.start_date
    and (t.end_date is null or dates.due_date<=t.end_date)
  on conflict(tenancy_id,due_date) do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

create or replace function public.homebound_mark_payment(p_payment_id uuid,p_paid boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  if auth.uid() is null or not exists (select 1 from public.landlords where user_id=auth.uid())
    then raise exception 'Approved landlord login required.'; end if;
  update public.rent_payments set paid_at=case when p_paid then now() else null end
    where id=p_payment_id and owner_id=auth.uid();
  get diagnostics v_rows=row_count;
  return v_rows > 0;
end;
$$;

-- Grant only the narrowly-scoped database operations exposed by the UI.
revoke all on function public.homebound_create_tenancy(uuid,text,text,text,text,date,integer,numeric,uuid) from public,anon,authenticated;
revoke all on function public.homebound_end_tenancy(uuid) from public,anon,authenticated;
revoke all on function public.homebound_sync_payments() from public,anon,authenticated;
revoke all on function public.homebound_mark_payment(uuid,boolean) from public,anon,authenticated;
grant execute on function public.homebound_create_tenancy(uuid,text,text,text,text,date,integer,numeric,uuid) to authenticated;
grant execute on function public.homebound_end_tenancy(uuid) to authenticated;
grant execute on function public.homebound_sync_payments() to authenticated;
grant execute on function public.homebound_mark_payment(uuid,boolean) to authenticated;

-- Publish owner-only table change events for automatic dashboard refreshing.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='tenancies') then
    alter publication supabase_realtime add table public.tenancies;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='rent_payments') then
    alter publication supabase_realtime add table public.rent_payments;
  end if;
end $$;

-- ============================================================================
-- HOMEBOUND UPDATE: per-bed availability and student visitation notifications
-- Re-runnable migration. No existing listing, payment, hold, or chat records deleted.
-- ============================================================================

-- Each active tenant receives a stable slot within a room.
alter table public.tenancies add column if not exists bed_slot text;

-- Assign individual slots to pre-existing active rentals, retaining their records.
do $$
declare t record; n integer;
begin
  for t in select id, listing_id, room_name from public.tenancies
      where status='Active' and bed_slot is null order by created_at, id
  loop
    select i into n from generate_series(1,100) i
    where not exists (select 1 from public.tenancies other
      where other.status='Active' and other.listing_id=t.listing_id
        and other.room_name=t.room_name and other.bed_slot=('bed-'||i))
    order by i limit 1;
    if n is null then raise exception 'More than 100 occupied slots in a room.'; end if;
    update public.tenancies set bed_slot=('bed-'||n) where id=t.id;
  end loop;
end $$;
create unique index if not exists tenancies_one_active_bed
  on public.tenancies(listing_id,room_name,bed_slot)
  where status='Active' and bed_slot is not null;

-- Backfill a durable bed array for old listings without a bed array. Existing
-- room capacity and any pre-existing blocked beds are preserved.
create or replace function public.homebound_migrate_room_beds(p_listing_id uuid,p_rooms jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare room jsonb; bed jsonb; beds jsonb; output jsonb := '[]'::jsonb;
    capacity integer; n integer; free_count integer; old_free integer;
    status text; existing jsonb; occupied boolean; legacy text; available_allocated integer;
begin
  for room in select value from jsonb_array_elements(coalesce(p_rooms,'[]'::jsonb)) loop
    capacity := greatest(1,least(100,coalesce(nullif(room->>'totalCapacity','')::integer,
                 public.homebound_room_slots(room->>'capacity'))));
    existing := coalesce(room->'beds','[]'::jsonb);
    if jsonb_typeof(existing) <> 'array' then existing := '[]'::jsonb; end if;
    -- Never silently discard a bed; editing later must explicitly respect occupancy.
    if jsonb_array_length(existing) > capacity then capacity := jsonb_array_length(existing); end if;
    if exists (select 1 from public.tenancies t where t.listing_id=p_listing_id
        and t.room_name=room->>'name' and t.status='Active'
        and t.bed_slot ~ '^bed-[0-9]+$'
        and substring(t.bed_slot from 5)::integer > capacity) then
      raise exception 'Occupied bed exceeds the room capacity for "%".',room->>'name';
    end if;
    legacy := coalesce(room->>'status','Available');
    old_free := capacity;
    if legacy !~* '^Available' then old_free := 0;
    elsif legacy ~* '([0-9]+) beds? left' then
      old_free := least(capacity,substring(legacy from '([0-9]+) beds? left')::integer);
    end if;
    beds := '[]'::jsonb; free_count := 0; available_allocated := 0;
    for n in 1..capacity loop
      select value into bed from jsonb_array_elements(existing) where value->>'id'='bed-'||n limit 1;
      occupied := exists (select 1 from public.tenancies t where t.listing_id=p_listing_id
        and t.room_name=room->>'name' and t.status='Active' and t.bed_slot='bed-'||n);
      status := case when occupied then 'Occupied'
        when bed->>'status'='Unavailable' then 'Unavailable'
        when bed->>'status'='Available' then 'Available'
        when available_allocated < old_free then 'Available'
        else 'Unavailable' end;
      if status='Available' then
        free_count:=free_count+1;available_allocated:=available_allocated+1;
      end if;
      beds := beds || jsonb_build_array(
        jsonb_build_object('id','bed-'||n,'status',status) ||
        CASE WHEN status='Occupied' AND bed ? 'availableFrom'
             THEN jsonb_build_object('availableFrom',bed->>'availableFrom')
             ELSE '{}'::jsonb END ||
        CASE WHEN bed ? 'reservedFor' AND status IN ('Available','Occupied')
             THEN jsonb_build_object('reservedFor',bed->>'reservedFor')
             ELSE '{}'::jsonb END);

      bed := null;
    end loop;
    room := jsonb_set(room,'{totalCapacity}',to_jsonb(capacity),true);
    room := jsonb_set(room,'{beds}',beds,true);
    room := jsonb_set(room,'{status}',to_jsonb(case when free_count=0 then 'Full / Occupied'
      else format('Available (%s bed%s left)',free_count,case when free_count=1 then '' else 's' end) end),true);
    output:=output || jsonb_build_array(room);
  end loop;
  return output;
end;
$$;

update public.listings l set rooms=public.homebound_migrate_room_beds(l.id,l.rooms)
where exists (select 1 from jsonb_array_elements(l.rooms) r
  where not (r ? 'beds') or not (r ? 'totalCapacity'));

-- Recalculate one slot and room's public availability without changing others.
create or replace function public.homebound_apply_bed_status(
  p_rooms jsonb,p_room_name text,p_bed_slot text,p_status text)
returns jsonb language plpgsql set search_path = '' as $$
declare room jsonb; bed jsonb; items jsonb := '[]'::jsonb;
  updated_beds jsonb; free_count integer; n integer; found_room boolean := false;
  found_slot boolean := false;
begin
  if p_status not in ('Available','Unavailable','Occupied') then
    raise exception 'Invalid bed status.';
  end if;
  for room in select value from jsonb_array_elements(p_rooms) loop
    if room->>'name'=p_room_name then
      found_room:=true;updated_beds:='[]'::jsonb;free_count:=0;
      for bed in select value from jsonb_array_elements(room->'beds') loop
        if bed->>'id'=p_bed_slot then
          bed:=jsonb_set(bed,'{status}',to_jsonb(p_status),true);
          found_slot:=true;
        end if;
        if bed->>'status'='Available' then free_count:=free_count+1; end if;
        updated_beds:=updated_beds || jsonb_build_array(bed);
      end loop;
      room:=jsonb_set(room,'{beds}',updated_beds,true);
      room:=jsonb_set(room,'{status}',to_jsonb(case when free_count=0 then 'Full / Occupied'
        else format('Available (%s bed%s left)',free_count,
          case when free_count=1 then '' else 's' end) end),true);
    end if;
    items:=items || jsonb_build_array(room);
  end loop;
  if not found_room or not found_slot then raise exception 'Bed slot no longer exists.'; end if;
  return items;
end;
$$;

-- Validate edits server-side: no occupied tenant can be lost or made vacant.
create or replace function public.homebound_protect_occupied_rooms()
returns trigger language plpgsql set search_path = '' as $$
declare room jsonb; bed jsonb; slot text; n integer; capacity integer;
  occupied integer; free_count integer; slot_tenants integer;
begin
  for room in select value from jsonb_array_elements(new.rooms) loop
    capacity:=nullif(room->>'totalCapacity','')::integer;
    if capacity is null or capacity not between 1 and 100 or
       coalesce(jsonb_typeof(room->'beds'),'null') <> 'array' or
       jsonb_array_length(room->'beds') <> capacity then
      raise exception 'Room "%" must contain exactly its declared bed capacity.',room->>'name';
    end if;
    free_count:=0;
    for n in 1..capacity loop
      slot:='bed-'||n;
      select value into bed from jsonb_array_elements(room->'beds') b
        where b.value->>'id'=slot limit 1;
      if bed is null then raise exception 'Room "%" is missing slot %.',room->>'name',slot; end if;
      if bed->>'status' not in ('Available','Unavailable','Occupied') then
        raise exception 'Invalid bed status in room "%".',room->>'name'; end if;
      select count(*) into slot_tenants from public.tenancies
         where listing_id=new.id and room_name=room->>'name'
           and bed_slot=slot and status='Active';
      if (bed->>'status'='Occupied') <> (slot_tenants=1) then
        raise exception 'Bed % in room "%" must match the active tenancy.',slot,room->>'name';
      end if;
      if bed->>'status'='Available' then free_count:=free_count+1; end if;
      bed:=null;
    end loop;
    if (free_count > 0) <> (coalesce(room->>'status','') ilike 'Available%') then
      raise exception 'Room "%" availability does not match its bed slots.',room->>'name';
    end if;
  end loop;
  -- A room with active tenants cannot be removed or renamed.
  if exists (select 1 from public.tenancies t where t.listing_id=new.id
      and t.status='Active' and not exists (
        select 1 from jsonb_array_elements(new.rooms) r
        where r->>'name'=t.room_name)) then
    raise exception 'End active tenancies before removing or renaming their room.';
  end if;
  return new;
end;
$$;
drop trigger if exists homebound_occupied_room_guard on public.listings;
create trigger homebound_occupied_room_guard before insert or update of rooms on public.listings
for each row execute function public.homebound_protect_occupied_rooms();

-- The owner can block/unblock a VACANT bed only. Occupied slots are immutable
-- until the tenant is ended. Locking the listing serializes concurrent operations.
create or replace function public.homebound_set_bed_available(
 p_listing_id uuid,p_room_name text,p_bed_slot text,p_available boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_rooms jsonb; v_current text;
begin
  if auth.uid() is null or not exists (select 1 from public.landlords where user_id=auth.uid()) then
    raise exception 'Approved landlord login required.'; end if;
  select owner_id,rooms into v_owner,v_rooms from public.listings
    where id=p_listing_id for update;
  if v_owner is distinct from auth.uid() then raise exception 'Property access denied.'; end if;
  select bed->>'status' into v_current
    from jsonb_array_elements(v_rooms) r
    cross join lateral jsonb_array_elements(r->'beds') bed
    where r->>'name'=p_room_name and bed->>'id'=p_bed_slot limit 1;
  if v_current is null then raise exception 'Bed slot does not exist.'; end if;
  if v_current='Occupied' or exists (select 1 from public.tenancies
    where listing_id=p_listing_id and room_name=p_room_name
      and bed_slot=p_bed_slot and status='Active') then
    raise exception 'An occupied bed cannot be changed until the tenancy ends.';
  end if;
  update public.listings set rooms=public.homebound_apply_bed_status(v_rooms,
    p_room_name,p_bed_slot,case when p_available then 'Available' else 'Unavailable' end)
    where id=p_listing_id;
  return true;
end;
$$;

-- Assign a PARTICULAR bed, with one transaction and a listing row lock.
create or replace function public.homebound_assign_bed(
  p_listing_id uuid,p_room_name text,p_bed_slot text,
  p_tenant_name text,p_phone text,p_email text,p_start_date date,
  p_due_day integer,p_monthly_rent numeric,p_hold_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;v_rooms jsonb;v_state text;v_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.landlords where user_id=auth.uid()) then
    raise exception 'Approved landlord login required.'; end if;
  if length(btrim(coalesce(p_tenant_name,''))) not between 2 and 150
     or length(btrim(coalesce(p_phone,''))) not between 7 and 35
     or length(coalesce(p_email,''))>250
     or p_start_date is null or p_start_date < date '2000-01-01'
     or p_start_date > current_date+730
     or p_due_day not between 1 and 31 or p_monthly_rent is null
     or p_monthly_rent<=0 or p_monthly_rent>10000000 then
    raise exception 'Please provide valid tenant and rent details.';
  end if;
  select owner_id,rooms into v_owner,v_rooms from public.listings
     where id=p_listing_id for update;
  if v_owner is distinct from auth.uid() then raise exception 'Property access denied.'; end if;
  select bed->>'status' into v_state
    from jsonb_array_elements(v_rooms) r
    cross join lateral jsonb_array_elements(r->'beds') bed
    where r->>'name'=p_room_name and bed->>'id'=p_bed_slot limit 1;
  if v_state is distinct from 'Available' then
    raise exception 'The selected bed is not available.'; end if;
  if exists (select 1 from public.tenancies where listing_id=p_listing_id
    and room_name=p_room_name and bed_slot=p_bed_slot and status='Active') then
    raise exception 'The selected bed is already rented.'; end if;
  if p_hold_id is not null and not exists (select 1 from public.hold_requests
    where id=p_hold_id and listing_id=p_listing_id and room_name=p_room_name
      and owner_id=auth.uid() and status='Confirmed Visit') then
    raise exception 'The linked visitation is not confirmed for this room.'; end if;
  insert into public.tenancies(owner_id,listing_id,room_name,bed_slot,tenant_name,tenant_phone,
    tenant_email,monthly_rent,start_date,due_day,source_hold_id)
  values(auth.uid(),p_listing_id,p_room_name,p_bed_slot,btrim(p_tenant_name),
    btrim(p_phone),btrim(coalesce(p_email,'')),p_monthly_rent,p_start_date,p_due_day,p_hold_id)
  returning id into v_id;
  update public.listings set rooms=public.homebound_apply_bed_status(v_rooms,p_room_name,p_bed_slot,'Occupied')
      where id=p_listing_id;
  if p_hold_id is not null then
    update public.hold_requests set status='Rented' where id=p_hold_id;
  end if;
  return v_id;
end;
$$;

-- Restore ONLY the bed used by an ending tenant and keep historical payments.
create or replace function public.homebound_end_tenancy(p_tenancy_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare t public.tenancies%rowtype; v_rooms jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.landlords where user_id=auth.uid()) then
     raise exception 'Approved landlord login required.'; end if;
  select * into t from public.tenancies where id=p_tenancy_id and owner_id=auth.uid();
  if not found or t.status<>'Active' then return false; end if;
  select rooms into v_rooms from public.listings where id=t.listing_id for update;
  update public.tenancies set status='Ended',end_date=(now() at time zone 'Asia/Manila')::date
   where id=p_tenancy_id and owner_id=auth.uid() and status='Active';
  delete from public.rent_payments where tenancy_id=p_tenancy_id and paid_at is null
    and due_date>(now() at time zone 'Asia/Manila')::date;
  update public.listings set rooms=public.homebound_apply_bed_status(v_rooms,t.room_name,t.bed_slot,'Available')
   where id=t.listing_id;
  return true;
end;
$$;

-- Attach a hold to a student-accessible conversation at submission time so an
-- approval/decline can appear in that exact conversation, even when it is new.
alter table public.hold_requests add column if not exists chat_conversation_id uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='hold_requests_chat_conversation_fk') then
    alter table public.hold_requests add constraint hold_requests_chat_conversation_fk
      foreign key(chat_conversation_id) references public.chat_conversations(id) on delete set null;
  end if;
end $$;

alter table public.chat_messages drop constraint if exists chat_messages_sender_check;
alter table public.chat_messages add constraint chat_messages_sender_check
  check (sender in ('student','owner','system'));

create or replace function public.homebound_create_hold_with_chat(
  p_listing_id uuid,p_room_name text,p_student_name text,p_student_phone text,
  p_student_email text,p_visit_date date,p_visit_time time,p_request_token uuid,
  p_chat_token uuid,p_conversation_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hold jsonb;v_conv uuid;v_owner uuid;
begin
  if p_chat_token is null then raise exception 'Conversation token is required.'; end if;
  if p_conversation_id is null then
    select owner_id into v_owner from public.listings where id=p_listing_id;
    if v_owner is null then raise exception 'Property no longer exists.'; end if;
    insert into public.chat_conversations(listing_id,owner_id,student_token)
      values(p_listing_id,v_owner,p_chat_token) returning id into v_conv;
  else
    select id into v_conv from public.chat_conversations where id=p_conversation_id
      and listing_id=p_listing_id and student_token=p_chat_token;
    if v_conv is null then raise exception 'Conversation access denied.'; end if;
  end if;
  v_hold:=public.homebound_create_hold(p_listing_id,p_room_name,p_student_name,p_student_phone,
    p_student_email,p_visit_date,p_visit_time,p_request_token);
  update public.hold_requests set chat_conversation_id=v_conv where id=(v_hold->>'id')::uuid;
  return v_hold || jsonb_build_object('conversationId',v_conv);
end;
$$;

create or replace function public.homebound_owner_set_hold_status(p_id uuid,p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare h public.hold_requests%rowtype;v_message text;
begin
  if p_status not in ('Confirmed Visit','Declined') then
    raise exception 'Invalid hold status.'; end if;
  update public.hold_requests set status=p_status
    where id=p_id and status='Pending Approval' and expires_at>now()
      and owner_id=auth.uid() and exists
        (select 1 from public.landlords where user_id=auth.uid())
    returning * into h;
  if not found then return false; end if;
  if h.chat_conversation_id is not null then
    v_message:=case when p_status='Confirmed Visit' then
        'Homebound update: Your visitation request for "'||left(h.room_name,150)||'" on '
        ||h.visit_date::text||' at '||to_char(h.visit_date + h.visit_time,'HH12:MI AM')||' has been APPROVED by the owner.'
      else 'Homebound update: Your visitation request for "'||left(h.room_name,150)||'" on '
        ||h.visit_date::text||' has been DECLINED by the owner. Please message the owner to discuss alternatives.' end;
    insert into public.chat_messages(conversation_id,sender,body)
        values(h.chat_conversation_id,'system',v_message);
  end if;
  return true;
end;
$$;

-- Limit callable, privileged functions to the intended roles only.
revoke all on function public.homebound_migrate_room_beds(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.homebound_apply_bed_status(jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.homebound_set_bed_available(uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function public.homebound_assign_bed(uuid,text,text,text,text,text,date,integer,numeric,uuid) from public,anon,authenticated;
revoke all on function public.homebound_create_hold_with_chat(uuid,text,text,text,text,date,time,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.homebound_set_bed_available(uuid,text,text,boolean) to authenticated;
grant execute on function public.homebound_assign_bed(uuid,text,text,text,text,text,date,integer,numeric,uuid) to authenticated;
grant execute on function public.homebound_create_hold_with_chat(uuid,text,text,text,text,date,time,uuid,uuid,uuid) to anon,authenticated;
-- Retire the old implicit-bed assignment RPC; the client now chooses an exact slot.
revoke execute on function public.homebound_create_tenancy(uuid,text,text,text,text,date,integer,numeric,uuid) from authenticated;

COMMIT;

-- ============================================================================
-- HOMEBOUND: ADDITIONS FOR THE NOVEMBER 2026 OWNER EXPERIENCE
-- Non-destructive extension. Existing listings, photos, chat, visit holds,
-- tenancy records, and rent payment records remain in place.
-- ============================================================================
BEGIN;

-- A planned end is an ESTIMATE. A tenancy remains Active until the owner ends it.
ALTER TABLE public.tenancies
  ADD COLUMN IF NOT EXISTS planned_end_date date;
ALTER TABLE public.tenancies
  ADD COLUMN IF NOT EXISTS announcement_token uuid DEFAULT gen_random_uuid();
UPDATE public.tenancies SET announcement_token=gen_random_uuid() WHERE announcement_token IS NULL;
ALTER TABLE public.tenancies ALTER COLUMN announcement_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS homebound_tenant_announcement_token_idx
  ON public.tenancies(announcement_token);

-- Private landlord announcements; recipients are snapshotted as ACTIVE
-- tenancies at publication, for an unambiguous historical audience.
CREATE TABLE IF NOT EXISTS public.tenant_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES public.listings(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS homebound_announcements_owner_date
  ON public.tenant_announcements(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.tenant_announcement_recipients (
  announcement_id uuid NOT NULL REFERENCES public.tenant_announcements(id) ON DELETE CASCADE,
  tenancy_id uuid NOT NULL REFERENCES public.tenancies(id) ON DELETE CASCADE,
  PRIMARY KEY(announcement_id,tenancy_id)
);
ALTER TABLE public.tenant_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_announcement_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Homebound owner reads own announcements" ON public.tenant_announcements;
CREATE POLICY "Homebound owner reads own announcements"
 ON public.tenant_announcements FOR SELECT TO authenticated
 USING (owner_id=(SELECT auth.uid()) AND EXISTS
   (SELECT 1 FROM public.landlords l WHERE l.user_id=(SELECT auth.uid())));
REVOKE ALL ON public.tenant_announcements FROM anon,authenticated;
REVOKE ALL ON public.tenant_announcement_recipients FROM anon,authenticated;
GRANT SELECT ON public.tenant_announcements TO authenticated;

-- Owner-only announcement publication: do not let an untrusted browser choose
-- individual recipients or impersonate another landlord.
CREATE OR REPLACE FUNCTION public.homebound_publish_announcement(
 p_listing_id uuid,p_title text,p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.landlords l WHERE l.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Approved landlord account required.';
  END IF;
  IF length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 120
     OR length(btrim(coalesce(p_body,''))) NOT BETWEEN 1 AND 1500 THEN
    RAISE EXCEPTION 'Enter an announcement title and message.';
  END IF;
  IF p_listing_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.listings l WHERE l.id=p_listing_id AND l.owner_id=auth.uid()) THEN
    RAISE EXCEPTION 'Selected listing does not belong to this landlord.';
  END IF;
  INSERT INTO public.tenant_announcements(owner_id,listing_id,title,body)
  VALUES (auth.uid(),p_listing_id,btrim(p_title),btrim(p_body)) RETURNING id INTO v_id;
  INSERT INTO public.tenant_announcement_recipients(announcement_id,tenancy_id)
  SELECT v_id,t.id FROM public.tenancies t WHERE t.owner_id=auth.uid()
    AND t.status='Active' AND (p_listing_id IS NULL OR t.listing_id=p_listing_id);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN jsonb_build_object('id',v_id,'recipients',v_count);
END;
$$;

-- Token-only private tenant view, returning announcement text and time, not
-- tenant records, owner credentials, phone numbers, or addresses.
CREATE OR REPLACE FUNCTION public.homebound_tenant_announcements(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,
    'body',a.body,'created_at',a.created_at) ORDER BY a.created_at DESC),'[]'::jsonb)
  FROM public.tenancies t
  JOIN public.tenant_announcement_recipients r ON r.tenancy_id=t.id
  JOIN public.tenant_announcements a ON a.id=r.announcement_id
  WHERE t.announcement_token=p_token;
$$;

-- Expose the EXPECTED available date only in the public bed JSON, never the
-- tenant's identity or their private tenancy record.
CREATE OR REPLACE FUNCTION public.homebound_set_expected_moveout(
 p_tenancy_id uuid,p_date date)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tenancies%ROWTYPE; v_rooms jsonb; v_new_rooms jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
     SELECT 1 FROM public.landlords l WHERE l.user_id=auth.uid()) THEN
     RAISE EXCEPTION 'Approved landlord required.';
  END IF;
  SELECT * INTO t FROM public.tenancies WHERE id=p_tenancy_id AND owner_id=auth.uid() FOR UPDATE;
  IF NOT FOUND OR t.status<>'Active' THEN RAISE EXCEPTION 'Active tenancy not found.'; END IF;
  IF p_date IS NOT NULL AND (p_date<current_date OR p_date<t.start_date OR p_date>current_date+730) THEN
    RAISE EXCEPTION 'Expected move-out must be a future date within 2 years.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.advance_reservations ar
      WHERE ar.listing_id=t.listing_id AND ar.room_name=t.room_name
        AND ar.bed_slot=t.bed_slot AND ar.status='Approved'
        AND (p_date IS NULL OR p_date>=ar.move_in_date)) THEN
    RAISE EXCEPTION 'Cancel the approved advance reservation before changing this expected move-out date.';
  END IF;
  SELECT rooms INTO v_rooms FROM public.listings WHERE id=t.listing_id FOR UPDATE;
  SELECT jsonb_agg(
    CASE WHEN room->>'name'=t.room_name THEN
      jsonb_set(room,'{beds}',(
        SELECT jsonb_agg(
          CASE WHEN bed->>'id'=t.bed_slot THEN
            CASE WHEN p_date IS NULL THEN bed-'availableFrom'
              ELSE jsonb_set(bed,'{availableFrom}',to_jsonb(p_date::text),true)
            END
          ELSE bed END ORDER BY bi)
        FROM jsonb_array_elements(room->'beds') WITH ORDINALITY AS b(bed,bi)
      ),true)
    ELSE room END ORDER BY ri)
  INTO v_new_rooms
  FROM jsonb_array_elements(v_rooms) WITH ORDINALITY AS r(room,ri);
  UPDATE public.tenancies SET planned_end_date=p_date WHERE id=p_tenancy_id;
  UPDATE public.listings SET rooms=v_new_rooms WHERE id=t.listing_id;
  RETURN true;
END;
$$;

-- Advance reservations are separate from visit holds, do NOT mark beds occupied,
-- and do NOT automatically start a tenancy or collect payments.
CREATE TABLE IF NOT EXISTS public.advance_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_name text NOT NULL,
  bed_slot text NOT NULL,
  move_in_date date NOT NULL,
  student_name text NOT NULL CHECK (char_length(btrim(student_name)) BETWEEN 2 AND 150),
  student_phone text NOT NULL CHECK (char_length(btrim(student_phone)) BETWEEN 7 AND 35),
  student_email text NOT NULL CHECK (char_length(btrim(student_email)) BETWEEN 4 AND 250),
  student_token uuid NOT NULL,
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','Approved','Declined','Cancelled','Fulfilled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS homebound_advance_owner_recent
 ON public.advance_reservations(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS homebound_advance_listing_slot
 ON public.advance_reservations(listing_id,room_name,bed_slot,move_in_date);
-- At most ONE accepted advance request per bed, regardless of exact arrival day.
CREATE UNIQUE INDEX IF NOT EXISTS homebound_one_approved_advance_per_bed
 ON public.advance_reservations(listing_id,room_name,bed_slot) WHERE status='Approved';
ALTER TABLE public.advance_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Homebound owner reads advance requests" ON public.advance_reservations;
CREATE POLICY "Homebound owner reads advance requests" ON public.advance_reservations
 FOR SELECT TO authenticated
 USING (owner_id=(SELECT auth.uid()) AND EXISTS (
   SELECT 1 FROM public.landlords l WHERE l.user_id=(SELECT auth.uid())));
REVOKE ALL ON public.advance_reservations FROM anon,authenticated;
GRANT SELECT ON public.advance_reservations TO authenticated;

CREATE OR REPLACE FUNCTION public.homebound_request_advance(
 p_listing_id uuid,p_room_name text,p_bed_slot text,p_move_in_date date,
 p_student_name text,p_student_phone text,p_student_email text,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid; v_rooms jsonb; v_bed jsonb; v_id uuid;
BEGIN
  IF p_token IS NULL OR p_listing_id IS NULL OR p_move_in_date IS NULL
    OR p_move_in_date<=current_date OR p_move_in_date>current_date+365
    OR length(btrim(coalesce(p_student_name,''))) NOT BETWEEN 2 AND 150
    OR length(btrim(coalesce(p_student_phone,''))) NOT BETWEEN 7 AND 35
    OR length(btrim(coalesce(p_student_email,''))) NOT BETWEEN 4 AND 250
    OR p_student_email NOT LIKE '%@%' THEN
      RAISE EXCEPTION 'Provide valid contact information and a future move-in date.';
  END IF;
  SELECT owner_id,rooms INTO v_owner,v_rooms FROM public.listings WHERE id=p_listing_id FOR UPDATE;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Listing no longer exists.'; END IF;
  SELECT bed INTO v_bed FROM jsonb_array_elements(v_rooms) r
    JOIN LATERAL jsonb_array_elements(r->'beds') AS b(bed) ON TRUE
    WHERE r->>'name'=p_room_name AND bed->>'id'=p_bed_slot LIMIT 1;
  IF v_bed IS NULL THEN RAISE EXCEPTION 'Selected bed does not exist.'; END IF;
  IF v_bed->>'status'='Unavailable' THEN RAISE EXCEPTION 'This bed is blocked.'; END IF;
  IF v_bed->>'status'='Occupied' AND NOT EXISTS (
    SELECT 1 FROM public.tenancies t WHERE t.listing_id=p_listing_id AND t.room_name=p_room_name
      AND t.bed_slot=p_bed_slot AND t.status='Active'
      AND t.planned_end_date IS NOT NULL AND t.planned_end_date<p_move_in_date
  ) THEN RAISE EXCEPTION 'Owner has not confirmed an expected vacancy by this move-in date.'; END IF;
  IF EXISTS (SELECT 1 FROM public.advance_reservations ar
     WHERE ar.listing_id=p_listing_id AND ar.room_name=p_room_name AND ar.bed_slot=p_bed_slot
       AND ar.status='Approved') THEN
    RAISE EXCEPTION 'A future reservation for this bed was already approved.';
  END IF;
  IF (SELECT count(*) FROM public.advance_reservations ar
     WHERE lower(ar.student_email)=lower(p_student_email)
       AND ar.created_at>now()-interval '24 hours')>=5 THEN
    RAISE EXCEPTION 'Too many requests today. Contact the owner.';
  END IF;
  INSERT INTO public.advance_reservations(listing_id,owner_id,room_name,bed_slot,
      move_in_date,student_name,student_phone,student_email,student_token)
    VALUES (p_listing_id,v_owner,p_room_name,p_bed_slot,p_move_in_date,
      btrim(p_student_name),btrim(p_student_phone),btrim(p_student_email),p_token)
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id,'status','Pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.homebound_advance_status(p_id uuid,p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('id',a.id,'status',a.status,'move_in_date',a.move_in_date)
  FROM public.advance_reservations a WHERE a.id=p_id AND a.student_token=p_token;
$$;

-- Store only an approved future reservation DATE on the public bed slot.
-- Student name, token and contact stay in the protected table.
CREATE OR REPLACE FUNCTION public.homebound_write_bed_reservation(
 p_rooms jsonb,p_room_name text,p_bed_slot text,p_date date)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    CASE WHEN room->>'name'=p_room_name THEN jsonb_set(room,'{beds}',(
      SELECT jsonb_agg(CASE WHEN bed->>'id'=p_bed_slot THEN
        CASE WHEN p_date IS NULL THEN bed-'reservedFor'
          ELSE jsonb_set(bed,'{reservedFor}',to_jsonb(p_date::text),true) END
        ELSE bed END ORDER BY bi)
      FROM jsonb_array_elements(room->'beds') WITH ORDINALITY AS b(bed,bi)),true)
      ELSE room END ORDER BY ri)
  INTO v_result FROM jsonb_array_elements(p_rooms) WITH ORDINALITY AS r(room,ri);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.homebound_owner_set_advance_status(p_id uuid,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.advance_reservations%ROWTYPE; v_status text; v_rooms jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.landlords l WHERE l.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Approved landlord required.';
  END IF;
  IF p_status NOT IN ('Approved','Declined','Cancelled') THEN RAISE EXCEPTION 'Invalid status.'; END IF;
  SELECT * INTO a FROM public.advance_reservations
    WHERE id=p_id AND owner_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF a.status='Pending' AND p_status IN ('Approved','Declined') OR
     a.status='Approved' AND p_status='Cancelled' THEN
    IF p_status='Approved' THEN
      -- Recheck live vacancy expectation at approval time.
      SELECT bed->>'status' INTO v_status FROM public.listings l
      CROSS JOIN LATERAL jsonb_array_elements(l.rooms) r
      CROSS JOIN LATERAL jsonb_array_elements(r->'beds') bed
      WHERE l.id=a.listing_id AND r->>'name'=a.room_name
        AND bed->>'id'=a.bed_slot LIMIT 1;
      IF v_status='Occupied' AND NOT EXISTS (SELECT 1 FROM public.tenancies t
        WHERE t.listing_id=a.listing_id AND t.room_name=a.room_name AND t.bed_slot=a.bed_slot
        AND t.status='Active' AND t.planned_end_date<a.move_in_date) THEN
          RAISE EXCEPTION 'Bed vacancy is not confirmed for the requested date.';
      END IF;
      IF v_status='Unavailable' OR v_status IS NULL THEN RAISE EXCEPTION 'Bed no longer reservable.'; END IF;
    END IF;
    SELECT rooms INTO v_rooms FROM public.listings WHERE id=a.listing_id FOR UPDATE;
    UPDATE public.advance_reservations SET status=p_status WHERE id=p_id;
    UPDATE public.listings SET rooms=public.homebound_write_bed_reservation(
      v_rooms,a.room_name,a.bed_slot,CASE WHEN p_status='Approved' THEN a.move_in_date ELSE NULL END)
      WHERE id=a.listing_id;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

-- Any change of occupancy clears the previous tenant's obsolete expected
-- vacancy date. The owner may publish a new date for the new active tenancy.
create or replace function public.homebound_apply_bed_status(
  p_rooms jsonb,p_room_name text,p_bed_slot text,p_status text)
returns jsonb language plpgsql set search_path = '' as $$
declare room jsonb; bed jsonb; items jsonb := '[]'::jsonb;
  updated_beds jsonb; free_count integer; n integer; found_room boolean := false;
  found_slot boolean := false;
begin
  if p_status not in ('Available','Unavailable','Occupied') then
    raise exception 'Invalid bed status.';
  end if;
  for room in select value from jsonb_array_elements(p_rooms) loop
    if room->>'name'=p_room_name then
      found_room:=true;updated_beds:='[]'::jsonb;free_count:=0;
      for bed in select value from jsonb_array_elements(room->'beds') loop
        if bed->>'id'=p_bed_slot then
          bed:=jsonb_set(bed-'availableFrom'-'reservedFor','{status}',to_jsonb(p_status),true);
          found_slot:=true;
        end if;
        if bed->>'status'='Available' then free_count:=free_count+1; end if;
        updated_beds:=updated_beds || jsonb_build_array(bed);
      end loop;
      room:=jsonb_set(room,'{beds}',updated_beds,true);
      room:=jsonb_set(room,'{status}',to_jsonb(case when free_count=0 then 'Full / Occupied'
        else format('Available (%s bed%s left)',free_count,
          case when free_count=1 then '' else 's' end) end),true);
    end if;
    items:=items || jsonb_build_array(room);
  end loop;
  if not found_room or not found_slot then raise exception 'Bed slot no longer exists.'; end if;
  return items;
end;
$$;


-- Protect confirmed future reservations from manual availability changes.
create or replace function public.homebound_set_bed_available(
 p_listing_id uuid,p_room_name text,p_bed_slot text,p_available boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_rooms jsonb; v_current text;
begin
  if auth.uid() is null or not exists (select 1 from public.landlords where user_id=auth.uid()) then
    raise exception 'Approved landlord login required.'; end if;
  select owner_id,rooms into v_owner,v_rooms from public.listings
    where id=p_listing_id for update;
  if v_owner is distinct from auth.uid() then raise exception 'Property access denied.'; end if;
  IF EXISTS (SELECT 1 FROM public.advance_reservations ar
    WHERE ar.listing_id=p_listing_id AND ar.room_name=p_room_name AND ar.bed_slot=p_bed_slot
      AND ar.status='Approved') THEN
    RAISE EXCEPTION 'This bed is reserved for a future student. Cancel the reservation before changing availability.';
  END IF;
  select bed->>'status' into v_current
    from jsonb_array_elements(v_rooms) r
    cross join lateral jsonb_array_elements(r->'beds') bed
    where r->>'name'=p_room_name and bed->>'id'=p_bed_slot limit 1;
  if v_current is null then raise exception 'Bed slot does not exist.'; end if;
  if v_current='Occupied' or exists (select 1 from public.tenancies
    where listing_id=p_listing_id and room_name=p_room_name
      and bed_slot=p_bed_slot and status='Active') then
    raise exception 'An occupied bed cannot be changed until the tenancy ends.';
  end if;
  update public.listings set rooms=public.homebound_apply_bed_status(v_rooms,
    p_room_name,p_bed_slot,case when p_available then 'Available' else 'Unavailable' end)
    where id=p_listing_id;
  return true;
end;
$$;

REVOKE ALL ON FUNCTION public.homebound_set_bed_available(uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_set_bed_available(uuid,text,text,boolean) TO authenticated;

-- Integrate approved future reservations into existing exact-bed tenancy assignment.
create or replace function public.homebound_assign_bed(
  p_listing_id uuid,p_room_name text,p_bed_slot text,
  p_tenant_name text,p_phone text,p_email text,p_start_date date,
  p_due_day integer,p_monthly_rent numeric,p_hold_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;v_rooms jsonb;v_state text;v_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.landlords where user_id=auth.uid()) then
    raise exception 'Approved landlord login required.'; end if;
  if length(btrim(coalesce(p_tenant_name,''))) not between 2 and 150
     or length(btrim(coalesce(p_phone,''))) not between 7 and 35
     or length(coalesce(p_email,''))>250
     or p_start_date is null or p_start_date < date '2000-01-01'
     or p_start_date > current_date+730
     or p_due_day not between 1 and 31 or p_monthly_rent is null
     or p_monthly_rent<=0 or p_monthly_rent>10000000 then
    raise exception 'Please provide valid tenant and rent details.';
  end if;
  select owner_id,rooms into v_owner,v_rooms from public.listings
     where id=p_listing_id for update;
  if v_owner is distinct from auth.uid() then raise exception 'Property access denied.'; end if;
  select bed->>'status' into v_state
    from jsonb_array_elements(v_rooms) r
    cross join lateral jsonb_array_elements(r->'beds') bed
    where r->>'name'=p_room_name and bed->>'id'=p_bed_slot limit 1;
  if v_state is distinct from 'Available' then
    raise exception 'The selected bed is not available.'; end if;
  if exists (select 1 from public.tenancies where listing_id=p_listing_id
    and room_name=p_room_name and bed_slot=p_bed_slot and status='Active') then
    raise exception 'The selected bed is already rented.'; end if;
  IF EXISTS (SELECT 1 FROM public.advance_reservations ar
    WHERE ar.listing_id=p_listing_id AND ar.room_name=p_room_name
      AND ar.bed_slot=p_bed_slot AND ar.status='Approved'
      AND (lower(ar.student_email)<>lower(coalesce(p_email,''))
           OR p_start_date < ar.move_in_date)) THEN
    RAISE EXCEPTION 'This bed has an approved advance reservation for another renter.';
  END IF;
  if p_hold_id is not null and not exists (select 1 from public.hold_requests
    where id=p_hold_id and listing_id=p_listing_id and room_name=p_room_name
      and owner_id=auth.uid() and status='Confirmed Visit') then
    raise exception 'The linked visitation is not confirmed for this room.'; end if;
  insert into public.tenancies(owner_id,listing_id,room_name,bed_slot,tenant_name,tenant_phone,
    tenant_email,monthly_rent,start_date,due_day,source_hold_id)
  values(auth.uid(),p_listing_id,p_room_name,p_bed_slot,btrim(p_tenant_name),
    btrim(p_phone),btrim(coalesce(p_email,'')),p_monthly_rent,p_start_date,p_due_day,p_hold_id)
  returning id into v_id;
  update public.listings set rooms=public.homebound_apply_bed_status(v_rooms,p_room_name,p_bed_slot,'Occupied')
      where id=p_listing_id;
  if p_hold_id is not null then
    update public.hold_requests set status='Rented' where id=p_hold_id;
  end if;
  UPDATE public.advance_reservations SET status='Fulfilled'
    WHERE listing_id=p_listing_id AND room_name=p_room_name AND bed_slot=p_bed_slot
      AND status='Approved' AND lower(student_email)=lower(coalesce(p_email,''))
      AND move_in_date<=p_start_date;
  return v_id;
end;
$$;

REVOKE ALL ON FUNCTION public.homebound_assign_bed(uuid,text,text,text,text,text,date,integer,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_assign_bed(uuid,text,text,text,text,text,date,integer,numeric,uuid) TO authenticated;

-- Ending a tenancy preserves an already approved future reservation marker.
create or replace function public.homebound_end_tenancy(p_tenancy_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare t public.tenancies%rowtype; v_rooms jsonb; v_date date;
begin
  if auth.uid() is null or not exists (select 1 from public.landlords where user_id=auth.uid()) then
     raise exception 'Approved landlord login required.'; end if;
  select * into t from public.tenancies where id=p_tenancy_id and owner_id=auth.uid();
  if not found or t.status<>'Active' then return false; end if;
  select rooms into v_rooms from public.listings where id=t.listing_id for update;
  update public.tenancies set status='Ended',end_date=(now() at time zone 'Asia/Manila')::date
   where id=p_tenancy_id and owner_id=auth.uid() and status='Active';
  delete from public.rent_payments where tenancy_id=p_tenancy_id and paid_at is null
    and due_date>(now() at time zone 'Asia/Manila')::date;
  update public.listings set rooms=public.homebound_apply_bed_status(v_rooms,t.room_name,t.bed_slot,'Available')
   where id=t.listing_id;
  SELECT move_in_date INTO v_date FROM public.advance_reservations ar
    WHERE ar.listing_id=t.listing_id AND ar.room_name=t.room_name
      AND ar.bed_slot=t.bed_slot AND ar.status='Approved' LIMIT 1;
  IF v_date IS NOT NULL THEN
    UPDATE public.listings SET rooms=public.homebound_write_bed_reservation(
      rooms,t.room_name,t.bed_slot,v_date) WHERE id=t.listing_id;
  END IF;
  return true;
end;
$$;

REVOKE ALL ON FUNCTION public.homebound_end_tenancy(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_end_tenancy(uuid) TO authenticated;

-- No direct student access to protected tables. Public RPC responses are
-- intentionally narrow and every read of private announcements checks a token.
REVOKE ALL ON FUNCTION public.homebound_write_bed_reservation(jsonb,text,text,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.homebound_publish_announcement(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.homebound_tenant_announcements(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.homebound_set_expected_moveout(uuid,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.homebound_request_advance(uuid,text,text,date,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.homebound_advance_status(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.homebound_owner_set_advance_status(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_publish_announcement(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_tenant_announcements(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_set_expected_moveout(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_request_advance(uuid,text,text,date,text,text,text,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_advance_status(uuid,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.homebound_owner_set_advance_status(uuid,text) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';