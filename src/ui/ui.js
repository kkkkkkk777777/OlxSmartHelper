/*
 * OLX Smart Helper — UI rendering.
 * Dark, compact, honest. Two surfaces:
 *   - a pill overlaid on each search-result card (fast signal)
 *   - a confidence-based helper panel on a single listing page
 */
(function () {
  "use strict";

  const OLXHelper = (window.OLXHelper = window.OLXHelper || {});
  const U = OLXHelper.utils;

  const COLORS = {
    green: "olxsh-green",
    orange: "olxsh-orange",
    red: "olxsh-red",
    gray: "olxsh-gray",
  };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function svgIcon(path) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("class", "olxsh-ico");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", path);
    s.appendChild(p);
    return s;
  }

  /* ---------- compact pill for cards ---------- */

  function renderCardPill(card, v) {
    if (card.querySelector(".olxsh-pill")) return;
    const colorCls = COLORS[v.color] || COLORS.gray;
    const pill = el("div", `olxsh-pill ${colorCls}${v.great ? " olxsh-great" : ""}`);

    pill.appendChild(el("span", "olxsh-dot"));
    pill.appendChild(el("span", "olxsh-pill-label", v.label));

    // Confidence shown as a tiny 3-bar meter — never a fake number.
    pill.appendChild(confidenceMeter(v.confidenceKey));

    pill.title = tooltipText(v);
    const style = getComputedStyle(card);
    if (style.position === "static") card.style.position = "relative";
    card.appendChild(pill);
  }

  function confidenceMeter(key) {
    const level = key === "high" ? 3 : key === "mid" ? 2 : 1;
    const wrap = el("span", `olxsh-meter olxsh-meter-${level}`);
    for (let i = 1; i <= 3; i++) {
      wrap.appendChild(el("span", `olxsh-bar${i <= level ? " on" : ""}`));
    }
    return wrap;
  }

  function tooltipText(v) {
    const top = v.reasons.slice(0, 3).map((r) => "• " + r.text).join("\n");
    return `OLX Smart Helper — ${v.label}\nУверенность: ${v.confidence}\n${top}`;
  }

  /* ---------- helper panel on listing page ---------- */

  function renderPageCard(target, v, handlers) {
    document.getElementById("olxsh-card")?.remove();

    const colorCls = COLORS[v.color] || COLORS.gray;
    const wrap = el("div", `olxsh-card ${colorCls}${v.great ? " olxsh-great" : ""}`);
    wrap.id = "olxsh-card";

    /* header: status badge + brand */
    const header = el("div", "olxsh-card-head");
    const badge = el("div", "olxsh-badge");
    badge.appendChild(el("span", "olxsh-dot"));
    badge.appendChild(el("span", "olxsh-badge-text", "Статус: " + v.label));
    header.appendChild(badge);
    const brandWrap = el("div", "olxsh-head-right");
    brandWrap.appendChild(el("span", "olxsh-brand", "OLX Smart Helper"));
    const help = el("button", "olxsh-help", "?");
    help.title = "Что это? / настройки";
    help.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Toggle inline info — never navigate away from the page.
      const dr = wrap.querySelector(".olxsh-info");
      if (dr) dr.classList.toggle("olxsh-open");
    });
    brandWrap.appendChild(help);
    header.appendChild(brandWrap);
    wrap.appendChild(header);

    /* inline info/settings drawer (hidden until "?" is clicked) */
    wrap.appendChild(infoDrawer(handlers));

    /* confidence row */
    const conf = el("div", "olxsh-conf");
    conf.appendChild(el("span", "olxsh-conf-label", "Уверенность"));
    conf.appendChild(confidenceMeter(v.confidenceKey));
    conf.appendChild(el("span", `olxsh-conf-val olxsh-fg-${v.color}`, v.confidence));
    wrap.appendChild(conf);

    /* price line — honest about what we actually know */
    wrap.appendChild(priceLine(target, v));

    /* price-history + relist soft signals */
    const signals = signalPills(handlers.priceHistory, handlers.relist);
    if (signals) wrap.appendChild(signals);

    /* reasons */
    if (v.reasons.length) {
      const rWrap = el("div", "olxsh-reasons");
      rWrap.appendChild(el("div", "olxsh-reasons-title", "Причины"));
      const list = el("div", "olxsh-reason-list");
      for (const r of v.reasons) {
        const item = el("div", `olxsh-reason olxsh-reason-${r.kind}`);
        item.appendChild(el("span", "olxsh-reason-mark", reasonMark(r.kind)));
        item.appendChild(el("span", "olxsh-reason-text", r.text));
        list.appendChild(item);
      }
      rWrap.appendChild(list);
      wrap.appendChild(rWrap);
    }

    if (v.great) {
      wrap.appendChild(el("div", "olxsh-note olxsh-note-great", "🔥 Похоже на особенно выгодное предложение"));
    }

    /* comparables drawer (collapsible) */
    if (handlers.comparables && handlers.comparables.length) {
      wrap.appendChild(comparablesDrawer(handlers.comparables));
    }

    /* personal meta: contact status + note + watchlist */
    let metaBox = null;
    if (handlers.meta) {
      metaBox = metaSection(handlers.meta);
      wrap.appendChild(metaBox);
    }

    /* quick seller workflow row */
    if (handlers.quick) {
      wrap.appendChild(quickRow(handlers.quick, metaBox));
    }

    /* actions */
    const actions = el("div", "olxsh-actions");
    actions.appendChild(
      button("Похожие", "M10 2a8 8 0 105.29 14.71l4 4 1.42-1.42-4-4A8 8 0 0010 2zm0 2a6 6 0 110 12 6 6 0 010-12z", () =>
        handlers.onSimilar && handlers.onSimilar()
      )
    );
    actions.appendChild(
      button("Шаблоны", "M4 4h16v12H5.17L4 17.17V4z", (btn) =>
        handlers.onPresets && handlers.onPresets(btn)
      )
    );
    actions.appendChild(
      button("Открыть", "M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h5v2H7v10h10v-3h2v5H5V5z", () =>
        handlers.onOpen && handlers.onOpen()
      )
    );
    wrap.appendChild(actions);

    mountPageCard(wrap);
    return wrap;
  }

  // Inline settings accordion inside the card — no external navigation, no
  // explanatory copy: just a way to reach full settings.
  function infoDrawer(handlers) {
    const d = el("div", "olxsh-info");
    d.addEventListener("click", (e) => e.stopPropagation());
    const set = el("button", "olxsh-info-settings", "Настройки");
    set.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onHelp && handlers.onHelp();
    });
    d.appendChild(set);
    return d;
  }

  // Price-history + relist soft signals as compact pills.
  function signalPills(ph, relist) {
    const pills = [];
    if (ph) {
      const kind =
        ph.change === "drop" || ph.change === "rise"
          ? ph.change
          : ph.prevPrice != null && ph.price != null
          ? ph.price < ph.prevPrice
            ? "drop"
            : ph.price > ph.prevPrice
            ? "rise"
            : null
          : ph.change === "new"
          ? "new"
          : null;
      if (kind === "drop") {
        pills.push(pill("green", "↓ Цена снижена", ph.prevPrice != null ? "было " + U.formatPrice(ph.prevPrice, ph.currency) : ""));
      } else if (kind === "rise") {
        pills.push(pill("red", "↑ Цена выросла", ph.prevPrice != null ? "было " + U.formatPrice(ph.prevPrice, ph.currency) : ""));
      } else if (kind === "new") {
        pills.push(pill("gray", "Новое для вас", ""));
      }
    }
    if (relist && relist.title) {
      pills.push(pill("orange", "Возможно, перевыставлено", ""));
    }
    if (!pills.length) return null;
    const box = el("div", "olxsh-signals");
    pills.forEach((p) => box.appendChild(p));
    return box;
  }

  function pill(color, label, sub) {
    const p = el("span", `olxsh-sig olxsh-sig-${color}`);
    p.appendChild(el("span", "olxsh-sig-label", label));
    if (sub) p.appendChild(el("span", "olxsh-sig-sub", sub));
    return p;
  }

  // Collapsible list of a few comparable listings (title + price + link).
  function comparablesDrawer(items) {
    const box = el("div", "olxsh-comps");
    const toggle = el("button", "olxsh-comps-toggle");
    toggle.appendChild(el("span", null, `Похожие рядом (${items.length})`));
    const chev = el("span", "olxsh-comps-chev", "▾");
    toggle.appendChild(chev);
    const list = el("div", "olxsh-comps-list");
    list.style.display = "none";

    for (const it of items) {
      const row = el("a", "olxsh-comp");
      row.href = it.url || "#";
      row.target = "_blank";
      row.appendChild(el("span", "olxsh-comp-title", it.title || "Объявление"));
      row.appendChild(el("span", "olxsh-comp-price", U.formatPrice(it.price, it.currency)));
      list.appendChild(row);
    }
    toggle.addEventListener("click", () => {
      const open = list.style.display === "none";
      list.style.display = open ? "block" : "none";
      chev.textContent = open ? "▴" : "▾";
    });
    box.appendChild(toggle);
    box.appendChild(list);
    return box;
  }

  // Compact quick actions: copy default preset + one-click "mark contacted".
  function quickRow(quick, metaBox) {
    const row = el("div", "olxsh-quick");
    const copy = el("button", "olxsh-quick-btn");
    copy.textContent = "⚡ Сообщение";
    copy.title = "Скопировать шаблон по умолчанию";
    copy.addEventListener("click", () => quick.onCopyDefault && quick.onCopyDefault());
    row.appendChild(copy);

    const mark = el("button", "olxsh-quick-btn");
    mark.textContent = "✓ Написал";
    mark.title = "Отметить: связался с продавцом";
    mark.addEventListener("click", async () => {
      await (quick.onMarkContacted && quick.onMarkContacted());
      if (metaBox) {
        const sel = metaBox.querySelector(".olxsh-meta-status");
        if (sel) {
          sel.value = "contacted";
          metaBox.dataset.status = "contacted"; // dropdown change is the feedback
        }
      }
    });
    row.appendChild(mark);
    return row;
  }

  // Compact per-listing meta: contact status, personal note, save toggle.
  // meta = { record, statuses, statusLabels, onStatus, onNote, onToggleSave }
  function metaSection(meta) {
    const rec = meta.record || {};
    const box = el("div", "olxsh-meta");

    const row = el("div", "olxsh-meta-row");

    // status dropdown
    const sel = el("select", "olxsh-meta-status");
    for (const s of meta.statuses) {
      const opt = el("option", null, meta.statusLabels[s]);
      opt.value = s;
      if ((rec.status || "not_contacted") === s) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      meta.onStatus(sel.value);
      box.dataset.status = sel.value;
    });
    box.dataset.status = rec.status || "not_contacted";
    row.appendChild(sel);

    // save / watchlist toggle
    const save = el("button", "olxsh-meta-save");
    const paint = (saved) => {
      save.textContent = saved ? "★ В списке" : "☆ Сохранить";
      save.classList.toggle("is-saved", !!saved);
    };
    paint(rec.saved);
    save.addEventListener("click", async () => {
      const updated = await meta.onToggleSave();
      paint(updated && updated.saved); // button label is the feedback
    });
    row.appendChild(save);
    box.appendChild(row);

    // Note field. `change` fires once on blur/Enter — no aggressive per-keystroke
    // or duplicate blur saving, and typing is never interrupted by a re-render.
    const note = el("input", "olxsh-meta-note");
    note.type = "text";
    note.placeholder = "Заметка по объявлению…";
    note.value = rec.note || "";
    note.addEventListener("change", () => meta.onNote(note.value));
    // Keep clicks/keys inside the input from bubbling to card-level handlers.
    note.addEventListener("click", (e) => e.stopPropagation());
    box.appendChild(note);

    return box;
  }

  // Only show a numeric estimate when confidence is high; otherwise stay honest.
  function priceLine(target, v) {
    const box = el("div", "olxsh-priceline");
    if (v.hasReliableEstimate) {
      box.appendChild(kv("Цена объявления", U.formatPrice(target.price, target.currency)));
      box.appendChild(kv("Медиана похожих", U.formatPrice(v.marketPrice, v.currency)));
      if (v.priceDelta != null) {
        const pct = `${v.priceDelta > 0 ? "+" : ""}${Math.round(v.priceDelta * 100)}%`;
        box.appendChild(kv("Разница", pct, v.color));
      }
      box.appendChild(kv("Похожих учтено", String(v.comparablesCount)));
    } else {
      box.classList.add("olxsh-priceline-weak");
      box.appendChild(kv("Цена объявления", U.formatPrice(target.price, target.currency)));
      const note = el("div", "olxsh-weak-note");
      note.appendChild(el("span", "olxsh-weak-ico", "ⓘ"));
      note.appendChild(el("span", null, "Недостаточно данных для точной оценки"));
      box.appendChild(note);
      if (v.comparablesCount > 0) {
        box.appendChild(
          el("div", "olxsh-weak-sub", `Найдено похожих: ${v.comparablesCount} (мало для точной цифры)`)
        );
      }
    }
    return box;
  }

  function kv(label, value, color) {
    const m = el("div", "olxsh-kv");
    m.appendChild(el("div", "olxsh-kv-label", label));
    m.appendChild(el("div", `olxsh-kv-value${color ? " olxsh-fg-" + color : ""}`, value));
    return m;
  }

  function reasonMark(kind) {
    return kind === "pos" ? "✓" : kind === "neg" ? "!" : "•";
  }

  function button(label, iconPath, onClick) {
    const b = el("button", "olxsh-btn");
    b.appendChild(svgIcon(iconPath));
    b.appendChild(el("span", null, label));
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(b);
    });
    return b;
  }

  function mountPageCard(wrap) {
    const aside =
      document.querySelector('[data-testid="ad-price-container"]') ||
      document.querySelector('[data-testid="aside"]') ||
      document.querySelector('[data-cy="ad_title"]');
    if (aside && aside.parentElement) {
      aside.parentElement.insertBefore(wrap, aside.nextSibling);
    } else {
      wrap.classList.add("olxsh-floating");
      document.body.appendChild(wrap);
    }
  }

  /* ---------- seller message presets popover ---------- */

  // controller: { getPresets, apply(preset), add({label,text}), update(id,patch),
  //               remove(id), setDefault(id) }  — mutators return the new list.
  async function openPresetPopover(anchor, controller) {
    document.getElementById("olxsh-presets")?.remove();

    const pop = el("div", "olxsh-presets");
    pop.id = "olxsh-presets";
    pop.addEventListener("click", (e) => e.stopPropagation());

    // header
    const head = el("div", "olxsh-pp-head");
    head.appendChild(el("span", "olxsh-pp-title", "Шаблоны сообщений"));
    const close = el("button", "olxsh-pp-close", "×");
    close.addEventListener("click", () => pop.remove());
    head.appendChild(close);
    pop.appendChild(head);

    const body = el("div", "olxsh-pp-body");
    pop.appendChild(body);

    const foot = el("div", "olxsh-pp-foot");
    const addBtn = el("button", "olxsh-pp-add", "＋ Новый шаблон");
    foot.appendChild(addBtn);
    pop.appendChild(foot);

    let presets = await controller.getPresets();

    function copy(preset) {
      navigator.clipboard
        .writeText(preset.text)
        .then(() => toast(null, "Скопировано: " + preset.label))
        .catch(() => toast(null, "Не удалось скопировать"));
    }

    function renderList() {
      body.innerHTML = "";
      const def = presets.find((p) => p.isDefault);

      // Quick one-click use of the default preset.
      if (def) {
        const quick = el("button", "olxsh-pp-quick");
        quick.appendChild(el("span", "olxsh-pp-quick-ico", "⚡"));
        const q = el("span", "olxsh-pp-quick-text");
        q.appendChild(el("span", "olxsh-pp-quick-label", "По умолчанию"));
        q.appendChild(el("span", "olxsh-pp-quick-sub", def.label));
        quick.appendChild(q);
        quick.addEventListener("click", () => copy(def));
        body.appendChild(quick);
      }

      for (const p of presets) {
        body.appendChild(presetRow(p));
      }
      if (!presets.length) {
        body.appendChild(el("div", "olxsh-pp-empty", "Пока нет шаблонов"));
      }
    }

    function presetRow(p) {
      const row = el("div", `olxsh-pp-row${p.isDefault ? " is-default" : ""}`);

      const star = el("button", "olxsh-pp-star", p.isDefault ? "★" : "☆");
      star.title = p.isDefault ? "Шаблон по умолчанию" : "Сделать по умолчанию";
      star.addEventListener("click", async () => {
        presets = await controller.setDefault(p.id);
        renderList();
      });
      row.appendChild(star);

      const main = el("div", "olxsh-pp-main");
      main.appendChild(el("div", "olxsh-pp-label", p.label));
      main.appendChild(el("div", "olxsh-pp-text", p.text));
      main.title = "Скопировать";
      main.addEventListener("click", () => copy(p));
      row.appendChild(main);

      const edit = el("button", "olxsh-pp-icon", "✎");
      edit.title = "Редактировать";
      edit.addEventListener("click", () => showForm(p, row));
      row.appendChild(edit);

      const del = el("button", "olxsh-pp-icon", "🗑");
      del.title = "Удалить";
      del.addEventListener("click", async () => {
        presets = await controller.remove(p.id);
        renderList();
      });
      row.appendChild(del);

      return row;
    }

    // Inline add/edit form. `preset` null → add mode; `replaceRow` optional.
    function showForm(preset, replaceRow) {
      const form = el("div", "olxsh-pp-form");
      const labelInput = el("input", "olxsh-pp-input");
      labelInput.placeholder = "Название";
      labelInput.value = preset ? preset.label : "";
      const textInput = el("textarea", "olxsh-pp-textarea");
      textInput.placeholder = "Текст сообщения";
      textInput.value = preset ? preset.text : "";
      form.appendChild(labelInput);
      form.appendChild(textInput);

      const row = el("div", "olxsh-pp-form-actions");
      const save = el("button", "olxsh-pp-save", "Сохранить");
      const cancel = el("button", "olxsh-pp-cancel", "Отмена");
      row.appendChild(save);
      row.appendChild(cancel);
      form.appendChild(row);

      save.addEventListener("click", async () => {
        const label = labelInput.value;
        const txt = textInput.value;
        if (!txt.trim()) {
          textInput.focus();
          return;
        }
        presets = preset
          ? await controller.update(preset.id, { label, text: txt })
          : await controller.add({ label, text: txt });
        renderList();
      });
      cancel.addEventListener("click", () => renderList());

      if (replaceRow) {
        replaceRow.replaceWith(form);
      } else {
        body.insertBefore(form, body.firstChild);
      }
      labelInput.focus();
    }

    addBtn.addEventListener("click", () => showForm(null, null));

    renderList();

    // position + mount
    document.body.appendChild(pop);
    positionPopover(pop, anchor);

    // close on outside click / escape
    const onDoc = (e) => {
      if (!pop.contains(e.target)) cleanup();
    };
    const onKey = (e) => {
      if (e.key === "Escape") cleanup();
    };
    function cleanup() {
      pop.remove();
      document.removeEventListener("click", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
    }
    setTimeout(() => {
      document.addEventListener("click", onDoc, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
  }

  function positionPopover(pop, anchor) {
    const r = anchor ? anchor.getBoundingClientRect() : { left: 40, bottom: 80, top: 80 };
    const w = 320;
    let left = Math.min(r.left, window.innerWidth - w - 12);
    left = Math.max(12, left);
    pop.style.left = left + "px";
    // Prefer above the anchor; fall back below if not enough room.
    const popH = pop.offsetHeight || 360;
    if (r.top > popH + 16) {
      pop.style.top = Math.max(12, r.top - popH - 10) + "px";
    } else {
      pop.style.top = r.bottom + 10 + "px";
    }
  }

  function toast(anchor, message) {
    const t = el("div", "olxsh-toast", message);
    (anchor || document.body).appendChild(t);
    requestAnimationFrame(() => t.classList.add("olxsh-toast-show"));
    setTimeout(() => {
      t.classList.remove("olxsh-toast-show");
      setTimeout(() => t.remove(), 250);
    }, 1400);
  }

  OLXHelper.ui = { renderCardPill, renderPageCard, openPresetPopover, toast };
})();
