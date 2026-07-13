// UI for the Cohort Retention & LTV Projection tool. Logic lives in retention.js.
import { COHORTS, MARGIN } from "./cohorts.js";
import { buildReport, SORTS } from "./retention.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => (x < 0 ? "−€" : "€") + Math.abs(Math.round(Number(x))).toLocaleString("en-US");
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
const pctS = (x, d = 1) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";

let options = { horizon: 24, basis: "contribution", margin: MARGIN, sort: "age" };

function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  render();
}

function setControl(control, value, seg, btn) {
  if (control === "horizon") options.horizon = Number(value);
  else options[control] = value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  const rep = buildReport(COHORTS, options);
  const m = rep.metrics;
  $("fileInfo").innerHTML = `<strong>${m.cohorts}</strong> cohorts · <strong>${m.customers}</strong> customers · realised <strong>${eur(m.avgRealisedLtv)}</strong> → projected <strong>${eur(m.avgProjectedLtv)}</strong> LTV (${m.horizon}mo) · <strong>${pct(m.toComePct)}</strong> still to come <span style="color:var(--muted)">(cohorts.js)</span>`;
  renderMetrics(m);
  renderTriangle(rep);
  renderCurve(rep);
  renderLtvBars(rep);
  renderTable(rep);
  renderInsight(rep);
}

function renderMetrics(m) {
  const cards = [
    ["Cohorts", `${m.cohorts}`, ""],
    ["Customers", m.customers.toLocaleString("en-US"), ""],
    ["Avg realised LTV", eur(m.avgRealisedLtv), "warn"],
    ["Avg projected LTV", eur(m.avgProjectedLtv), "good"],
    ["Still to come", pct(m.toComePct), "accent"],
    ["Month-12 retention", pct(m.retM12), ""],
    ["Early-retention trend", pctS(m.earlyRetTrend), m.earlyRetTrend < -0.02 ? "bad" : m.earlyRetTrend > 0.02 ? "good" : "warn", true],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls, sm]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd class="${sm ? "sm" : ""}">${esc(String(v))}</dd></div>`).join("");
}

function shade(ret) {
  // Interpolate panel-2 (#24303e) → good (#2fbf87) by retention.
  const a = [36, 48, 62], b = [47, 191, 135];
  const t = Math.max(0, Math.min(1, ret));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function renderTriangle(rep) {
  const cols = 12; // month 0..11 shown in the heatmap
  const head = ['<div class="tri-lab"></div>', ...Array.from({ length: cols }, (_, a) => `<div class="tri-cell head">m${a}</div>`)].join("");
  const rows = rep.rows.slice().sort((a, b) => b.observedMonths - a.observedMonths).map((r) => {
    const cohort = COHORTS.find((c) => c.id === r.id);
    const cells = Array.from({ length: cols }, (_, a) => {
      if (a <= r.observedMonths && cohort.observed[a]) {
        const ret = cohort.observed[a].activePct;
        return `<div class="tri-cell" style="background:${shade(ret)}" title="${esc(r.label)} · month ${a}: ${pct(ret)}">${a === 0 ? "100" : Math.round(ret * 100)}</div>`;
      }
      return `<div class="tri-cell future" title="projected"></div>`;
    }).join("");
    return `<div class="tri-lab">${esc(r.label)}</div>${cells}`;
  }).join("");
  const grid = $("triangle");
  grid.style.gridTemplateColumns = `64px repeat(${cols}, 1fr)`;
  grid.innerHTML = head + rows;
}

function renderCurve(rep) {
  const W = 400, H = 200, padL = 40, padR = 12, padT = 12, padB = 26;
  const s = rep.samples;
  const maxAge = s.length - 1;
  const x = (age) => padL + (age / maxAge) * (W - padL - padR);
  const y = (v) => H - padB - v * (H - padT - padB);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="#2a3949" stroke-width="1"/><text x="${padL - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="9">${pct(v)}</text>`).join("");
  const fitted = s.map((p, i) => `${i ? "L" : "M"}${x(p.age).toFixed(1)},${y(p.fitted).toFixed(1)}`).join(" ");
  const observedMax = Math.max(...rep.rows.map((r) => r.observedMonths));
  const dots = s.filter((p) => p.observed != null).map((p) => `<circle cx="${x(p.age).toFixed(1)}" cy="${y(p.observed).toFixed(1)}" r="2.6" fill="var(--muted)"/>`).join("");
  const divX = x(observedMax);
  $("curve").innerHTML = `${grid}
    <line x1="${divX.toFixed(1)}" y1="${padT}" x2="${divX.toFixed(1)}" y2="${H - padB}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3"/>
    <text x="${(divX + 4).toFixed(1)}" y="${padT + 9}" fill="var(--muted)" font-size="9">projected →</text>
    <path d="${fitted}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    ${dots}
    <text x="${x(0).toFixed(1)}" y="${H - 8}" fill="var(--muted)" font-size="9">m0</text>
    <text x="${x(maxAge).toFixed(1)}" y="${H - 8}" text-anchor="end" fill="var(--muted)" font-size="9">m${maxAge}</text>`;
  $("curveNote").innerHTML = `Fit: retention ≈ <strong>${rep.curve.A}·age<sup>−${rep.curve.decay}</sup></strong> (R² ${rep.curve.r2}) · month-1 <strong>${pct(rep.metrics.retM1)}</strong>, month-12 <strong>${pct(rep.metrics.retM12)}</strong>.`;
}

