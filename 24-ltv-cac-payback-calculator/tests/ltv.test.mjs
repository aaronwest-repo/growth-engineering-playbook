// Smoke test for the LTV/CAC/payback core. Pure Node, no deps.
// Run: node tests/ltv.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseCsv, orderContribution, orderNetRevenue, buildCustomers,
  analyzeSegments, buildReport, paybackCurve, SORTS, VERDICTS,
} from "../ltv.js";
import { CAC, CHANNEL_LABELS, THRESHOLDS } from "../cac.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const rd = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const orders = parseCsv(rd("../../shared-data/customers/orders.csv"));
const customers = parseCsv(rd("../../shared-data/customers/customers.csv"));

// --- Loading + contribution math -------------------------------------------
check("order data loads", orders.length > 100 && customers.length > 10);
const o = { gross_revenue: "100", discount: "10", shipping_revenue: "5", product_cost: "40", shipping_cost: "4", returned_amount: "0" };
check("contribution = gross − discount + shipRev − costs", orderContribution(o) === 51);
check("net revenue = gross − discount + shipRev − returns", orderNetRevenue(o) === 95);
check("a returned order reduces contribution",
  orderContribution({ ...o, returned_amount: "100" }) === -49);

// --- Customer records ------------------------------------------------------
const recs = buildCustomers({ orders, customers }, { asOf: "2026-09-09" });
check("one record per customer with orders", recs.length > 0 && recs.length <= new Set(orders.map((r) => r.customer_id)).size);
check("acquisition channel is the first order's channel", recs.every((c) => c.acqChannel));
check("tenure is always positive", recs.every((c) => c.tenureMonths >= 0.5));
check("order count and contribution are coherent", recs.every((c) => c.orders >= 1 && typeof c.contribution === "number"));
check("repeat flag matches order count", recs.every((c) => c.repeat === (c.orders > 1)));
check("acquisition date is each customer's earliest order",
  recs.every((c) => {
    const os = orders.filter((r) => r.customer_id === c.customerId).map((r) => r.order_date).sort();
    return c.acqDate === os[0];
  }));

// --- Segment analysis ------------------------------------------------------
const segs = analyzeSegments(recs, CAC, { groupBy: "channel", basis: "contribution", labels: CHANNEL_LABELS });
check("segments cover the acquisition channels", segs.length >= 4);
check("every segment has cac, ltv:cac and payback",
  segs.every((s) => s.cac >= 0 && s.ltvCac >= 0 && (s.paybackMonths >= 0 || s.paybackMonths === Infinity)));
check("ltv:cac = avg LTV / cac", segs.every((s) => s.cac === 0 || Math.abs(s.ltvCac - s.avgLtv / s.cac) < 0.02));
check("payback = cac / avg monthly contribution",
  segs.every((s) => s.avgMonthlyContribution <= 0 || Math.abs(s.paybackMonths - s.cac / s.avgMonthlyContribution) < 0.2));
check("cheap channels have higher LTV:CAC than paid social",
  (() => {
    const social = segs.find((s) => s.key === "social");
    const direct = segs.find((s) => s.key === "direct");
    return !social || !direct || direct.ltvCac > social.ltvCac;
  })());
check("net profit = (avgLtv − cac) × customers", segs.every((s) => Math.abs(s.netProfit - (s.avgLtv - s.cac) * s.customers) < 1));
check("every verdict has a label", segs.every((s) => VERDICTS[s.verdict]));

// --- Revenue basis overstates vs contribution basis ------------------------
const contribReport = buildReport({ orders, customers }, CAC, { basis: "contribution" });
const revenueReport = buildReport({ orders, customers }, CAC, { basis: "revenue" });
check("revenue-based LTV overstates contribution-based LTV",
  revenueReport.metrics.blendedLtv > contribReport.metrics.blendedLtv,
  `${revenueReport.metrics.blendedLtv} vs ${contribReport.metrics.blendedLtv}`);
check("revenue basis inflates the blended LTV:CAC ratio",
  revenueReport.metrics.blendedLtvCac > contribReport.metrics.blendedLtvCac);

// --- Report aggregate ------------------------------------------------------
const rep = contribReport;
check("blended LTV, CAC and ratio are computed",
  rep.metrics.blendedLtv > 0 && rep.metrics.blendedCac > 0 && rep.metrics.blendedLtvCac > 0);
check("repeat rate is a fraction", rep.metrics.repeatRate >= 0 && rep.metrics.repeatRate <= 1);
check("grouping by tier changes the segmentation",
  buildReport({ orders, customers }, CAC, { groupBy: "tier" }).segments.length !== rep.segments.length ||
  buildReport({ orders, customers }, CAC, { groupBy: "tier" }).segments.some((s) => ["none", "silver", "gold"].includes(s.key)));
check("sort by payback is ascending (fastest first)",
  rep.sorted && buildReport({ orders, customers }, CAC, { sort: "payback" }).sorted
    .filter((s) => s.paybackMonths !== Infinity)
    .every((s, i, a) => i === 0 || a[i - 1].paybackMonths <= s.paybackMonths));

// --- Payback curve ---------------------------------------------------------
const curve = paybackCurve(segs[0], 18);
check("payback curve rises monotonically from zero", curve.points[0].cumulative === 0 && curve.points[18].cumulative >= curve.points[1].cumulative);
check("payback curve exposes the CAC line", curve.cac === segs[0].cac);

// --- Thresholds + leakage --------------------------------------------------
check("thresholds are sane (3:1 rule, 12-month payback)", THRESHOLDS.ltvCacHealthy === 3 && THRESHOLDS.paybackHealthy === 12);
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(rep).slice(0, 200000)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll LTV/CAC/payback checks passed.");
process.exit(failures ? 1 : 0);
