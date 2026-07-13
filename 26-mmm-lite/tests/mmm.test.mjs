// Smoke test for the MMM-lite core. Pure Node, no deps.
// Run: node tests/mmm.test.mjs   (exits non-zero on any failure)

import { SERIES, GROUND_TRUTH } from "../series.js";
import { adstock, saturate, ols, fit, decompose, responseCurve, MODELS, SORTS } from "../mmm.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const near = (a, b, eps) => Math.abs(a - b) < eps;

// --- Transforms ------------------------------------------------------------
check("adstock with θ=0 is identity", adstock([1, 2, 3], 0).every((v, i) => v === [1, 2, 3][i]));
check("adstock carries over and decays",
  (() => { const a = adstock([10, 0, 0], 0.5); return a[0] === 10 && a[1] === 5 && a[2] === 2.5; })());
check("saturation is concave and bounded in (0,1)",
  saturate(100, 100) > 0 && saturate(100, 100) < 1 && saturate(50, 100) < saturate(150, 100));

// --- OLS -------------------------------------------------------------------
check("OLS recovers a known linear relationship",
  (() => {
    const X = [[1, 0], [1, 1], [1, 2], [1, 3]]; const y = [1, 3, 5, 7]; // y = 1 + 2x
    const b = ols(X, y); return near(b[0], 1, 1e-6) && near(b[1], 2, 1e-6);
  })());

// --- Data loads ------------------------------------------------------------
check("series has 104 weeks of sales + spend", SERIES.weeks === 104 && SERIES.sales.length === 104 && SERIES.channels.length === 4);
check("every channel has a full spend series", SERIES.channels.every((c) => c.spend.length === 104 && c.spend.every((v) => v > 0)));

// --- Fit recovers the ground truth -----------------------------------------
const dec = decompose(SERIES, "full");
check("full model fits well (high R²)", dec.metrics.r2 > 0.9, `R²=${dec.metrics.r2}`);
check("recovered base share is close to the true base share",
  near(dec.metrics.baseShare, GROUND_TRUTH.baseShare, 0.08), `fit=${dec.metrics.baseShare} true=${GROUND_TRUTH.baseShare}`);
check("recovered adstock θ is close to truth for the high-carryover channel",
  (() => { const social = dec.channels.find((c) => c.id === "paid_social"); return Math.abs(social.theta - GROUND_TRUTH.theta.paid_social) <= 0.2; })());
check("the immediate channel recovers low/zero carryover",
  (() => { const email = dec.channels.find((c) => c.id === "newsletter"); return email.theta <= 0.2; })());
check("recovered channel ROIs are in the right ballpark vs truth",
  dec.channels.every((c) => {
    const t = GROUND_TRUTH.roi[c.id];
    return Math.abs(c.roi - t) / t < 0.35;
  }), JSON.stringify(dec.channels.map((c) => [c.id, c.roi, round2(GROUND_TRUTH.roi[c.id])])));
function round2(x) { return Math.round(x * 100) / 100; }

// --- Decomposition adds up -------------------------------------------------
check("all channel contributions are positive under the full model", dec.channels.every((c) => c.totalContribution > 0));
check("base + channel contributions reconstruct predicted sales",
  near(dec.parts.reduce((s, p) => s + p.total, 0), dec.metrics.predictedTotal, 5));
check("predicted total is close to actual total (good fit)",
  Math.abs(dec.metrics.predictedTotal - dec.metrics.totalSales) / dec.metrics.totalSales < 0.03);
check("marketing + base shares sum to ~1", near(dec.metrics.baseShare + dec.metrics.marketingShare, 1, 0.001));

// --- Model specifications differ -------------------------------------------
const naive = decompose(SERIES, "naive");
const noAdstock = decompose(SERIES, "no_adstock");
check("the full model fits at least as well as the naive model", dec.metrics.r2 >= naive.metrics.r2 - 1e-6, `full=${dec.metrics.r2} naive=${naive.metrics.r2}`);
check("dropping adstock changes the fit", noAdstock.metrics.r2 !== dec.metrics.r2);
check("naive model forces zero carryover", naive.channels.every((c) => c.theta === 0));
check("every model spec has a label", Object.values(MODELS).every((m) => m.label));

// --- Response curve --------------------------------------------------------
const curve = responseCurve(dec.channels[0], SERIES, 20);
check("response curve is concave and starts at 0", curve.points[0].contribution === 0 && curve.points.length === 21);
check("response curve shows diminishing returns",
  (curve.points[5].contribution - curve.points[4].contribution) > (curve.points[20].contribution - curve.points[19].contribution));

// --- Sorting + leakage -----------------------------------------------------
const sorted = dec.channels.slice().sort(SORTS.roi);
check("sort by ROI is descending", sorted.every((c, i, a) => i === 0 || a[i - 1].roi >= c.roi));
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(dec).slice(0, 200000)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll MMM-lite checks passed.");
process.exit(failures ? 1 : 0);
