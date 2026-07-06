/*
 * OLX Smart Helper — similarity matching.
 * Scores how comparable two listings are (0..1) from title keywords,
 * brand/model hints, size and location. Also finds comparables among the
 * cards currently rendered on the page (the "real" data source for the MVP).
 */
(function () {
  "use strict";

  const OLXHelper = (window.OLXHelper = window.OLXHelper || {});
  const U = OLXHelper.utils;

  function jaccard(aArr, bArr) {
    const a = new Set(aArr);
    const b = new Set(bArr);
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
  }

  function overlapCount(aArr, bArr) {
    const b = new Set(bArr);
    let n = 0;
    for (const x of new Set(aArr)) if (b.has(x)) n++;
    return n;
  }

  // Weighted similarity between a target listing and a candidate.
  function score(target, cand) {
    const kw = jaccard(target.keywords, cand.keywords); // 0..1
    const brand = target.brandHints.length
      ? overlapCount(target.brandHints, cand.brandHints) /
        target.brandHints.length
      : 0;

    let sizeScore = 0;
    if (target.size != null && cand.size != null) {
      const diff = Math.abs(target.size - cand.size);
      const rel = diff / Math.max(target.size, 1);
      sizeScore = Math.max(0, 1 - rel); // closer size → higher
    }

    let locScore = 0;
    if (target.location && cand.location) {
      const city = target.location.split(/[,-]/)[0].trim().toLowerCase();
      if (city && cand.location.toLowerCase().includes(city)) locScore = 1;
    }

    // Weights: keywords dominate, brand is a strong booster, size/location nudge.
    const weighted =
      0.5 * kw +
      0.3 * brand +
      0.12 * sizeScore +
      0.08 * locScore;

    return Math.min(1, weighted);
  }

  const DEFAULT_THRESHOLD = 0.22;

  // Find comparable listings for `target` from a pool of listings.
  function findSimilar(target, pool, opts = {}) {
    const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    const limit = opts.limit ?? 40;
    const results = [];
    for (const cand of pool) {
      if (!cand || cand.price == null) continue;
      if (cand.url && target.url && cand.url === target.url) continue; // skip self
      const s = score(target, cand);
      if (s >= threshold) results.push({ listing: cand, score: s });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  OLXHelper.similarity = {
    score,
    findSimilar,
    jaccard,
    DEFAULT_THRESHOLD,
  };
})();
