/*
 * OLX Smart Helper — per-listing user metadata + watchlist (Phase 1 storage).
 *
 * Reuses chrome.storage.local (same approach as presets.js). One key holds a
 * map of listingId → record:
 *
 *   ListingRecord = {
 *     id, url, title, price, currency,
 *     note: string,
 *     status: 'not_contacted' | 'contacted' | 'replied' | 'ignored',
 *     saved: boolean, savedAt: number|null, updatedAt: number
 *   }
 *
 * Watchlist == records where saved === true. Kept intentionally flat so Phase 2
 * can map it onto listing_actions / a saved_items table later.
 */
(function () {
  "use strict";

  const OLXHelper = (window.OLXHelper = window.OLXHelper || {});

  const KEY = "olxsh_listings";
  const PRESETS_KEY = "olxsh_presets";
  const FLAGS_KEY = "olxsh_flags";

  // Retention: keep every "important" record forever; cap plain records.
  const MAX_PLAIN = 500;

  const STATUSES = ["not_contacted", "contacted", "replied", "ignored"];
  const STATUS_LABELS = {
    not_contacted: "Не связывался",
    contacted: "Написал",
    replied: "Ответил",
    ignored: "Игнор",
  };

  // Derive a stable id from an OLX listing URL (ad id when present).
  function listingKey(urlOrId) {
    if (!urlOrId) return null;
    const s = String(urlOrId);
    const m = s.match(/-ID([A-Za-z0-9]+)\.html/i) || s.match(/\/(\d{5,})(?:[/?#]|$)/);
    if (m) return "id_" + m[1];
    try {
      return "u_" + new URL(s).pathname.replace(/\/+$/, "");
    } catch (e) {
      return "u_" + s.slice(0, 120);
    }
  }

  /* ---------- promisified storage ---------- */

  function rawGet() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(KEY, (obj) => resolve((obj && obj[KEY]) || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  function rawSet(map) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [KEY]: map }, () => resolve(map));
      } catch (e) {
        resolve(map);
      }
    });
  }

  /* ---------- public API ---------- */

  async function getAll() {
    return rawGet();
  }

  async function getRecord(id) {
    if (!id) return null;
    const map = await rawGet();
    return map[id] || null;
  }

  function baseRecord(id, ctx = {}) {
    return {
      id,
      url: ctx.url || "",
      title: ctx.title || "",
      currency: ctx.currency || "",
      price: ctx.price ?? null,
      prevPrice: null,
      firstPrice: ctx.price ?? null,
      firstSeen: null,
      lastSeen: null,
      lastChangedAt: null,
      note: "",
      status: "not_contacted",
      saved: false,
      savedAt: null,
    };
  }

  // Create/patch a record. `ctx` supplies listing fields on first write.
  // Note: price/history are owned by recordPrice() and are NOT overwritten here.
  async function upsert(id, patch, ctx = {}) {
    if (!id) return null;
    const map = await rawGet();
    const prev = map[id] || baseRecord(id, ctx);
    const rec = {
      ...prev,
      // keep light listing fields fresh, but never touch price/history
      url: ctx.url || prev.url,
      title: ctx.title || prev.title,
      currency: ctx.currency || prev.currency,
      ...patch,
      id,
      updatedAt: Date.now(),
    };
    map[id] = rec;
    await rawSet(map);
    return rec;
  }

  /*
   * Record the listing's current price and maintain lightweight history.
   * Returns { record, change }, where change ∈ 'new'|'drop'|'rise'|null.
   */
  async function recordPrice(id, price, ctx = {}) {
    if (!id) return { record: null, change: null };
    const map = await rawGet();
    const now = Date.now();
    let rec = map[id];
    let change = null;

    if (!rec) {
      rec = baseRecord(id, ctx);
      rec.firstSeen = now;
      rec.lastSeen = now;
      rec.price = price ?? null;
      rec.firstPrice = price ?? null;
      change = "new";
    } else {
      rec = { ...rec };
      rec.lastSeen = now;
      if (ctx.title) rec.title = ctx.title;
      if (ctx.url) rec.url = ctx.url;
      if (ctx.currency) rec.currency = ctx.currency;
      if (price != null) {
        if (rec.price == null) {
          rec.price = price;
          if (rec.firstPrice == null) rec.firstPrice = price;
        } else if (price !== rec.price) {
          rec.prevPrice = rec.price;
          rec.price = price;
          rec.lastChangedAt = now;
          change = price < rec.prevPrice ? "drop" : "rise";
        }
      }
    }
    rec.updatedAt = now;
    map[id] = rec;
    pruneMap(map); // keep storage bounded; important records are always kept
    await rawSet(map);
    return { record: rec, change };
  }

  // A record is "important" (never pruned) if the user touched it: saved,
  // has a note, or has a non-default contact status.
  function isImportant(r) {
    return !!(
      r &&
      (r.saved ||
        (r.note && r.note.trim()) ||
        (r.status && r.status !== "not_contacted"))
    );
  }

  // Deterministic retention: keep all important records; among plain records
  // keep only the newest MAX_PLAIN (by lastSeen), drop the rest. Mutates map.
  function pruneMap(map) {
    const plain = [];
    for (const id in map) {
      if (!isImportant(map[id])) plain.push(map[id]);
    }
    if (plain.length <= MAX_PLAIN) return map;
    plain.sort((a, b) => (b.lastSeen || b.updatedAt || 0) - (a.lastSeen || a.updatedAt || 0));
    for (const rec of plain.slice(MAX_PLAIN)) delete map[rec.id];
    return map;
  }

  function setNote(id, note, ctx) {
    return upsert(id, { note: String(note || "") }, ctx);
  }

  function setStatus(id, status, ctx) {
    const s = STATUSES.includes(status) ? status : "not_contacted";
    return upsert(id, { status: s }, ctx);
  }

  // Toggle watchlist membership; returns the updated record.
  async function toggleSave(id, ctx) {
    const cur = await getRecord(id);
    const saved = !(cur && cur.saved);
    return upsert(id, { saved, savedAt: saved ? Date.now() : null }, ctx);
  }

  async function getWatchlist() {
    const map = await rawGet();
    return Object.values(map)
      .filter((r) => r && r.saved)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  async function remove(id) {
    const map = await rawGet();
    delete map[id];
    await rawSet(map);
    return map;
  }

  /* ---------- simple flags (onboarding, debug, etc.) ---------- */

  function getFlag(name) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(FLAGS_KEY, (o) =>
          resolve(!!(o && o[FLAGS_KEY] && o[FLAGS_KEY][name]))
        );
      } catch (e) {
        resolve(false);
      }
    });
  }

  function setFlag(name, value) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(FLAGS_KEY, (o) => {
          const flags = (o && o[FLAGS_KEY]) || {};
          flags[name] = value;
          chrome.storage.local.set({ [FLAGS_KEY]: flags }, () => resolve(true));
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  const isOnboarded = () => getFlag("onboarded");
  const markOnboarded = () => setFlag("onboarded", true);
  const isDebug = () => getFlag("debug");
  const setDebug = (v) => setFlag("debug", !!v);

  /* ---------- import / export backup ---------- */

  function rawGetKeys(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (o) => resolve(o || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  // Export presets + listings (notes/status/watchlist) + flags as one bundle.
  async function exportAll() {
    const o = await rawGetKeys([KEY, PRESETS_KEY, FLAGS_KEY]);
    return {
      app: "olx-smart-helper",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        presets: o[PRESETS_KEY] || [],
        listings: o[KEY] || {},
        flags: o[FLAGS_KEY] || {},
      },
    };
  }

  // Import a bundle in one of two modes:
  //   'merge'   (default) — listings/flags merge (imported wins); presets
  //                         replace only when the file contains any.
  //   'replace'          — fully overwrite presets + listings + flags.
  // Returns counts, or throws on an invalid bundle.
  async function importAll(bundle, mode = "merge") {
    if (!bundle || typeof bundle !== "object" || bundle.app !== "olx-smart-helper" || !bundle.data) {
      throw new Error("Неверный формат файла (ожидается резервная копия OLX Smart Helper)");
    }
    const d = bundle.data;
    let listings, presets, flags;

    if (mode === "replace") {
      listings = d.listings && typeof d.listings === "object" ? { ...d.listings } : {};
      presets = Array.isArray(d.presets) ? d.presets : [];
      flags = d.flags && typeof d.flags === "object" ? { ...d.flags } : {};
    } else {
      const cur = await rawGetKeys([KEY, PRESETS_KEY, FLAGS_KEY]);
      listings = { ...(cur[KEY] || {}), ...(d.listings || {}) };
      presets =
        Array.isArray(d.presets) && d.presets.length ? d.presets : cur[PRESETS_KEY] || [];
      flags = { ...(cur[FLAGS_KEY] || {}), ...(d.flags || {}) };
    }
    pruneMap(listings);

    await new Promise((resolve) => {
      try {
        chrome.storage.local.set(
          { [KEY]: listings, [PRESETS_KEY]: presets, [FLAGS_KEY]: flags },
          () => resolve()
        );
      } catch (e) {
        resolve();
      }
    });
    return { listings: Object.keys(listings).length, presets: presets.length, mode };
  }

  /* ---------- debug events buffer (for the Options debug panel) ---------- */

  const DEBUG_KEY = "olxsh_debug";

  function getDebugEvents() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(DEBUG_KEY, (o) => resolve((o && o[DEBUG_KEY]) || []));
      } catch (e) {
        resolve([]);
      }
    });
  }

  function clearDebugEvents() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [DEBUG_KEY]: [] }, () => resolve(true));
      } catch (e) {
        resolve(false);
      }
    });
  }

  OLXHelper.store = {
    KEY,
    STATUSES,
    STATUS_LABELS,
    MAX_PLAIN,
    listingKey,
    getAll,
    getRecord,
    upsert,
    setNote,
    setStatus,
    toggleSave,
    recordPrice,
    getWatchlist,
    remove,
    isImportant,
    pruneMap,
    getFlag,
    setFlag,
    isOnboarded,
    markOnboarded,
    isDebug,
    setDebug,
    exportAll,
    importAll,
    getDebugEvents,
    clearDebugEvents,
  };
})();
