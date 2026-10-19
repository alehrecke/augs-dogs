(function () {
  const cfg = window.AUGS_CONFIG;
  const CURATED = window.WALKS;
  // Built-in walks plus spots friends added (see setSpots).
  let WALKS = CURATED.slice();
  let BY_ID = Object.fromEntries(WALKS.map((w) => [w.id, w]));
  const TYPES = ["woods", "coast", "beach", "path", "fields", "city"];
  const REGIONS = ["North", "Providence", "West Bay", "South County", "Newport & East Bay", "Block Island", "Connecticut", "Massachusetts"];
  const OFF_BY_DEFAULT = ["Block Island", "Connecticut", "Massachusetts"];
  const PROVIDENCE = { lat: 41.824, lon: -71.413, label: "Providence" };
  const RADII = [15, 30, 45, 60];

  // Spin settings are per-device (each spinner picks their own), remembered between visits.
  const PREFS_KEY = "augs-dogs-spin-prefs";
  const PREFS = (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } })();

  const S = {
    store: null,
    events: [], rsvps: [], photos: [], spots: [],
    spotsReady: true,    // false until the spots table exists (supabase/002_spots.sql)
    signature: "",
    tab: "week",
    detail: null,        // event id open in the Past walks tab
    regions: new Set(REGIONS.filter((r) => !OFF_BY_DEFAULT.includes(r))),
    favOnly: false, easyOnly: false,   // extra spin filters
    // "region" = pick by RI region chips; "distance" = anything within radiusMi of center, any state.
    mode: PREFS.mode === "distance" ? "distance" : "region",
    center: PREFS.center || PROVIDENCE,
    radiusMi: RADII.includes(PREFS.radiusMi) ? PREFS.radiusMi : 30,
    pickingCenter: false,
    showNoDogs: false,                 // purple "no dogs allowed" map layer
    spinning: false, rerolling: false, editing: false,
    adding: false, draft: null, searchHits: [],   // "Add a spot" form state
    query: "",
  };

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (s, opts = { weekday: "long", month: "long", day: "numeric" }) => parseDate(s).toLocaleDateString(undefined, opts);
  const fmtShort = (s) => fmtDate(s, { month: "short", day: "numeric", year: "numeric" });
  const fmtTime = (t) => { const [h, m] = t.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };
  const errMsg = (e) => (e && e.message) || "Something went wrong. Try again?";
  const walkFor = (id) => BY_ID[id] || { id, name: id, town: "", region: "", type: "", blurb: "", flags: [], lat: 41.7, lon: -71.5 };
  const stateOf = (w) => w.state || { Connecticut: "CT", Massachusetts: "MA" }[w.region] || "RI";
  const directionsUrl = (w) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${w.name}, ${w.town}, ${stateOf(w)}`);
  const savePrefs = () => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: S.mode, center: S.center, radiusMi: S.radiusMi })); } catch { /* private mode */ }
  };
  const pageUrl = () => location.href.split("#")[0];
  const dogsOK = (w) => w.dogs !== "no";
  const infoUrl = (w) => (w.eri ? `https://exploreri.org/gSiteReport2.php?siteID=${w.eri}` : null);
  // "3.5 mi · moderate · woods", plus ★ community favourite and 💧 somewhere for dogs to wade.
  const walkMeta = (w) =>
    [w.miles && `${w.miles} mi`, w.difficulty, w.type].filter(Boolean).join(" · ") +
    (w.fav ? " · ★ favourite" : "") + (w.water ? " · 💧 dog can wade" : "");

  function toast(msg, ms = 2600) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), ms);
  }

  // The walk for a meet day stays "this week" until ~3 hours after it starts.
  function nextMeetDate(now = new Date()) {
    const [h, m] = cfg.meetTime.split(":").map(Number);
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let diff = (cfg.meetDay - d.getDay() + 7) % 7;
    if (diff === 0) {
      const over = new Date(d);
      over.setHours(h + 3, m);
      if (now > over) diff = 7;
    }
    d.setDate(d.getDate() + diff);
    return isoDate(d);
  }

  // Seasonal dog rules. ok=false keeps a walk out of the hat for that date.
  function seasonCheck(walk, dateStr) {
    const d = parseDate(dateStr);
    const md = (d.getMonth() + 1) * 100 + d.getDate();
    const f = new Set(walk.flags);
    const notes = [];
    let ok = true;
    if (f.has("stateBeach")) {
      const summer = md >= 401 && md <= 930;
      if (f.has("beachOnly")) {
        if (summer) ok = false;
        else notes.push("Off-season, so leashed dogs are welcome on the state beach through March 31.");
      } else if (summer) {
        notes.push("No dogs on the state swimming beach Apr 1 – Sep 30. Stick to the trails.");
      }
    }
    if (f.has("townBeachNarr")) {
      if (md >= 515 && md <= 915) ok = false;
      else notes.push("Leashed dogs are OK on the town beach Sep 16 – May 14.");
    }
    if (f.has("offSeasonOnly")) {
      if (md >= 401 && md <= 930) ok = false;
      else notes.push("Dogs are only allowed here in the off-season (Oct – Mar).");
    }
    if (f.has("noDogsNesting")) {
      if (md >= 401 && md <= 831) ok = false;
      else notes.push("No dogs here Apr 1 – Aug 31 (bird nesting).");
    }
    if (f.has("napatree")) {
      if (md >= 502 && md <= 907) ok = false;
      else notes.push("Keep dogs leashed and off the dunes. It's protected bird habitat.");
    }
    if (f.has("orange") && (md >= 901 || md <= 531)) {
      notes.push("Hunting season: RI requires blaze orange here (200 sq in, 500 in December shotgun season). Put an orange vest on the pup too.");
    }
    if (f.has("huntingArea") && (md >= 901 || md <= 531)) {
      notes.push("Hunting is allowed here: wear blaze orange in season, and put an orange vest on the pup.");
    }
    if (f.has("island")) notes.push("Needs the Block Island ferry from Point Judith. Plan a full day.");
    return { ok, notes };
  }

  // Walks you haven't done yet go first; once every eligible walk is done, anything but the last 5.
  function candidates(dateStr, excludeId) {
    const inScope = S.mode === "distance" ? (w) => distMi(S.center, w) <= S.radiusMi : (w) => S.regions.has(w.region);
    const eligible = WALKS.filter((w) => dogsOK(w) && inScope(w) && w.id !== excludeId
      && (!S.favOnly || w.fav) && (!S.easyOnly || w.difficulty === "easy") && seasonCheck(w, dateStr).ok);
    const visited = new Set(S.events.filter((e) => e.meet_date !== dateStr).map((e) => e.walk_id));
    const fresh = eligible.filter((w) => !visited.has(w.id));
    if (fresh.length) return fresh;
    const recent = new Set(S.events.slice(-5).map((e) => e.walk_id));
    const rest = eligible.filter((w) => !recent.has(w.id));
    return rest.length ? rest : eligible;
  }

  const currentEvent = () => S.events.find((e) => e.meet_date === nextMeetDate());
  const pastEvents = () => S.events.filter((e) => e.meet_date < nextMeetDate()).reverse();
  const rsvpsFor = (evId) => S.rsvps.filter((r) => r.event_id === evId);
  const photosFor = (evId) => S.photos.filter((p) => p.event_id === evId);

  // ---------- who am I (stored per device) ----------
  const ME_KEY = "augs-dogs-me";
  function getMe() { try { return JSON.parse(localStorage.getItem(ME_KEY)); } catch { return null; } }
  function setMe(me) { try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch { /* private mode */ } renderMe(); }
  const isMe = (name) => { const me = getMe(); return !!me && me.name.toLowerCase() === String(name).toLowerCase(); };

  function askMe() {
    const dlg = $("#me-dialog");
    const form = $("#me-form");
    const me = getMe() || {};
    form.elements.name.value = me.name || "";
    form.elements.dog.value = me.dog || "";
    return new Promise((resolve) => {
      dlg.addEventListener("close", () => {
        const name = form.elements.name.value.trim();
        if (dlg.returnValue === "ok" && name) {
          const v = { name, dog: form.elements.dog.value.trim() };
          setMe(v);
          resolve(v);
        } else resolve(null);
      }, { once: true });
      dlg.returnValue = "";
      dlg.showModal();
    });
  }
  const requireMe = async () => getMe() || (await askMe());

  function renderMe() {
    const me = getMe();
    $("#me-button").textContent = me ? (me.dog ? `${me.name} & ${me.dog}` : me.name) : "Who are you?";
  }

  // ---------- map ----------
  let map;
  const markers = {};
  const PIN_SIZE = { next: 26, draft: 24 };
  const pinIcon = (cls) => {
    const s = PIN_SIZE[cls] || 16;
    return L.divIcon({ className: "", html: `<div class="pin ${cls}"></div>`, iconSize: [s, s] });
  };
  const addMarker = (w) => {
    markers[w.id] = L.marker([w.lat, w.lon], { icon: pinIcon(""), title: w.name, riseOnHover: true })
      .addTo(map)
      .bindPopup(() => popupHtml(w), { maxWidth: 270 });
  };

  function initMap() {
    // Mainland RI; Block Island is just off the bottom edge.
    map = L.map("map", { zoomSnap: 0.25 }).fitBounds([[41.3, -71.86], [42.02, -71.12]], { padding: [8, 8] });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    WALKS.forEach(addMarker);
    map.on("click", (e) => {
      if (S.adding) setDraft(e.latlng.lat, e.latlng.lng);
      else if (S.pickingCenter) setCenter({ lat: e.latlng.lat, lon: e.latlng.lng, label: "the map pin" });
    });

    // Map button that shows/hides the "no dogs allowed" layer.
    const NoDogsToggle = L.Control.extend({
      onAdd() {
        const b = L.DomUtil.create("button", "map-toggle");
        b.type = "button";
        b.innerHTML = `<span class="pin nodog"></span> No-dog walks`;
        b.setAttribute("aria-pressed", "false");
        L.DomEvent.disableClickPropagation(b);   // also stops the document click delegation, so wire it here
        L.DomEvent.on(b, "click", () => {
          S.showNoDogs = !S.showNoDogs;
          updatePins();
          if (S.showNoDogs) toast("Purple = beautiful, but no dogs allowed. Humans-only walks.", 3500);
        });
        return b;
      },
    });
    new NoDogsToggle({ position: "topright" }).addTo(map);
  }

  // ---------- distance mode ----------
  let radiusCircle = null;
  // The circle shows while the spin card is up in distance mode.
  function updateRadiusCircle() {
    const show = S.mode === "distance" && S.tab === "week" && (!currentEvent() || S.rerolling);
    if (!show) { if (radiusCircle) { radiusCircle.remove(); radiusCircle = null; } return; }
    const opts = { radius: S.radiusMi * 1609, color: "#e8743b", weight: 2, fillOpacity: 0.06, interactive: false };
    if (radiusCircle) radiusCircle.setLatLng([S.center.lat, S.center.lon]).setRadius(opts.radius);
    else radiusCircle = L.circle([S.center.lat, S.center.lon], opts).addTo(map);
  }

  function setCenter(c) {
    S.center = { lat: +c.lat.toFixed(4), lon: +c.lon.toFixed(4), label: c.label };
    S.pickingCenter = false;
    savePrefs();
    render();
    map.flyToBounds(radiusCircle ? radiusCircle.getBounds() : [[c.lat, c.lon], [c.lat, c.lon]], { duration: 0.6 });
  }

  function centerOnMe() {
    if (!navigator.geolocation) return toast("This browser can't share your location.");
    toast("Finding you…", 8000);
    navigator.geolocation.getCurrentPosition(
      (p) => { toast("Got it!"); setCenter({ lat: p.coords.latitude, lon: p.coords.longitude, label: "your location" }); },
      () => toast("Couldn't get your location. Tap the map instead.", 3500),
      { timeout: 8000, maximumAge: 600000 },
    );
  }

  // ---------- friend-added spots ----------
  const spotToWalk = (s) => ({
    id: s.id, name: s.name, town: s.town || "", region: s.region, type: s.type || "walk",
    blurb: s.blurb || "", lat: s.lat, lon: s.lon,
    flags: s.off_season_only ? ["offSeasonOnly"] : [], addedBy: s.added_by,
  });

  function setSpots(spots) {
    const custom = spots.map(spotToWalk);
    WALKS = CURATED.concat(custom);
    BY_ID = Object.fromEntries(WALKS.map((w) => [w.id, w]));
    for (const id of Object.keys(markers)) if (!BY_ID[id]) { markers[id].remove(); delete markers[id]; }
    custom.forEach((w) => { if (!markers[w.id]) addMarker(w); });
  }

  // RI plus the nearby parts of CT and MA (matches supabase/003_spots_area.sql).
  const inArea = (lat, lon) => lat > 40.9 && lat < 42.5 && lon > -72.5 && lon < -70.7;
  const OK_STATES = ["Rhode Island", "Connecticut", "Massachusetts"];
  // Rough straight-line distance; fine at this scale.
  const distKm = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * 0.746);
  const distMi = (a, b) => distKm(a, b) / 1.609;

  // CT/MA come from the geocoded state; inside RI, region = whichever built-in RI walk is nearest.
  function guessRegion(lat, lon, state) {
    if (state === "Connecticut" || state === "Massachusetts") return state;
    if (lat < 41.25) return "Block Island";
    let best = null;
    for (const w of CURATED) {
      if (stateOf(w) !== "RI" || w.region === "Block Island") continue;
      if (!best || distKm(w, { lat, lon }) < distKm(best, { lat, lon })) best = w;
    }
    return best.region;
  }

  const townFrom = (a = {}) => a.town || a.city || a.village || a.hamlet || a.suburb || "";
  const nominatim = async (path, params) =>
    (await fetch(`https://nominatim.openstreetmap.org/${path}?` + new URLSearchParams({ format: "json", addressdetails: "1", ...params }))).json();

  let draftMarker = null;
  // inArea() is a bounding box, so it also takes slivers of NY/NH. Nominatim's address knows the state.
  function noteState(state) {
    if (S.draft) S.draft.state = state || null;
    if (state && !OK_STATES.includes(state)) {
      $("#place-status").textContent += ` ⚠️ That looks like it's in ${state}. Is the pin in the right place?`;
    }
  }

  function setDraft(lat, lon, town, state) {
    if (!inArea(lat, lon)) return toast("That's too far away. Keep it to RI and the nearby parts of CT and MA.", 3500);
    S.draft = { lat, lon, state: null };
    if (draftMarker) draftMarker.setLatLng([lat, lon]);
    else {
      draftMarker = L.marker([lat, lon], { icon: pinIcon("draft"), draggable: true, zIndexOffset: 2000 }).addTo(map);
      draftMarker.on("dragend", () => { const p = draftMarker.getLatLng(); setDraft(p.lat, p.lng); });
    }
    const form = $("#spot-form");
    if (!form) return;
    $("#place-status").textContent = `📍 Pin dropped${town ? ` in ${town}` : ""}. Drag it on the map to fine-tune.`;
    if (town) {
      if (!form.elements.town.value) form.elements.town.value = town;
      return noteState(state);
    }
    nominatim("reverse", { lat, lon, zoom: 14 })
      .then((r) => {
        const t = townFrom(r.address);
        if (t && !form.elements.town.value) form.elements.town.value = t;
        noteState(r.address && r.address.state);
      })
      .catch(() => {});
  }
  function clearDraft() {
    if (draftMarker) draftMarker.remove();
    draftMarker = null;
    S.draft = null;
  }

  async function searchPlace() {
    const q = $("#place-q").value.trim();
    const box = $("#place-hits");
    if (!q) return;
    box.innerHTML = `<p class="hint">Searching…</p>`;
    try {
      S.searchHits = await nominatim("search", { q, limit: 5, countrycodes: "us", viewbox: "-72.5,42.5,-70.7,40.9", bounded: 1 });
      box.innerHTML = S.searchHits.length
        ? S.searchHits.map((h, i) => `<button type="button" class="list-item hit" data-action="pick-hit" data-i="${i}">${esc(h.display_name)}</button>`).join("")
        : `<p class="hint">Nothing found nearby. Try a different name, or tap the map.</p>`;
    } catch {
      box.innerHTML = `<p class="hint">Search isn't working right now. Tap the map instead.</p>`;
    }
  }
  function pickHit(i) {
    const h = S.searchHits[i];
    if (!h) return;
    $("#place-hits").innerHTML = "";
    setDraft(+h.lat, +h.lon, townFrom(h.address), h.address && h.address.state);
    map.flyTo([+h.lat, +h.lon], 14, { duration: 0.8 });
  }

  async function saveSpot(form) {
    const name = form.elements.name.value.trim();
    if (!S.draft) return toast("Where is it? Search for it, or tap the map to drop a pin.", 3500);
    const twin = WALKS.find((w) => distKm(w, S.draft) < 0.4 || w.name.toLowerCase() === name.toLowerCase());
    if (twin && !confirm(`${twin.name} is already on the map close by. Add this anyway?`)) return;
    const me = await requireMe();
    if (!me) return;
    const spot = {
      id: "u-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)),
      name,
      town: form.elements.town.value.trim() || null,
      region: guessRegion(S.draft.lat, S.draft.lon, S.draft.state),
      type: form.elements.type.value,
      blurb: form.elements.blurb.value.trim() || null,
      lat: +S.draft.lat.toFixed(5),
      lon: +S.draft.lon.toFixed(5),
      off_season_only: form.elements.offseason.checked,
      added_by: me.name,
    };
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try { await S.store.addSpot(spot); }
    catch (e) {
      btn.disabled = false;
      // 23514 = check constraint: the database still only accepts RI coordinates (supabase/003_spots_area.sql not run).
      return toast(e && e.code === "23514" ? "The shared database doesn't take out-of-state spots yet. Ask Alex to run the update!" : errMsg(e), 4500);
    }
    S.adding = false;
    clearDraft();
    toast("Added! It's in the hat for future spins 🎲", 3500);
    await refresh(true);
    focusWalk(spot.id);
  }

  async function removeSpot(id) {
    if (!confirm("Remove this spot from the map for everyone?")) return;
    try { await S.store.removeSpot(id); } catch (e) { toast(errMsg(e)); }
    map.closePopup();
    await refresh(true);
  }

  function startAdding() {
    if (!S.spotsReady) return toast("Adding spots needs a quick database update first. Ask Alex!", 4000);
    S.tab = "spots"; S.detail = null; S.adding = true;
    render();
    $(".panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updatePins() {
    const cur = currentEvent();
    const visited = new Set(pastEvents().map((e) => e.walk_id));
    for (const w of WALKS) {
      const m = markers[w.id];
      if (!dogsOK(w)) {
        m.setIcon(pinIcon("nodog"));
        if (S.showNoDogs) m.addTo(map); else m.remove();
        continue;
      }
      const cls = cur && cur.walk_id === w.id ? "next" : visited.has(w.id) ? "visited" : "";
      m.setIcon(pinIcon(cls)).setZIndexOffset(cls === "next" ? 1000 : cls ? 500 : 0);
    }
    const t = $(".map-toggle");
    if (t) t.setAttribute("aria-pressed", String(S.showNoDogs));
  }

  function noDogsPopupHtml(w) {
    return `<div class="popup">
      <h3>${esc(w.name)}</h3>
      <p class="walk-town">${esc(w.town)}${w.miles ? ` · ${w.miles} mi` : ""}</p>
      <p><span class="badge nodog">🚫 No dogs allowed</span></p>
      <p>${esc(w.blurb)}</p>
      <p class="hint"><strong>Why:</strong> ${esc(w.noDogs.why)}</p>
      <p class="hint"><strong>Enforcement:</strong> ${esc(w.noDogs.enforcement)}</p>
      <p class="hint">Worth a humans-only walk. Leave the pups at home.</p>
      <div class="row">
        <a class="btn small ghost" href="${directionsUrl(w)}" target="_blank" rel="noopener">Directions</a>
        ${infoUrl(w) ? `<a class="btn small ghost" href="${infoUrl(w)}" target="_blank" rel="noopener">Trail info</a>` : ""}
      </div>
    </div>`;
  }

  function popupHtml(w) {
    if (!dogsOK(w)) return noDogsPopupHtml(w);
    const past = pastEvents().filter((e) => e.walk_id === w.id);
    const cur = currentEvent();
    const { notes } = seasonCheck(w, nextMeetDate());
    return `<div class="popup">
      <h3>${esc(w.name)}</h3>
      <p class="walk-town">${esc(w.town)} · ${esc(walkMeta(w))}</p>
      ${w.blurb ? `<p>${esc(w.blurb)}</p>` : ""}
      ${w.tips ? `<p class="hint">💡 ${esc(w.tips)}</p>` : ""}
      ${w.addedBy ? `<p class="hint">Added by ${esc(w.addedBy)}</p>` : ""}
      ${cur && cur.walk_id === w.id ? `<p><span class="badge next">This week's walk!</span></p>` : ""}
      ${past.length ? `<p><span class="badge visited">Walked ${past.length}× · last ${esc(fmtShort(past[0].meet_date))}</span></p>` : ""}
      ${notes.map((n) => `<p class="warn">${esc(n)}</p>`).join("")}
      <div class="row">
        <a class="btn small" href="${directionsUrl(w)}" target="_blank" rel="noopener">Directions</a>
        ${infoUrl(w) ? `<a class="btn small ghost" href="${infoUrl(w)}" target="_blank" rel="noopener">Trail map</a>` : ""}
        ${past.length ? `<button class="btn small ghost" data-action="open-past" data-event="${esc(past[0].id)}">Photos</button>` : ""}
      </div>
      ${w.addedBy && isMe(w.addedBy) && !S.events.some((e) => e.walk_id === w.id)
        ? `<p><button class="linkish" data-action="remove-spot" data-walk="${esc(w.id)}">Remove this spot</button></p>` : ""}
    </div>`;
  }

  function focusWalk(id) {
    const w = walkFor(id);
    if (!markers[id]) return;
    if (!dogsOK(w) && !S.showNoDogs) { S.showNoDogs = true; updatePins(); }
    if (window.innerWidth < 860) $("#map").scrollIntoView({ behavior: "smooth", block: "start" });
    map.flyTo([w.lat, w.lon], 13, { duration: 0.8 });
    setTimeout(() => markers[id].openPopup(), 850);
  }

  // ---------- views ----------
  function render() {
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
    const view = $("#view");
    if (S.tab === "week") view.innerHTML = weekHtml();
    else if (S.tab === "past") view.innerHTML = S.detail ? pastDetailHtml(S.detail) : pastListHtml();
    else { view.innerHTML = spotsHtml(); renderSpotList(); }
    updatePins();
    updateRadiusCircle();
  }

  function weekHtml() {
    const date = nextMeetDate();
    const ev = currentEvent();
    if (!ev || S.rerolling) return spinHtml(date, ev);
    const w = walkFor(ev.walk_id);
    const people = rsvpsFor(ev.id);
    const mine = people.find((r) => isMe(r.name));
    const { notes } = seasonCheck(w, ev.meet_date);
    return `<article class="card">
      <p class="eyebrow">This week</p>
      <p class="when">${esc(fmtDate(ev.meet_date))} · ${esc(fmtTime(ev.meet_time || cfg.meetTime))}</p>
      <h2 class="walk-name">${esc(w.name)}</h2>
      <p class="walk-town">${esc(w.town)}${ev.picked_by ? ` · spun by ${esc(ev.picked_by)}` : ""}</p>
      <p class="hint" style="margin:0 0 8px">${esc(walkMeta(w))}</p>
      <p class="blurb">${esc(w.blurb)}</p>
      ${w.tips ? `<p class="hint">💡 ${esc(w.tips)}</p>` : ""}
      ${ev.note ? `<p class="note"><strong>Meet:</strong> ${esc(ev.note)}</p>` : ""}
      ${notes.map((n) => `<p class="warn">${esc(n)}</p>`).join("")}
      ${S.editing ? editFormHtml(ev) : ""}
      <div class="row">
        <a class="btn small" href="${directionsUrl(w)}" target="_blank" rel="noopener">Directions</a>
        <button class="btn small ghost" data-action="map-focus" data-walk="${esc(w.id)}">On the map</button>
        ${infoUrl(w) ? `<a class="btn small ghost" href="${infoUrl(w)}" target="_blank" rel="noopener">Trail map</a>` : ""}
        <button class="btn small ghost" data-action="calendar">Add to calendar</button>
        <button class="btn small ghost" data-action="invite">Share invite</button>
        <button class="btn small ghost" data-action="reroll">🎲 Re-roll</button>
      </div>

      <h3 class="section-title">Who's coming (${people.length})</h3>
      ${people.length ? `<ul class="people">${people.map((r) => `<li class="${isMe(r.name) ? "me" : ""}">${esc(r.name)}${r.dog ? ` &amp; ${esc(r.dog)}` : ""}</li>`).join("")}</ul>` : `<p class="hint">Nobody yet. Be the first!</p>`}
      <div class="row" style="margin-top:10px">
        ${mine
          ? `<button class="btn ghost" data-action="rsvp-out" data-id="${esc(mine.id)}">Can't make it anymore</button>`
          : `<button class="btn" data-action="rsvp-in">I'm in! 🐕</button>`}
      </div>

      ${photosSectionHtml(ev)}

      ${S.editing ? "" : `<p style="margin-top:14px"><button class="linkish" data-action="edit">Edit time / meeting spot</button></p>`}
    </article>`;
  }

  function spinHtml(date, ev) {
    const pool = candidates(date, ev && ev.walk_id);
    return `<article class="card spin-box">
      <p class="eyebrow">${ev ? "Re-roll" : "Next walk"}</p>
      <p class="when">${esc(fmtDate(date))} · ${esc(fmtTime(ev ? ev.meet_time || cfg.meetTime : cfg.meetTime))}</p>
      <p>${ev ? `Currently <strong>${esc(walkFor(ev.walk_id).name)}</strong>. Spin again for somewhere else.` : "No spot picked yet. Spin to choose this week's walk!"}</p>
      <div class="row filters mode-switch" role="group" aria-label="How to pick">
        <button class="chip" data-action="set-mode" data-mode="region" aria-pressed="${S.mode === "region"}">By region</button>
        <button class="chip" data-action="set-mode" data-mode="distance" aria-pressed="${S.mode === "distance"}">By distance (any state)</button>
      </div>
      ${S.mode === "region"
        ? `<div class="row filters">${REGIONS.map((r) => `<button class="chip" data-action="region" data-region="${esc(r)}" aria-pressed="${S.regions.has(r)}">${esc(r)}</button>`).join("")}</div>`
        : `<div class="row filters">${RADII.map((r) => `<button class="chip" data-action="set-radius" data-radius="${r}" aria-pressed="${S.radiusMi === r}">${r} mi</button>`).join("")}</div>
           <p class="hint" style="margin:4px 0">from <strong>${esc(S.center.label)}</strong> (straight-line) ·
             <button class="linkish" data-action="center-providence">Providence</button> ·
             <button class="linkish" data-action="center-me">my location</button> ·
             <button class="linkish" data-action="center-pick">${S.pickingCenter ? "now tap the map…" : "tap the map"}</button></p>`}
      <div class="row filters">
        <button class="chip" data-action="toggle-filter" data-filter="favOnly" aria-pressed="${S.favOnly}">★ Favourites only</button>
        <button class="chip" data-action="toggle-filter" data-filter="easyOnly" aria-pressed="${S.easyOnly}">Easy walks only</button>
      </div>
      <div class="slot" id="slot">${pool.length ? "?" : "No spots match those filters"}</div>
      <button class="btn big" data-action="spin" ${pool.length ? "" : "disabled"}>Spin the wheel</button>
      <p class="hint" style="margin-top:10px">${pool.length} spot${pool.length === 1 ? "" : "s"} in the hat. Places you've walked sit out until you've done them all, and seasonal beach bans are skipped.</p>
      ${ev ? `<p><button class="linkish" data-action="reroll-cancel">Never mind, keep it</button></p>` : ""}
      <p><button class="linkish" data-action="add-spot">Know a good spot that's missing? Add it to the hat</button></p>
    </article>`;
  }

  function editFormHtml(ev) {
    return `<form class="edit-form card" id="edit-form" style="box-shadow:none">
      <label>Start time <input type="time" name="time" value="${esc(ev.meet_time || cfg.meetTime)}" required></label>
      <label>Meeting spot / notes <textarea name="note" rows="2" maxlength="300" placeholder="e.g. Main lot off Route 114, by the stone barns">${esc(ev.note || "")}</textarea></label>
      <div class="row end">
        <button type="button" class="btn ghost small" data-action="edit-cancel">Cancel</button>
        <button class="btn small">Save</button>
      </div>
    </form>`;
  }

  function photosSectionHtml(ev) {
    const photos = photosFor(ev.id);
    return `<h3 class="section-title">Photos (${photos.length})</h3>
      ${photos.length ? `<div class="gallery">${photos.map((p) => `<button data-action="photo" data-id="${esc(p.id)}"><img loading="lazy" src="${esc(S.store.photoUrl(p))}" alt="${esc(p.caption || "Walk photo")}"></button>`).join("")}</div>` : `<p class="hint">No photos yet.</p>`}
      <div class="row" style="margin-top:10px">
        <label class="upload btn small ghost">Add photos
          <input type="file" accept="image/*" multiple data-upload="${esc(ev.id)}">
        </label>
      </div>`;
  }

  function pastListHtml() {
    const past = pastEvents();
    if (!past.length) return `<p class="empty">No past walks yet. They'll show up here after each meetup, with everyone's photos.</p>`;
    return `<div class="list">${past.map((ev) => {
      const w = walkFor(ev.walk_id);
      const photos = photosFor(ev.id);
      const n = rsvpsFor(ev.id).length;
      return `<button class="list-item" data-action="open-past" data-event="${esc(ev.id)}">
        <h3>${esc(w.name)}</h3>
        <span class="badge">${esc(fmtShort(ev.meet_date))}</span>
        <span class="meta">${esc(w.town)} · ${n} walker${n === 1 ? "" : "s"} · ${photos.length} photo${photos.length === 1 ? "" : "s"}</span>
        ${photos.length ? `<span class="thumbs">${photos.slice(0, 5).map((p) => `<img loading="lazy" src="${esc(S.store.photoUrl(p))}" alt="">`).join("")}</span>` : ""}
      </button>`;
    }).join("")}</div>`;
  }

  function pastDetailHtml(evId) {
    const ev = S.events.find((e) => e.id === evId);
    if (!ev) { S.detail = null; return pastListHtml(); }
    const w = walkFor(ev.walk_id);
    const people = rsvpsFor(ev.id);
    return `<p><button class="linkish" data-action="back">← All past walks</button></p>
      <article class="card">
        <p class="eyebrow">${esc(fmtDate(ev.meet_date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</p>
        <h2 class="walk-name">${esc(w.name)}</h2>
        <p class="walk-town">${esc(w.town)}</p>
        ${ev.note ? `<p class="note">${esc(ev.note)}</p>` : ""}
        <h3 class="section-title">Who came (${people.length})</h3>
        ${people.length ? `<ul class="people">${people.map((r) => `<li>${esc(r.name)}${r.dog ? ` &amp; ${esc(r.dog)}` : ""}</li>`).join("")}</ul>` : `<p class="hint">Nobody RSVP'd. Mystery walk!</p>`}
        ${photosSectionHtml(ev)}
        <div class="row" style="margin-top:12px">
          <button class="btn small ghost" data-action="map-focus" data-walk="${esc(w.id)}">On the map</button>
        </div>
      </article>`;
  }

  function spotsHtml() {
    if (S.adding) return addSpotHtml();
    const added = WALKS.length - CURATED.length;
    return `<div class="row" style="justify-content:space-between; margin-bottom:10px">
        <p class="hint" style="margin:0; flex:1">${WALKS.filter(dogsOK).length} dog-friendly spots${added ? `, ${added} added by friends` : ""}.</p>
        <button class="btn small" data-action="add-spot">+ Add a spot</button>
      </div>
      <label>Find a spot <input type="search" id="spot-search" placeholder="Name, town, beach, woods…" value="${esc(S.query)}"></label>
      <p class="hint" style="margin:6px 0 0">Grey = not yet walked, green = walked, orange = this week, purple = no dogs allowed (map toggle).</p>
      <div id="spot-list"></div>`;
  }

  function addSpotHtml() {
    return `<form class="card edit-form" id="spot-form" style="box-shadow:none" autocomplete="off">
      <h2 style="font-size:1.25rem">Add a dog-friendly spot</h2>
      <p class="hint">Once it's added, everyone sees it on the map and it can come up in future spins.</p>
      <label>Name <input name="name" required minlength="2" maxlength="80" placeholder="e.g. Tillinghast Pond trails"></label>
      <div>
        <label for="place-q">Where is it?</label>
        <div class="row" style="flex-wrap:nowrap; margin-top:4px">
          <input id="place-q" placeholder="Search a park, trail or address">
          <button type="button" class="btn small" data-action="search-place">Find</button>
        </div>
        <div id="place-hits" class="list" style="margin-top:6px"></div>
        <p id="place-status" class="note">${S.draft ? "📍 Pin dropped. Drag it on the map to fine-tune." : "Search above, or tap the map to drop a pin at the parking spot/trailhead."}</p>
      </div>
      <label>Town <input name="town" maxlength="40" placeholder="Filled in from the pin"></label>
      <label>What kind of walk?
        <select name="type">${TYPES.map((t) => `<option>${t}</option>`).join("")}</select>
      </label>
      <label>What's it like? Parking tips? <textarea name="blurb" rows="3" maxlength="400" placeholder="e.g. Easy 2 mi loop around the pond, park at the end of Old Snake Hill Rd"></textarea></label>
      <label class="check"><input type="checkbox" name="offseason"> Dogs only allowed here Oct–Mar (e.g. a swimming beach)</label>
      <label class="check"><input type="checkbox" required> Dogs are allowed here (on leash is fine)</label>
      <div class="row end">
        <button type="button" class="btn ghost small" data-action="add-cancel">Cancel</button>
        <button type="submit" class="btn small">Add spot</button>
      </div>
    </form>`;
  }

  function renderSpotList() {
    if (!$("#spot-list")) return;
    const q = S.query.trim().toLowerCase();
    const cur = currentEvent();
    const counts = {};
    pastEvents().forEach((e) => { counts[e.walk_id] = (counts[e.walk_id] || 0) + 1; });
    const all = WALKS.filter((w) => !q || `${w.name} ${w.town} ${w.type} ${w.region} ${w.blurb}`.toLowerCase().includes(q));
    const match = all.filter(dogsOK);
    const noDogs = all.filter((w) => !dogsOK(w));
    const noDogsHtml = noDogs.length ? `<details class="nodog-list" ${q ? "open" : ""}>
        <summary class="region-title">🚫 No dogs allowed: humans-only walks (${noDogs.length})</summary>
        <div class="list">${noDogs.map((w) => `<button class="list-item" data-action="map-focus" data-walk="${esc(w.id)}">
          <h3>${esc(w.name)}</h3><span class="badge nodog">no dogs</span>
          <span class="meta">${esc(w.town)}${w.miles ? ` · ${w.miles} mi` : ""}</span>
        </button>`).join("")}</div>
      </details>` : "";
    $("#spot-list").innerHTML = (match.length || noDogs.length) ? REGIONS.map((r) => {
      const ws = match.filter((w) => w.region === r);
      if (!ws.length) return "";
      return `<h3 class="region-title">${esc(r)}</h3><div class="list">${ws.map((w) => {
        const badge = cur && cur.walk_id === w.id ? `<span class="badge next">This week</span>`
          : counts[w.id] ? `<span class="badge visited">Walked ${counts[w.id]}×</span>`
          : w.addedBy ? `<span class="badge">added by ${esc(w.addedBy)}</span>` : "";
        return `<button class="list-item" data-action="map-focus" data-walk="${esc(w.id)}">
          <h3>${esc(w.name)}</h3>${badge}
          <span class="meta">${esc(w.town)} · ${esc(walkMeta(w))}</span>
        </button>`;
      }).join("")}</div>`;
    }).join("") + noDogsHtml : `<p class="empty">No spots match “${esc(S.query)}”.</p>`;
  }

  // ---------- actions ----------
  async function spin() {
    if (S.spinning) return;
    const date = nextMeetDate();
    const existing = currentEvent();
    const pool = candidates(date, existing && existing.walk_id);
    if (!pool.length) return toast("No spots in those regions. Turn some back on!");
    const me = await requireMe();
    if (!me) return;

    S.spinning = true;
    map.closePopup();
    const slot = $("#slot");
    $('[data-action="spin"]').disabled = true;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (let delay = 40; delay < 320 && !reduced; delay *= 1.12) {
      slot.textContent = pool[Math.floor(Math.random() * pool.length)].name;
      await sleep(delay);
    }
    slot.textContent = pick.name;
    slot.classList.add("done");
    confetti();
    await sleep(900);

    try {
      if (existing) await S.store.updateEvent(existing.id, { walk_id: pick.id, picked_by: me.name });
      else await S.store.createEvent({ meet_date: date, walk_id: pick.id, meet_time: cfg.meetTime, picked_by: me.name });
    } catch (e) {
      toast(e instanceof window.AugsStore.ConflictError ? "Someone else just spun! Here's their pick." : errMsg(e), 4000);
    }
    S.spinning = false;
    S.rerolling = false;
    await refresh(true);
    const ev = currentEvent();
    if (ev) focusWalk(ev.walk_id);
  }

  async function rsvpIn() {
    const ev = currentEvent();
    const me = await requireMe();
    if (!ev || !me) return;
    try {
      await S.store.addRsvp({ event_id: ev.id, name: me.name, dog: me.dog || null });
      toast("See you there!");
    } catch (e) { toast(errMsg(e)); }
    await refresh(true);
  }

  async function rsvpOut(id) {
    try { await S.store.removeRsvp(id); } catch (e) { toast(errMsg(e)); }
    await refresh(true);
  }

  async function saveEdit(form) {
    const ev = currentEvent();
    if (!ev) return;
    try {
      await S.store.updateEvent(ev.id, { meet_time: form.elements.time.value, note: form.elements.note.value.trim() || null });
      S.editing = false;
      toast("Saved");
    } catch (e) { toast(errMsg(e)); }
    await refresh(true);
  }

  function downloadCalendar() {
    const ev = currentEvent();
    if (!ev) return;
    const w = walkFor(ev.walk_id);
    const [h, m] = (ev.meet_time || cfg.meetTime).split(":").map(Number);
    const start = parseDate(ev.meet_date);
    start.setHours(h, m);
    const end = new Date(start.getTime() + 90 * 60000);
    const local = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const txt = (s) => String(s).replace(/[\\,;]/g, "\\$&").replace(/\n/g, "\\n");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Augs Dogs//EN", "BEGIN:VEVENT",
      `UID:${ev.id}@augs-dogs`, `DTSTAMP:${stamp}`, `DTSTART:${local(start)}`, `DTEND:${local(end)}`,
      `SUMMARY:${txt(`${cfg.groupName}: ${w.name}`)}`,
      `LOCATION:${txt(`${w.name}, ${w.town}, RI`)}`,
      `DESCRIPTION:${txt([ev.note && `Meet: ${ev.note}`, directionsUrl(w), pageUrl()].filter(Boolean).join("\n"))}`,
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = `augs-dogs-${ev.meet_date}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function shareInvite() {
    const ev = currentEvent();
    if (!ev) return;
    const w = walkFor(ev.walk_id);
    const text = [
      `🐾 ${cfg.groupName}: ${fmtDate(ev.meet_date)} at ${fmtTime(ev.meet_time || cfg.meetTime)}`,
      `${w.name} (${w.town})`,
      ev.note && `Meet: ${ev.note}`,
      `Directions: ${directionsUrl(w)}`,
      `Say you're in: ${pageUrl()}`,
    ].filter(Boolean).join("\n");
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast("Invite copied. Paste it in the group chat!"); }
    } catch (e) {
      if (e && e.name === "AbortError") return;
      window.prompt("Copy this invite:", text);
    }
  }

  // Shrink photos in the browser before upload: phone photos are 3-8 MB, these end up ~300-600 KB.
  async function resizeImage(file, maxSide, quality) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch {
      src = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Couldn't read ${file.name}. Try a JPEG or PNG.`));
        img.src = URL.createObjectURL(file);
      });
    }
    const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
    const c = document.createElement("canvas");
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return new Promise((resolve) => c.toBlob(resolve, "image/jpeg", quality));
  }

  async function uploadPhotos(input) {
    const ev = S.events.find((e) => e.id === input.dataset.upload);
    const files = [...input.files];
    input.value = "";
    if (!ev || !files.length) return;
    const me = await requireMe();
    if (!me) return;
    const demo = S.store.mode === "demo";
    let done = 0;
    for (const f of files) {
      toast(`Uploading ${done + 1} of ${files.length}…`, 60000);
      try {
        const blob = await resizeImage(f, demo ? 900 : 1800, demo ? 0.7 : 0.82);
        await S.store.addPhoto(ev.id, ev.walk_id, blob, { by: me.name });
        done++;
      } catch (e) { toast(errMsg(e), 4000); break; }
    }
    if (done) toast(`${done} photo${done === 1 ? "" : "s"} added!`);
    await refresh(true);
  }

  // ---------- lightbox ----------
  const lb = { list: [], i: 0 };
  function openLightbox(photoId) {
    const p = S.photos.find((x) => x.id === photoId);
    if (!p) return;
    lb.list = photosFor(p.event_id);
    lb.i = lb.list.indexOf(p);
    showLightbox();
    $("#lightbox").showModal();
  }
  function showLightbox() {
    const p = lb.list[lb.i];
    const box = $("#lightbox");
    $("img", box).src = S.store.photoUrl(p);
    $(".lb-caption", box).textContent = [p.caption, p.uploaded_by && `by ${p.uploaded_by}`].filter(Boolean).join(" · ");
    box.querySelectorAll(".lb-nav").forEach((b) => { b.hidden = lb.list.length < 2; });
  }
  function stepLightbox(d) {
    lb.i = (lb.i + d + lb.list.length) % lb.list.length;
    showLightbox();
  }

  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < 26; i++) {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      el.setAttribute("viewBox", "0 0 64 64");
      el.setAttribute("class", "confetti");
      el.innerHTML = $(".paw").innerHTML;
      el.style.left = Math.random() * 100 + "vw";
      el.style.animationDuration = 1.6 + Math.random() * 1.6 + "s";
      el.style.animationDelay = Math.random() * 0.3 + "s";
      el.style.width = el.style.height = 10 + Math.random() * 14 + "px";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3800);
    }
  }

  // ---------- wiring ----------
  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".tabs button");
    if (tab) { S.tab = tab.dataset.tab; S.detail = null; S.adding = false; clearDraft(); render(); return; }
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    if (a === "spin") spin();
    else if (a === "region") {
      const r = el.dataset.region;
      S.regions.has(r) ? S.regions.delete(r) : S.regions.add(r);
      render();
    }
    else if (a === "reroll") { if (confirm("Re-roll this week's walk? Everyone will see the new pick.")) { S.rerolling = true; render(); } }
    else if (a === "reroll-cancel") { S.rerolling = false; render(); }
    else if (a === "edit") { S.editing = true; render(); }
    else if (a === "edit-cancel") { S.editing = false; render(); }
    else if (a === "rsvp-in") rsvpIn();
    else if (a === "rsvp-out") rsvpOut(el.dataset.id);
    else if (a === "calendar") downloadCalendar();
    else if (a === "invite") shareInvite();
    else if (a === "map-focus") focusWalk(el.dataset.walk);
    else if (a === "open-past") {
      S.tab = "past"; S.detail = el.dataset.event; map.closePopup(); render();
      $(".panel").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    else if (a === "back") { S.detail = null; render(); }
    else if (a === "photo") openLightbox(el.dataset.id);
    else if (a === "toggle-filter") { S[el.dataset.filter] = !S[el.dataset.filter]; render(); }
    else if (a === "set-mode") {
      S.mode = el.dataset.mode; S.pickingCenter = false; savePrefs(); render();
      if (S.mode === "distance" && radiusCircle) map.flyToBounds(radiusCircle.getBounds(), { duration: 0.6 });
    }
    else if (a === "set-radius") { S.radiusMi = +el.dataset.radius; savePrefs(); render(); map.flyToBounds(radiusCircle.getBounds(), { duration: 0.6 }); }
    else if (a === "center-providence") setCenter(PROVIDENCE);
    else if (a === "center-me") centerOnMe();
    else if (a === "center-pick") {
      S.pickingCenter = true; render();
      if (window.innerWidth < 860) $("#map").scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Tap the map where you want to start from", 3500);
    }
    else if (a === "add-spot") startAdding();
    else if (a === "add-cancel") { S.adding = false; clearDraft(); render(); }
    else if (a === "search-place") searchPlace();
    else if (a === "pick-hit") pickHit(+el.dataset.i);
    else if (a === "remove-spot") removeSpot(el.dataset.walk);
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id === "edit-form") { e.preventDefault(); saveEdit(e.target); }
    if (e.target.id === "spot-form") { e.preventDefault(); saveSpot(e.target); }
  });
  document.addEventListener("keydown", (e) => {
    // Enter in the place search runs the search instead of submitting the form.
    if (e.key === "Enter" && e.target.id === "place-q") { e.preventDefault(); searchPlace(); }
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches("input[data-upload]")) uploadPhotos(e.target);
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "spot-search") { S.query = e.target.value; renderSpotList(); }
  });
  $("#me-button").addEventListener("click", askMe);
  const box = $("#lightbox");
  $(".lb-close", box).addEventListener("click", () => box.close());
  $(".lb-prev", box).addEventListener("click", () => stepLightbox(-1));
  $(".lb-next", box).addEventListener("click", () => stepLightbox(1));
  box.addEventListener("click", (e) => { if (e.target === box) box.close(); });
  document.addEventListener("keydown", (e) => {
    if (!box.open) return;
    if (e.key === "ArrowLeft") stepLightbox(-1);
    if (e.key === "ArrowRight") stepLightbox(1);
  });

  // ---------- data ----------
  async function refresh(force) {
    try {
      const [events, rsvps, photos] = await Promise.all([S.store.listEvents(), S.store.listRsvps(), S.store.listPhotos()]);
      S.events = events.slice().sort((a, b) => a.meet_date.localeCompare(b.meet_date));
      S.rsvps = rsvps;
      S.photos = photos;
    } catch (e) {
      console.error(e);
      toast("Couldn't reach the shared data. Check config.js / your connection.", 5000);
    }
    // Separate from the rest so the site still works before supabase/002_spots.sql has been run.
    try {
      S.spots = await S.store.listSpots();
      S.spotsReady = true;
    } catch (e) {
      console.warn("Friend-added spots unavailable (has supabase/002_spots.sql been run?)", e);
      S.spotsReady = false;
    }
    setSpots(S.spots);
    // Background refreshes only redraw when something changed and nobody is mid-edit.
    const sig = JSON.stringify([S.events, S.rsvps.length, S.photos.length, S.spots.length]);
    if (!force && (sig === S.signature || S.editing || S.spinning || S.rerolling || S.adding || $("#me-dialog").open)) return;
    S.signature = sig;
    render();
  }

  async function start() {
    document.title = cfg.groupName;
    $("#group-name").textContent = cfg.groupName;
    renderMe();
    initMap();
    render();
    S.store = await window.AugsStore.createStore();
    $("#demo-banner").hidden = S.store.mode !== "demo";
    await refresh(true);
    if (S.store.mode === "shared") {
      setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
    }
  }

  start();
})();
