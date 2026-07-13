// UI for the Marketing Budget Allocator. All logic lives in allocator.js.
import { CHANNELS } from "./channels.js";
import { buildReport, curve } from "./allocator.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => (x < 0 ? "−€" : "€") + Math.abs(Math.round(Number(x))).toLocaleString("en-US");
const eurK = (x) => (Math.abs(x) >= 1000 ? (x < 0 ? "−€" : "€") + (Math.abs(x) / 1000).toFixed(1) + "k" : eur(x));
const pct = (x, d = 0) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";

let options = { budgetMultiplier: 1, budgetMode: "fixed", objective: "profit", sort: "reallocation" };
let selectedCh = CHANNELS[0].id;
let currentRep = null;

function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  const sel = $("chSelect");
  sel.innerHTML = CHANNELS.map((c) => `<option value="${c.id}">${esc(c.channel)}</option>`).join("");
  sel.value = selectedCh;
  sel.addEventListener("change", () => { selectedCh = sel.value; renderCurve(); });
  render();
}

function setControl(control, value, seg, btn) {
  if (control === "budget") {
    if (value === "max") { options.budgetMode = "max"; }
    else { options.budgetMode = "fixed"; options.budgetMultiplier = Number(value); }
  } else {
    options[control] = value;
  }
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  const rep = buildReport(CHANNELS, options);
  currentRep = rep;
  const m = rep.metrics;
  $("fileInfo").innerHTML = `Budget <strong>${eur(m.budget)}</strong>${m.mode === "max" ? " (profit-max)" : ""} · optimising <strong>${m.objective}</strong> · current contribution <strong>${eur(m.currentContribution)}</strong> → optimal <strong>${eur(m.optimalContribution)}</strong> (<strong>${pct(m.upliftPct)}</strong>) <span style="color:var(--muted)">(channels.js)</span>`;
  renderMetrics(m);
  renderBars(rep);
  renderTable(rep);
  if (!rep.channels.some((c) => c.id === selectedCh)) selectedCh = rep.channels[0].id;
  $("chSelect").value = selectedCh;
  renderCurve();
  renderInsight(rep);
}

