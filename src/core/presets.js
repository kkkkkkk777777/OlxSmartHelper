/*
 * OLX Smart Helper — seller message presets (Phase 1 storage).
 *
 * Simple CRUD over chrome.storage.local (the storage approach the extension
 * already declares in the manifest). One key holds the whole list:
 *
 *   MessagePreset = { id: string, label: string, text: string, isDefault?: boolean }
 *
 * Phase 2 will move this behind a real DB; the API here is intentionally small
 * so that swap stays localized.
 */
(function () {
  "use strict";

  const OLXHelper = (window.OLXHelper = window.OLXHelper || {});

  const KEY = "olxsh_presets";

  // Seeded on first run. Labels are short; text is the full seller message.
  const DEFAULTS = [
    { label: "Актуально?", text: "Здравствуйте! Актуально ли это объявление?", isDefault: true },
    { label: "Заберу сегодня", text: "Если предложение ещё актуально, могу забрать сегодня. Удобно ли вам?" },
    { label: "Торг при самовывозе", text: "Если заберу лично и без торга, сможете немного снизить цену?" },
    { label: "Состояние товара", text: "Можете, пожалуйста, рассказать подробнее о состоянии товара? Есть ли скрытые дефекты?" },
    { label: "Доставка", text: "Отправите ли вы через службу доставки? Какой способ вам удобнее?" },
  ];

  function uid() {
    return (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- low-level storage (promisified) ---------- */

  function rawGet() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(KEY, (obj) => resolve(obj && obj[KEY]));
      } catch (e) {
        resolve(undefined);
      }
    });
  }

  function rawSet(list) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [KEY]: list }, () => resolve(list));
      } catch (e) {
        resolve(list);
      }
    });
  }

  /* ---------- public API ---------- */

  // Returns the current presets, seeding defaults on first run.
  async function getAll() {
    let list = await rawGet();
    if (!Array.isArray(list)) {
      list = DEFAULTS.map((p) => ({ id: uid(), ...p }));
      ensureSingleDefault(list);
      await rawSet(list);
    }
    return list;
  }

  async function add({ label, text }) {
    const list = await getAll();
    const preset = { id: uid(), label: (label || "").trim() || "Без названия", text: (text || "").trim() };
    if (!preset.text) return list; // ignore empty
    list.push(preset);
    await rawSet(list);
    return list;
  }

  async function update(id, patch) {
    const list = await getAll();
    const p = list.find((x) => x.id === id);
    if (!p) return list;
    if (patch.label != null) p.label = patch.label.trim() || p.label;
    if (patch.text != null) p.text = patch.text.trim() || p.text;
    await rawSet(list);
    return list;
  }

  async function remove(id) {
    let list = await getAll();
    const wasDefault = list.find((x) => x.id === id)?.isDefault;
    list = list.filter((x) => x.id !== id);
    if (wasDefault && list.length) list[0].isDefault = true; // keep a default alive
    await rawSet(list);
    return list;
  }

  async function setDefault(id) {
    const list = await getAll();
    for (const p of list) p.isDefault = p.id === id;
    await rawSet(list);
    return list;
  }

  async function getDefault() {
    const list = await getAll();
    return list.find((p) => p.isDefault) || list[0] || null;
  }

  function ensureSingleDefault(list) {
    if (!list.length) return;
    if (!list.some((p) => p.isDefault)) list[0].isDefault = true;
  }

  OLXHelper.presets = {
    KEY,
    DEFAULTS,
    getAll,
    add,
    update,
    remove,
    setDefault,
    getDefault,
  };
})();
