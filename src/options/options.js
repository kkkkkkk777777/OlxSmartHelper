/*
 * OLX Smart Helper — Options / Help page logic.
 * Runs in the extension page context; reuses store.js + presets.js (loaded
 * before this file) which both talk to chrome.storage.local.
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

  function fmtPrice(p, cur) {
    if (p == null) return "—";
    return (
      Math.round(p).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") +
      (cur ? " " + cur : "")
    );
  }

  function fmtDate(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleDateString();
    } catch (e) {
      return "";
    }
  }

  /* ---------- watchlist ---------- */

  async function renderWatchlist() {
    const box = document.getElementById("watchlist");
    if (!store) {
      box.innerHTML = '<div class="empty">Хранилище недоступно.</div>';
      return;
    }
    const items = await store.getWatchlist();
    if (!items.length) {
      box.innerHTML =
        '<div class="empty">Пока пусто. На странице объявления нажмите ' +
        "<b>☆ Сохранить</b> — оно появится здесь с ценой, статусом и датой.</div>";
      return;
    }
    box.innerHTML = "";
    for (const r of items) {
      const el = document.createElement("div");
      el.className = "wl-item";
      const statusLabel = store.STATUS_LABELS[r.status] || "";
      el.innerHTML =
        '<div class="wl-main">' +
        '<div class="wl-title"><a href="' +
        esc(r.url) +
        '" target="_blank">' +
        (esc(r.title) || "Объявление") +
        "</a></div>" +
        '<div class="wl-meta">' +
        "<span>" + fmtPrice(r.price, r.currency) + "</span>" +
        (statusLabel ? "<span>" + esc(statusLabel) + "</span>" : "") +
        (r.savedAt ? "<span>сохранено " + fmtDate(r.savedAt) + "</span>" : "") +
        "</div>" +
        (r.note ? '<div class="wl-note">“' + esc(r.note) + '”</div>' : "") +
        "</div>";
      const btn = document.createElement("button");
      btn.className = "wl-remove";
      btn.textContent = "Убрать";
      btn.addEventListener("click", async () => {
        await store.remove(r.id);
        renderWatchlist();
      });
      el.appendChild(btn);
      box.appendChild(el);
    }
  }

  /* ---------- presets ---------- */

  async function renderPresets() {
    const box = document.getElementById("presets");
    if (!presets) {
      box.innerHTML = '<div class="empty">Хранилище недоступно.</div>';
      return;
    }
    const list = await presets.getAll();
    box.innerHTML = "";
    for (const p of list) {
      const el = document.createElement("div");
      el.className = "pre-item";
      el.innerHTML =
        '<div class="pre-main">' +
        '<div class="pre-label">' +
        esc(p.label) +
        (p.isDefault ? '<span class="star">★</span>' : "") +
        "</div>" +
        '<div class="pre-text">' +
        esc(p.text) +
        "</div></div>";

      const star = document.createElement("button");
      star.className = "pre-del";
      star.textContent = p.isDefault ? "★" : "☆";
      star.title = "Сделать шаблоном по умолчанию";
      star.addEventListener("click", async () => {
        await presets.setDefault(p.id);
        renderPresets();
      });

      const del = document.createElement("button");
      del.className = "pre-del";
      del.textContent = "🗑";
      del.title = "Удалить";
      del.addEventListener("click", async () => {
        if (!confirm('Удалить шаблон «' + (p.label || "") + '»?')) return;
        await presets.remove(p.id);
        renderPresets();
      });

      el.appendChild(star);
      el.appendChild(del);
      box.appendChild(el);
    }
    if (!list.length) {
      box.innerHTML =
        '<div class="empty">Нет шаблонов. Добавьте первый ниже — он появится в ' +
        "кнопке <b>Шаблоны</b> на объявлениях.</div>";
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

  /* ---------- backup: export / import ---------- */

  function setStatus(msg, cls) {
    const s = document.getElementById("b-status");
    if (!s) return;
    s.textContent = msg || "";
    s.className = "empty " + (cls || "");
  }

  let pendingMode = "merge"; // which import mode the file picker will use

  function wireBackup() {
    const exportBtn = document.getElementById("b-export");
    const importBtn = document.getElementById("b-import");
    const replaceBtn = document.getElementById("b-import-replace");
    const file = document.getElementById("b-file");
    if (!store || !exportBtn) return;

    exportBtn.addEventListener("click", async () => {
      const bundle = await store.exportAll();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "olx-smart-helper-backup.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Экспортировано.", "b-ok");
    });

    importBtn.addEventListener("click", () => {
      pendingMode = "merge";
      file.click();
    });
    replaceBtn.addEventListener("click", () => {
      const ok = confirm(
        "Заменить ВСЕ данные содержимым файла?\n\n" +
          "Текущие шаблоны, заметки, статусы, список и настройки будут удалены " +
          "без возможности восстановления."
      );
      if (!ok) return;
      pendingMode = "replace";
      file.click();
    });

    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = async () => {
        let bundle;
        try {
          bundle = JSON.parse(reader.result);
        } catch (e) {
          setStatus("Файл повреждён или не является JSON.", "b-err");
          file.value = "";
          return;
        }
        try {
          const res = await store.importAll(bundle, pendingMode);
          const word = res.mode === "replace" ? "Заменено" : "Импортировано";
          setStatus(
            `${word}: шаблонов ${res.presets}, объявлений ${res.listings}.`,
            "b-ok"
          );
          renderWatchlist();
          renderPresets();
          renderDebug();
          syncDebugToggle();
        } catch (e) {
          setStatus("Ошибка импорта: " + (e.message || "неверный файл"), "b-err");
        }
        file.value = "";
      };
      reader.onerror = () => setStatus("Не удалось прочитать файл.", "b-err");
      reader.readAsText(f);
    });
  }

  /* ---------- debug toggle + in-app panel ---------- */

  async function syncDebugToggle() {
    const box = document.getElementById("dbg");
    if (store && box) box.checked = await store.isDebug();
  }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString();
    } catch (e) {
      return "";
    }
  }

  async function renderDebug() {
    const list = document.getElementById("dbg-list");
    if (!store || !list) return;
    const events = await store.getDebugEvents();
    if (!events.length) {
      list.innerHTML = '<div class="empty">Нет событий. Включите режим и обновите страницу OLX.</div>';
      return;
    }
    list.innerHTML = "";
    // newest first
    for (const ev of events.slice().reverse()) {
      const warn = ev.type === "unmatched-card" || ev.type === "no-title";
      const item = document.createElement("div");
      item.className = "dbg-item";
      item.innerHTML =
        '<span class="dbg-time">' + fmtTime(ev.t) + "</span>" +
        '<span class="dbg-type' + (warn ? " warn" : "") + '">' + esc(ev.type) + "</span>" +
        '<span class="dbg-payload">' + esc(shortPayload(ev.payload)) + "</span>";
      list.appendChild(item);
    }
  }

  function shortPayload(p) {
    if (p == null) return "";
    try {
      return typeof p === "string" ? p : JSON.stringify(p);
    } catch (e) {
      return String(p);
    }
  }

  function wireDebug() {
    const box = document.getElementById("dbg");
    const refresh = document.getElementById("dbg-refresh");
    const clear = document.getElementById("dbg-clear");
    if (store && box) {
      box.addEventListener("change", async () => {
        await store.setDebug(box.checked);
        setStatusEl(
          box.checked
            ? "Отладка включена — откройте/обновите страницу OLX."
            : "Отладка выключена."
        );
      });
    }
    if (refresh) refresh.addEventListener("click", renderDebug);
    if (clear)
      clear.addEventListener("click", async () => {
        await store.clearDebugEvents();
        renderDebug();
      });
  }

  function setStatusEl(msg) {
    // small transient note under the toggle reuses the backup status line
    const s = document.getElementById("b-status");
    if (s) {
      s.textContent = msg;
      s.className = "empty";
    }
  }

  /* ---------- version ---------- */

  function renderVersion() {
    const v = document.getElementById("app-version");
    if (v) v.textContent = appVersion();
  }

  /* ---------- CSV export for watchlist ---------- */

  function csvCell(val) {
    const s = val == null ? "" : String(val);
    // Escape per RFC 4180: wrap in quotes, double any inner quotes.
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function wireCsv() {
    const btn = document.getElementById("wl-csv");
    if (!btn || !store) return;
    btn.addEventListener("click", async () => {
      const items = await store.getWatchlist();
      if (!items.length) {
        setStatusEl("В списке пока пусто — нечего экспортировать.");
        return;
      }
      const cols = ["title", "url", "price", "currency", "status", "note", "savedAt"];
      const rows = [cols.join(",")];
      for (const r of items) {
        rows.push(
          [
            csvCell(r.title),
            csvCell(r.url),
            csvCell(r.price),
            csvCell(r.currency),
            csvCell(store.STATUS_LABELS[r.status] || r.status || ""),
            csvCell(r.note),
            csvCell(r.savedAt ? new Date(r.savedAt).toISOString() : ""),
          ].join(",")
        );
      }
      // Prepend BOM so Excel opens UTF-8 correctly.
      download(
        "olx-watchlist.csv",
        "﻿" + rows.join("\r\n"),
        "text/csv;charset=utf-8"
      );
      setStatusEl("Экспортировано объявлений: " + items.length + ".");
    });
  }

  /* ---------- copy diagnostics ---------- */

  function wireCopyDiagnostics() {
    const btn = document.getElementById("dbg-copy");
    if (!btn || !store) return;
    btn.addEventListener("click", async () => {
      const events = await store.getDebugEvents();
      const header =
        "OLX Smart Helper — диагностика\n" +
        "Версия: " + appVersion() + "\n" +
        "Дата: " + new Date().toISOString() + "\n" +
        "Событий: " + events.length + "\n" +
        "----------------------------------------";
      const lines = events.map(
        (ev) =>
          "[" + fmtTime(ev.t) + "] " + ev.type + " " + shortPayload(ev.payload)
      );
      const text = header + "\n" + (lines.join("\n") || "(нет событий)");
      navigator.clipboard
        .writeText(text)
        .then(() => setStatusEl("Диагностика скопирована в буфер."))
        .catch(() => setStatusEl("Не удалось скопировать."));
    });
  }

  function appVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (e) {
      return "—";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderVersion();
    renderWatchlist();
    renderPresets();
    wirePresetAdd();
    wireBackup();
    wireCsv();
    wireDebug();
    wireCopyDiagnostics();
    syncDebugToggle();
    renderDebug();
  });
})();
