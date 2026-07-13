// UI for the Revenue Demand Forecast. All logic lives in forecast.js.
import { SERIES } from "./series.js";
import { buildReport } from "./forecast.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => (x < 0 ? "−€" : "€") + Math.abs(Math.round(Number(x))).toLocaleString("en-US");
const eurK = (x) => (Math.abs(x) >= 1000 ? (x < 0 ? "−€" : "€") + (Math.abs(x) / 1000).toFixed(Math.abs(x) >= 1000000 ? 2 : 0) + (Math.abs(x) >= 1000000 ? "M" : "k") : eur(x));
const pctS = (x, d = 1) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";

let options = { horizon: 12, seasonality: true, interval: 80 };

function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  render();
}

function setControl(control, value, seg, btn) {
  if (control === "horizon" || control === "interval") options[control] = Number(value);
  else if (control === "seasonality") options.seasonality = value === "on";
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  const rep = buildReport(SERIES, options);
  const m = rep.metrics;
  $("fileInfo").innerHTML = `<strong>${m.historyMonths}</strong> months history · last 12 <strong>${eur(m.last12)}</strong> · forecast next 12 <strong>${eur(m.next12)}</strong> (<strong>${pctS(m.fcYoY)}</strong> YoY) · backtest MAPE <strong>${pct(m.mape, 1)}</strong> <span style="color:var(--muted)">(series.js)</span>`;
  renderMetrics(m);
  renderChart(rep);
  renderSeasonal(rep);
  renderBacktest(rep);
  renderTable(rep);
  renderInsight(rep);
}

function renderMetrics(m) {
  const cards = [
    ["History", m.historyMonths + " mo", ""],
    ["Last 12mo revenue", eurK(m.last12), ""],
    ["Forecast next 12mo", eurK(m.next12), "good"],
    ["Forecast YoY", pctS(m.fcYoY), m.fcYoY >= 0 ? "good" : "bad"],
    ["Monthly growth", pctS(m.monthlyGrowth, 2), "accent"],
    ["Backtest MAPE", pct(m.mape, 1), m.mape < 0.1 ? "good" : m.mape < 0.2 ? "warn" : "bad"],
    ["Interval coverage", pct(m.coverage), m.coverage >= 0.75 ? "good" : "warn", true],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls, sm]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd class="${sm ? "sm" : ""}">${esc(String(v))}</dd></div>`).join("");
}

function renderChart(rep) {
  const W = 1080, H = 300, padL = 60, padR = 16, padT = 12, padB = 26;
  const hist = rep.history, fc = rep.forecast.points;
  const nTotal = hist.length + fc.length;
  const allVals = [...hist.map((p) => p.revenue), ...fc.map((p) => p.upper)];
  const maxY = Math.max(...allVals) * 1.05, minY = 0;
  const x = (i) => padL + (i / (nTotal - 1)) * (W - padL - padR);
  const y = (v) => H - padB - ((v - minY) / (maxY - minY || 1)) * (H - padT - padB);
  const fitted = rep.model.fitted;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = minY + f * (maxY - minY); return `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="#2a3949" stroke-width="1"/><text x="${padL - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="10">${eurK(v)}</text>`; }).join("");

  const histPath = hist.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.revenue).toFixed(1)}`).join(" ");
  const fitPath = fitted.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  // Forecast band polygon (upper then lower reversed), anchored at last actual.
  const bi = hist.length - 1;
  const upper = [[x(bi), y(hist[bi].revenue)], ...fc.map((p, i) => [x(hist.length + i), y(p.upper)])];
  const lower = [...fc.map((p, i) => [x(hist.length + i), y(p.lower)]).reverse(), [x(bi), y(hist[bi].revenue)]];
  const band = [...upper, ...lower].map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ") + " Z";
  const fcLine = [[x(bi), y(hist[bi].revenue)], ...fc.map((p, i) => [x(hist.length + i), y(p.point)])]
    .map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const divX = x(bi);

  // sparse x labels
  const labelEvery = Math.ceil(nTotal / 8);
  const labels = [];
  for (let i = 0; i < nTotal; i += labelEvery) {
    const p = i < hist.length ? hist[i] : fc[i - hist.length];
    labels.push(`<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="var(--muted)" font-size="9">${p.label}</text>`);
  }

  $("chart").innerHTML = `${grid}
    <path d="${band}" fill="rgba(79,156,249,.18)" stroke="none"/>
    <line x1="${divX.toFixed(1)}" y1="${padT}" x2="${divX.toFixed(1)}" y2="${H - padB}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3"/>
    <text x="${(divX + 4).toFixed(1)}" y="${padT + 10}" fill="var(--muted)" font-size="9">forecast →</text>
    <path d="${fitPath}" fill="none" stroke="var(--border)" stroke-width="1.5"/>
    <path d="${histPath}" fill="none" stroke="var(--muted)" stroke-width="2"/>
    <path d="${fcLine}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    ${labels.join("")}`;
}

function renderSeasonal(rep) {
  const idx = rep.indices, labels = rep.monthLabels;
  const maxDev = Math.max(...idx.map((v) => Math.abs(v - 1)), 0.1);
  $("seasonal").innerHTML = idx.map((v, i) => {
    const dev = v - 1, w = (Math.abs(dev) / maxDev) * 48;
    const cls = dev >= 0 ? "up" : "down";
    return `<div class="sea-row">
      <span class="sea-lab">${labels[i]}</span>
      <span class="sea-track"><span class="sea-mid"></span><span class="sea-fill ${cls}" style="width:${w}%"></span></span>
      <span class="sea-val" style="color:${dev >= 0.02 ? "var(--good)" : dev <= -0.02 ? "var(--warn)" : "var(--muted)"}">${v.toFixed(2)}×</span>
    </div>`;
  }).join("");
}

