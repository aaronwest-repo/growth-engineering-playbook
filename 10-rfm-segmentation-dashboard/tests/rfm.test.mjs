// Smoke test for the RFM segmentation core. Pure Node, no deps.
// Run: node tests/rfm.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCsv, buildSegmentation, SEGMENT_ORDER, WINDOWS } from "../rfm.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const rd = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const customers = parseCsv(rd("../../shared-data/customers/customers.csv"));
const orders = parseCsv(rd("../../shared-data/customers/orders.csv"));
const tickets = parseCsv(rd("../../shared-data/customers/support-tickets.csv"));
const model = buildSegmentation({ customers, orders, tickets });

// --- Loading ---------------------------------------------------------------
check("customers and orders load", customers.length > 0 && orders.length > 0);
check("orders expose expected fields",
  ["order_id", "customer_id", "order_date", "gross_revenue", "returned_amount"].every((k) => k in orders[0]));

// --- RFM scoring -----------------------------------------------------------
const withOrders = new Set(orders.map((o) => o.customer_id));
check("RFM scores generated for customers with orders",
  model.profiles.length > 0 && model.profiles.every((p) => withOrders.has(p.customer_id)));
check("every score is 1..5 with a 3-digit code",
  model.profiles.every((p) => [p.r, p.f, p.m].every((s) => s >= 1 && s <= 5) && /^[1-5]{3}$/.test(p.code)));

// Recency score is monotone: more recent (fewer days) => score not lower.
const byRec = [...model.profiles].sort((a, b) => a.recencyDays - b.recencyDays);
check("recency score changes with latest order date (more recent scores >= older)",
  byRec[0].r >= byRec[byRec.length - 1].r && new Set(model.profiles.map((p) => p.r)).size > 1,
  `recentR=${byRec[0].r} oldestR=${byRec[byRec.length - 1].r}`);

// Frequency score monotone with order count.
const byFreq = [...model.profiles].sort((a, b) => b.frequency - a.frequency);
check("frequency score changes with order count (most orders scores >= fewest)",
  byFreq[0].f >= byFreq[byFreq.length - 1].f && new Set(model.profiles.map((p) => p.f)).size > 1,
  `maxFreqF=${byFreq[0].f} minFreqF=${byFreq[byFreq.length - 1].f}`);

// Monetary score monotone with net revenue.
const byMon = [...model.profiles].sort((a, b) => b.netRevenue - a.netRevenue);
check("monetary score changes with net revenue (highest scores >= lowest)",
  byMon[0].m >= byMon[byMon.length - 1].m && new Set(model.profiles.map((p) => p.m)).size > 1,
  `topM=${byMon[0].m} lowM=${byMon[byMon.length - 1].m}`);

// --- Segments --------------------------------------------------------------
check("at least 5 distinct segments are produced", model.activeSegments.length >= 5,
  `active=${model.activeSegments.join(",")}`);
check("VIP loyalists segment exists", model.segments.vip_loyalists.count > 0);
check("at-risk or dormant segment exists",
  model.segments.at_risk.count > 0 || model.segments.dormant.count > 0,
  `atRisk=${model.segments.at_risk.count} dormant=${model.segments.dormant.count}`);
check("every profile maps to a known segment",
  model.profiles.every((p) => SEGMENT_ORDER.includes(p.segment)));

// --- Suppression / eligibility --------------------------------------------
check("consent suppression works (no marketing consent => suppressed + do_not_target)",
  model.profiles.filter((p) => !p.consent.marketing).every((p) => p.eligibility.suppressed && p.segment === "do_not_target") &&
  model.profiles.some((p) => !p.consent.marketing),
  `suppressed=${model.metrics.suppressedCustomers}`);

check("recent purchase suppression works",
  model.profiles.filter((p) => p.recencyDays <= WINDOWS.recentPurchase).every((p) =>
    p.eligibility.recentPurchaseHold &&
    p.warnings.some((w) => /Recent purchase/.test(w)) &&
    p.eligibility.emailEligible === false));

check("high return risk warning works",
  model.profiles.some((p) => p.eligibility.returnsRisk) &&
  model.profiles.filter((p) => p.eligibility.returnsRisk).every((p) => p.warnings.some((w) => /High returns/.test(w))));

// --- Explanation + recommendations -----------------------------------------
const sample = byMon[0]; // a real scored profile
check("selected profile explanation includes R/F/M evidence",
  ["r", "f", "m", "lastOrderDate", "frequency", "netRevenue"].every((k) => sample[k] !== undefined) &&
  sample.warnings !== undefined);

check("campaign recommendation exists per active segment",
  model.activeSegments.every((k) => {
    const rec = model.segments[k].recommendation;
    return rec && rec.action && rec.incentive && rec.why;
  }));

// --- Leakage: no raw real emails ------------------------------------------
const blob = JSON.stringify(model.profiles);
check("no raw emails appear in profiles (no '@')", !blob.includes("@"));
check("customer ids are synthetic tokens", model.profiles.every((p) => /^C-\d+$/.test(p.customer_id)));

// --- Metrics sanity --------------------------------------------------------
check("top-level metrics are coherent",
  model.metrics.customersScored === model.profiles.length &&
  model.metrics.returnAdjustedRevenue <= model.metrics.segmentableRevenue &&
  model.metrics.activeCustomers <= model.metrics.customersScored);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll RFM segmentation checks passed.");
process.exit(failures ? 1 : 0);
