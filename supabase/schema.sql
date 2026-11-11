-- HOMEBOUND: run in Supabase > SQL Editor before connecting the browser app.
-- Landlords must be explicitly approved by an admin (see README).
-- All listing reads are public; only the owner can change a listing.

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
    lat double precision not null check (lat between -90 and 90),
    lng double precision not null check (lng between -180 and 180),
    owner_name text not null,
    owner_phone text not null default '',
    main_image text not null default '',
    rooms jsonb not null default '[]'::jsonb
        check (jsonb_typeof(rooms) = 'array' and jsonb_array_length(rooms) > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

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
create trigger listings_updated_at_trigger
before update on public.listings
for each row execute function public.homebound_set_updated_at();

alter table public.landlords enable row level security;
alter table public.listings enable row level security;

-- Approvals are admin-only (there are deliberately no client-side write policies on landlords).
drop policy if exists "Landlord can read own approval" on public.landlords;
create policy "Landlord can read own approval"
on public.landlords for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Anyone can read listings" on public.listings;
create policy "Anyone can read listings"
on public.listings for select to anon, authenticated
using (true);

drop policy if exists "Approved landlord can add own listings" on public.listings;
create policy "Approved landlord can add own listings"
on public.listings for insert to authenticated
with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.landlords l where l.user_id = (select auth.uid()))
);

drop policy if exists "Approved landlord can update own listings" on public.listings;
create policy "Approved landlord can update own listings"
on public.listings for update to authenticated
using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.landlords l where l.user_id = (select auth.uid()))
)
with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.landlords l where l.user_id = (select auth.uid()))
);

drop policy if exists "Approved landlord can delete own listings" on public.listings;
create policy "Approved landlord can delete own listings"
on public.listings for delete to authenticated
using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.landlords l where l.user_id = (select auth.uid()))
);

-- The schema is exposed for browser Data API; RLS restricts actual access.
grant usage on schema public to anon, authenticated;
grant select on public.listings to anon, authenticated;
grant insert, update, delete on public.listings to authenticated;
grant select on public.landlords to authenticated;
revoke insert, update, delete on public.landlords from anon, authenticated;

-- Enable change notifications for other open browsers, once per table.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listings'
    ) then
        alter publication supabase_realtime add table public.listings;
    end if;
end $$;

-- AFTER creating a Supabase Auth user (Dashboard > Authentication > Users),
-- approve that specific landlord ONCE in the SQL editor, replacing the UUID:
-- insert into public.landlords (user_id, display_name)
-- values ('00000000-0000-0000-0000-000000000000', 'Landlord Name')
-- on conflict (user_id) do update set display_name = excluded.display_name;
-- Do NOT run the example with its placeholder UUID.