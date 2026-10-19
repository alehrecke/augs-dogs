-- Aug's Dogs: spots that friends add themselves (on top of the built-in list in data/walks.js).
-- Paste into Supabase -> SQL Editor -> New query, and click Run. Run once, after schema.sql.

create table if not exists public.spots (
  id text primary key,                                   -- "u-<uuid>", made by the app
  name text not null check (char_length(name) between 2 and 80),
  town text,
  region text not null,
  type text,
  blurb text check (char_length(blurb) <= 400),
  lat double precision not null check (lat between 41.0 and 42.1),     -- roughly Rhode Island
  lon double precision not null check (lon between -72.0 and -71.0),
  off_season_only boolean not null default false,        -- e.g. a beach with a summer dog ban
  added_by text,
  created_at timestamptz not null default now()
);

alter table public.spots enable row level security;

create policy "anyone reads spots"   on public.spots for select using (true);
create policy "anyone adds spots"    on public.spots for insert with check (true);
create policy "anyone removes spots" on public.spots for delete using (true);
