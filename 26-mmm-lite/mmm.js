// Marketing mix model (lite) core. Dependency-free ES module, imported by the
// browser UI (app.js) and the Node smoke test (tests/mmm.test.mjs). No DOM, no
// network, no PII.
//
// MMM answers the question attribution can't: of all the sales that happened, how
// many did marketing actually cause — and how much was just going to happen anyway
// (the base)? It regresses weekly sales on spend, but with two transforms that
// make ad spend behave like ad spend: ADSTOCK (effect carries over and decays, so
// last week's spend still sells this week) and SATURATION (diminishing returns, so
// the tenth euro does less than the first). This fits both from the data by grid-
// searching carryover and solving least squares, decomposes sales into base +
// channels, and derives each channel's ROI and response curve. Deterministic.
//
// It is a CORRELATIONAL model: it fits history, it doesn't prove causation. The
// honest use is to validate its contributions against holdout experiments (case
// 22) — the tool says so, loudly.

const round = (n, p = 0) => { const f = 10 ** p; return Math.round(n * f) / f; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sum = (a) => a.reduce((s, v) => s + v, 0);

// Geometric adstock: a[t] = x[t] + θ·a[t-1].
export function adstock(x, theta) {
  const out = new Array(x.length);
  let carry = 0;
  for (let t = 0; t < x.length; t++) { carry = x[t] + theta * carry; out[t] = carry; }
  return out;
}
export const saturate = (x, k) => 1 - Math.exp(-x / k);

// Solve (X'X) b = X'y by Gaussian elimination with partial pivoting.
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
  // Augment and eliminate.
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

function rSquared(y, yhat) {
  const ybar = mean(y);
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < y.length; i++) { ssRes += (y[i] - yhat[i]) ** 2; ssTot += (y[i] - ybar) ** 2; }
  return ssTot ? 1 - ssRes / ssTot : 0;
}

export const MODELS = {
  full: { label: "Full (adstock + saturation)", adstock: true, saturation: true },
  no_adstock: { label: "No adstock", adstock: false, saturation: true },
  no_saturation: { label: "No saturation", adstock: true, saturation: false },
  naive: { label: "Naive (raw spend)", adstock: false, saturation: false },
};

const THETA_GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];

// Build a channel's transformed regressor for a given θ under a model spec.
function transform(spend, theta, spec) {
  const a = spec.adstock ? adstock(spend, theta) : spend.slice();
  if (!spec.saturation) return a;
  const k = 2 * mean(spend);
  return a.map((v) => saturate(v, k));
}

// Base design columns: intercept, linear trend, and an annual sin/cos pair so the
// organic seasonality is captured by the base — not wrongly absorbed by channels.
const BASE_P = 4;
function baseCols(n) {
  const trend = [], sin = [], cos = [];
  for (let t = 0; t < n; t++) {
    trend.push(t / n);
    sin.push(Math.sin((2 * Math.PI * t) / 52));
    cos.push(Math.cos((2 * Math.PI * t) / 52));
  }
  return { trend, sin, cos };
}

// Fit the model: grid-search θ per channel jointly, OLS on [base cols, channels].
export function fit(series, modelKey = "full") {
  const spec = MODELS[modelKey] || MODELS.full;
  const n = series.weeks;
  const { trend, sin, cos } = baseCols(n);

  // Precompute each channel's transform for every θ on the grid.
  const thetas = spec.adstock ? THETA_GRID : [0];
  const pre = series.channels.map((c) => Object.fromEntries(thetas.map((th) => [th, transform(c.spend, th, spec)])));

  // Joint grid search over θ combinations (cartesian product).
  let best = null;
  const nCh = series.channels.length;
  const idx = new Array(nCh).fill(0);
  const total = thetas.length ** nCh;
  for (let step = 0; step < total; step++) {
    // decode step -> per-channel theta index
    let s = step;
    for (let c = 0; c < nCh; c++) { idx[c] = s % thetas.length; s = Math.floor(s / thetas.length); }
    const cols = series.channels.map((c, ci) => pre[ci][thetas[idx[ci]]]);
    const X = [];
    for (let t = 0; t < n; t++) X.push([1, trend[t], sin[t], cos[t], ...cols.map((col) => col[t])]);
    const b = ols(X, series.sales);
    const yhat = X.map((row) => row.reduce((s2, v, j) => s2 + v * b[j], 0));
    const r2 = rSquared(series.sales, yhat);
    // Prefer positive channel coefficients (a well-identified fit); penalise negatives.
    const negPenalty = b.slice(BASE_P).filter((v) => v < 0).length * 0.05;
    const score = r2 - negPenalty;
    if (!best || score > best.score) best = { score, r2, b, thetas: idx.map((i) => thetas[i]), cols, yhat };
    if (thetas.length === 1) break; // no adstock: single combo
  }
  return { spec, modelKey, best, trend, sin, cos, n };
}

