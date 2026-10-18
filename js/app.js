(function () {
  const cfg = window.AUGS_CONFIG;
  const WALKS = window.WALKS;
  const BY_ID = Object.fromEntries(WALKS.map((w) => [w.id, w]));
  const REGIONS = ["North", "Providence", "West Bay", "South County", "Newport & East Bay", "Block Island"];

  const S = {
    store: null,
    events: [], rsvps: [], photos: [],
    signature: "",
    tab: "week",
    detail: null,        // event id open in the Past walks tab
    regions: new Set(REGIONS.filter((r) => r !== "Block Island")),
    spinning: false, rerolling: false, editing: false,
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
  const directionsUrl = (w) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${w.name}, ${w.town}, RI`);
  const pageUrl = () => location.href.split("#")[0];

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
    if (f.has("napatree")) {
      if (md >= 502 && md <= 907) ok = false;
      else notes.push("Keep dogs leashed and off the dunes. It's protected bird habitat.");
    }
    if (f.has("orange") && (md >= 901 || md <= 531)) {
      notes.push("Hunting season: RI requires blaze orange here (200 sq in, 500 in December shotgun season). Put an orange vest on the pup too.");
    }
    if (f.has("island")) notes.push("Needs the Block Island ferry from Point Judith. Plan a full day.");
    return { ok, notes };
  }

  // Walks you haven't done yet go first; once every eligible walk is done, anything but the last 5.
  function candidates(dateStr, excludeId) {
    const eligible = WALKS.filter((w) => S.regions.has(w.region) && w.id !== excludeId && seasonCheck(w, dateStr).ok);
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
  const pinIcon = (cls) => L.divIcon({ className: "", html: `<div class="pin ${cls}"></div>`, iconSize: cls === "next" ? [26, 26] : [16, 16] });

  function initMap() {
    // Mainland RI; Block Island is just off the bottom edge.
    map = L.map("map", { zoomSnap: 0.25 }).fitBounds([[41.3, -71.86], [42.02, -71.12]], { padding: [8, 8] });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    for (const w of WALKS) {
      markers[w.id] = L.marker([w.lat, w.lon], { icon: pinIcon(""), title: w.name, riseOnHover: true })
        .addTo(map)
        .bindPopup(() => popupHtml(w), { maxWidth: 270 });
    }
  }

  function updatePins() {
    const cur = currentEvent();
    const visited = new Set(pastEvents().map((e) => e.walk_id));
    for (const w of WALKS) {
      const cls = cur && cur.walk_id === w.id ? "next" : visited.has(w.id) ? "visited" : "";
      markers[w.id].setIcon(pinIcon(cls)).setZIndexOffset(cls === "next" ? 1000 : cls ? 500 : 0);
    }
  }

  function popupHtml(w) {
    const past = pastEvents().filter((e) => e.walk_id === w.id);
    const cur = currentEvent();
    const { notes } = seasonCheck(w, nextMeetDate());
    return `<div class="popup">
      <h3>${esc(w.name)}</h3>
      <p class="walk-town">${esc(w.town)} · ${esc(w.type)}</p>
      <p>${esc(w.blurb)}</p>
      ${cur && cur.walk_id === w.id ? `<p><span class="badge next">This week's walk!</span></p>` : ""}
      ${past.length ? `<p><span class="badge visited">Walked ${past.length}× · last ${esc(fmtShort(past[0].meet_date))}</span></p>` : ""}
      ${notes.map((n) => `<p class="warn">${esc(n)}</p>`).join("")}
      <div class="row">
        <a class="btn small" href="${directionsUrl(w)}" target="_blank" rel="noopener">Directions</a>
        ${past.length ? `<button class="btn small ghost" data-action="open-past" data-event="${esc(past[0].id)}">Photos</button>` : ""}
      </div>
    </div>`;
  }

  function focusWalk(id) {
    const w = walkFor(id);
    if (!markers[id]) return;
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
      <p class="blurb">${esc(w.blurb)}</p>
      ${ev.note ? `<p class="note"><strong>Meet:</strong> ${esc(ev.note)}</p>` : ""}
      ${notes.map((n) => `<p class="warn">${esc(n)}</p>`).join("")}
      ${S.editing ? editFormHtml(ev) : ""}
      <div class="row">
        <a class="btn small" href="${directionsUrl(w)}" target="_blank" rel="noopener">Directions</a>
        <button class="btn small ghost" data-action="map-focus" data-walk="${esc(w.id)}">On the map</button>
        <button class="btn small ghost" data-action="calendar">Add to calendar</button>
        <button class="btn small ghost" data-action="invite">Share invite</button>
      </div>

      <h3 class="section-title">Who's coming (${people.length})</h3>
      ${people.length ? `<ul class="people">${people.map((r) => `<li class="${isMe(r.name) ? "me" : ""}">${esc(r.name)}${r.dog ? ` &amp; ${esc(r.dog)}` : ""}</li>`).join("")}</ul>` : `<p class="hint">Nobody yet. Be the first!</p>`}
      <div class="row" style="margin-top:10px">
        ${mine
          ? `<button class="btn ghost" data-action="rsvp-out" data-id="${esc(mine.id)}">Can't make it anymore</button>`
          : `<button class="btn" data-action="rsvp-in">I'm in! 🐕</button>`}
      </div>

      ${photosSectionHtml(ev)}

      <div class="row" style="margin-top:14px; gap:14px">
        ${S.editing ? "" : `<button class="linkish" data-action="edit">Edit time / meeting spot</button>`}
        <button class="linkish" data-action="reroll">Re-roll the walk</button>
      </div>
    </article>`;
  }

  function spinHtml(date, ev) {
    const pool = candidates(date, ev && ev.walk_id);
    return `<article class="card spin-box">
      <p class="eyebrow">${ev ? "Re-roll" : "Next walk"}</p>
      <p class="when">${esc(fmtDate(date))} · ${esc(fmtTime(ev ? ev.meet_time || cfg.meetTime : cfg.meetTime))}</p>
      <p>${ev ? `Currently <strong>${esc(walkFor(ev.walk_id).name)}</strong>. Spin again for somewhere else.` : "No spot picked yet. Spin to choose this week's walk!"}</p>
      <div class="row filters">${REGIONS.map((r) => `<button class="chip" data-action="region" data-region="${esc(r)}" aria-pressed="${S.regions.has(r)}">${esc(r)}</button>`).join("")}</div>
      <div class="slot" id="slot">${pool.length ? "?" : "No spots in those regions"}</div>
      <button class="btn big" data-action="spin" ${pool.length ? "" : "disabled"}>Spin the wheel</button>
      <p class="hint" style="margin-top:10px">${pool.length} spot${pool.length === 1 ? "" : "s"} in the hat. Places you've walked sit out until you've done them all, and seasonal beach bans are skipped.</p>
      ${ev ? `<p><button class="linkish" data-action="reroll-cancel">Never mind, keep it</button></p>` : ""}
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
    return `<label>Find a spot <input type="search" id="spot-search" placeholder="Name, town, beach, woods…" value="${esc(S.query)}"></label>
      <p class="hint" style="margin:6px 0 0">${WALKS.length} dog-friendly spots. Grey = not yet walked, green = walked, orange = this week.</p>
      <div id="spot-list"></div>`;
  }

  function renderSpotList() {
    const q = S.query.trim().toLowerCase();
    const cur = currentEvent();
    const counts = {};
    pastEvents().forEach((e) => { counts[e.walk_id] = (counts[e.walk_id] || 0) + 1; });
    const match = WALKS.filter((w) => !q || `${w.name} ${w.town} ${w.type} ${w.region} ${w.blurb}`.toLowerCase().includes(q));
    $("#spot-list").innerHTML = match.length ? REGIONS.map((r) => {
      const ws = match.filter((w) => w.region === r);
      if (!ws.length) return "";
      return `<h3 class="region-title">${esc(r)}</h3><div class="list">${ws.map((w) => {
        const badge = cur && cur.walk_id === w.id ? `<span class="badge next">This week</span>`
          : counts[w.id] ? `<span class="badge visited">Walked ${counts[w.id]}×</span>` : "";
        return `<button class="list-item" data-action="map-focus" data-walk="${esc(w.id)}">
          <h3>${esc(w.name)}</h3>${badge}
          <span class="meta">${esc(w.town)} · ${esc(w.type)}</span>
        </button>`;
      }).join("")}</div>`;
    }).join("") : `<p class="empty">No spots match “${esc(S.query)}”.</p>`;
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
    if (tab) { S.tab = tab.dataset.tab; S.detail = null; render(); return; }
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
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id === "edit-form") { e.preventDefault(); saveEdit(e.target); }
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
    // Background refreshes only redraw when something changed and nobody is mid-edit.
    const sig = JSON.stringify([S.events, S.rsvps.length, S.photos.length]);
    if (!force && (sig === S.signature || S.editing || S.spinning || S.rerolling || $("#me-dialog").open)) return;
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
