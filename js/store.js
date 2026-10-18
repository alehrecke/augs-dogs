// Data layer. Two interchangeable stores with the same methods:
//  - LocalStore: demo mode, saved in this browser's localStorage only.
//  - SupabaseStore: shared mode, everyone sees the same events, RSVPs and photos.
(function () {
  const cfg = window.AUGS_CONFIG;

  class ConflictError extends Error {}

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function LocalStore() {
    const KEY = "augs-dogs-demo-v1";
    const empty = () => ({ events: [], rsvps: [], photos: [] });
    const load = () => {
      try { return JSON.parse(localStorage.getItem(KEY)) || empty(); } catch { return empty(); }
    };
    const save = (d) => {
      try { localStorage.setItem(KEY, JSON.stringify(d)); }
      catch { throw new Error("Demo storage is full. Photos need shared mode (see README)."); }
    };
    const now = () => new Date().toISOString();
    return {
      mode: "demo",
      async listEvents() { return load().events; },
      async createEvent(ev) {
        const d = load();
        if (d.events.some((e) => e.meet_date === ev.meet_date)) throw new ConflictError();
        const row = { id: uid(), created_at: now(), ...ev };
        d.events.push(row); save(d); return row;
      },
      async updateEvent(id, patch) {
        const d = load();
        const row = d.events.find((e) => e.id === id);
        Object.assign(row, patch); save(d); return row;
      },
      async listRsvps() { return load().rsvps; },
      async addRsvp(r) {
        const d = load();
        if (d.rsvps.some((x) => x.event_id === r.event_id && x.name === r.name)) return null;
        const row = { id: uid(), created_at: now(), ...r };
        d.rsvps.push(row); save(d); return row;
      },
      async removeRsvp(id) {
        const d = load();
        d.rsvps = d.rsvps.filter((x) => x.id !== id); save(d);
      },
      async listPhotos() { return load().photos; },
      async addPhoto(eventId, walkId, blob, meta) {
        const d = load();
        const row = { id: uid(), created_at: now(), event_id: eventId, walk_id: walkId,
          url: await blobToDataUrl(blob), caption: meta.caption || null, uploaded_by: meta.by || null };
        d.photos.push(row); save(d); return row;
      },
      photoUrl(p) { return p.url; },
    };
  }

  function SupabaseStore(client) {
    const T = (name) => client.from(name);
    const check = ({ data, error }) => { if (error) throw error; return data; };
    const isDuplicate = (res) => res.error && res.error.code === "23505";
    return {
      mode: "shared",
      async listEvents() { return check(await T("events").select("*").order("meet_date")); },
      async createEvent(ev) {
        const res = await T("events").insert(ev).select().single();
        if (isDuplicate(res)) throw new ConflictError();
        return check(res);
      },
      async updateEvent(id, patch) { return check(await T("events").update(patch).eq("id", id).select().single()); },
      async listRsvps() { return check(await T("rsvps").select("*")); },
      async addRsvp(r) {
        const res = await T("rsvps").insert(r).select().single();
        if (isDuplicate(res)) return null;
        return check(res);
      },
      async removeRsvp(id) { check(await T("rsvps").delete().eq("id", id)); },
      async listPhotos() { return check(await T("photos").select("*").order("created_at")); },
      async addPhoto(eventId, walkId, blob, meta) {
        const path = `${eventId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        check(await client.storage.from(cfg.photoBucket).upload(path, blob, { contentType: "image/jpeg" }));
        return check(await T("photos").insert({
          event_id: eventId, walk_id: walkId, path, caption: meta.caption || null, uploaded_by: meta.by || null,
        }).select().single());
      },
      photoUrl(p) { return client.storage.from(cfg.photoBucket).getPublicUrl(p.path).data.publicUrl; },
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function createStore() {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return LocalStore();
    try {
      await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js");
      return SupabaseStore(window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey));
    } catch (e) {
      console.error("Couldn't load Supabase, falling back to demo mode", e);
      return LocalStore();
    }
  }

  window.AugsStore = { createStore, ConflictError };
})();
