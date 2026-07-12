// RFM segmentation core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/rfm.test.mjs). No DOM, no network, no PII — customers are
// keyed by synthetic customer_id and fictional first names.
//
// This is NOT a "VIP / at-risk / dormant" label generator. Segmentation here is a
// *decision layer*: recency/frequency/monetary scoring, return-adjusted value,
// consent + suppression eligibility, lifecycle stage, and a rule-based campaign
// recommendation per segment — plus the warnings that stop you mailing the wrong
// person the wrong thing. RFM runs on customer_id records; the upstream identity
// resolution (case 09) is what makes those records trustworthy in the first place.

export function parseCsv(text) {
  const rows = [];
  let field = "", record = [], q = false;
  const pf = () => { record.push(field); field = ""; };
  const pr = () => { rows.push(record); record = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") pf();
    else if (c === "\n") { pf(); pr(); }
    else if (c !== "\r") field += c;
  }
  if (field.length || record.length) { pf(); pr(); }
  const raw = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  const header = raw[0].map((h) => h.trim());
  return raw.slice(1).map((cells) => { const o = {}; header.forEach((h, i) => (o[h] = (cells[i] || "").trim())); return o; });
}

const bool = (v) => v === "true" || v === true;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const dayNum = (d) => Math.floor(new Date(d).getTime() / 86400000);
const groupBy = (arr, key) => arr.reduce((m, x) => { (m[x[key]] ||= []).push(x); return m; }, {});
const round = (n) => Math.round(n * 100) / 100;

// Suppression / timing windows (days). Deterministic, documented in the README.
export const WINDOWS = { recentPurchase: 14, active: 180, supportRisk: 90, newCustomer: 120 };
export const RETURN_RISK_RATIO = 0.25; // returned / gross above this = returns risk

// Ordered segment catalogue with rule-based campaign recommendations. The
// recommendation is the point of the segment, not the label.
export const SEGMENTS = {
  vip_loyalists:            { label: "VIP loyalists",            tone: "vip",  action: "Early access + loyalty recognition", incentive: "Status & access, not discount",        why: "Recent, frequent, high value. Reward loyalty; discounting them wastes margin." },
  loyal_customers:          { label: "Loyal customers",          tone: "ok",   action: "Cross-sell + replenishment reminders", incentive: "Curated bundles, light incentive",     why: "Frequent buyers with solid value. Grow basket, don't buy loyalty you already have." },
  promising:                { label: "Promising",                tone: "ok",   action: "Second-purchase nudge",                incentive: "Category education + small first-repeat offer", why: "Recent buyers still building a habit. Convert to a repeat before they cool off." },
  new_customers:            { label: "New customers",            tone: "ok",   action: "Onboarding + care guide",              incentive: "No discount — product education",       why: "Just arrived. Deliver the first experience well before asking for more." },
  at_risk:                  { label: "At risk",                  tone: "warn", action: "Win-back, margin-aware incentive",     incentive: "Targeted offer sized to their margin", why: "Valuable and previously frequent, now lapsing. Worth a measured win-back." },
  dormant:                  { label: "Dormant",                  tone: "warn", action: "Low-frequency reactivation or holdout", incentive: "One reactivation touch, then suppress",  why: "Long silent and low value. Test a holdout; most won't return, so don't over-invest." },
  one_time_buyers:          { label: "One-time buyers",          tone: "warn", action: "Second-purchase / category education",  incentive: "Reason to return, not blanket promo",  why: "A single order. The whole value is unlocking purchase #2." },
  high_value_returns_risk:  { label: "High-value returns risk",  tone: "bad",  action: "Service & support first, not discount", incentive: "Fit/sizing help — never a discount",    why: "High spend but high returns. Discounting fuels more returns; fix the root cause." },
  do_not_target:            { label: "Do not target",            tone: "bad",  action: "Suppress from marketing",              incentive: "None — no lawful marketing basis",     why: "No marketing consent. Excluded from campaigns regardless of value." },
};
export const SEGMENT_ORDER = Object.keys(SEGMENTS);

