// Lifecycle campaign planner core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/planner.test.mjs). No DOM, no network, no PII — customers
// are keyed by synthetic customer_id and fictional first names.
//
// This is NOT "send more email". Identity resolution (case 09) makes profiles
// trustworthy; RFM (case 10) assigns a lifecycle state. This planner turns those
// states into *controlled* campaigns: who is eligible, who is suppressed, what
// message fits the moment, when it sends, who is held out for measurement, what
// incentive is margin-safe, and how success is judged. Lifecycle marketing is
// controlled customer decisioning — suppression, timing, margin, measurement —
// not a calendar.

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
const iso = (day) => new Date(day * 86400000).toISOString().slice(0, 10);

export const WINDOWS = { recentPurchase: 14, active: 180, supportRisk: 90, newCustomer: 120 };
export const RETURN_RISK_RATIO = 0.25;
export const INCENTIVE_LEVELS = { none: 0, "5%": 0.05, "10%": 0.10, "15%": 0.15 };
export const HOLDOUT_LEVELS = { "0%": 0, "10%": 0.10, "20%": 0.20 };

// Ordered lifecycle segments (RFM-style). Support/return risk are first-class
// states here, because they change the campaign, not just a warning label.
export const SEGMENTS = {
  vip_loyalists:    { label: "VIP loyalists" },
  promising:        { label: "Promising" },
  new_customers:    { label: "New customers" },
  one_time_buyers:  { label: "One-time buyers" },
  at_risk:          { label: "At risk" },
  dormant:          { label: "Dormant" },
  high_return_risk: { label: "High-return risk" },
  support_risk:     { label: "Support risk" },
  do_not_target:    { label: "Do not target" },
};

// Lifecycle campaigns. Each targets a disjoint set of segments, so a customer
// sits in exactly one lifecycle moment (or none, if do-not-target).
export const CAMPAIGNS = [
  {
    key: "vip_early_access", name: "VIP early-access", objective: "vip_loyalty",
    segments: ["vip_loyalists"], usesIncentive: false, convRate: 0.18,
    waitDays: 0, followUpDays: 5, measureDays: 30, targetMetric: "Repeat purchase rate",
    brief: { subject: "You're in first — early access is open", preheader: "A thank-you for being one of our best customers.", angle: "Recognition and access, not a discount. Reward loyalty you already have.", cta: "Shop early access", suggestion: "Newest arrivals in their top category", tone: "Warm, exclusive, low-pressure." },
  },
  {
    key: "second_purchase", name: "Second-purchase nudge", objective: "second_purchase",
    segments: ["one_time_buyers", "new_customers"], usesIncentive: true, convRate: 0.12,
    waitDays: 3, followUpDays: 10, measureDays: 30, targetMetric: "Repeat purchase rate",
    brief: { subject: "Since you liked your first order…", preheader: "A little help finding what pairs with it.", angle: "Turn a first order into a habit. Educate on the category, small first-repeat nudge.", cta: "See what pairs with it", suggestion: "Complementary category to first order", tone: "Helpful, curious, not pushy." },
  },
  {
    key: "winback", name: "Win-back", objective: "winback",
    segments: ["at_risk"], usesIncentive: true, convRate: 0.08,
    waitDays: 0, followUpDays: 14, measureDays: 45, targetMetric: "Reactivation rate",
    brief: { subject: "We saved your spot", preheader: "Here's what's new since you were last in.", angle: "Valuable but lapsing. Margin-aware win-back sized to their worth, not a blanket coupon.", cta: "Come back and see", suggestion: "Best-sellers since last visit", tone: "Sincere, specific, respectful." },
  },
  {
    key: "replenishment_care", name: "Replenishment / care guide", objective: "retention",
    segments: ["promising"], usesIncentive: false, convRate: 0.15,
    waitDays: 2, followUpDays: 21, measureDays: 30, targetMetric: "Repeat purchase rate",
    brief: { subject: "Getting the most out of your order", preheader: "Care tips + when to restock.", angle: "Build the relationship with usefulness before asking for another sale.", cta: "Read the care guide", suggestion: "Care + replenishment for owned category", tone: "Practical, generous, expert." },
  },
  {
    key: "support_first_recovery", name: "Support-first recovery", objective: "retention",
    segments: ["support_risk", "high_return_risk"], usesIncentive: false, convRate: 0.05,
    waitDays: 0, followUpDays: 7, measureDays: 30, targetMetric: "Ticket resolution / return rate",
    brief: { subject: "Let's make this right", preheader: "A real person, not a promo.", angle: "Service before selling. High returns / open tickets get help — a discount here funds the next return.", cta: "Get help now", suggestion: "Sizing & fit guidance, not products", tone: "Accountable, human, zero sales pressure." },
  },
  {
    key: "dormant_reactivation", name: "Dormant reactivation test", objective: "winback",
    segments: ["dormant"], usesIncentive: true, convRate: 0.03,
    waitDays: 0, followUpDays: 0, measureDays: 60, targetMetric: "Reactivation rate",
    brief: { subject: "Still want to hear from us?", preheader: "One message, your call.", angle: "Long silent, low value. One reactivation touch against a holdout; most won't return, so don't over-invest.", cta: "Yes, keep me in", suggestion: "Entry-price best-sellers", tone: "Low-key, honest, easy opt-out." },
  },
];