function renderLtvBars(rep) {
  const rows = rep.sorted;
  const max = Math.max(...rows.map((r) => r.projectedLtv), 1);
  $("ltvbars").innerHTML = rows.map((r) => {
    const rw = (r.realisedLtv / max) * 100, pw = (r.toCome / max) * 100;
    return `<div class="bar-row">
      <span class="bar-lab">${esc(r.label)}</span>
      <span class="bar-track"><span class="bar-real" style="width:${rw}%"></span><span class="bar-proj" style="width:${pw}%"></span></span>
      <span class="bar-val">${eur(r.projectedLtv)} <span class="sub">${eur(r.realisedLtv)} banked · ${pct(r.toComePct)} to come</span></span>
    </div>`;
  }).join("");
}

function renderTable(rep) {
  const sc = (k) => (k === options.sort ? " sorted" : "");
  $("table").innerHTML = `<thead><tr>
      <th>Cohort</th><th>Size</th><th>Obs. mo</th><th class="${sc("retention").trim()}">Ret M1</th><th>Ret M3</th><th>Ret M12</th><th>Realised LTV</th><th class="${sc("projected").trim()}">Projected LTV</th><th>% to come</th>
    </tr></thead><tbody>${rep.sorted.map((r) => `
      <tr>
        <td style="font-weight:600">${esc(r.label)}</td>
        <td>${r.size}</td>
        <td>${r.observedMonths}</td>
        <td${r.observedMonths >= 1 ? "" : ' style="color:var(--muted)"'}>${pct(r.retM1)}${r.observedMonths >= 1 ? "" : "*"}</td>
        <td${r.observedMonths >= 3 ? "" : ' style="color:var(--muted)"'}>${pct(r.retM3)}${r.observedMonths >= 3 ? "" : "*"}</td>
        <td style="color:var(--muted)">${pct(r.retM12)}*</td>
        <td>${eur(r.realisedLtv)}</td>
        <td style="color:var(--good);font-weight:700">${eur(r.projectedLtv)}</td>
        <td>${pct(r.toComePct)}</td>
      </tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="9" style="color:var(--muted);font-size:11px;border:none;padding-top:8px">* projected from the fitted curve (beyond this cohort's observed months)</td></tr></tfoot>`;
}

function renderInsight(rep) {
  const m = rep.metrics;
  const newest = rep.rows.slice().sort((a, b) => a.observedMonths - b.observedMonths)[0];

  $("insight").innerHTML = `
    <p>Across ${m.customers} customers, realised LTV averages just <b>${eur(m.avgRealisedLtv)}</b> — but that's only what's banked. Projected to ${m.horizon} months it's <b>${eur(m.avgProjectedLtv)}</b>, with <b>${pct(m.toComePct)}</b> still to come. Judge the newest cohort (<b>${esc(newest.label)}</b>) on realised LTV and you'd write off <b>${eur(newest.projectedLtv)}</b> of expected value as <b>${eur(newest.realisedLtv)}</b> — the mistake that kills good paid-acquisition channels on a payback report.</p>
    <p>The number that actually leads is <b>early retention</b>: month-1 retention across cohorts is running <b>${pctS(m.earlyRetTrend)}</b> (from <b>${pct(m.oldM1)}</b> in the oldest cohorts to <b>${pct(m.newM1)}</b> in the newest). ${m.earlyRetTrend < -0.02 ? "That decline is your earliest warning that acquisition quality is slipping — it shows up in month-1 retention long before it shows up in LTV, because young cohorts borrow the pooled curve for their tail." : "Early retention is holding, so projected LTV is trustworthy for planning."} This is the forward-looking half of unit economics: pair projected LTV with the realised LTV/CAC tool (24) for payback, and never let a young cohort's banked number set the acquisition budget.</p>`;
}

init();
