// UI for the MMM-lite tool. All logic lives in mmm.js.
import { SERIES } from "./series.js";
import { decompose, responseCurve, MODELS, SORTS } from "./mmm.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => (x < 0 ? "−€" : "€") + Math.abs(Math.round(Number(x))).toLocaleString("en-US");
const eurK = (x) => (Math.abs(x) >= 1000 ? (x < 0 ? "−€" : "€") + (Math.abs(x) / 1000).toFixed(Math.abs(x) >= 100000 ? 0 : 1) + "k" : eur(x));
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";

const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"];
let options = { model: "full", sort: "contribution" };
let selectedCh = SERIES.channels[0].id;
let currentDec = null;

function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  const sel = $("chSelect");
  sel.innerHTML = SERIES.channels.map((c) => `<option value="${c.id}">${esc(c.channel)}</option>`).join("");
  sel.value = selectedCh;
  sel.addEventListener("change", () => { selectedCh = sel.value; renderCurve(); });
  render();
}

function setControl(control, value, seg, btn) {
  options[control] = value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function colorFor(dec, id) {
  const i = dec.channels.findIndex((c) => c.id === id);
  return i >= 0 ? COLORS[i % COLORS.length] : "var(--cbase)";
}

function render() {
  const dec = decompose(SERIES, options.model);
  currentDec = dec;
  const m = dec.metrics;
  $("fileInfo").innerHTML = `<strong>${m.weeks}</strong> weeks · <strong>${eur(m.totalSales)}</strong> sales · base <strong>${pct(m.baseShare)}</strong> · marketing <strong>${pct(m.marketingShare)}</strong> · model <strong>${m.modelLabel}</strong> · fit R² <strong>${m.r2}</strong> <span style="color:var(--muted)">(series.js)</span>`;
  renderMetrics(m, dec);
  renderDecomp(dec);
  renderFit(dec);
  renderTable(dec);
  if (!dec.channels.some((c) => c.id === selectedCh)) selectedCh = dec.channels[0].id;
  $("chSelect").value = selectedCh;
  renderCurve();
  renderInsight(dec);
}

function renderMetrics(m, dec) {
  const top = dec.channels.slice().sort((a, b) => b.roi - a.roi)[0];
  const cards = [
    ["Period", m.weeks + " wks", ""],
    ["Total sales", eurK(m.totalSales), ""],
    ["Base (organic)", pct(m.baseShare), "warn"],
    ["Marketing-driven", pct(m.marketingShare), "good"],
    ["Model fit R²", m.r2.toFixed(3), m.r2 >= 0.9 ? "good" : m.r2 >= 0.7 ? "warn" : "bad"],
    ["Blended ROAS", m.blendedRoi + "×", m.blendedRoi >= 1 ? "good" : "bad"],
    ["Best ROI channel", top.channel, "accent", true],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls, sm]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd class="${sm ? "sm" : ""}">${esc(String(v))}</dd></div>`).join("");
}

function renderDecomp(dec) {
  const parts = dec.parts.slice().sort((a, b) => (a.isBase ? -1 : b.isBase ? 1 : b.total - a.total));
  const totalPred = dec.metrics.predictedTotal;
  const max = Math.max(...parts.map((p) => p.total), 1);
  $("decomp").innerHTML = parts.map((p) => {
    const w = (Math.max(p.total, 0) / max) * 100;
    const color = p.isBase ? "var(--cbase)" : colorFor(dec, p.id);
    return `<div class="dec-row">
      <span class="dec-lab"><span class="swatch" style="background:${color}"></span>${esc(p.label)}</span>
      <span class="dec-track"><span class="dec-fill" style="width:${w}%;background:${color}"></span></span>
      <span class="dec-val">${eurK(p.total)} <span class="sub">${pct(p.total / totalPred)}${p.roi != null ? ` · ${p.roi}×` : ""}</span></span>
    </div>`;
  }).join("");
}

function renderFit(dec) {
  const W = 1080, H = 260, padL = 56, padR = 14, padT = 12, padB = 24;
  const act = dec.actual, pred = dec.predicted, base = dec.baseSeries;
  const n = act.length;
  const maxY = Math.max(...act, ...pred) * 1.05, minY = 0;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => H - padB - ((v - minY) / (maxY - minY || 1)) * (H - padT - padB);
  const path = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const grid = [0, 0.5, 1].map((f) => { const v = minY + f * (maxY - minY); return `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="#2a3949" stroke-width="1"/><text x="${padL - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="10">${eurK(v)}</text>`; }).join("");
  $("fitSub").innerHTML = `Model <strong>${esc(dec.metrics.modelLabel)}</strong> reconstructs history at <strong>R² ${dec.metrics.r2}</strong>. A high R² means the decomposition is worth reading; a low one means don't.`;
  $("fit").innerHTML = `${grid}
    <path d="${path(base)}" fill="none" stroke="var(--cbase)" stroke-width="1.5" stroke-dasharray="4 3"/>
    <path d="${path(act)}" fill="none" stroke="var(--muted)" stroke-width="1.5"/>
    <path d="${path(pred)}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <text x="${padL}" y="${H - 8}" fill="var(--muted)" font-size="10">week 1</text>
    <text x="${(W - padR).toFixed(1)}" y="${H - 8}" text-anchor="end" fill="var(--muted)" font-size="10">week ${n}</text>`;
}

function renderTable(dec) {
  const sc = (k) => (k === options.sort ? " sorted" : "");
  const rows = dec.channels.slice().sort(SORTS[options.sort] || SORTS.contribution);
  $("table").innerHTML = `<thead><tr>
      <th>Channel</th><th class="${sc("spend").trim()}">Spend</th><th class="${sc("contribution").trim()}">Contribution</th><th>% of sales</th><th class="${sc("roi").trim()}">ROI</th><th class="${sc("carryover").trim()}">Adstock θ</th><th>Carryover</th>
    </tr></thead><tbody>${rows.map((c) => `
      <tr>
        <td class="ch"><span class="swatch" style="background:${colorFor(dec, c.id)}"></span>${esc(c.channel)}<div style="font-size:10.5px;color:var(--muted);font-weight:400;margin-left:15px">${esc(c.source)}</div></td>
        <td>${eur(c.totalSpend)}</td>
        <td>${eur(c.totalContribution)}</td>
        <td>${pct(c.totalContribution / dec.metrics.predictedTotal)}</td>
        <td style="color:${c.roi >= 1 ? "var(--good)" : "var(--bad)"};font-weight:700">${c.roi}×</td>
        <td>${c.theta.toFixed(2)}</td>
        <td>${c.theta > 0 ? "+" + pct(c.carryover) : "—"}</td>
      </tr>`).join("")}</tbody>`;
}

function renderCurve() {
  if (!currentDec) return;
  const ch = currentDec.channels.find((c) => c.id === selectedCh) || currentDec.channels[0];
  const cv = responseCurve(ch, SERIES, 48);
  drawCurve(cv, ch);
  $("chKv").innerHTML = `
    <dt>Modelled ROI</dt><dd style="color:${ch.roi >= 1 ? "var(--good)" : "var(--bad)"}">${ch.roi}×</dd>
    <dt>Contribution (2 yrs)</dt><dd>${eur(ch.totalContribution)}</dd>
    <dt>Adstock θ (carryover)</dt><dd>${ch.theta.toFixed(2)}${ch.theta > 0 ? ` (+${pct(ch.carryover)})` : ""}</dd>
    <dt>Mean weekly spend</dt><dd>${eur(ch.meanSpend)}</dd>`;
  const cls = ch.roi >= 1.3 ? "good" : ch.roi >= 1 ? "warn" : "bad";
  const msg = ch.roi < 1
    ? `<b>Below breakeven.</b> The model returns <b>${ch.roi}× revenue</b> — this channel's spend isn't paying for itself before margin. Cut or restructure.`
    : ch.theta >= 0.4
      ? `<b>Long carryover.</b> With θ=${ch.theta.toFixed(2)}, most of a week's punch lands in <em>later</em> weeks (+${pct(ch.carryover)} total effect) — don't judge it on same-week sales.`
      : `<b>Fast, efficient.</b> Returns <b>${ch.roi}× revenue</b> with little carryover — its effect is immediate.`;
  $("chCallout").innerHTML = `<div class="callout ${cls}">${msg}</div>`;
}

function drawCurve(cv, ch) {
  const W = 340, H = 150, padL = 46, padR = 12, padT = 12, padB = 24;
  const maxX = cv.maxS, maxY = Math.max(...cv.points.map((p) => p.contribution), 1);
  const x = (s) => padL + (s / maxX) * (W - padL - padR);
  const y = (v) => H - padB - (v / maxY) * (H - padT - padB);
  const line = cv.points.map((p, i) => `${i ? "L" : "M"}${x(p.spend).toFixed(1)},${y(p.contribution).toFixed(1)}`).join(" ");
  const mx = x(cv.meanSpend);
  $("curve").innerHTML = `
    <line x1="${padL}" y1="${y(0).toFixed(1)}" x2="${W - padR}" y2="${y(0).toFixed(1)}" stroke="#2a3949" stroke-width="1"/>
    <path d="${line}" fill="none" stroke="var(--good)" stroke-width="2"/>
    <line x1="${mx.toFixed(1)}" y1="${padT}" x2="${mx.toFixed(1)}" y2="${H - padB}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 3"/>
    <text x="${mx.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="var(--accent)" font-size="9">mean spend</text>
    <text x="${(padL - 4)}" y="${(y(maxY) + 3).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="9">${eurK(maxY)}/wk</text>
    <text x="${(padL - 4)}" y="${(y(0) + 3).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="9">€0</text>
    <text x="${x(0).toFixed(1)}" y="${H - 8}" text-anchor="start" fill="var(--muted)" font-size="9">€0/wk</text>`;
}

function renderInsight(dec) {
  const m = dec.metrics;
  const best = dec.channels.slice().sort((a, b) => b.roi - a.roi)[0];
  const worst = dec.channels.slice().sort((a, b) => a.roi - b.roi)[0];
  const longest = dec.channels.slice().sort((a, b) => b.theta - a.theta)[0];
  const naive = decompose(SERIES, "naive");

  $("insight").innerHTML = `
    <p>Over ${m.weeks} weeks, <b>${pct(m.baseShare)}</b> of sales are <b>base</b> — demand that arrives without any spend — and only <b>${pct(m.marketingShare)}</b> is marketing-driven. Blended modelled ROAS is <b>${m.blendedRoi}×</b>. The best channel is <b>${esc(best.channel)}</b> at <b>${best.roi}×</b>; the weakest is <b>${esc(worst.channel)}</b> at <b>${worst.roi}×</b>${worst.roi < 1 ? " — below breakeven before margin even enters" : ""}.</p>
    <p>Two things the model makes visible that last-click can't: <b>carryover</b> (${esc(longest.channel)} keeps working with θ=${longest.theta.toFixed(2)}, so judging it on same-week sales understates it) and the <b>base</b> you'd earn regardless. The current spec fits at <b>R² ${m.r2}</b>; the naive raw-spend model fits at ${naive.metrics.r2} and mis-reads both carryover and diminishing returns. But an MMM is <b>correlational</b>: it fits history, it doesn't prove causation, and collinear channels can trade credit. Treat these ROIs as priors to <b>validate with holdout experiments</b> (case 22) and to feed the budget allocator (case 25) — not as ground truth on their own.</p>`;
}

init();
