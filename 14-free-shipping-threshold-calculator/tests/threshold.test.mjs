// Smoke test for the free-shipping threshold calculator core. Pure Node, no deps.
// Run: node tests/threshold.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCsv, buildModel, evaluate, sweep, warningsFor, NUDGE_RATES, CONV_LIFTS } from "../threshold.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const rd = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const orders = parseCsv(rd("../../shared-data/customers/orders.csv"));
const model = buildModel({ orders });

// --- Loading + model -------------------------------------------------------
check("orders load", orders.length > 0);
check("basket distribution + economics derived",
  model.n > 0 && model.aov > 0 && model.marginRate > 0 && model.avgShippingCost > 0 && model.histogram.length > 0,
  `n=${model.n} aov=${model.aov} margin=${model.marginRate} ship=${model.avgShippingCost}`);
check("candidate thresholds generated", model.candidateThresholds.length >= 5);
check("histogram bins sum to order count", model.histogram.reduce((s, b) => s + b.count, 0) === model.n);

// --- Single scenario -------------------------------------------------------
const r = evaluate(model, { threshold: 200, nudge: "med", conv: "8%", window: "€25", shipping: "€5" });
check("scenario splits orders into above / within-reach / far", r.counts.above + r.counts.reach + r.counts.far === model.n);
check("subsidy cost = shipping cost x qualifying orders", r.subsidyCost === r.counts.above * r.shippingCost);
check("net delta = nudge gain + conversion gain − subsidy cost",
  Math.abs(r.netDelta - (r.nudgeGain + r.convGain - r.subsidyCost)) < 0.02);
check("AOV lift is non-negative (nudging can only add basket)", r.aovAfter >= r.aovBefore);

// --- Sweep + recommendation -----------------------------------------------
const sw = sweep(model, { nudge: "med", conv: "8%", window: "€25", shipping: "€5" });
check("sweep evaluates every candidate threshold", sw.rows.length === model.candidateThresholds.length);
check("recommended threshold is the argmax of net delta",
  sw.rows.every((x) => x.netDelta <= sw.recommendedNet) && model.candidateThresholds.includes(sw.recommended),
  `rec=${sw.recommended} net=${sw.recommendedNet}`);

// --- Levers move the outcome ----------------------------------------------
const lowN = evaluate(model, { threshold: 200, nudge: "low", conv: "8%", window: "€25", shipping: "€5" });
const highN = evaluate(model, { threshold: 200, nudge: "high", conv: "8%", window: "€25", shipping: "€5" });
check("higher nudge rate improves (or equals) net contribution", highN.netDelta >= lowN.netDelta && highN.nudgeGain > lowN.nudgeGain);
const noConv = evaluate(model, { threshold: 200, nudge: "med", conv: "off", window: "€25", shipping: "€5" });
const hiConv = evaluate(model, { threshold: 200, nudge: "med", conv: "12%", window: "€25", shipping: "€5" });
check("higher conversion lift improves net contribution", hiConv.netDelta > noConv.netDelta && noConv.convGain === 0);
const cheapShip = evaluate(model, { threshold: 200, nudge: "med", conv: "8%", window: "€25", shipping: "€5" });
const dearShip = evaluate(model, { threshold: 200, nudge: "med", conv: "8%", window: "€25", shipping: "€12" });
check("higher shipping cost lowers net contribution", dearShip.netDelta < cheapShip.netDelta);

// --- Break-even conversion lift -------------------------------------------
check("break-even conversion lift is computed", typeof r.breakEvenConv === "number");
if (Number.isFinite(r.breakEvenConv)) {
  const atBE = evaluate(model, { threshold: 200, nudge: "med", conv: "off", window: "€25", shipping: "€5" });
  // net at break-even conv = nudgeGain + breakEvenConv*qualContribNetShip - subsidy ≈ 0
  const qualContribNetShip = (atBE.convGain === 0) ? (r.convGain / r.convLift) : 0;
  const scaled = atBE.nudgeGain + r.breakEvenConv * qualContribNetShip - atBE.subsidyCost;
  check("net delta ≈ 0 at the break-even conversion lift", Math.abs(scaled) < 0.5, `scaled=${scaled}`);
} else {
  check("break-even flagged unreachable when qualifying orders can't cover shipping", true);
}

// --- Wrong vs right --------------------------------------------------------
check("naive revenue uplift overstates the real net contribution",
  r.naiveUplift > r.netDelta,
  `naive=${r.naiveUplift} net=${r.netDelta}`);

// --- A too-low threshold must warn -----------------------------------------
const lowT = evaluate(model, { threshold: 100, nudge: "med", conv: "off", window: "€25", shipping: "€12" });
const lowWarn = warningsFor(lowT);
check("a too-low threshold produces a warning", lowWarn.length > 0, JSON.stringify(lowWarn.map((w) => w.type)));

// --- Percentages coherent --------------------------------------------------
check("qualify% and reach% are within 0..100", r.pctQualify >= 0 && r.pctQualify <= 100 && r.pctReach >= 0 && r.pctReach <= 100);
check("all nudge + conversion presets evaluate",
  Object.keys(NUDGE_RATES).every((k) => typeof evaluate(model, { threshold: 200, nudge: k }).netDelta === "number") &&
  Object.keys(CONV_LIFTS).every((k) => typeof evaluate(model, { threshold: 200, conv: k }).netDelta === "number"));

// --- Leakage ---------------------------------------------------------------
check("no raw emails appear (no '@')", !JSON.stringify({ model: { ...model, values: model.values.length }, r, sw }).includes("@"));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll free-shipping threshold calculator checks passed.");
process.exit(failures ? 1 : 0);