// Quintile scorer: maps a value to 1..5 by its position in the population.
// higherIsBetter=false inverts (used for recency, where fewer days is better).
function quintileScorer(values, higherIsBetter) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length || 1;
  return (v) => {
    let leq = 0;
    for (const x of sorted) if (x <= v) leq++;
    let s = Math.ceil((leq / n) * 5);
    if (s < 1) s = 1; if (s > 5) s = 5;
    return higherIsBetter ? s : 6 - s;
  };
}

// One customer's rolled-up order economics.
function economics(orders, refDay) {
  const gross = orders.reduce((s, o) => s + num(o.gross_revenue), 0);
  const returned = orders.reduce((s, o) => s + num(o.returned_amount), 0);
  const productCost = orders.reduce((s, o) => s + num(o.product_cost), 0);
  const shippingCost = orders.reduce((s, o) => s + num(o.shipping_cost), 0);
  const discount = orders.reduce((s, o) => s + num(o.discount), 0);
  const lastOrderDay = Math.max(...orders.map((o) => dayNum(o.order_date)));
  const lastOrderDate = orders.reduce((best, o) => (dayNum(o.order_date) >= dayNum(best) ? o.order_date : best), orders[0].order_date);
  const netRevenue = gross - returned;                     // return-adjusted revenue
  const margin = gross - returned - productCost - shippingCost - discount;
  return {
    frequency: orders.length,
    grossRevenue: round(gross),
    returnedAmount: round(returned),
    netRevenue: round(netRevenue),
    margin: round(margin),
    returnRatio: gross > 0 ? round(returned / gross) : 0,
    lastOrderDate,
    recencyDays: refDay - lastOrderDay,
  };
}

function classify({ r, f, m, recencyDays, createdDays, returnRatio, canMarket }) {
  if (!canMarket) return "do_not_target";
  if (m >= 4 && returnRatio >= RETURN_RISK_RATIO) return "high_value_returns_risk";
  if (r >= 4 && f >= 4 && m >= 4) return "vip_loyalists";
  if (m >= 3 && f >= 3 && r <= 2) return "at_risk";        // valuable + frequent but slipping
  if (r <= 1) return "dormant";                            // long silent
  if (f >= 4 && r >= 3) return "loyal_customers";
  if (recencyDays <= WINDOWS.newCustomer && f <= 1) return "new_customers"; // recent first purchase, single order
  if (f === 1) return "one_time_buyers";
  return "promising";                                      // recent-ish, still light
}