function economics(orders, refDay) {
  const gross = orders.reduce((s, o) => s + num(o.gross_revenue), 0);
  const returned = orders.reduce((s, o) => s + num(o.returned_amount), 0);
  const lastOrderDay = Math.max(...orders.map((o) => dayNum(o.order_date)));
  const lastOrderDate = orders.reduce((b, o) => (dayNum(o.order_date) >= dayNum(b) ? o.order_date : b), orders[0].order_date);
  return {
    frequency: orders.length,
    grossRevenue: round(gross),
    returnedAmount: round(returned),
    netRevenue: round(gross - returned),
    returnRatio: gross > 0 ? round(returned / gross) : 0,
    lastOrderDate,
    recencyDays: refDay - lastOrderDay,
  };
}

function quintileScorer(values, higherIsBetter) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length || 1;
  return (v) => {
    let leq = 0; for (const x of sorted) if (x <= v) leq++;
    let s = Math.ceil((leq / n) * 5); if (s < 1) s = 1; if (s > 5) s = 5;
    return higherIsBetter ? s : 6 - s;
  };
}

function classify({ r, f, m, recencyDays, returnRatio, marketing, supportRisk }) {
  if (!marketing) return "do_not_target";
  if (supportRisk) return "support_risk";
  if (m >= 4 && returnRatio >= RETURN_RISK_RATIO) return "high_return_risk";
  if (r >= 4 && f >= 4 && m >= 4) return "vip_loyalists";
  if (m >= 3 && f >= 3 && r <= 2) return "at_risk";
  if (r <= 1) return "dormant";
  if (recencyDays <= WINDOWS.newCustomer && f <= 1) return "new_customers";
  if (f === 1) return "one_time_buyers";
  return "promising";
}

