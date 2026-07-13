// Smoke test for the holdout-vs-observed lift core. Pure Node, no deps.
// Run: node tests/lift.test.mjs   (exits non-zero on any failure)

import { EXPERIMENTS } from "../experiments.js";
import {
  normalCdf, proportionTest, analyzeExperiment, buildReport, CONFIDENCE, VERDICTS, SORTS,
} from "../lift.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

// --- normalCdf -------------------------------------------------------------
check("normalCdf(0) ~ 0.5", near(normalCdf(0), 0.5));
check("normalCdf(1.96) ~ 0.975", near(normalCdf(1.959964), 0.975, 2e-3));
check("normalCdf is symmetric", near(normalCdf(-1.2) + normalCdf(1.2), 1, 2e-3));
check("normalCdf monotonic", normalCdf(-2) < normalCdf(0) && normalCdf(0) < normalCdf(2));

// --- proportionTest --------------------------------------------------------
const bigLift = proportionTest({ users: 20000, conversions: 300 }, { users: 10000, conversions: 90 }, CONFIDENCE[95].z);
check("lift is treatment rate minus control rate", near(bigLift.lift, 0.015 - 0.009));
check("a large clear lift is significant (CI excludes 0)", bigLift.significant && bigLift.ciLow > 0);
check("a large clear lift has a tiny p-value", bigLift.pValue < 0.001, `p=${bigLift.pValue}`);
const noLift = proportionTest({ users: 8000, conversions: 480 }, { users: 4000, conversions: 224 }, CONFIDENCE[95].z);
check("a marginal lift is NOT significant", !noLift.significant && noLift.pValue > 0.05, `p=${noLift.pValue}`);
check("CI brackets the point estimate", noLift.ciLow < noLift.lift && noLift.lift < noLift.ciHigh);

// --- analyzeExperiment: the story ------------------------------------------
const byId = Object.fromEntries(EXPERIMENTS.map((e) => [e.id, analyzeExperiment(e, 95)]));

check("brand search reports a huge ROAS", byId["brand-search"].reportedRoas > 5);
check("brand search is NOT truly incremental (harvesting/no-lift)",
  ["harvesting", "no-lift", "inconclusive"].includes(byId["brand-search"].verdict), byId["brand-search"].verdict);
check("brand search incremental ROAS collapses far below reported",
  byId["brand-search"].incrementalRoas < byId["brand-search"].reportedRoas / 3);

check("prospecting is genuinely incremental", byId["prospecting"].verdict === "incremental" && byId["prospecting"].significant);
check("affiliate is genuinely incremental", byId["affiliate-partner"].verdict === "incremental");
check("generic search is genuinely incremental", byId["generic-search"].verdict === "incremental");

check("instagram holdout is inconclusive (underpowered)", byId["instagram-awareness"].verdict === "inconclusive" && !byId["instagram-awareness"].significant);

check("incremental conversions are below reported for every channel",
  Object.values(byId).every((r) => r.incrementalConversions <= r.reportedConversions + 1e-6));
check("incrementality % is between -100% and 100%",
  Object.values(byId).every((r) => r.incrementalityPct <= 1.0001 && r.incrementalityPct > -1));
check("baseline + incremental reconstructs reported conversions",
  Object.values(byId).every((r) => near(r.baselineConversions + r.incrementalConversions, r.reportedConversions, 0.5)));

// --- confidence level actually matters -------------------------------------
const news95 = analyzeExperiment(EXPERIMENTS.find((e) => e.id === "newsletter"), 95);
const news99 = analyzeExperiment(EXPERIMENTS.find((e) => e.id === "newsletter"), 99);
check("newsletter is significant at 95% but not at 99% (the bar matters)",
  news95.significant && !news99.significant, `95=${news95.significant} 99=${news99.significant}`);
check("a stricter confidence widens the interval",
  (news99.ciHigh - news99.ciLow) > (news95.ciHigh - news95.ciLow));

// --- buildReport aggregate -------------------------------------------------
const rep = buildReport(EXPERIMENTS, { conf: 95, sort: "incrementality" });
check("report has one row per experiment", rep.rows.length === EXPERIMENTS.length);
check("blended incremental ROAS is below blended reported ROAS",
  rep.metrics.incrementalRoas < rep.metrics.reportedRoas, `${rep.metrics.incrementalRoas} vs ${rep.metrics.reportedRoas}`);
check("reported revenue overstates incremental revenue", rep.metrics.overstatementPct > 0.1);
check("blended incrementality is a sensible fraction", rep.metrics.incrementalityPct > 0 && rep.metrics.incrementalityPct < 1);
check("some spend is flagged as not incremental", rep.metrics.notIncremental >= 2 && rep.metrics.wastedSpendRevenue > 0);
check("sort by incrementality is descending",
  rep.sorted.every((r, i, a) => i === 0 || a[i - 1].incrementalityPct >= r.incrementalityPct));
check("sort by iroas reorders", buildReport(EXPERIMENTS, { sort: "iroas" }).sorted[0].id !== undefined);
check("every verdict has a label", rep.rows.every((r) => VERDICTS[r.verdict]));

// --- Leakage ---------------------------------------------------------------
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(rep)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll holdout-vs-observed lift checks passed.");
process.exit(failures ? 1 : 0);