// Decompose sales into base + per-channel contribution, plus ROI + response curve.
export function decompose(series, modelKey = "full") {
  const f = fit(series, modelKey);
  const { b, cols, thetas, yhat, r2 } = f.best;
  const n = f.n;

  // Base = intercept + trend + annual seasonality.
  const baseSeries = f.trend.map((tr, t) => b[0] + b[1] * tr + b[2] * f.sin[t] + b[3] * f.cos[t]);
  const channels = series.channels.map((c, ci) => {
    const beta = b[4 + ci];
    const contribution = cols[ci].map((v) => beta * v);
    const totalContribution = sum(contribution);
    const totalSpend = sum(c.spend);
    return {
      id: c.id, channel: c.channel, source: c.source,
      theta: thetas[ci], beta: round(beta),
      contribution, totalContribution: round(totalContribution),
      totalSpend: round(totalSpend), meanSpend: round(mean(c.spend)),
      roi: totalSpend ? round(totalContribution / totalSpend, 2) : 0,
      carryover: round(thetas[ci] / (1 - thetas[ci] + 1e-9), 2), // total effect multiplier − 1
    };
  });

  const totalSales = sum(series.sales);
  const baseTotal = sum(baseSeries);
  const marketingTotal = channels.reduce((s, c) => s + Math.max(c.totalContribution, 0), 0);
  const predictedTotal = baseTotal + channels.reduce((s, c) => s + c.totalContribution, 0);

  const parts = [
    { id: "base", label: "Base (organic)", total: round(baseTotal), isBase: true },
    ...channels.map((c) => ({ id: c.id, label: c.channel, total: c.totalContribution, roi: c.roi, theta: c.theta })),
  ];

  const metrics = {
    weeks: n,
    totalSales: round(totalSales),
    predictedTotal: round(predictedTotal),
    r2: round(r2, 3),
    baseShare: predictedTotal ? baseTotal / predictedTotal : 0,
    marketingShare: predictedTotal ? channels.reduce((s, c) => s + c.totalContribution, 0) / predictedTotal : 0,
    totalSpend: round(channels.reduce((s, c) => s + c.totalSpend, 0)),
    blendedRoi: (() => { const sp = channels.reduce((s, c) => s + c.totalSpend, 0); return sp ? round(marketingTotal / sp, 2) : 0; })(),
    modelLabel: MODELS[modelKey].label,
  };

  return { channels, baseSeries, parts, actual: series.sales, predicted: yhat, metrics, modelKey };
}

export const SORTS = {
  contribution: (a, b) => b.totalContribution - a.totalContribution,
  roi: (a, b) => b.roi - a.roi,
  spend: (a, b) => b.totalSpend - a.totalSpend,
  carryover: (a, b) => b.theta - a.theta,
};

// Steady-state response curve for one channel: contribution vs weekly spend.
export function responseCurve(channel, series, points = 40) {
  const raw = series.channels.find((c) => c.id === channel.id).spend;
  const k = 2 * mean(raw);
  const theta = channel.theta;
  const maxS = Math.max(...raw) * 1.4;
  const pts = [];
  for (let i = 0; i <= points; i++) {
    const s = (i / points) * maxS;
    const steady = theta < 1 ? s / (1 - theta) : s; // steady-state adstock
    const contribution = channel.beta * saturate(steady, k);
    pts.push({ spend: round(s), contribution: round(contribution) });
  }
  return { points: pts, maxS: round(maxS), meanSpend: channel.meanSpend, k: round(k) };
}