function renderBacktest(rep) {
  const bt = rep.backtest;
  const W = 500, H = 170, padL = 46, padR = 12, padT = 10, padB = 22;
  const rows = bt.rows;
  const vals = rows.flatMap((r) => [r.actual, r.upper, r.lower]);
  const maxY = Math.max(...vals) * 1.05, minY = Math.min(...vals) * 0.9;
  const x = (i) => padL + (i / (rows.length - 1)) * (W - padL - padR);
  const y = (v) => H - padB - ((v - minY) / (maxY - minY || 1)) * (H - padT - padB);
  const band = [...rows.map((r, i) => [x(i), y(r.upper)]), ...rows.map((r, i) => [x(i), y(r.lower)]).reverse()]
    .map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ") + " Z";
  const line = (key, color, w) => `<path d="${rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
  const dots = rows.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r.actual).toFixed(1)}" r="2.5" fill="${r.covered ? "var(--good)" : "var(--bad)"}"/>`).join("");
  $("backtest").innerHTML = `
    <path d="${band}" fill="rgba(79,156,249,.15)" stroke="none"/>
    ${line("point", "var(--accent)", 2)}
    ${line("actual", "var(--muted)", 1.5)}
    ${dots}
    <text x="${padL}" y="${H - 6}" fill="var(--muted)" font-size="9">${esc(rows[0].label)}</text>
    <text x="${(W - padR).toFixed(1)}" y="${H - 6}" text-anchor="end" fill="var(--muted)" font-size="9">${esc(rows[rows.length - 1].label)}</text>`;

  $("btKv").innerHTML = `
    <dt>MAPE (avg % error)</dt><dd style="color:${bt.mape < 0.1 ? "var(--good)" : "var(--warn)"}">${pct(bt.mape, 1)}</dd>
    <dt>Interval coverage</dt><dd>${pct(bt.coverage)} <span style="color:var(--muted)">(target ${bt.interval}%)</span></dd>
    <dt>Held-out months</dt><dd>${bt.holdout}</dd>`;
  const good = bt.mape < 0.1 && bt.coverage >= 0.7;
  $("btCallout").innerHTML = `<div class="callout ${good ? "good" : "warn"}">${good
    ? `<b>Calibrated.</b> On months it never saw, the forecast was off by <b>${pct(bt.mape, 1)}</b> on average and the interval caught <b>${pct(bt.coverage)}</b> of actuals — trust the range.`
    : `<b>Read with care.</b> MAPE is <b>${pct(bt.mape, 1)}</b> and the interval covered <b>${pct(bt.coverage)}</b> of actuals${rep.metrics.seasonality ? "" : " — turning seasonality on usually helps"}. Widen the interval or shorten the horizon before planning on it.`}</div>`;
}

function renderTable(rep) {
  const fc = rep.forecast.points;
  $("table").innerHTML = `<thead><tr>
      <th>Month</th><th>Forecast</th><th>Low (${rep.metrics.interval}%)</th><th>High (${rep.metrics.interval}%)</th><th>± range</th>
    </tr></thead><tbody>${fc.map((p) => {
    const rng = (p.upper - p.lower) / 2 / p.point;
    return `<tr>
      <td>${esc(p.label)}</td>
      <td style="font-weight:700">${eur(p.point)}</td>
      <td style="color:var(--muted)">${eur(p.lower)}</td>
      <td style="color:var(--muted)">${eur(p.upper)}</td>
      <td>±${pct(rng)}</td>
    </tr>`;
  }).join("")}</tbody>`;
}

function renderInsight(rep) {
  const m = rep.metrics;
  const fc = rep.forecast.points;
  const wideningStart = (fc[0].upper - fc[0].lower) / 2 / fc[0].point;
  const wideningEnd = (fc[fc.length - 1].upper - fc[fc.length - 1].lower) / 2 / fc[fc.length - 1].point;
  const noSeason = buildReport(SERIES, { ...options, seasonality: false });

  $("insight").innerHTML = `
    <p>Revenue is growing about <b>${pctS(m.monthlyGrowth, 2)}</b> a month; the next 12 months forecast to <b>${eur(m.next12)}</b>, up <b>${pctS(m.fcYoY)}</b> on the trailing year. But the honest headline is the range: next month is ±<b>${pct(wideningStart)}</b>, ${m.horizon} months out it's ±<b>${pct(wideningEnd)}</b> — plan the near term tightly and the far term loosely.</p>
    <p>Seasonality is the swing that averages hide: <b>${m.peakMonth}</b> runs <b>${m.peakIndex}×</b> the mean while <b>${m.troughMonth}</b> is <b>${m.troughIndex}×</b> — inventory and cash planning live in that gap, not the annual total. The model is worth trusting only because it backtests: <b>${pct(m.mape, 1)}</b> average error and <b>${pct(m.coverage)}</b> interval coverage on unseen months${m.seasonality ? `, versus ${pct(noSeason.metrics.mape, 1)} MAPE with seasonality switched off` : ""}. A forecast is a claim about uncertainty — this one shows its work, and it's still just a trend extrapolation: a promo, a stock-out, or a demand shock lives outside these bands.</p>`;
}

init();