// Build the full segmentation model from raw customers + orders (+ optional
// tickets for support-risk warnings). Returns scored profiles, segment rollups,
// a 5x5 R×F matrix, and top-level metrics.
export function buildSegmentation({ customers, orders, tickets = [] }, opts = {}) {
  const ordersByCustomer = groupBy(orders, "customer_id");
  const ticketsByCustomer = groupBy(tickets.filter((t) => t.customer_id), "customer_id");

  // Reference "today" = latest date in the data, so recency is deterministic.
  const allDates = [...orders.map((o) => o.order_date), ...customers.map((c) => c.created_at)];
  const refDay = allDates.length ? Math.max(...allDates.map(dayNum)) : 0;
  const refDate = new Date(refDay * 86400000).toISOString().slice(0, 10);

  // Only customers with at least one order can be RFM-scored.
  const scored = customers.filter((c) => (ordersByCustomer[c.customer_id] || []).length > 0);

  const econ = new Map();
  scored.forEach((c) => econ.set(c.customer_id, economics(ordersByCustomer[c.customer_id], refDay)));

  const rScore = quintileScorer(scored.map((c) => econ.get(c.customer_id).recencyDays), false);
  const fScore = quintileScorer(scored.map((c) => econ.get(c.customer_id).frequency), true);
  const mScore = quintileScorer(scored.map((c) => econ.get(c.customer_id).netRevenue), true);

  const profiles = scored.map((c) => {
    const e = econ.get(c.customer_id);
    const r = rScore(e.recencyDays), f = fScore(e.frequency), m = mScore(e.netRevenue);
    const consent = {
      marketing: bool(c.consent_marketing),
      personalization: bool(c.consent_personalization),
      newsletter: bool(c.newsletter_opt_in),
    };
    const createdDays = refDay - dayNum(c.created_at);
    const cTickets = ticketsByCustomer[c.customer_id] || [];
    const recentNegTicket = cTickets.some(
      (t) => t.sentiment === "negative" && refDay - dayNum(t.created_at) <= WINDOWS.supportRisk
    );

    const segment = classify({ r, f, m, recencyDays: e.recencyDays, createdDays, returnRatio: e.returnRatio, canMarket: consent.marketing });

    // Suppression / eligibility overlay — independent of the behavioural segment.
    const warnings = [];
    if (!consent.marketing) warnings.push("No marketing consent — suppress from all campaigns");
    if (!consent.newsletter) warnings.push("Newsletter opt-out — email channel not eligible");
    if (!consent.personalization) warnings.push("No personalization consent — generic content only");
    if (e.recencyDays <= WINDOWS.recentPurchase) warnings.push(`Recent purchase (${e.recencyDays}d) — suppress promo, avoid over-mailing`);
    if (e.returnRatio >= RETURN_RISK_RATIO) warnings.push(`High returns (${Math.round(e.returnRatio * 100)}% of spend) — service-first, not discount`);
    if (recentNegTicket) warnings.push("Recent negative support ticket — resolve before promoting");

    const eligibility = {
      suppressed: !consent.marketing,
      emailEligible: consent.marketing && consent.newsletter && e.recencyDays > WINDOWS.recentPurchase,
      canPersonalize: consent.personalization,
      recentPurchaseHold: e.recencyDays <= WINDOWS.recentPurchase,
      returnsRisk: e.returnRatio >= RETURN_RISK_RATIO,
      supportRisk: recentNegTicket,
    };

    return {
      customer_id: c.customer_id,
      first_name: c.first_name,
      country: c.country,
      loyalty_tier: c.loyalty_tier,
      r, f, m, code: `${r}${f}${m}`,
      ...e,
      createdDays,
      consent,
      segment,
      segmentLabel: SEGMENTS[segment].label,
      warnings,
      eligibility,
      recommendation: SEGMENTS[segment],
    };
  });

  // Segment rollups.
  const segments = {};
  SEGMENT_ORDER.forEach((key) => {
    const members = profiles.filter((p) => p.segment === key);
    segments[key] = {
      key, label: SEGMENTS[key].label, tone: SEGMENTS[key].tone,
      recommendation: SEGMENTS[key],
      count: members.length,
      revenue: round(members.reduce((s, p) => s + p.netRevenue, 0)),
      grossRevenue: round(members.reduce((s, p) => s + p.grossRevenue, 0)),
      customers: members,
    };
  });
  const activeSegments = SEGMENT_ORDER.filter((k) => segments[k].count > 0);

  // 5x5 recency × frequency matrix (cells hold counts + net revenue).
  const matrix = Array.from({ length: 5 }, (_, ri) =>
    Array.from({ length: 5 }, (_, fi) => {
      const cell = profiles.filter((p) => p.r === 5 - ri && p.f === fi + 1);
      return { r: 5 - ri, f: fi + 1, count: cell.length, revenue: round(cell.reduce((s, p) => s + p.netRevenue, 0)) };
    })
  );

  const metrics = {
    customersScored: profiles.length,
    activeCustomers: profiles.filter((p) => p.recencyDays <= WINDOWS.active).length,
    vipCustomers: segments.vip_loyalists.count,
    atRiskDormant: segments.at_risk.count + segments.dormant.count,
    suppressedCustomers: profiles.filter((p) => p.eligibility.suppressed).length,
    segmentableRevenue: round(profiles.reduce((s, p) => s + p.grossRevenue, 0)),
    returnAdjustedRevenue: round(profiles.reduce((s, p) => s + p.netRevenue, 0)),
  };

  return { refDate, refDay, profiles, segments, activeSegments, matrix, metrics };
}
