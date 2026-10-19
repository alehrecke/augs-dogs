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
- Friend-added spots: `spots` table (`supabase/002_spots.sql`), merged into `WALKS` by
  `setSpots()`; ids are `u-<uuid>`. Place search/reverse geocoding uses Nominatim from the
  browser. Region is inferred from the nearest built-in walk. Loaded separately in `refresh()`
  so the site still works if the table is missing (`S.spotsReady`).
- Built-in walk data: edit `tools/walks-source.json`, run `python tools/build_walks.py` (Nominatim
  geocoding) → generates `data/walks.js`. Never hand-edit `data/walks.js`.
- v2 walk schema: `miles`, `difficulty` (easy/moderate/hard), `fav`, `water`, `tips`, `eri` (Explore RI
  siteID → "Trail map" link), `dogs: "no"` + `noDogs {why, enforcement}` = purple layer, filtered out of
  `candidates()` by `dogsOK()`. Research + sources in `docs/RESEARCH.md`; re-scrape with
  `tools/scrape_exploreri.py`. Reddit is unreachable from Claude's tools (403).
- Seasonal dog rules live in `seasonCheck()` in `js/app.js`, keyed off each walk's `flags`
  (`stateBeach`, `beachOnly`, `townBeachNarr`, `napatree`, `orange`, `island`, `offSeasonOnly`, `noDogsNesting`).

## Testing

No test suite. Headless smoke test approach that worked: serve the folder with
`python -m http.server`, drive Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`)
with `puppeteer-core` installed in a temp dir. Click through spin → name dialog → RSVP → edit
note → photo upload → lightbox → re-roll → past walks → spot search, at 1280px and 390px, light + dark.

## Current status

- 2026-10-18: v1 built and smoke-tested in demo mode (all flows pass, no console errors).
- 2026-10-18: Supabase project `zpaytdpbabllenywbypm` connected (publishable key, which needs
  supabase-js ≥ 2.6x, hence 2.117.2). Schema run; RLS insert + storage upload verified by
  REST probes (left a harmless `photos/_setup-test/pixel.jpg`). Meets Sundays 14:00.
  Pushed to `github.com/alehrecke/augs-dogs` (`main`); site URL once Pages is on:
  https://alehrecke.github.io/augs-dogs/ (live 2026-10-18).
- 2026-10-19: "Add a spot" feature (search or tap map, CT/MA warning, remove own unwalked spot).
  Tested in demo mode; `002_spots.sql` run by Alex, live insert/delete + RI-bounds check
  verified via REST, live site opens the form with no errors.
- 2026-10-19: v2 walk list: 119 dog walks (28 ★), 20 no-dog places (purple toggle layer). Spin filters
  ★ Favourites / Easy only. Tested in demo mode (filters, 12 spins never pick no-dog, phone layout).
