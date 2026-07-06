/*
 * OLX Smart Helper — content script entry point.
 * Wires extractor → similarity → estimator → UI on both listing pages and
 * search-result cards. Re-runs on SPA navigation and lazy-loaded cards.
 */
(function () {
  "use strict";

  const OLXHelper = window.OLXHelper;
  if (!OLXHelper) return;
  const { utils: U, extractor, similarity, evaluator, store, ui } = OLXHelper;
  const debug = OLXHelper.debug;

  // Load debug flag and keep it live if toggled from the Options page.
  store.isDebug().then((v) => debug.set(v));
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.olxsh_flags) {
        debug.set(!!(changes.olxsh_flags.newValue && changes.olxsh_flags.newValue.debug));
      }
    });
  } catch (e) {
    /* ignore if unavailable */
  }

  /* ---------- build the comparison pool from visible cards ---------- */

  function buildPool() {
    return extractor
      .getCards()
      .map((card) => extractor.extractCard(card))
      .filter((l) => l.price != null && l.title);
  }

  /* ---------- analyze a single card against its peers ---------- */

  function analyzeCards() {
    const cards = extractor.getCards();
    if (cards.length < 2) return;

    // Extract all once so every card is compared against the same pool.
    const listings = cards.map((card) => ({
      card,
      listing: extractor.extractCard(card),
    }));
    const pool = listings.map((x) => x.listing).filter((l) => l.price != null);

    for (const { card, listing } of listings) {
      if (listing.price == null || !listing.title) continue;
      const comps = similarity.findSimilar(listing, pool, { limit: 30 });
      const verdict = evaluator.evaluate(listing, comps);
      ui.renderCardPill(card, verdict);
    }

    logCardDiagnostics(listings);
  }

  // Debug: summarize how many cards failed title/price extraction + samples.
  function logCardDiagnostics(listings) {
    if (!debugRun) return;
    const noTitle = listings.filter((x) => !x.listing.title);
    const noPrice = listings.filter((x) => x.listing.price == null);
    debug.event("search-cards", {
      cards: listings.length,
      missingTitle: noTitle.length,
      missingPrice: noPrice.length,
    });
    const sample = [...noTitle, ...noPrice].slice(0, 3);
    for (const x of sample) {
      debug.event("unmatched-card", {
        classes: x.card.className || "(none)",
        html: (x.card.outerHTML || "").slice(0, 160),
      });
    }
  }

  /* ---------- analyze the single listing page ---------- */

  async function analyzePage() {
    const target = extractor.extractPage();
    if (debugRun) {
      debug.event("listing", {
        titleFound: !!target.title,
        priceFound: target.price != null,
        priceRaw: target.priceRaw || "(none)",
      });
    }
    if (!target.title) {
      if (debugRun) debug.event("no-title", { url: location.pathname });
      return;
    }

    const id = store.listingKey(target.url);

    // Stability guard: render the helper card ONCE per listing. OLX mutates the
    // DOM constantly, which re-triggers run(); re-rendering here would destroy
    // open panels and reset the note input mid-typing. If our card is already
    // present for this listing, leave it (and its interaction state) alone.
    if (renderedId === id && document.getElementById("olxsh-card")) return;

    // Comparables come from any cards OLX renders in "similar ads" sections.
    const pool = buildPool();
    const comps = similarity.findSimilar(target, pool, { limit: 40 });
    const verdict = evaluator.evaluate(target, comps);

    const ctx = {
      url: target.url,
      title: target.title,
      price: target.price,
      currency: target.currency,
    };

    // Record price + maintain lightweight history, then detect likely relist.
    const { record, change } = await store.recordPrice(id, target.price, ctx);
    const relist = await detectRelist(target, id);

    // Top few comparables for the inline drawer.
    const comparables = comps.slice(0, 4).map((c) => c.listing);

    ui.renderPageCard(target, verdict, {
      onSimilar: () => openSimilarSearch(target),
      onPresets: (anchor) => openPresets(anchor),
      onOpen: () => window.open(target.url, "_blank"),
      onHelp: () => openOptions(),
      priceHistory: {
        change,
        price: record.price,
        prevPrice: record.prevPrice,
        currency: target.currency,
      },
      relist: relist.isRelist ? { title: relist.match.title } : null,
      comparables,
      quick: {
        onCopyDefault: async () => {
          const d = await OLXHelper.presets.getDefault();
          if (!d) return ui.toast(null, "Нет шаблона по умолчанию");
          navigator.clipboard
            .writeText(d.text)
            .then(() => ui.toast(null, "Скопировано: " + d.label))
            .catch(() => ui.toast(null, "Не удалось скопировать"));
        },
        onMarkContacted: () => store.setStatus(id, "contacted", ctx),
      },
      meta: {
        record,
        statuses: store.STATUSES,
        statusLabels: store.STATUS_LABELS,
        onStatus: (s) => store.setStatus(id, s, ctx),
        onNote: (n) => store.setNote(id, n, ctx),
        onToggleSave: () => store.toggleSave(id, ctx),
      },
    });

    renderedId = id; // mark this listing as rendered; skip rebuilds until nav
  }

  // Soft relist heuristic: a previously seen listing with a different id but a
  // very similar title and a close price is likely the same item re-posted.
  async function detectRelist(target, currentId) {
    try {
      const map = await store.getAll();
      const tks = target.keywords;
      if (!tks || !tks.length) return { isRelist: false };
      for (const [rid, r] of Object.entries(map)) {
        if (rid === currentId || !r || !r.title) continue;
        const sim = similarity.jaccard(tks, U.tokenize(r.title));
        if (sim < 0.7) continue;
        const priceClose =
          target.price != null && r.price != null
            ? Math.abs(target.price - r.price) / Math.max(r.price, 1) <= 0.15
            : true; // if a price is missing, title match alone is enough for a soft flag
        if (priceClose) return { isRelist: true, match: r, sim };
      }
    } catch (e) {
      /* ignore */
    }
    return { isRelist: false };
  }

  // Open the options page via the proper extension API. Content scripts can't
  // call openOptionsPage() directly and raw-navigating to the extension URL is
  // blocked (ERR_BLOCKED_BY_CLIENT), so we ask the background worker to do it.
  function openOptions() {
    try {
      chrome.runtime.sendMessage({ type: "openOptions" }, () => {
        void chrome.runtime.lastError; // ignore "no receiver" during dev reloads
      });
    } catch (e) {
      /* ignore if messaging is unavailable */
    }
  }

  /* ---------- action handlers ---------- */

  function openSimilarSearch(target) {
    // Use the actual listing title (normalized) as the search query.
    let query = U.buildSearchQuery(target.title);
    // Fallback to detected brand/model + keywords only if the title is unusable.
    if (!query) {
      query = [...target.brandHints, ...target.keywords.slice(0, 4)]
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 6)
        .join(" ");
    }
    if (!query) return; // nothing meaningful to search — don't open a junk query
    const origin = location.origin;
    window.open(`${origin}/list/q-${encodeURIComponent(query)}/`, "_blank");
  }

  // Open the message-preset popover, wired to the presets storage module.
  function openPresets(anchor) {
    const P = OLXHelper.presets;
    ui.openPresetPopover(anchor, {
      getPresets: () => P.getAll(),
      add: (data) => P.add(data),
      update: (id, patch) => P.update(id, patch),
      remove: (id) => P.remove(id),
      setDefault: (id) => P.setDefault(id),
    });
  }

  /* ---------- run loop + SPA / lazy-load handling ---------- */

  let scheduled = false;
  let debugRun = false; // true for one run cycle when debug logging should fire
  let renderedId = null; // listing id the helper card is currently rendered for
  function run() {
    scheduled = false;
    try {
      // One throttled debug window per run so sibling logs stay coherent.
      debugRun = debug.enabled && debug.throttle();
      const listing = extractor.isListingPage();
      if (debugRun) {
        debug.event("page-type", {
          type: listing ? "listing" : "search/other",
          path: location.pathname,
        });
      }
      if (listing) {
        Promise.resolve(analyzePage()).catch((e) =>
          console.debug("[OLX Smart Helper]", e)
        );
      } else {
        analyzeCards();
      }
    } catch (e) {
      /* fail quietly — never break the host page */
      console.debug("[OLX Smart Helper]", e);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(run, 350);
  }

  // Initial run.
  schedule();

  // Re-run on DOM mutations (infinite scroll, filter changes, SPA nav).
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) {
        schedule();
        return;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Re-run on history navigation (OLX is a SPA).
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      renderedId = null; // navigated to a different listing → allow a fresh render
      document.getElementById("olxsh-card")?.remove();
      schedule();
    }
  }, 800);
})();
