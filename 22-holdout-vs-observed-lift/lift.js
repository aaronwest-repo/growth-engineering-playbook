// Holdout-vs-observed lift core. Dependency-free ES module, imported by the
// browser UI (app.js) and the Node smoke test (tests/lift.test.mjs). No DOM,
// no network, no PII.
//
// The lie this tool is built to expose: the number a channel REPORTS (its
// conversions, its ROAS) is not the number it CAUSED. A holdout experiment
// withholds the campaign from a random control group; whatever that control
// group converts anyway is the organic baseline you were never going to lose.
// True incremental lift = treatment rate − control rate, extrapolated over the
// treated population. Then a two-proportion z-test asks the question every
// dashboard skips: is the lift even distinguishable from zero?
//
// Reported ROAS flatters demand-harvesting channels (brand, retargeting, email);
// incremental ROAS and a significance test tell you where the marginal euro
// actually works. Deterministic; nothing is sent anywhere.

const round = (n, p = 2) => { const f = 10 ** p; return Math.round(n * f) / f; };

export const CONFIDENCE = {
  90: { z: 1.645, label: "90%" },
  95: { z: 1.959964, label: "95%" },
  99: { z: 2.575829, label: "99%" },
};

// Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation.
export function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  let p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  p = 1 - p;
  return x >= 0 ? p : 1 - p;
}

// Two-proportion z-test for treatment vs control conversion rates.
// Returns lift (rate difference), z, two-sided p-value, and a CI at the given z*.
export function proportionTest(treatment, control, zStar) {
  const n1 = treatment.users, x1 = treatment.conversions;
  const n2 = control.users, x2 = control.conversions;
  const p1 = n1 ? x1 / n1 : 0;
  const p2 = n2 ? x2 / n2 : 0;
  const lift = p1 - p2;
  // Pooled SE for the significance test (H0: p1 === p2).
  const pooled = (x1 + x2) / (n1 + n2);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2)) || 0;
  const z = sePooled ? lift / sePooled : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  // Unpooled SE for the confidence interval around the observed lift.
  const seUnpooled = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2) || 0;
  const ciLow = lift - zStar * seUnpooled;
  const ciHigh = lift + zStar * seUnpooled;
  return { p1, p2, lift, z, pValue, ciLow, ciHigh, significant: ciLow > 0 };
}

// Full incrementality picture for one experiment at a given confidence level.
export function analyzeExperiment(exp, conf = 95) {
  const zStar = CONFIDENCE[conf].z;
  const test = proportionTest(exp.treatment, exp.control, zStar);
  const aov = exp.treatment.conversions ? exp.revenue / exp.treatment.conversions : 0;

  const baselineConversions = test.p2 * exp.treatment.users; // what treated users would have done anyway
  const incrementalConversions = exp.treatment.conversions - baselineConversions;
  const incrementalityPct = exp.treatment.conversions ? incrementalConversions / exp.treatment.conversions : 0;

  const incrementalRevenue = incrementalConversions * aov;
  const reportedRoas = exp.spend ? exp.revenue / exp.spend : 0;
  const incrementalRoas = exp.spend ? incrementalRevenue / exp.spend : 0;
  // Cost per truly-incremental conversion (vs the reported CPA).
  const reportedCpa = exp.treatment.conversions ? exp.spend / exp.treatment.conversions : 0;
  const incrementalCpa = incrementalConversions > 0 ? exp.spend / incrementalConversions : Infinity;

  // CI on incremental conversions (rescale the rate CI over treated users).
  const incLow = test.ciLow * exp.treatment.users;
  const incHigh = test.ciHigh * exp.treatment.users;
  // Best-case incrementality still allowed by the interval — separates a
  // well-powered null (bounded near zero) from a genuinely underpowered test.
  const incHighPct = exp.treatment.conversions ? incHigh / exp.treatment.conversions : 0;

  let verdict;
  if (!test.significant) {
    // Underpowered (the CI still admits a real effect) vs a confident null.
    verdict = incHighPct >= 0.35 ? "inconclusive" : "no-lift";
  } else if (incrementalityPct < 0.35) {
    verdict = "harvesting"; // real but small — mostly demand it would have won anyway
  } else {
    verdict = "incremental";
  }

  return {
    id: exp.id, channel: exp.channel, source: exp.source, note: exp.note,
    spend: exp.spend, revenue: exp.revenue, aov: round(aov),
    treatment: exp.treatment, control: exp.control,
    treatmentRate: test.p1, controlRate: test.p2,
    lift: test.lift, z: round(test.z, 3), pValue: test.pValue,
    ciLow: test.ciLow, ciHigh: test.ciHigh, significant: test.significant,
    reportedConversions: exp.treatment.conversions,
    baselineConversions: round(baselineConversions, 1),
    incrementalConversions: round(incrementalConversions, 1),
    incLow: round(incLow, 1), incHigh: round(incHigh, 1),
    incrementalityPct,
    reportedRevenue: exp.revenue, incrementalRevenue: round(incrementalRevenue),
    reportedRoas: round(reportedRoas), incrementalRoas: round(incrementalRoas),
    reportedCpa: round(reportedCpa), incrementalCpa: incrementalCpa === Infinity ? Infinity : round(incrementalCpa),
    verdict,
  };
}

