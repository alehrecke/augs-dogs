# Aug's Dogs

Alex's friends' weekly dog-walk web app: randomly picks a dog-friendly RI walk each week,
RSVPs, and shared photo albums of past walks on a map. Started 2026-10-18. Alex is not a
software person: explain choices in plain language and keep the stack boring.

## Stack (deliberately no build step)

- Static `index.html` + `styles.css` + `js/app.js` + `js/store.js`. Leaflet 1.9.4 (cdnjs) + OSM tiles.
- `config.js` is the only file Alex should need to edit (meet day/time, Supabase keys).
- `js/store.js` has two stores with the same methods: `LocalStore` (demo mode, localStorage)
  and `SupabaseStore` (shared mode). Any new data feature must be added to **both**.
- `supabase/schema.sql`: tables `events` (unique `meet_date` prevents double spins),
  `rsvps`, `photos` + public `photos` storage bucket. No auth: open RLS policies for anon.
- Walk data: edit `tools/walks-source.json`, run `python tools/build_walks.py` (Nominatim
  geocoding) → generates `data/walks.js`. Never hand-edit `data/walks.js`.
- Seasonal dog rules live in `seasonCheck()` in `js/app.js`, keyed off each walk's `flags`
  (`stateBeach`, `beachOnly`, `townBeachNarr`, `napatree`, `orange`, `island`).

## Testing

No test suite. Headless smoke test approach that worked: serve the folder with
`python -m http.server`, drive Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`)
with `puppeteer-core` installed in a temp dir. Click through spin → name dialog → RSVP → edit
note → photo upload → lightbox → re-roll → past walks → spot search, at 1280px and 390px, light + dark.

## Current status

- 2026-10-18: v1 built and smoke-tested in demo mode (all flows pass, no console errors).
  Git repo initialised locally (branch `main`), **no remote yet**.
- Waiting on Alex: create the Supabase project + paste keys into `config.js`, create the
  GitHub repo and enable Pages (steps in README). Shared mode has not been run against a
  real Supabase project yet, so check it the first time it's connected.
