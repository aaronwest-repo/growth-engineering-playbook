// Smoke test for the revenue demand forecast core. Pure Node, no deps.
// Run: node tests/forecast.test.mjs   (exits non-zero on any failure)

import { SERIES, GROUND_TRUTH } from "../series.js";
import { ols, fitModel, seasonalIndices, forecast, backtest, buildReport, Z } from "../forecast.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const near = (a, b, eps) => Math.abs(a - b) < eps;

// --- OLS -------------------------------------------------------------------
check("OLS recovers a known linear relationship",
  (() => { const b = ols([[1, 0], [1, 1], [1, 2]], [2, 4, 6]); return near(b[0], 2, 1e-6) && near(b[1], 2, 1e-6); })());

// --- Data ------------------------------------------------------------------
check("series has 36 months of positive revenue", SERIES.points.length === 36 && SERIES.points.every((p) => p.revenue > 0));

// --- Fit recovers the truth ------------------------------------------------
const model = fitModel(SERIES.points, true);
check("full model fits well (high R²)", model.r2 > 0.9, `R²=${model.r2}`);
check("recovered monthly growth is close to the true 1.5%",
  near(model.growth, GROUND_TRUTH.growth, 0.004), `fit=${model.growth} true=${GROUND_TRUTH.growth}`);

const idx = seasonalIndices(model);
check("seasonal indices average to ~1", near(idx.reduce((a, b) => a + b, 0) / 12, 1, 1e-6));
check("December is the seasonal peak, summer is the trough",
  idx[11] === Math.max(...idx) && Math.min(idx[6], idx[7]) < 0.95);
check("recovered seasonal shape tracks the truth",
  idx.every((v, i) => Math.abs(v - GROUND_TRUTH.seasonalNorm[i]) < 0.08), JSON.stringify(idx.map((v) => Math.round(v * 100) / 100)));

// --- Forecast --------------------------------------------------------------
const fc = forecast(SERIES.points, { horizon: 12, seasonality: true, interval: 80 });
check("forecast returns the requested horizon", fc.points.length === 12);
check("forecast starts the month after history ends",
  fc.points[0].t === SERIES.points[SERIES.points.length - 1].t + 1);
check("every point sits inside its own interval", fc.points.every((p) => p.lower <= p.point && p.point <= p.upper));
check("intervals widen with the horizon",
  (() => { const w = (p) => p.upper - p.lower; return w(fc.points[11]) > w(fc.points[0]); })());
check("forecast continues the growth trend (next Dec > last Dec)",
  (() => {
    const lastDec = SERIES.points.filter((p) => p.month === 11).slice(-1)[0].revenue;
    const nextDec = fc.points.find((p) => p.month === 11).point;
    return nextDec > lastDec;
  })());
check("95% intervals are wider than 80% intervals",
  (() => {
    const f95 = forecast(SERIES.points, { horizon: 12, interval: 95 });
    return (f95.points[5].upper - f95.points[5].lower) > (fc.points[5].upper - fc.points[5].lower);
  })());

// --- Seasonality toggle ----------------------------------------------------
const flat = fitModel(SERIES.points, false);
check("dropping seasonality lowers the fit", flat.r2 < model.r2, `flat=${flat.r2} full=${model.r2}`);
check("seasonality-off forecast is flat across months (no seasonal swing)",
  (() => {
    const f = forecast(SERIES.points, { horizon: 12, seasonality: false });
    const ratios = f.points.map((p, i) => (i ? p.point / f.points[i - 1].point : 1));
    return Math.max(...ratios.slice(1)) - Math.min(...ratios.slice(1)) < 0.01; // only trend growth
  })());

// --- Backtest --------------------------------------------------------------
const bt = backtest(SERIES.points, { holdout: 12, seasonality: true, interval: 80 });
check("backtest scores every held-out month", bt.rows.length === 12);
check("backtest MAPE is low on this clean series", bt.mape < 0.1, `MAPE=${bt.mape}`);
check("seasonal model backtests better than flat", bt.mape < backtest(SERIES.points, { holdout: 12, seasonality: false }).mape);
check("interval coverage is a sane fraction", bt.coverage >= 0.5 && bt.coverage <= 1);

// --- Report ----------------------------------------------------------------
const rep = buildReport(SERIES, { horizon: 12, seasonality: true, interval: 80 });
check("report exposes headline metrics",
  rep.metrics.historyMonths === 36 && rep.metrics.next12 > 0 && rep.metrics.peakMonth === "Dec");
check("forecast next-12 shows growth over last-12", rep.metrics.next12 > rep.metrics.last12);
check("horizon control changes the number of forecast points",
  buildReport(SERIES, { horizon: 6 }).forecast.points.length === 6);
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(rep).slice(0, 200000)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll revenue demand forecast checks passed.");
process.exit(failures ? 1 : 0);