export const SORTS = {
  incrementality: (a, b) => b.incrementalityPct - a.incrementalityPct,
  iroas: (a, b) => b.incrementalRoas - a.incrementalRoas,
  spend: (a, b) => b.spend - a.spend,
  gap: (a, b) => (b.reportedRoas - b.incrementalRoas) - (a.reportedRoas - a.incrementalRoas),
};

export const VERDICTS = {
  incremental: { label: "Incremental", cls: "good" },
  harvesting: { label: "Mostly harvesting", cls: "warn" },
  inconclusive: { label: "Inconclusive", cls: "muted" },
  "no-lift": { label: "No measurable lift", cls: "bad" },
};

// Portfolio-level report across all experiments at a chosen confidence + sort.
export function buildReport(experiments, options = {}) {
  const conf = options.conf || 95;
  const sortKey = options.sort || "incrementality";
  const rows = experiments.map((e) => analyzeExperiment(e, conf));
  const sorted = rows.slice().sort(SORTS[sortKey] || SORTS.incrementality);

  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const reportedRevenue = rows.reduce((s, r) => s + r.reportedRevenue, 0);
  const incrementalRevenue = rows.reduce((s, r) => s + r.incrementalRevenue, 0);
  const reportedConversions = rows.reduce((s, r) => s + r.reportedConversions, 0);
  const incrementalConversions = rows.reduce((s, r) => s + r.incrementalConversions, 0);

  const wasted = rows.filter((r) => r.verdict === "no-lift" || r.verdict === "harvesting")
    .reduce((s, r) => s + (r.reportedRevenue - r.incrementalRevenue), 0);

  const metrics = {
    experiments: rows.length,
    spend: round(spend),
    reportedRevenue: round(reportedRevenue),
    incrementalRevenue: round(incrementalRevenue),
    reportedRoas: round(spend ? reportedRevenue / spend : 0),
    incrementalRoas: round(spend ? incrementalRevenue / spend : 0),
    reportedConversions: Math.round(reportedConversions),
    incrementalConversions: round(incrementalConversions, 1),
    incrementalityPct: reportedConversions ? incrementalConversions / reportedConversions : 0,
    overstatementPct: incrementalRevenue ? (reportedRevenue - incrementalRevenue) / incrementalRevenue : 0,
    inconclusive: rows.filter((r) => r.verdict === "inconclusive").length,
    notIncremental: rows.filter((r) => r.verdict === "no-lift" || r.verdict === "harvesting").length,
    wastedSpendRevenue: round(wasted),
    confidence: CONFIDENCE[conf].label,
  };

  return { rows, sorted, metrics, conf, sort: sortKey };
}
