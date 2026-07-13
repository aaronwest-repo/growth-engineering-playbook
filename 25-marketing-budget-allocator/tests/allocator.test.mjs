// Smoke test for the marketing budget allocator core. Pure Node, no deps.
// Run: node tests/allocator.test.mjs   (exits non-zero on any failure)

import { CHANNELS } from "../channels.js";
import {
  response, netContribution, marginalRevenue, marginalProfit,
  allocateBudget, profitMaxSpend, buildReport, curve, SORTS,
} from "../allocator.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const near = (a, b, eps = 1) => Math.abs(a - b) < eps;

// --- Response curve shape --------------------------------------------------
const ch = CHANNELS[0];
check("response starts at 0 and rises", response(ch, 0) === 0 && response(ch, 5000) > 0);
check("response is concave (diminishing returns)",
  response(ch, 2000) - response(ch, 1000) > response(ch, 6000) - response(ch, 5000));
check("response approaches vmax but never exceeds it", response(ch, ch.k * 10) < ch.vmax && response(ch, ch.k * 10) > ch.vmax * 0.99);
check("marginal revenue decreases with spend", marginalRevenue(ch, 1000) > marginalRevenue(ch, 8000));
check("marginal profit = margin*marginalRevenue − 1",
  near(marginalProfit(ch, 3000), ch.margin * marginalRevenue(ch, 3000) - 1, 1e-9));

// --- Fixed-budget allocation -----------------------------------------------
const budget = 54000;
const alloc = allocateBudget(CHANNELS, budget, "profit");
check("allocation spends the whole budget", near(alloc.reduce((s, a) => s + a.spend, 0), budget, 5));
check("every allocation is non-negative", alloc.every((a) => a.spend >= -1e-6));
check("at the optimum, active channels share one marginal profit (water-filling)",
  (() => {
    const active = alloc.filter((a) => a.spend > 1);
    const mps = active.map((a) => marginalProfit(CHANNELS.find((c) => c.id === a.id), a.spend));
    return Math.max(...mps) - Math.min(...mps) < 0.02;
  })());

// The optimum must beat naive plans at the same budget.
function planContribution(spendById) {
  return CHANNELS.reduce((s, c) => s + netContribution(c, spendById[c.id] || 0), 0);
}
const optSpend = Object.fromEntries(alloc.map((a) => [a.id, a.spend]));
const evenSpend = Object.fromEntries(CHANNELS.map((c) => [c.id, budget / CHANNELS.length]));
const currentSpend = Object.fromEntries(CHANNELS.map((c) => [c.id, c.currentSpend]));
check("optimal beats an even split", planContribution(optSpend) > planContribution(evenSpend));
check("optimal beats the current plan at the same budget", planContribution(optSpend) >= planContribution(currentSpend) - 1);

// --- Profit-max (unconstrained) --------------------------------------------
const pm = profitMaxSpend(CHANNELS, "profit");
check("profit-max drives every channel's marginal profit to ~0",
  pm.every((a) => a.spend === 0 || Math.abs(marginalProfit(CHANNELS.find((c) => c.id === a.id), a.spend)) < 0.01));
check("no fixed budget can beat the profit-max contribution",
  planContribution(Object.fromEntries(pm.map((a) => [a.id, a.spend]))) >= planContribution(optSpend) - 1);

// --- Report: the story -----------------------------------------------------
const rep = buildReport(CHANNELS, { budgetMultiplier: 1, objective: "profit" });
check("reallocating the same budget lifts contribution", rep.metrics.upliftPct > 0.02, `uplift=${rep.metrics.upliftPct}`);
check("budget matches the current total at 1x", near(rep.metrics.budget, rep.metrics.currentBudget, 1));
check("some channels are cut and some increased", rep.metrics.cut >= 1 && rep.metrics.increased >= 1);
check("the underfunded high-margin channel gets more, the saturated one gets cut",
  (() => {
    const email = rep.channels.find((c) => c.id === "newsletter");
    const retarget = rep.channels.find((c) => c.id === "retargeting");
    return email.action === "increase" && retarget.action === "cut";
  })());
check("deltas net to ~zero at a fixed budget", near(rep.channels.reduce((s, c) => s + c.deltaSpend, 0), 0, 5));

// --- Objective toggle: revenue over-funds low-margin channels ---------------
const profitRep = buildReport(CHANNELS, { budgetMultiplier: 1, objective: "profit" });
const revRep = buildReport(CHANNELS, { budgetMultiplier: 1, objective: "revenue" });
check("revenue objective yields more revenue but less contribution than profit objective",
  revRep.metrics.optimalRevenue >= profitRep.metrics.optimalRevenue - 1 &&
  revRep.metrics.optimalContribution <= profitRep.metrics.optimalContribution + 1,
  `rev: rev=${revRep.metrics.optimalRevenue} con=${revRep.metrics.optimalContribution} | profit: rev=${profitRep.metrics.optimalRevenue} con=${profitRep.metrics.optimalContribution}`);

// --- Max-budget mode -------------------------------------------------------
const maxRep = buildReport(CHANNELS, { budgetMode: "max", objective: "profit" });
check("profit-max budget yields the highest contribution of all budgets", maxRep.metrics.optimalContribution >= rep.metrics.optimalContribution - 1);
check("at profit-max every euro's marginal profit is ~0 (breakeven marginal ROAS)",
  maxRep.channels.every((c) => c.optimal.spend < 1 || Math.abs(c.optimal.marginalProfit) < 0.02));

// --- Sorting + curve + leakage ---------------------------------------------
check("sort by reallocation is by |delta| desc",
  rep.sorted.every((c, i, a) => i === 0 || Math.abs(a[i - 1].deltaSpend) >= Math.abs(c.deltaSpend)));
const cv = curve(CHANNELS[0], 9000, 5000, 20);
check("curve samples net contribution and marks both spends", cv.points.length === 21 && cv.currentSpend === 9000 && cv.optimalSpend === 5000);
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(rep)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll marketing budget allocator checks passed.");
process.exit(failures ? 1 : 0);