function renderMetrics(m) {
  const cards = [
    ["Budget", eurK(m.budget), m.mode === "max" ? "accent" : ""],
    ["Current contribution", eurK(m.currentContribution), ""],
    ["Optimal contribution", eurK(m.optimalContribution), "good"],
    ["Uplift", pct(m.upliftPct), m.upliftPct > 0 ? "good" : "muted"],
    ["Extra profit", eurK(m.upliftAbs), m.upliftAbs > 0 ? "good" : "muted", true],
    ["Reallocated", eurK(m.reallocated), "accent"],
    ["Cut / grown", `${m.cut} / ${m.increased}`, "warn", true],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls, sm]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd class="${sm ? "sm" : ""}">${esc(String(v))}</dd></div>`).join("");
}

function renderBars(rep) {
  const rows = rep.sorted;
  const max = Math.max(...rows.flatMap((r) => [r.current.spend, r.optimal.spend]), 1);
  $("bars").innerHTML = rows.map((r) => {
    const cw = (r.current.spend / max) * 100, ow = (r.optimal.spend / max) * 100;
    const dcls = r.action === "increase" ? "up" : r.action === "cut" ? "down" : "hold";
    const arrow = r.action === "increase" ? "▲" : r.action === "cut" ? "▼" : "＝";
    return `<div class="bar-row">
      <span class="bar-ch" title="${esc(r.channel)}">${esc(r.channel)}</span>
      <span class="bar-pair">
        <span class="bar-line"><span class="bar-fill cur" style="width:${cw}%"></span></span>
        <span class="bar-line"><span class="bar-fill opt" style="width:${ow}%"></span></span>
      </span>
      <span class="bar-val">${eurK(r.optimal.spend)} <div class="delta ${dcls}">${arrow} ${eurK(Math.abs(r.deltaSpend))}</div></span>
    </div>`;
  }).join("");
}

function renderTable(rep) {
  const sc = (k) => (k === options.sort ? " sorted" : "");
  $("table").innerHTML = `<thead><tr>
      <th>Channel</th><th>Margin</th><th>Current</th><th class="${sc("reallocation").trim()}">Optimal</th><th>Δ Spend</th><th class="${sc("marginalRoas").trim()}">Marginal ROAS</th><th class="${sc("contribution").trim()}">Contribution</th><th>Action</th>
    </tr></thead><tbody>${rep.sorted.map((r) => `
      <tr>
        <td class="ch">${esc(r.channel)}<div style="font-size:10.5px;color:var(--muted);font-weight:400">${esc(r.source)}</div></td>
        <td>${Math.round(r.margin * 100)}%</td>
        <td>${eur(r.current.spend)}</td>
        <td style="font-weight:700">${eur(r.optimal.spend)}</td>
        <td style="color:${r.deltaSpend > 1 ? "var(--good)" : r.deltaSpend < -1 ? "var(--bad)" : "var(--muted)"}">${r.deltaSpend >= 0 ? "+" : ""}${eur(r.deltaSpend)}</td>
        <td>${r.optimal.marginalRoas.toFixed(2)}×</td>
        <td>${eur(r.optimal.contribution)}</td>
        <td><span class="pill ${r.action}">${r.action === "increase" ? "Increase" : r.action === "cut" ? "Cut" : "Hold"}</span></td>
      </tr>`).join("")}</tbody>`;
}

function renderCurve() {
  if (!currentRep) return;
  const row = currentRep.channels.find((c) => c.id === selectedCh) || currentRep.channels[0];
  const ch = CHANNELS.find((c) => c.id === selectedCh);
  const cv = curve(ch, row.current.spend, row.optimal.spend, 48);
  drawCurve(cv, row);

  $("chKv").innerHTML = `
    <dt>Current spend</dt><dd>${eur(row.current.spend)}</dd>
    <dt>Optimal spend</dt><dd style="color:var(--accent)">${eur(row.optimal.spend)}</dd>
    <dt>Margin</dt><dd>${Math.round(row.margin * 100)}%</dd>
    <dt>Marginal ROAS (current → optimal)</dt><dd>${row.current.marginalRoas.toFixed(2)}× → ${row.optimal.marginalRoas.toFixed(2)}×</dd>
    <dt>Contribution (current → optimal)</dt><dd>${eur(row.current.contribution)} → ${eur(row.optimal.contribution)}</dd>`;

  const cls = row.action === "increase" ? "good" : row.action === "cut" ? "bad" : "warn";
  const msg = row.action === "increase"
    ? `<b>Underfunded.</b> The marginal euro here still returns <b>${row.current.marginalRoas.toFixed(2)}× revenue</b> — well above the mix. Move <b>${eur(row.deltaSpend)}</b> into it.`
    : row.action === "cut"
      ? `<b>Over-funded.</b> Its curve has flattened — the last euros return <b>${row.current.marginalRoas.toFixed(2)}× revenue</b>, below what other channels would do with the same money. Cut <b>${eur(Math.abs(row.deltaSpend))}</b>.`
      : `<b>About right.</b> Its marginal return already matches the rest of the mix.`;
  $("chCallout").innerHTML = `<div class="callout ${cls}">${msg}<div style="margin-top:8px;color:var(--muted);font-size:12px">${esc(ch.note)}</div></div>`;
}

function drawCurve(cv, row) {
  const W = 340, H = 170, padL = 44, padR = 12, padT = 12, padB = 26;
  const maxX = cv.maxS;
  const ys = cv.points.map((p) => p.contribution);
  const maxY = Math.max(...ys, 1), minY = Math.min(...ys, 0);
  const x = (s) => padL + (s / maxX) * (W - padL - padR);
  const y = (v) => H - padB - ((v - minY) / (maxY - minY || 1)) * (H - padT - padB);

  const line = cv.points.map((p, i) => `${i ? "L" : "M"}${x(p.spend).toFixed(1)},${y(p.contribution).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  const mark = (s, color, label) => {
    const px = x(s);
    return `<line x1="${px.toFixed(1)}" y1="${padT}" x2="${px.toFixed(1)}" y2="${H - padB}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3"/>
      <text x="${px.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="${color}" font-size="9">${label}</text>`;
  };

  $("curve").innerHTML = `
    <line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" stroke="#2a3949" stroke-width="1"/>
    <path d="${line}" fill="none" stroke="var(--good)" stroke-width="2"/>
    ${mark(row.current.spend, "#8a9bb0", "current")}
    ${mark(row.optimal.spend, "var(--accent)", "optimal")}
    <text x="${padL - 4}" y="${(y(maxY) + 3).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="9">${eurK(maxY)}</text>
    <text x="${padL - 4}" y="${(zeroY + 3).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="9">€0</text>
    <text x="${x(0).toFixed(1)}" y="${H - 8}" text-anchor="start" fill="var(--muted)" font-size="9">€0 spend</text>`;
}

function renderInsight(rep) {
  const m = rep.metrics;
  const biggestCut = rep.channels.slice().sort((a, b) => a.deltaSpend - b.deltaSpend)[0];
  const biggestGain = rep.channels.slice().sort((a, b) => b.deltaSpend - a.deltaSpend)[0];
  const revRep = buildReport(CHANNELS, { ...options, objective: "revenue" });

  $("insight").innerHTML = `
    <p>At ${m.mode === "max" ? "the profit-maximising budget" : `a ${eur(m.budget)} budget`}, the current plan returns <b>${eur(m.currentContribution)}</b> in contribution; the optimal allocation returns <b>${eur(m.optimalContribution)}</b> — <b>${pct(m.upliftPct)}</b> more profit from <b>the same money</b>, just moved. It shifts <b>${eur(m.reallocated)}</b>: biggest cut is <b>${esc(biggestCut.channel)}</b> (${eur(biggestCut.deltaSpend)}), biggest increase is <b>${esc(biggestGain.channel)}</b> (+${eur(biggestGain.deltaSpend)}).</p>
    <p>The rule that gets you there: allocate on <b>marginal</b> return, not average ROAS. A saturated channel with a great blended ROAS is still the wrong home for the next euro. Optimising for <b>revenue</b> instead of profit would spend more on low-margin channels and leave <b>${eur(rep.metrics.optimalContribution - revRep.metrics.optimalContribution)}</b> of contribution on the table — the same margin-blindness the POAS tool flags. And the marginal lens only works if the response curves are <em>incremental</em>: feed it holdout-measured lift (case 22), not last-click revenue, or you'll happily optimise spend into demand you already own.</p>`;
}

init();
