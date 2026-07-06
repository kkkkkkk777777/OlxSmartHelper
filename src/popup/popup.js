/*
 * OLX Smart Helper — toolbar popup (main settings surface).
 * Runs in the extension popup context; reuses store.js + presets.js.
 * Left-click on the icon opens THIS. Full/advanced settings live on the
 * options page (right-click icon → Options, or the "Все настройки" button).
 */
(function () {
  "use strict";

  const H = window.OLXHelper || {};
  const store = H.store;
  const presets = H.presets;

  function esc(s) {
    return String(s || "").replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function renderVersion() {
    const el = document.getElementById("ver");
    try {
      el.textContent = chrome.runtime.getManifest().version;
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------- presets ---------- */

  async function renderPresets() {
    const box = document.getElementById("presets");
    if (!presets || !box) return;
    const list = await presets.getAll();
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = '<div class="empty">Нет шаблонов. Добавьте первый ниже.</div>';
      return;
    }
    for (const p of list) {
      const row = document.createElement("div");
      row.className = "pre";
      row.innerHTML =
        '<div class="pre-main">' +
        '<div class="pre-label">' + esc(p.label) +
        (p.isDefault ? '<span class="star">★</span>' : "") + "</div>" +
        '<div class="pre-text">' + esc(p.text) + "</div></div>";

      const star = document.createElement("button");
      star.className = "pre-btn";
      star.textContent = p.isDefault ? "★" : "☆";
      star.title = "Сделать по умолчанию";
      star.addEventListener("click", async () => {
        await presets.setDefault(p.id);
        renderPresets();
      });

      const del = document.createElement("button");
      del.className = "pre-btn del";
      del.textContent = "🗑";
      del.title = "Удалить";
      del.addEventListener("click", async () => {
        if (!confirm('Удалить шаблон «' + (p.label || "") + '»?')) return;
        await presets.remove(p.id);
        renderPresets();
      });

      row.appendChild(star);
      row.appendChild(del);
      box.appendChild(row);
    }
  }

  function wirePresetAdd() {
    const add = document.getElementById("p-add");
    if (!add || !presets) return;
    add.addEventListener("click", async () => {
      const label = document.getElementById("p-label");
      const text = document.getElementById("p-text");
      if (!text.value.trim()) {
        text.focus();
        return;
      }
      await presets.add({ label: label.value, text: text.value });
      label.value = "";
      text.value = "";
      renderPresets();
    });
  }

  /* ---------- debug toggle ---------- */

  async function wireDebug() {
    const box = document.getElementById("dbg");
    if (!store || !box) return;
    box.checked = await store.isDebug();
    box.addEventListener("change", () => store.setDebug(box.checked));
  }

  /* ---------- full options (secondary route) ---------- */

  function wireMore() {
    const btn = document.getElementById("more");
    if (!btn) return;
    btn.addEventListener("click", () => {
      // In the popup (extension) context this API is available directly.
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
      window.close();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderVersion();
    renderPresets();
    wirePresetAdd();
    wireDebug();
    wireMore();
  });
})();
