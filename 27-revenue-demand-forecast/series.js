// Monthly revenue history for the fictional Northstar Outfitters store.
// Invented, deterministic — no real revenue or PII.
//
// Generated from a KNOWN process so the forecaster can be graded against truth:
// an exponential trend (steady monthly growth) times a multiplicative annual
// seasonality (Q4 gifting + winter-gear peak, summer dip) plus a little
// deterministic noise. forecast.js never sees these params — it re-estimates
// trend and seasonality from the revenue series alone. GROUND_TRUTH is exported
// only so the smoke test can check the fit recovers them.

const START_YEAR = 2024;
const MONTHS = 36; // Jan 2024 … Dec 2026

// Multiplicative seasonal factors by calendar month (Jan=0 … Dec=11).
const SEASONAL = [0.85, 0.80, 0.90, 1.00, 1.05, 1.00, 0.85, 0.85, 1.05, 1.15, 1.45, 1.55];
const BASE = 42000;      // level at t=0
const GROWTH = 0.015;    // 1.5% month-over-month trend

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (1103515245 * s + 12345) >>> 0; return s / 4294967296; };
}

const rand = lcg(4242);
const points = [];
for (let t = 0; t < MONTHS; t++) {
  const month = t % 12;
  const year = START_YEAR + Math.floor(t / 12);
  const trend = BASE * Math.pow(1 + GROWTH, t);
  const noise = 1 + (rand() - 0.5) * 0.08; // ±4%
  const revenue = Math.round(trend * SEASONAL[month] * noise);
  points.push({ t, label: `${year}-${String(month + 1).padStart(2, "0")}`, year, month, revenue });
}

export const SERIES = {
  startYear: START_YEAR,
  months: MONTHS,
  points,
};

export const GROUND_TRUTH = {
  growth: GROWTH,
  seasonal: SEASONAL.slice(),
  // Normalised seasonal shape (mean 1) for comparison with recovered indices.
  seasonalNorm: (() => { const m = SEASONAL.reduce((a, b) => a + b, 0) / 12; return SEASONAL.map((v) => v / m); })(),
};
