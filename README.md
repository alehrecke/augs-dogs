# Aug's Dogs 🐾

A tiny website for a friends' weekly dog walk somewhere in Rhode Island.

- **Map** of 49 dog-friendly walks around RI (state parks, management areas, bike paths, city parks, off-season beaches, Block Island).
- **Spin the wheel** to pick each week's walk at random. It skips places you've already been until you've done them all, and skips beaches during their summer dog bans. Region chips narrow the draw (Block Island is off by default because it needs a ferry).
- **"I'm in!"** RSVPs, an editable meeting spot/time, **Add to calendar**, and a **Share invite** text for the group chat.
- **Past walks** turn green on the map, and each one keeps a shared photo album anyone can add to.
- **Add a spot**: anyone can add a dog-friendly place they know (search for it or tap the map). It shows on the map for everyone and goes into the hat for future spins.
- Automatic seasonal warnings, e.g. blaze-orange reminders in hunting season.

There are no logins. People type their name and dog's name once and it's remembered on their phone.

## How it's built (plain-English version)

| Piece | What it is | Cost |
|---|---|---|
| The website | Plain HTML/CSS/JavaScript files in this folder: no build step, no framework | free |
| The map | [Leaflet](https://leafletjs.com) + OpenStreetMap tiles | free |
| Shared data + photos | [Supabase](https://supabase.com): a hosted database + file storage | free tier: 500 MB data, 1 GB photos (~2,000+ photos) |
| Hosting | GitHub Pages (or Netlify) | free |

Until Supabase is connected the site runs in **demo mode**: it works fully, but everything is saved only in your own browser.

## Try it on your computer

From this folder:

```
python -m http.server 8000
```

then open <http://localhost:8000>. (Opening `index.html` by double-clicking mostly works too, but the server is more reliable.)

## Go live: switch on sharing (≈15 minutes, one time)

### 1. Create the shared database (Supabase)

1. Sign up at <https://supabase.com> (GitHub login is easiest) → **New project**. Name it `augs-dogs`, pick a region near you (East US), and set any database password (you won't need it again).
2. When it's ready, open **SQL Editor** → **New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. That creates the tables and the `photos` bucket. Then do the same with [`supabase/002_spots.sql`](supabase/002_spots.sql) (friend-added spots).
3. Go to **Project Settings → API Keys** and copy the **Project URL** and the **anon public** key into [`config.js`](config.js). (Newer Supabase projects show a "publishable" key first. If that one gives errors, use the anon key under the **Legacy API keys** tab.)

   ```js
   supabaseUrl: "https://abcdefgh.supabase.co",
   supabaseAnonKey: "eyJhbGciOi...",
   ```

   The anon key is *meant* to be public. It's safe to put in the website.

Reload the local site: the yellow demo banner disappears, and anything you do now is shared.

### 2. Put the site online (GitHub Pages)

1. On github.com create a new **public** repository named `augs-dogs` (no README).
2. In this folder:

   ```
   git remote add origin https://github.com/alehrecke/augs-dogs.git
   git push -u origin main
   ```

3. In the repo on GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
4. After a minute the site is at **https://alehrecke.github.io/augs-dogs/**. Send that link to the group.

Every later change is just `git commit` + `git push`, and the site updates itself.

*No-git alternative:* drag this whole folder onto <https://app.netlify.com/drop>.

## Day-to-day

- **Change the meet day/time:** `meetDay` / `meetTime` in `config.js`. A single week can also be changed in the app ("Edit time / meeting spot").
- **Remove a friend-added spot:** whoever added it can remove it from its map popup (until it's been walked), or delete the row in Supabase → **Table Editor → spots**.
- **Add or fix a built-in walk:** edit `tools/walks-source.json`, then run `python tools/build_walks.py`. That looks up map coordinates automatically and regenerates `data/walks.js`. If a place can't be found, add `"lat"`/`"lon"` by hand (right-click in Google Maps → copy coordinates).
- **Delete a photo or a bad event:** Supabase dashboard → **Table Editor** (and **Storage → photos** for the file itself).

## Things to know

- **Privacy:** anyone with the link can see the site and post. Fine for a friends' group. If the link ever spreads, logins can be added later (Supabase has email "magic link" sign-in).
- **Supabase free projects pause after ~7 days with no activity.** Weekly use keeps it awake. If it does pause, click **Restore** in the dashboard.
- **Dog rules change.** The walk list and seasonal rules were researched in October 2026 (state park leash ≤ 6 ft, no dogs on state swimming beaches Apr 1 – Sep 30, blaze orange in management areas during hunting seasons, Napatree's summer daytime ban). Places with no dogs at all (Audubon refuges, National Wildlife Refuges like Sachuest and Trustom) are deliberately left out. Check posted signs, and fix anything wrong in `tools/walks-source.json`.
- Map pins are approximate. **Directions** searches Google Maps for the place by name, which gets you to the right lot.

## Ideas for later

- Vote on spots / mark favourites.
- Weekly reminder text or email (Supabase scheduled function, or a simple group-chat bot).
- "Paw-ssport": stats per dog (walks attended, miles, favourite spot).
- Weather forecast for walk day on the card.
- Walk length/difficulty filter for older or smaller dogs.