// Build scored + segmented profiles once. Campaign planning re-runs cheaply on
// top of this with different scenario options.
export function buildProfiles({ customers, orders, tickets = [] }) {
  const ordersByCustomer = groupBy(orders, "customer_id");
  const ticketsByCustomer = groupBy(tickets.filter((t) => t.customer_id), "customer_id");
  const allDates = [...orders.map((o) => o.order_date), ...customers.map((c) => c.created_at)];
  const refDay = allDates.length ? Math.max(...allDates.map(dayNum)) : 0;

  const gross = orders.reduce((s, o) => s + num(o.gross_revenue), 0);
  const marginAbs = orders.reduce((s, o) => s + num(o.gross_revenue) - num(o.product_cost) - num(o.shipping_cost) - num(o.discount) - num(o.returned_amount), 0);
  const aov = orders.length ? round(gross / orders.length) : 0;
  const marginRate = gross > 0 ? round(marginAbs / gross) : 0;

  const scored = customers.filter((c) => (ordersByCustomer[c.customer_id] || []).length > 0);
  const econ = new Map();
  scored.forEach((c) => econ.set(c.customer_id, economics(ordersByCustomer[c.customer_id], refDay)));

  const rS = quintileScorer(scored.map((c) => econ.get(c.customer_id).recencyDays), false);
  const fS = quintileScorer(scored.map((c) => econ.get(c.customer_id).frequency), true);
  const mS = quintileScorer(scored.map((c) => econ.get(c.customer_id).netRevenue), true);

  const profiles = scored.map((c) => {
    const e = econ.get(c.customer_id);
    const r = rS(e.recencyDays), f = fS(e.frequency), m = mS(e.netRevenue);
    const consent = { marketing: bool(c.consent_marketing), personalization: bool(c.consent_personalization), newsletter: bool(c.newsletter_opt_in) };
    const cTickets = ticketsByCustomer[c.customer_id] || [];
    const negTicket = cTickets.some((t) => t.sentiment === "negative" && t.status !== "resolved" && refDay - dayNum(t.created_at) <= WINDOWS.supportRisk);
    const segment = classify({ r, f, m, recencyDays: e.recencyDays, returnRatio: e.returnRatio, marketing: consent.marketing, supportRisk: negTicket });
    return {
      customer_id: c.customer_id, first_name: c.first_name, country: c.country, loyalty_tier: c.loyalty_tier,
      r, f, m, code: `${r}${f}${m}`, ...e, consent, negTicket, segment, segmentLabel: SEGMENTS[segment].label,
    };
  });

  return { refDay, refDate: iso(refDay), profiles, aov, marginRate };
}

// Apply a suppression policy to one candidate, returning the blocking reason
// (or null if the customer is eligible). "strict" adds channel/timing/support
// rules on top of the hard consent + returns rules.
function suppressionReason(p, strictness) {
  if (!p.consent.marketing) return "No marketing consent";
  if (p.returnRatio >= RETURN_RISK_RATIO) return "High return risk";
  if (strictness === "strict") {
    if (p.negTicket) return "Unresolved negative support ticket";
    if (p.recencyDays <= WINDOWS.recentPurchase) return "Recent purchase (avoid over-mailing)";
    if (!p.consent.newsletter) return "Newsletter opt-out";
  }
  return null;
}

