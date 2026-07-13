// Revenue demand forecast core. Dependency-free ES module, imported by the
// browser UI (app.js) and the Node smoke test (tests/forecast.test.mjs). No DOM,
// no network, no PII.
//
// A forecast without an interval is a guess wearing a suit. This fits a
// log-linear trend plus monthly seasonal effects by least squares, projects
// revenue forward, and — the part most dashboards skip — attaches prediction
// intervals that WIDEN with the horizon, because you know next month better than
// next year. It backtests on held-out months (MAPE + interval coverage) so the
// uncertainty is calibrated, not decorative, and it's honest about what a
// short history and a trend extrapolation can and can't promise. Deterministic.

const round = (n, p = 0) => { const f = 10 ** p; return Math.round(n * f) / f; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

export const Z = { 80: 1.281552, 95: 1.959964 };

// Solve (X'X)b = X'y via Gaussian elimination with partial pivoting.
export function ols(X, y) {
  const n = X.length, p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  const M = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-9;
    for (let c = col; c <= p; c++) M[col][c] /= d;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= p; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[p]);
}

// Design row for absolute month index t (calendar month = t % 12).
// [intercept, trend, 11 month dummies (Feb..Dec; Jan is the reference)].
function designRow(t, seasonality) {
  const row = [1, t];
  if (seasonality) {
    const m = ((t % 12) + 12) % 12;
    for (let j = 1; j < 12; j++) row.push(m === j ? 1 : 0);
  }
  return row;
}

// Fit log(revenue) ~ trend + seasonal on a set of points.
export function fitModel(points, seasonality = true) {
  const X = points.map((p) => designRow(p.t, seasonality));
  const y = points.map((p) => Math.log(p.revenue));
  const b = ols(X, y);
  const fittedLog = X.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));
  const resid = y.map((v, i) => v - fittedLog[i]);
  const p = X[0].length;
  const dof = Math.max(points.length - p, 1);
  const sigma = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / dof); // residual SD in log space
  const fitted = fittedLog.map((v) => Math.exp(v));
  // R² on the original scale.
  const ybar = mean(points.map((pt) => pt.revenue));
  let ssr = 0, sst = 0;
  points.forEach((pt, i) => { ssr += (pt.revenue - fitted[i]) ** 2; sst += (pt.revenue - ybar) ** 2; });
  return { b, seasonality, sigma, fitted, r2: sst ? 1 - ssr / sst : 0, growth: Math.exp(b[1]) - 1, n: points.length };
}

// Multiplicative seasonal indices (mean 1) recovered from the fit.
export function seasonalIndices(model) {
  if (!model.seasonality) return new Array(12).fill(1);
  const eff = [0]; // Jan reference = 0 in log space
  for (let j = 1; j < 12; j++) eff.push(model.b[2 + (j - 1)]);
  const mult = eff.map((e) => Math.exp(e));
  const avg = mean(mult);
  return mult.map((m) => m / avg);
}

// Forecast `horizon` months past the history, with prediction intervals.
export function forecast(points, { horizon = 12, seasonality = true, interval = 80 } = {}) {
  const model = fitModel(points, seasonality);
  const z = Z[interval] || Z[80];
  const lastT = points[points.length - 1].t;
  const startYear = points[0].year - Math.floor(points[0].t / 12); // year at t=0
  const out = [];
  for (let h = 1; h <= horizon; h++) {
    const t = lastT + h;
    const row = designRow(t, seasonality);
    const logHat = row.reduce((s, v, j) => s + v * model.b[j], 0);
    // Intervals widen with horizon (parameter + extrapolation uncertainty).
    const sigmaH = model.sigma * Math.sqrt(1 + h * 0.1);
    const point = Math.exp(logHat);
    const lower = Math.exp(logHat - z * sigmaH);
    const upper = Math.exp(logHat + z * sigmaH);
    const month = ((t % 12) + 12) % 12;
    const year = startYear + Math.floor(t / 12);
    out.push({ t, h, label: `${year}-${String(month + 1).padStart(2, "0")}`, month, year,
      point: round(point), lower: round(lower), upper: round(upper) });
  }
  return { model, points: out, interval };
}

// Backtest: hold out the last `holdout` months, forecast them, score accuracy.
export function backtest(points, { holdout = 12, seasonality = true, interval = 80 } = {}) {
  const train = points.slice(0, points.length - holdout);
  const test = points.slice(points.length - holdout);
  if (!train.length || !test.length) return null;
  const fc = forecast(train, { horizon: holdout, seasonality, interval });
  const rows = test.map((actual, i) => {
    const p = fc.points[i];
    const ape = Math.abs(actual.revenue - p.point) / actual.revenue;
    const covered = actual.revenue >= p.lower && actual.revenue <= p.upper;
    return { label: actual.label, actual: actual.revenue, point: p.point, lower: p.lower, upper: p.upper, ape, covered };
  });
  const mape = mean(rows.map((r) => r.ape));
  const rmse = Math.sqrt(mean(rows.map((r) => (r.actual - r.point) ** 2)));
  const coverage = rows.filter((r) => r.covered).length / rows.length;
  return { rows, mape: round(mape, 4), rmse: round(rmse), coverage: round(coverage, 3), interval, holdout };
}

// Everything the UI needs in one call.
export function buildReport(series, options = {}) {
  const opts = { horizon: 12, seasonality: true, interval: 80, ...options };
  const model = fitModel(series.points, opts.seasonality);
  const fc = forecast(series.points, opts);
  const bt = backtest(series.points, { holdout: 12, seasonality: opts.seasonality, interval: opts.interval });
  const indices = seasonalIndices(model);

  const last12 = series.points.slice(-12).reduce((s, p) => s + p.revenue, 0);
  const prev12 = series.points.slice(-24, -12).reduce((s, p) => s + p.revenue, 0);
  const next12 = fc.points.slice(0, 12).reduce((s, p) => s + p.point, 0);
  const peakMonthIdx = indices.indexOf(Math.max(...indices));
  const troughMonthIdx = indices.indexOf(Math.min(...indices));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const metrics = {
    historyMonths: series.points.length,
    last12, next12,
    histYoY: prev12 ? (last12 - prev12) / prev12 : 0,
    fcYoY: last12 ? (next12 - last12) / last12 : 0,
    monthlyGrowth: model.growth,
    r2: round(model.r2, 3),
    mape: bt ? bt.mape : null,
    coverage: bt ? bt.coverage : null,
    horizonValue: fc.points[fc.points.length - 1]?.point || 0,
    horizonLabel: fc.points[fc.points.length - 1]?.label || "",
    peakMonth: MONTHS[peakMonthIdx], peakIndex: round(indices[peakMonthIdx], 2),
    troughMonth: MONTHS[troughMonthIdx], troughIndex: round(indices[troughMonthIdx], 2),
    seasonality: opts.seasonality, interval: opts.interval, horizon: opts.horizon,
  };

  return { model, forecast: fc, backtest: bt, indices, monthLabels: MONTHS, history: series.points, metrics, options: opts };
}
