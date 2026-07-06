/*
 * OLX Smart Helper — honest heuristic evaluator.
 *
 * We no longer fabricate an "average market price" when comparable data is
 * weak. Instead we compute a confidence-based helper verdict:
 *
 *   Выгодно (green)  / Нормально (orange) / Сомнительно (red)
 *
 * A concrete numeric market estimate is ONLY exposed when confidence is high
 * (enough real, priced comparables on the page). Otherwise the panel honestly
 * says "Недостаточно данных для точной оценки".
 */
(function () {
  "use strict";

  const OLXHelper = (window.OLXHelper = window.OLXHelper || {});

  // How many priced comparables we need before trusting price positioning.
  const N_STRONG = 5; // → высокая уверенность, numeric estimate shown
  const N_MEDIUM = 2; // → средняя уверенность, only qualitative direction

  // Price bands relative to the comparables' median.
  const GOOD_BAND = 0.1; // ≥10% below → cheaper than similar
  const HIGH_BAND = 0.12; // ≥12% above → pricier than similar
  const GREAT_BAND = 0.25; // ≥25% below → highlight strongly

  function median(nums) {
    if (!nums.length) return null;
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // IQR outlier trim so a single mis-scraped price can't skew the median.
  function trimOutliers(nums) {
    if (nums.length < 4) return nums;
    const s = [...nums].sort((a, b) => a - b);
    const q = (p) => {
      const idx = (s.length - 1) * p;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      return s[lo] + (s[hi] - s[lo]) * (idx - lo);
    };
    const q1 = q(0.25);
    const q3 = q(0.75);
    const iqr = q3 - q1;
    return s.filter((n) => n >= q1 - 1.5 * iqr && n <= q3 + 1.5 * iqr);
  }

  /*
   * evaluate(target, comparables) → verdict
   * comparables: [{ listing, score }] from similarity.findSimilar
   */
  function evaluate(target, comparables) {
    const reasons = [];
    const priced = comparables
      .map((c) => c.listing.price)
      .filter((p) => p != null);
    const n = priced.length;

    /* ---- confidence from how much real comparable data we have ---- */
    let confidenceKey, confidence;
    if (n >= N_STRONG) {
      confidenceKey = "high";
      confidence = "высокая";
    } else if (n >= N_MEDIUM) {
      confidenceKey = "mid";
      confidence = "средняя";
    } else {
      confidenceKey = "low";
      confidence = "низкая";
    }

    /* ---- price positioning vs nearby (only if we have comparables) ---- */
    let priceSignal = null; // "good" | "market" | "high"
    let priceDelta = null;
    let marketMedian = null;
    if (n >= N_MEDIUM && target.price != null) {
      marketMedian = median(trimOutliers(priced));
      if (marketMedian && marketMedian > 0) {
        priceDelta = target.price / marketMedian - 1;
        if (priceDelta <= -GOOD_BAND) {
          priceSignal = "good";
          reasons.push({ kind: "pos", text: "дешевле похожих объявлений" });
        } else if (priceDelta >= HIGH_BAND) {
          priceSignal = "high";
          reasons.push({ kind: "neg", text: "дороже похожих объявлений" });
        } else {
          priceSignal = "market";
          reasons.push({ kind: "info", text: "цена на уровне похожих" });
        }
      }
    }

    /* ---- listing signal / completeness reasons ---- */
    const brandOk = target.brandHints && target.brandHints.length > 0;
    const titleOk = target.keywords && target.keywords.length >= 3;
    const sizeOk = target.size != null;
    const priceOk = target.price != null;
    const locOk = !!target.location;

    if (brandOk) reasons.push({ kind: "pos", text: "распознан бренд/модель" });
    if (titleOk) reasons.push({ kind: "pos", text: "подробный заголовок" });
    else reasons.push({ kind: "neg", text: "мало деталей в заголовке" });
    if (sizeOk) reasons.push({ kind: "pos", text: "указан размер/объём" });
    if (!priceOk) reasons.push({ kind: "neg", text: "не указана цена" });
    if (!locOk) reasons.push({ kind: "neg", text: "не указана локация" });

    if (n === 0) reasons.push({ kind: "info", text: "нет похожих объявлений рядом" });
    else if (n < N_MEDIUM) reasons.push({ kind: "info", text: "мало похожих для оценки" });

    // Signal-quality hits used when we can't judge on price.
    const qualityHits =
      (brandOk ? 1 : 0) + (titleOk ? 1 : 0) + (priceOk ? 1 : 0) + (sizeOk || locOk ? 1 : 0);

    /* ---- final status ---- */
    let status, great = false;
    if (priceSignal) {
      // Confident enough to judge on price.
      status = priceSignal === "good" ? "good" : priceSignal === "high" ? "high" : "market";
      great = priceSignal === "good" && priceDelta <= -GREAT_BAND && confidenceKey === "high";
    } else {
      // No reliable price comparison → judge on listing signal quality only.
      // Never claim "Выгодно" here: we cannot know it's a good deal.
      status = qualityHits >= 3 ? "market" : "high";
    }

    const labels = {
      good: "Выгодно",
      market: "Нормально",
      high: "Сомнительно",
      unknown: "—",
    };
    const colors = { good: "green", market: "orange", high: "red", unknown: "gray" };

    // A concrete numeric estimate is only honest at high confidence.
    const hasReliableEstimate = confidenceKey === "high" && marketMedian != null;

    return {
      status,
      label: labels[status],
      color: colors[status],
      confidence,
      confidenceKey,
      reasons: dedupeReasons(reasons),
      comparablesCount: n,
      hasReliableEstimate,
      marketPrice: hasReliableEstimate ? Math.round(marketMedian) : null,
      priceDelta,
      currency: target.currency || "",
      great,
    };
  }

  function dedupeReasons(list) {
    const seen = new Set();
    const out = [];
    for (const r of list) {
      if (seen.has(r.text)) continue;
      seen.add(r.text);
      out.push(r);
    }
    // Show most informative first: positives, then negatives, then info.
    const order = { pos: 0, neg: 1, info: 2 };
    return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 5);
  }

  OLXHelper.evaluator = {
    evaluate,
    median,
    trimOutliers,
    thresholds: { N_STRONG, N_MEDIUM, GOOD_BAND, HIGH_BAND, GREAT_BAND },
  };
})();
