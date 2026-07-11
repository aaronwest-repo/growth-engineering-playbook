// Affiliate tracking simulator core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/simulator.test.mjs). No DOM, no network.
//
// The shared event files are RAW ground truth (clicks, web events, orders). This
// module is the attribution + validation ENGINE: given scenario controls
// (attribution window, attribution rule, cookie-loss mode, validation mode) it
// recomputes who gets credited, what gets rejected, and what it means in money.

export const COMMISSION_RATE = 0.08;
const PAID_TOUCH_CHANNELS = new Set(["paid_search"]);

export function parseJsonl(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const ts = (s) => new Date(s).getTime();
const DAY = 86400000;

// Stable per-click hash in [0,1) for deterministic simulated cookie loss.
function hashUnit(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function isTracked(click, cookieLoss) {
  if (!click.cookie_set) return false;
  if (click.cookie_lost) return false;
  // Extra ITP-style loss layered on by the cookie-loss mode.
  if (cookieLoss > 0 && hashUnit(click.click_id) < cookieLoss) return false;
  return true;
}

/**
 * Classify every conversion under the given options.
 * options: { windowDays, rule, cookieLoss, validation }
 */
export function classify(model, options) {
  const { windowDays, rule, cookieLoss, validation } = options;
  const records = [];

  for (const conv of model.conversions) {
    const visitorClicks = (model.clicksByVisitor[conv.visitor_id] || [])
      .slice()
      .sort((a, b) => ts(a.clicked_at) - ts(b.clicked_at));
    const convTime = ts(conv.converted_at);
    const commission = round2(conv.order_value * COMMISSION_RATE);

    const hasAffiliate = visitorClicks.length > 0;
    // Affiliate clicks before the conversion.
    const priorClicks = visitorClicks.filter((c) => ts(c.clicked_at) <= convTime);
    const trackedInWindow = priorClicks.filter(
      (c) => isTracked(c, cookieLoss) && convTime - ts(c.clicked_at) <= windowDays * DAY
    );
    const publishers = new Set(priorClicks.map((c) => c.publisher_id));
    const isDuplicate = conv.validation_status === "duplicate" || publishers.size >= 2;

    let attributed = false;
    let winner = null;
    let status;
    let reason;

    if (!hasAffiliate) {
      status = "non_affiliate";
      reason = "No affiliate click in the journey.";
    } else if (trackedInWindow.length === 0) {
      // Influenced by affiliate, but not credited.
      const anyInWindow = priorClicks.some((c) => convTime - ts(c.clicked_at) <= windowDays * DAY);
      if (anyInWindow) {
        status = "lost_cookie";
        reason = "Affiliate click existed in-window but tracking was lost (cookie).";
      } else {
        status = "rejected_outside_window";
        reason = `Affiliate click fell outside the ${windowDays}-day window.`;
      }
    } else {
      // Pick the winning affiliate click per rule.
      if (rule === "first_affiliate") winner = trackedInWindow[0];
      else winner = trackedInWindow[trackedInWindow.length - 1]; // last_affiliate default
      // last_paid_touch: a later paid-search touch beats the affiliate click.
      if (rule === "last_paid" && PAID_TOUCH_CHANNELS.has(conv.competing_channel)) {
        attributed = false;
        status = "rejected_cross_channel";
        reason = "Last paid touch (paid search) wins under this rule; affiliate not credited.";
      } else {
        attributed = true;
        if (conv.returned) {
          status = "rejected_return";
          reason = "Order returned; commission clawed back.";
        } else if (winner.suspicious_flag) {
          if (validation === "strict") {
            status = "rejected_suspicious";
            reason = "Winning click from a flagged publisher; strict validation rejects it.";
          } else {
            status = "approved_flagged";
            reason = "Winning click from a flagged publisher; lenient validation approves with a flag.";
          }
        } else if (isDuplicate) {
          status = "approved_deduped";
          reason = "Multiple publishers claimed this order; one winner paid, duplicate claim rejected.";
        } else {
          status = "approved";
          reason = "Single affiliate winner within window.";
        }
      }
    }

    records.push({
      conv, commission, hasAffiliate, attributed, winner,
      publishers: [...publishers], isDuplicate, status, reason,
    });
  }
  return records;
}

const APPROVED = new Set(["approved", "approved_deduped", "approved_flagged"]);
const REJECTED_VALIDATION = new Set(["rejected_return", "rejected_suspicious"]);

function metricsFrom(records) {
  let approvedCommission = 0, rejectedCommission = 0, overpaymentPrevented = 0;
  let tracked = 0, lost = 0;
  for (const r of records) {
    if (r.attributed) tracked++;
    else if (r.hasAffiliate) lost++;

    if (APPROVED.has(r.status)) approvedCommission += r.commission;
    if (REJECTED_VALIDATION.has(r.status)) { rejectedCommission += r.commission; overpaymentPrevented += r.commission; }
    // A deduped order would otherwise have paid a second publisher.
    if (r.status === "approved_deduped") overpaymentPrevented += r.commission;
  }
  return {
    trackedConversions: tracked,
    lostConversions: lost,
    approvedCommission: round2(approvedCommission),
    rejectedCommission: round2(rejectedCommission),
    overpaymentPrevented: round2(overpaymentPrevented),
  };
}

/** Full simulation: metrics, journeys, dedup, validation queue, fraud, impact. */
export function simulate(model, options) {
  const records = classify(model, options);
  const m = metricsFrom(records);

  const metrics = {
    affiliateClicks: model.clicks.length,
    conversions: model.conversions.length,
    ...m,
  };

  // Validation queue grouped by status.
  const queue = {};
  for (const r of records) {
    (queue[r.status] = queue[r.status] || []).push({
      order_id: r.conv.order_id,
      product_id: r.conv.product_id,
      commission: r.commission,
      publisher: r.winner ? r.winner.publisher_name : "—",
      reason: r.reason,
    });
  }

  // Dedup: orders with two affiliate publishers competing.
  const dedup = records
    .filter((r) => r.isDuplicate && r.hasAffiliate)
    .slice(0, 8)
    .map((r) => ({
      order_id: r.conv.order_id,
      publishers: r.publishers,
      winner: r.winner ? r.winner.publisher_name : "—",
      status: r.status,
      reason: r.reason,
    }));

  // Fraud: aggregate click behavior per publisher.
  const pubAgg = {};
  for (const c of model.clicks) {
    const p = (pubAgg[c.publisher_id] = pubAgg[c.publisher_id] || {
      publisher_id: c.publisher_id, publisher_name: c.publisher_name,
      clicks: 0, suspiciousClicks: 0, visitors: new Set(),
    });
    p.clicks++;
    if (c.suspicious_flag) p.suspiciousClicks++;
    p.visitors.add(c.visitor_id);
  }
  const attributedByPub = {};
  for (const r of records) {
    if (r.attributed && r.winner) attributedByPub[r.winner.publisher_id] = (attributedByPub[r.winner.publisher_id] || 0) + 1;
  }
  const fraud = Object.values(pubAgg).map((p) => {
    const validConversions = attributedByPub[p.publisher_id] || 0;
    const clicksPerVisitor = p.clicks / p.visitors.size;
    const convRate = validConversions / p.clicks;
    const signals = [];
    if (p.suspiciousClicks > 0) signals.push(`${p.suspiciousClicks} clicks flagged suspicious`);
    if (clicksPerVisitor >= 3) signals.push(`${clicksPerVisitor.toFixed(1)} clicks per visitor (click spike)`);
    if (p.clicks >= 20 && convRate < 0.05) signals.push("many clicks, almost no valid conversions");
    const flagged = signals.length >= 2;
    return {
      publisher_id: p.publisher_id, publisher_name: p.publisher_name,
      clicks: p.clicks, visitors: p.visitors.size, validConversions,
      convRate: round2(convRate), signals, flagged,
      verdict: flagged ? "Flag for review — do not auto-approve" : "Within normal range",
    };
  }).sort((a, b) => b.clicks - a.clicks);

  // Journeys: one representative per interesting status.
  const journeys = buildJourneys(model, records);

  // Business impact.
  const undercounted = records.filter((r) => r.status === "lost_cookie");
  const undercountedRevenue = round2(undercounted.reduce((s, r) => s + r.conv.order_value, 0));
  const undercountedCommission = round2(undercounted.reduce((s, r) => s + r.commission, 0));
  const windowComparison = {};
  for (const w of [1, 7, 30]) {
    const wm = metricsFrom(classify(model, { ...options, windowDays: w }));
    windowComparison[w] = { trackedConversions: wm.trackedConversions, approvedCommission: wm.approvedCommission };
  }

  const impact = {
    undercountedRevenue, undercountedCommission,
    overpaymentPrevented: metrics.overpaymentPrevented,
    windowComparison,
  };

  return { options, metrics, queue, dedup, fraud, journeys, impact, records };
}

function buildJourneys(model, records) {
  const wanted = ["approved", "lost_cookie", "rejected_cross_channel", "approved_deduped", "rejected_suspicious", "rejected_return"];
  const out = [];
  const seen = new Set();
  for (const want of wanted) {
    const r = records.find((x) => x.status === want && !seen.has(x.conv.visitor_id));
    if (!r) continue;
    seen.add(r.conv.visitor_id);
    const v = r.conv.visitor_id;
    const steps = [];
    (model.clicksByVisitor[v] || []).forEach((c) =>
      steps.push({ t: c.clicked_at, kind: "affiliate_click",
        label: `Affiliate click via ${c.publisher_name}${c.cookie_lost ? " (cookie lost)" : c.cookie_set ? " (cookie set)" : ""}${c.suspicious_flag ? " ⚠ flagged" : ""}` }));
    (model.webByVisitor[v] || []).forEach((e) => {
      if (e.event_type === "affiliate_click") return; // already shown from clicks
      steps.push({ t: e.occurred_at, kind: e.event_type,
        label: `${e.event_type.replace(/_/g, " ")}${e.source ? " · " + e.source : ""}` });
    });
    steps.push({ t: r.conv.converted_at, kind: "conversion",
      label: `Conversion — ${r.conv.order_value.toFixed(2)} EUR${r.conv.returned ? " (later returned)" : ""}` });
    steps.sort((a, b) => ts(a.t) - ts(b.t));
    out.push({
      visitor_id: v, order_id: r.conv.order_id, status: r.status, reason: r.reason,
      attributed: r.attributed, winner: r.winner ? r.winner.publisher_name : "—",
      steps,
    });
  }
  return out;
}

/** Build the in-memory model with visitor indexes. */
export function buildModel({ clicks, web, conversions }) {
  const clicksByVisitor = {};
  for (const c of clicks) (clicksByVisitor[c.visitor_id] = clicksByVisitor[c.visitor_id] || []).push(c);
  const webByVisitor = {};
  for (const e of web) (webByVisitor[e.visitor_id] = webByVisitor[e.visitor_id] || []).push(e);
  return { clicks, web, conversions, clicksByVisitor, webByVisitor };
}

function round2(x) { return Math.round(x * 100) / 100; }