// Plan every campaign under a scenario. Options:
//   objective: retention | winback | second_purchase | vip_loyalty
//   incentive: none | 5% | 10% | 15%
//   holdout:   0% | 10% | 20%
//   strictness: basic | strict
export function planCampaigns(base, opts = {}) {
  const objective = opts.objective || "retention";
  const incentivePct = INCENTIVE_LEVELS[opts.incentive] ?? 0;
  const holdoutPct = HOLDOUT_LEVELS[opts.holdout] ?? 0;
  const strictness = opts.strictness === "strict" ? "strict" : "basic";
  const { profiles, aov, marginRate } = base;

  const bySeg = groupBy(profiles, "segment");

  const campaigns = CAMPAIGNS.map((def) => {
    const candidates = def.segments.flatMap((s) => bySeg[s] || []);
    const suppressed = [];
    const eligible = [];
    candidates.forEach((p) => {
      const reason = suppressionReason(p, strictness);
      if (reason) suppressed.push({ customer_id: p.customer_id, first_name: p.first_name, reason });
      else eligible.push(p);
    });

    // Deterministic holdout: sort by id, take every Nth so it's stable + spread.
    const sortedElig = [...eligible].sort((a, b) => a.customer_id.localeCompare(b.customer_id));
    const holdoutN = Math.round(sortedElig.length * holdoutPct);
    const holdoutIds = new Set();
    if (holdoutN > 0 && sortedElig.length > 0) {
      const step = sortedElig.length / holdoutN;
      for (let i = 0; i < holdoutN; i++) holdoutIds.add(sortedElig[Math.floor(i * step)].customer_id);
    }
    const holdout = sortedElig.filter((p) => holdoutIds.has(p.customer_id));
    const targeted = sortedElig.filter((p) => !holdoutIds.has(p.customer_id));

    // Economics of the send.
    const usesIncentive = def.usesIncentive;
    const effIncentive = usesIncentive ? incentivePct : 0;
    const expectedConverters = round(targeted.length * def.convRate);
    const revenueOpportunity = round(expectedConverters * aov);
    const grossMargin = round(revenueOpportunity * marginRate);
    const incentiveCost = round(revenueOpportunity * effIncentive);
    const netContribution = round(grossMargin - incentiveCost);

    // Timeline.
    const sendDay = base.refDay + 1 + def.waitDays;
    const followUpDay = def.followUpDays ? sendDay + def.followUpDays : null;
    const measureEndDay = sendDay + def.measureDays;

    // Risk warnings.
    const warnings = [];
    const marginShare = marginRate > 0 ? effIncentive / marginRate : 0;
    if (effIncentive > 0 && marginShare >= 0.4)
      warnings.push({ type: "over_discount", text: `Incentive consumes ${Math.round(marginShare * 100)}% of gross margin — over-discounting risk.` });
    if (suppressed.some((s) => s.reason === "No marketing consent"))
      warnings.push({ type: "consent", text: `${suppressed.filter((s) => s.reason === "No marketing consent").length} candidate(s) blocked for consent — do not override.` });
    if (def.segments.includes("support_risk") || def.segments.includes("high_return_risk"))
      warnings.push({ type: "support", text: "Service-first audience: resolve support / returns before any promotional message." });
    if (candidates.some((p) => p.returnRatio >= RETURN_RISK_RATIO))
      warnings.push({ type: "returns", text: "High-return customers present — a discount here tends to fund the next return." });
    if (holdoutPct === 0)
      warnings.push({ type: "measurement", text: "No holdout (0%) — measured lift will not be credible; you can't separate campaign effect from baseline." });

    return {
      key: def.key, name: def.name, objective: def.objective, brief: def.brief,
      segments: def.segments, segmentLabels: def.segments.map((s) => SEGMENTS[s].label),
      usesIncentive, convRate: def.convRate, targetMetric: def.targetMetric,
      candidates: candidates.length, suppressed, eligibleCount: eligible.length,
      holdoutCount: holdout.length, targetedCount: targeted.length,
      targetedSample: targeted.slice(0, 12),
      incentivePct: effIncentive, expectedConverters, revenueOpportunity, grossMargin,
      incentiveCost, netContribution,
      timeline: { sendDate: iso(sendDay), followUpDate: followUpDay ? iso(followUpDay) : null, measureEnd: iso(measureEndDay), measureDays: def.measureDays },
      holdoutPct, warnings,
    };
  });

  const planned = campaigns.filter((c) => c.targetedCount > 0 || c.eligibleCount > 0);
  let holdoutTotal = 0, revenue = 0, incentive = 0, riskWarnings = 0;
  campaigns.forEach((c) => {
    holdoutTotal += c.holdoutCount; revenue += c.revenueOpportunity;
    incentive += c.incentiveCost; riskWarnings += c.warnings.length;
  });

  // Segments are disjoint and each maps to at most one campaign, so overall
  // eligibility is a clean per-customer decision: has a campaign, and passes the
  // suppression policy. Everyone else (do-not-target or suppressed) is counted
  // once as suppressed.
  const segToCampaign = {};
  CAMPAIGNS.forEach((def) => def.segments.forEach((s) => (segToCampaign[s] = def.key)));
  const eligibleIds = new Set();
  const uniqueSuppressed = new Set();
  profiles.forEach((p) => {
    if (!segToCampaign[p.segment] || suppressionReason(p, strictness)) uniqueSuppressed.add(p.customer_id);
    else eligibleIds.add(p.customer_id);
  });

  const metrics = {
    eligibleCustomers: eligibleIds.size,
    suppressedCustomers: uniqueSuppressed.size,
    campaignsPlanned: planned.length,
    holdoutCustomers: holdoutTotal,
    revenueOpportunity: round(revenue),
    incentiveCost: round(incentive),
    riskWarnings,
  };

  // Default selected campaign follows the objective control.
  const selected = campaigns.find((c) => c.objective === objective && c.targetedCount >= 0)?.key
    || campaigns[0].key;

  return { options: { objective, incentive: opts.incentive || "none", holdout: opts.holdout || "0%", strictness }, aov, marginRate, metrics, campaigns, selected };
}

// Convenience: build + plan in one call (used by the UI and tests).
export function buildPlanner(data, opts = {}) {
  const base = buildProfiles(data);
  return { base, ...planCampaigns(base, opts) };
}
