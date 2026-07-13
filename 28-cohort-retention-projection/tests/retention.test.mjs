// Smoke test for the cohort retention & projection core. Pure Node, no deps.
// Run: node tests/retention.test.mjs   (exits non-zero on any failure)

import { COHORTS, MARGIN, GROUND_TRUTH } from "../cohorts.js";
import { fitRetention, projectCohort, curveSamples, buildReport, SORTS } from "../retention.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const near = (a, b, eps) => Math.abs(a - b) < eps;

// --- Data ------------------------------------------------------------------
check("12 cohorts forming a triangle (oldest full, newest month 0 only)",
  COHORTS.length === 12 && COHORTS[0].observed.length === 12 && COHORTS[11].observed.length === 1);
check("every cohort starts at 100% retention in month 0", COHORTS.every((c) => c.observed[0].activePct === 1));

// --- Curve fit recovers the truth ------------------------------------------
const curve = fitRetention(COHORTS);
check("fitted retention curve fits well (high R²)", curve.r2 > 0.85, `R²=${curve.r2}`);
check("recovered month-1 retention is close to the true 0.55", near(curve.A, GROUND_TRUTH.A, 0.08), `A=${curve.A}`);
check("recovered decay exponent is close to the true 0.45", near(curve.decay, GROUND_TRUTH.b, 0.12), `decay=${curve.decay}`);
check("retention is 1 at age 0 and decreasing after", curve.r(0) === 1 && curve.r(1) > curve.r(2) && curve.r(2) > curve.r(6));

// --- Cohort projection -----------------------------------------------------
const oldest = projectCohort(COHORTS[0], curve, { horizon: 24, margin: MARGIN, basis: "contribution" });
const newest = projectCohort(COHORTS[11], curve, { horizon: 24, margin: MARGIN, basis: "contribution" });
check("projected LTV includes the future, so it exceeds realised LTV", oldest.projectedLtv > oldest.realisedLtv);
check("a young cohort has most of its value still to come", newest.toComePct > oldest.toComePct && newest.toComePct > 0.5);
check("the oldest cohort has realised most of its horizon value", oldest.toComePct < newest.toComePct);
check("projection series spans month 0..horizon and marks projected months",
  oldest.series.length === 25 && oldest.series.some((p) => p.isProjected) && newest.series.filter((p) => p.isProjected).length > oldest.series.filter((p) => p.isProjected).length);
check("cumulative LTV is monotincreasing", oldest.series.every((p, i, a) => i === 0 || p.cumulative >= a[i - 1].cumulative));

// --- Contribution vs revenue basis -----------------------------------------
const rev = projectCohort(COHORTS[0], curve, { horizon: 24, basis: "revenue" });
check("revenue-basis LTV exceeds contribution-basis LTV",
  rev.projectedLtv > oldest.projectedLtv && near(oldest.projectedLtv / rev.projectedLtv, MARGIN, 0.02));

// --- Horizon extends value -------------------------------------------------
const h12 = projectCohort(COHORTS[0], curve, { horizon: 12 });
const h36 = projectCohort(COHORTS[0], curve, { horizon: 36 });
check("a longer horizon yields a higher projected LTV", h36.projectedLtv > h12.projectedLtv);

// --- Report ----------------------------------------------------------------
const rep = buildReport(COHORTS, { horizon: 24, basis: "contribution", sort: "age" });
check("report weights LTV by cohort size and exposes both figures",
  rep.metrics.avgProjectedLtv > rep.metrics.avgRealisedLtv && rep.metrics.customers === COHORTS.reduce((s, c) => s + c.size, 0));
check("blended 'still to come' is a sane fraction", rep.metrics.toComePct > 0 && rep.metrics.toComePct < 1);
check("cohort-quality trend is detected (newer cohorts retain worse here)",
  rep.metrics.qualityTrend < 0, `trend=${rep.metrics.qualityTrend}`);
check("curve samples carry observed + fitted for the chart",
  rep.samples.length === 25 && rep.samples[1].observed != null && rep.samples[24].fitted != null);
check("sort by projected LTV is descending",
  buildReport(COHORTS, { sort: "projected" }).sorted.every((r, i, a) => i === 0 || a[i - 1].projectedLtv >= r.projectedLtv));
check("horizon option changes projected LTV",
  buildReport(COHORTS, { horizon: 36 }).metrics.avgProjectedLtv > buildReport(COHORTS, { horizon: 12 }).metrics.avgProjectedLtv);
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(rep).slice(0, 200000)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll cohort retention projection checks passed.");
process.exit(failures ? 1 : 0);
