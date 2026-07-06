/*
 * OLX Smart Helper — DOM extraction.
 * Turns OLX DOM (listing page or a card in search results) into a clean
 * `Listing` object. Selectors use OLX's data-* attributes with text fallbacks
 * so the extractor degrades gracefully when the markup shifts.
 */
(function () {
  "use strict";

  const OLXHelper = (window.OLXHelper = window.OLXHelper || {});
  const U = OLXHelper.utils;

  function text(el) {
    return el ? el.textContent.trim() : "";
  }

  function firstText(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && text(el)) return text(el);
    }
    return "";
  }

  // Seller/profile containers whose text is a person's name, NOT the ad title.
  // A loose h4/h1 fallback must never pick the title from inside these.
  const SELLER_CONTAINERS =
    '[data-testid="user-profile"],[data-testid="seller-box"],' +
    '[data-testid="user-profile-user-name"],[data-cy="seller_card"],' +
    '[data-cy="user-profile"],a[href*="/users/"]';

  // Like firstText, but rejects chat/nav headings (e.g. "Повідомлення") and any
  // node inside a seller/profile block, so only the real ad title is returned.
  function firstTitle(root, selectors) {
    for (const sel of selectors) {
      for (const el of root.querySelectorAll(sel)) {
        if (el.closest(SELLER_CONTAINERS)) continue; // skip seller name blocks
        const t = text(el);
        if (t && !U.isJunkTitle(t)) return t;
      }
    }
    return "";
  }

  /* ---------- listing cards (search / category pages) ---------- */

  // Desktop + mobile OLX both use l-card; keep extra fallbacks for mobile grids.
  const CARD_SELECTOR =
    '[data-cy="l-card"], [data-testid="l-card"], [data-testid="listing-ad"]';

  function getCards() {
    return Array.from(document.querySelectorAll(CARD_SELECTOR));
  }

  function extractCard(card) {
    const linkEl = card.querySelector('a[href]');
    let title = firstText(card, [
      '[data-cy="ad-card-title"] a',
      '[data-cy="ad-card-title"]',
      '[data-testid="ad-title"]',
      "h6",
      "h4",
      "h3",
      "a[href]",
    ]);
    // Mobile fallback: title often lives in the link's title/aria-label or img alt.
    if (!title && linkEl) {
      title = linkEl.getAttribute("title") || linkEl.getAttribute("aria-label") || "";
    }
    if (!title) {
      const img = card.querySelector("img[alt]");
      if (img) title = img.getAttribute("alt") || "";
    }
    const priceRaw = firstText(card, [
      '[data-testid="ad-price"]',
      '[data-testid="ad-card-price"]',
      'p[data-testid="ad-price"]',
      '[class*="price"]', // last-resort fallback for mobile markup
    ]);
    const location = firstText(card, [
      '[data-testid="location-date"]',
      '[data-testid="location"]',
    ]);
    const url = linkEl ? linkEl.href : "";

    return buildListing({ title, priceRaw, location, url, source: "card", el: card });
  }

  /* ---------- listing page (single ad) ---------- */

  function isListingPage() {
    const path = location.pathname;
    // Search / category / results grids (incl. the "Similar" page, /list/q-…)
    // are never single-ad pages — let them fall through to card enrichment.
    if (/\/list\//i.test(path) || /[?&]q=|\/q-/.test(location.href)) return false;
    // Single-ad signals: an explicit ad-title element, or an OLX ad URL.
    const hasAdTitle = !!document.querySelector(
      '[data-cy="ad_title"], [data-testid="ad_title"], [data-testid="offer_title"], [data-cy="offer_title"]'
    );
    const adUrl =
      /\/(obyavlenie|oferta|ogloszenie)\//i.test(path) || /-ID[a-z0-9]+\.html/i.test(path);
    return hasAdTitle || adUrl;
  }

  function extractPage() {
    const title = firstTitle(document, [
      '[data-cy="ad_title"]',
      '[data-testid="ad_title"]',
      '[data-testid="offer_title"]',
      '[data-cy="offer_title"]',
      "h1",
      "h4",
    ]);
    const priceRaw = firstText(document, [
      '[data-testid="ad-price-container"] h3',
      '[data-testid="ad-price-container"]',
      '[data-testid="ad-price"]',
      'h3[class*="price"]',
      '[class*="price-label"]', // mobile fallback
    ]);
    const loc = firstText(document, [
      '[data-testid="location-date"]',
      '[data-testid="map-aside-section"] p',
      'img[src*="staticmap"] ~ *',
    ]);

    // Parameter chips ("Площадь: 45 м²", "Память: 128 GB") help size detection.
    const params = Array.from(
      document.querySelectorAll('[data-testid="ad-parameters-container"] *, [data-cy="ad-parameters"] *')
    )
      .map(text)
      .filter(Boolean)
      .join(" ");

    return buildListing({
      title,
      priceRaw,
      location: loc,
      url: window.location.href,
      source: "page",
      extraText: params,
    });
  }

  /* ---------- shared builder ---------- */

  function buildListing({ title, priceRaw, location, url, source, el, extraText }) {
    const price = U.parsePrice(priceRaw);
    const currency = U.detectCurrency(priceRaw);
    const size = U.extractSize(`${title} ${extraText || ""}`);
    return {
      title: title || "",
      priceRaw: priceRaw || "",
      price,
      currency,
      location: location || "",
      size,
      url: url || "",
      source,
      keywords: U.tokenize(title),
      brandHints: U.extractBrandHints(title),
      _el: el || null,
    };
  }

  OLXHelper.extractor = {
    CARD_SELECTOR,
    getCards,
    extractCard,
    isListingPage,
    extractPage,
  };
})();
