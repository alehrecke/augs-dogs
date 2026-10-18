-- Aug's Dogs: shared database + photo storage.
-- Paste this whole file into Supabase -> SQL Editor -> New query, and click Run. Safe to run once.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  meet_date date not null unique,          -- one walk per meet day; the unique key stops double spins
  walk_id text not null,                   -- id from data/walks.js
  meet_time text,
  note text,
  picked_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  dog text,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  walk_id text,
  path text not null,                      -- file path inside the "photos" storage bucket
  caption text,
  uploaded_by text,
  created_at timestamptz not null default now()
);

-- There are no logins: anyone with the site link can read, spin, RSVP and add photos.
-- Deleting events/photos is left to you in the Supabase dashboard.
alter table public.events enable row level security;
alter table public.rsvps  enable row level security;
alter table public.photos enable row level security;

create policy "anyone reads events"   on public.events for select using (true);
create policy "anyone creates events" on public.events for insert with check (true);
create policy "anyone edits events"   on public.events for update using (true) with check (true);

create policy "anyone reads rsvps"    on public.rsvps for select using (true);
create policy "anyone rsvps"          on public.rsvps for insert with check (true);
create policy "anyone un-rsvps"       on public.rsvps for delete using (true);

create policy "anyone reads photos"   on public.photos for select using (true);
create policy "anyone adds photos"    on public.photos for insert with check (true);

-- Public bucket for the photo files, capped at 5 MB per file and images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "anyone uploads walk photos" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'photos');
