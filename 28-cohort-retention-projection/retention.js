// Cohort retention & LTV projection core. Dependency-free ES module, imported by
// the browser UI (app.js) and the Node smoke test (tests/retention.test.mjs). No
// DOM, no network, no PII.
//
// Realised LTV (case 24) only counts money already banked, so it always
// understates a young cohort — most of its value is still in the future. This
// fits a retention curve to the cohort triangle, projects each cohort forward to a
// chosen horizon, and reports PROJECTED LTV: what a customer is worth once the tail
// is included. It keeps realised and projected side by side (so you see how much is
// a forecast, not a fact), and surfaces whether newer cohorts are retaining better
// or worse — the single most important leading indicator of growth quality.
// Deterministic.

const round = (n, p = 0) => { const f = 10 ** p; return Math.round(n * f) / f; };
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

// Simple 2-var OLS: y = a + b·x.
function linreg(xs, ys) {
  const n = xs.length, mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxx ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

// Fit a power-law retention curve r(age) = A·age^(-b) from pooled cohort data
// (age ≥ 1). Age 0 is 1 by definition. Weighted by cohort size.
export function fitRetention(cohorts) {
  const xs = [], ys = [];
  for (const c of cohorts) {
    for (const o of c.observed) {
      if (o.age >= 1 && o.activePct > 0) {
        const w = Math.round(c.size / 10); // weight larger cohorts more
        for (let k = 0; k < Math.max(w, 1); k++) { xs.push(Math.log(o.age)); ys.push(Math.log(o.activePct)); }
      }
    }
  }
  const { a, b } = linreg(xs, ys); // log r = a + b·log age
  const A = Math.exp(a), decay = -b;
  const r = (age) => (age === 0 ? 1 : Math.min(1, A * Math.pow(age, -decay)));
  // R² on the pooled log fit.
  const yhat = xs.map((x) => a + b * x);
  const ybar = mean(ys);
  let ssr = 0, sst = 0;
  ys.forEach((y, i) => { ssr += (y - yhat[i]) ** 2; sst += (y - ybar) ** 2; });
  return { A: round(A, 3), decay: round(decay, 3), r, r2: sst ? round(1 - ssr / sst, 3) : 0 };
}

// Project one cohort to `horizon` months: observed retention where we have it, the
// fitted curve beyond. Returns realised (to-date) and projected (full-horizon) LTV.
export function projectCohort(cohort, curve, { horizon = 24, margin = 0.45, basis = "contribution" } = {}) {
  const mult = basis === "revenue" ? 1 : margin;
  const revPerActive = mean(cohort.observed.filter((o) => o.age >= 1).map((o) => o.revPerActive)) || 85;
  const observedMax = cohort.observedMonths;

  const series = [];
  let realised = 0, projected = 0;
  for (let age = 0; age <= horizon; age++) {
    const observed = age <= observedMax ? cohort.observed[age] : null;
    const ret = observed ? observed.activePct : curve.r(age);
    const perCustRev = age === 0 ? 0 : ret * revPerActive; // month 0 = acquisition, no repeat rev
    const value = perCustRev * mult;
    projected += value;
    if (age <= observedMax) realised += value;
    series.push({ age, retention: round(ret, 3), isProjected: age > observedMax, cumulative: round(projected) });
  }
  const retAt = (m) => (m <= observedMax ? cohort.observed[m]?.activePct : curve.r(m));
  return {
    id: cohort.id, label: cohort.label, size: cohort.size, observedMonths: observedMax,
    revPerActive: round(revPerActive),
    realisedLtv: round(realised), projectedLtv: round(projected),
    toCome: round(projected - realised), toComePct: projected ? round((projected - realised) / projected, 3) : 0,
    retM1: round(retAt(1) || 0, 3), retM3: round(retAt(3) || 0, 3), retM12: round(retAt(12) || 0, 3),
    series,
  };
}

export const SORTS = {
  projected: (a, b) => b.projectedLtv - a.projectedLtv,
  retention: (a, b) => b.retM3 - a.retM3,
  age: (a, b) => b.observedMonths - a.observedMonths,
  size: (a, b) => b.size - a.size,
};

// Pooled retention curve samples (observed average + fitted + projected) for charts.
export function curveSamples(cohorts, curve, horizon) {
  const byAge = {};
  for (const c of cohorts) for (const o of c.observed) if (o.age >= 1) (byAge[o.age] || (byAge[o.age] = [])).push(o.activePct);
  const out = [];
  for (let age = 0; age <= horizon; age++) {
    const obs = age === 0 ? 1 : (byAge[age] ? mean(byAge[age]) : null);
    out.push({ age, observed: obs != null ? round(obs, 3) : null, fitted: round(curve.r(age), 3) });
  }
  return out;
}

export function buildReport(cohorts, options = {}) {
  const opts = { horizon: 24, margin: 0.45, basis: "contribution", sort: "age", ...options };
  const curve = fitRetention(cohorts);
  const rows = cohorts.map((c) => projectCohort(c, curve, opts));
  const sorted = rows.slice().sort(SORTS[opts.sort] || SORTS.age);

  const totalCustomers = cohorts.reduce((s, c) => s + c.size, 0);
  const wMean = (key) => rows.reduce((s, r) => s + r[key] * r.size, 0) / (totalCustomers || 1);

  // Cohort-quality trend: projected LTV of the 3 newest vs 3 oldest cohorts.
  const byAgeDesc = rows.slice().sort((a, b) => b.observedMonths - a.observedMonths);
  const oldest = byAgeDesc.slice(0, 3), newest = byAgeDesc.slice(-3);
  const oldLtv = mean(oldest.map((r) => r.projectedLtv)), newLtv = mean(newest.map((r) => r.projectedLtv));

  // The sharper, actually-observable signal: month-1 retention across cohorts that
  // have reached month 1 (projected LTV converges to the pooled tail for the young).
  const observedM1 = rows.filter((r) => r.observedMonths >= 1);
  const oldM1 = mean(observedM1.slice(0, 3).map((r) => r.retM1));
  const newM1 = mean(observedM1.slice(-3).map((r) => r.retM1));
  const earlyRetTrend = oldM1 ? round((newM1 - oldM1) / oldM1, 3) : 0;

  const metrics = {
    cohorts: rows.length,
    customers: totalCustomers,
    horizon: opts.horizon, basis: opts.basis,
    avgRealisedLtv: round(wMean("realisedLtv")),
    avgProjectedLtv: round(wMean("projectedLtv")),
    toComePct: (() => { const p = wMean("projectedLtv"), r = wMean("realisedLtv"); return p ? round((p - r) / p, 3) : 0; })(),
    retM1: round(curve.r(1), 3), retM12: round(curve.r(12), 3),
    curveA: curve.A, curveDecay: curve.decay, curveR2: curve.r2,
    qualityTrend: oldLtv ? round((newLtv - oldLtv) / oldLtv, 3) : 0,
    newLtv: round(newLtv), oldLtv: round(oldLtv),
    earlyRetTrend, oldM1: round(oldM1, 3), newM1: round(newM1, 3),
  };

  return { curve, rows, sorted, samples: curveSamples(cohorts, curve, opts.horizon), metrics, options: opts };
}
