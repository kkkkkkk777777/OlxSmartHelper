/*
 * OLX Smart Helper — shared utilities and namespace.
 * Everything hangs off a single global `window.OLXHelper` so the content
 * scripts can be modular without a bundler / ES modules.
 */
(function () {
  "use strict";

  const OLXHelper = (window.OLXHelper = window.OLXHelper || {});

  /* ---------- constants ---------- */

  // Words that carry no signal for similarity matching (RU/UA/PL/EN mix).
  const STOPWORDS = new Set(
    (
      "и в во не что он на я с со как а то все она так его но да ты к у же вы за бы " +
      "по только ее мне было вот от меня еще нет о из ему теперь когда даже ну для " +
      "the a an of for and or to in on with new used б у бу состояние торг срочно " +
      "продам продаю продается продажа продаж цена ціна цена договорная обмен идеал " +
      "i za w na do od dla nowy nowa uzywany stan sprzedam okazja pilne"
    ).split(/\s+/)
  );

  // Rough brand/model hint dictionary. Extend freely — matching is case-insensitive.
  const BRAND_HINTS = [
    "apple", "iphone", "samsung", "galaxy", "xiaomi", "redmi", "poco", "huawei",
    "honor", "oppo", "realme", "oneplus", "nokia", "motorola", "sony", "lg",
    "google", "pixel", "asus", "acer", "lenovo", "hp", "dell", "msi", "macbook",
    "ipad", "airpods", "playstation", "ps4", "ps5", "xbox", "nintendo", "switch",
    "bmw", "audi", "mercedes", "volkswagen", "vw", "toyota", "honda", "ford",
    "renault", "skoda", "kia", "hyundai", "nissan", "mazda", "opel", "peugeot",
    "bosch", "makita", "dewalt", "dyson", "ikea", "canon", "nikon", "gopro",
    "dji", "jbl", "bose", "logitech", "razer", "intel", "amd", "nvidia", "rtx",
    "gtx", "geforce", "radeon"
  ];

  /* ---------- text helpers ---------- */

  function normalize(str) {
    return (str || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Split a title into meaningful keyword tokens.
  function tokenize(str) {
    return normalize(str)
      .split(" ")
      .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  }

  // Pull likely brand/model hints out of a title.
  function extractBrandHints(str) {
    const norm = normalize(str);
    const found = new Set();
    for (const brand of BRAND_HINTS) {
      if (norm.includes(brand)) found.add(brand);
    }
    // model-ish tokens: things like "13", "a52", "rtx3060", "pro", "max", "plus"
    for (const tok of tokenize(str)) {
      if (/\d/.test(tok) && tok.length <= 6) found.add(tok);
      if (["pro", "max", "plus", "mini", "ultra", "lite", "air"].includes(tok)) {
        found.add(tok);
      }
    }
    return [...found];
  }

  // Headings that OLX renders which are NOT product titles (chat/nav blocks).
  // Guards the extractor's loose `h4`/`h1` fallbacks from picking these up.
  const JUNK_TITLE = new Set([
    "повідомлення", "повідомлення продавцю", "написати повідомлення",
    "сообщение", "сообщение продавцу", "написать сообщение", "написать",
    "message", "wiadomosc", "napisz wiadomosc", "чат", "chat",
    "меню", "menu", "войти", "вход", "увійти",
  ]);

  function isJunkTitle(str) {
    const n = normalize(str);
    if (!n || n.length < 2) return true;
    return JUNK_TITLE.has(n);
  }

  // Strip emoji / pictographs / variation selectors from a string.
  function stripEmoji(str) {
    return String(str || "").replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu,
      ""
    );
  }

  // Build a clean OLX search query from a listing title:
  // strip emoji/noise, collapse spaces, preserve meaningful product wording.
  function buildSearchQuery(title) {
    let s = stripEmoji(title);
    s = s.replace(/[^\p{L}\p{N}\s]+/gu, " "); // drop punctuation/symbols
    s = s.replace(/\s+/g, " ").trim();
    // Keep the query focused: first 8 meaningful words is plenty for OLX search.
    return s.split(" ").filter(Boolean).slice(0, 8).join(" ");
  }

  /* ---------- number / price helpers ---------- */

  // --- price parsing: split into isolation → numeric parse for safety ---

  // Step 1: isolate the FIRST price-like token from mixed node text so
  // neighbouring digits (photo count, badges, rating) can't be concatenated
  // onto the price. Stops at the first non-numeric char (e.g. currency word):
  // "480 грн 1 фото" -> "480", not "4801".
  function isolatePriceToken(raw) {
    const s = String(raw).replace(/[    ]/g, " ");
    const m = s.match(/\d[\d .,]*\d|\d/);
    return m ? m[0].trim() : "";
  }

  // Step 2: turn an isolated token into a number, resolving thousand/decimal
  // separators. Handles "480", "1 200", "1,200", "12 999", "1.299,00", "480,00".
  function parsePriceToken(token) {
    if (!token) return null;
    let t = token;
    const lastComma = t.lastIndexOf(",");
    const lastDot = t.lastIndexOf(".");
    if (lastComma > -1 && lastDot > -1) {
      const dec = lastComma > lastDot ? "," : ".";
      const thou = dec === "," ? "." : ",";
      t = t.split(thou).join("").split(" ").join("").replace(dec, ".");
    } else if (lastComma > -1) {
      t = /,\d{2}$/.test(t)
        ? t.replace(/[ .]/g, "").replace(",", ".")
        : t.replace(/[ ,]/g, "");
    } else if (lastDot > -1) {
      t = /\.\d{2}$/.test(t) ? t.replace(/[ ,]/g, "") : t.replace(/[ .]/g, "");
    } else {
      t = t.replace(/ /g, "");
    }
    const n = parseFloat(t);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  // Parse "480 грн", "1 200 грн", "12 999 грн", "1.299,00 zł" -> clean integer.
  function parsePrice(raw) {
    if (raw == null) return null;
    return parsePriceToken(isolatePriceToken(raw));
  }

  function detectCurrency(raw) {
    const s = String(raw || "");
    if (/грн|₴|uah/i.test(s)) return "грн";
    if (/zł|zl|pln/i.test(s)) return "zł";
    if (/€|eur/i.test(s)) return "€";
    if (/\$|usd/i.test(s)) return "$";
    if (/lei|ron/i.test(s)) return "lei";
    if (/лв|bgn/i.test(s)) return "лв";
    return "";
  }

  function formatPrice(n, currency) {
    if (n == null) return "—";
    const grouped = Math.round(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return currency ? `${grouped} ${currency}` : grouped;
  }

  // Pull a numeric "size" (m², volume, storage GB, etc.) if the title/attrs have one.
  function extractSize(str) {
    const norm = normalize(str);
    let m =
      norm.match(/(\d+[.,]?\d*)\s?(?:м2|м²|кв\.?м|m2|mkw)/) ||
      norm.match(/(\d+[.,]?\d*)\s?(?:гб|gb|тб|tb)/) ||
      norm.match(/(\d+[.,]?\d*)\s?(?:л|л\.|литр)/);
    if (!m) return null;
    const val = parseFloat(m[1].replace(",", "."));
    return Number.isFinite(val) ? val : null;
  }

  /* ---------- debug logger (gated by the `debug` flag in storage) ---------- */

  const debug = {
    enabled: false,
    _last: 0,
    set(v) {
      this.enabled = !!v;
    },
    // Throttle noisy per-run summaries to at most once per `ms`.
    throttle(ms = 1500) {
      const now = Date.now();
      if (now - this._last < ms) return false;
      this._last = now;
      return true;
    },
    log(...args) {
      if (this.enabled)
        console.log("%c[OLX Helper]", "color:#1fbf75;font-weight:bold", ...args);
    },
    warn(...args) {
      if (this.enabled)
        console.warn("%c[OLX Helper]", "color:#f5a524;font-weight:bold", ...args);
    },
    // Structured event: console-logs AND appends to a small rolling buffer in
    // storage (max 20) so the Options debug panel can show recent diagnostics.
    event(type, payload) {
      if (!this.enabled) return;
      this.log(type, payload || "");
      try {
        chrome.storage.local.get("olxsh_debug", (o) => {
          const buf = (o && o["olxsh_debug"]) || [];
          buf.push({ t: Date.now(), type, payload });
          while (buf.length > 20) buf.shift();
          chrome.storage.local.set({ olxsh_debug: buf });
        });
      } catch (e) {
        /* ignore */
      }
    },
  };
  OLXHelper.debug = debug;

  OLXHelper.utils = {
    STOPWORDS,
    BRAND_HINTS,
    normalize,
    tokenize,
    extractBrandHints,
    isJunkTitle,
    stripEmoji,
    buildSearchQuery,
    isolatePriceToken,
    parsePriceToken,
    parsePrice,
    detectCurrency,
    formatPrice,
    extractSize,
  };
})();
