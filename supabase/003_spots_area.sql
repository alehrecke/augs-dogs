-- Aug's Dogs: let friends add spots in the nearby parts of Connecticut and Massachusetts too.
-- Paste into Supabase -> SQL Editor -> New query, and click Run. Run once, after 002_spots.sql.

alter table public.spots drop constraint if exists spots_lat_check;
alter table public.spots drop constraint if exists spots_lon_check;
alter table public.spots add constraint spots_lat_check check (lat between 40.9 and 42.5);
alter table public.spots add constraint spots_lon_check check (lon between -72.5 and -70.7);
