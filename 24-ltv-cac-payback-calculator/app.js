// UI for the LTV / CAC / Payback calculator. All logic lives in ltv.js.
import { parseCsv, buildReport, paybackCurve, VERDICTS, SORTS } from "./ltv.js";
import { CAC, CHANNEL_LABELS, THRESHOLDS } from "./cac.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => (x < 0 ? "−€" : "€") + Math.abs(Math.round(Number(x))).toLocaleString("en-US");
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
const ratio = (x) => (x === Infinity ? "∞" : x.toFixed(1) + "×");
const months = (x) => (x === Infinity ? "never" : (x < 1 ? "<1" : x.toFixed(1)) + " mo");

let data = null;
let options = { basis: "contribution", groupBy: "channel", sort: "ltvCac" };
let selectedSeg = null;

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }

async function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  $("segSelect").addEventListener("change", () => { selectedSeg = $("segSelect").value; renderDetail(); });
  try {
    const [orders, customers] = await Promise.all([
      fetchText("../shared-data/customers/orders.csv").then(parseCsv),
      fetchText("../shared-data/customers/customers.csv").then(parseCsv),
    ]);
    data = { orders, customers };
    render();
  } catch (e) {
    $("fileInfo").innerHTML = `Couldn't load order data. Serve the repo from its <strong>root</strong> and open <code>/24-ltv-cac-payback-calculator/</code>.`;
  }
}

function labelFor(rep, key) {
  return rep.groupBy === "channel" ? (CHANNEL_LABELS[key] || key) : (key === "none" ? "No tier" : key[0].toUpperCase() + key.slice(1));
}

function setControl(control, value, seg, btn) {
  options[control] = value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  if (!data) return;
  const rep = buildReport(data, CAC, { ...options, labels: CHANNEL_LABELS });
  currentRep = rep;
  const m = rep.metrics;
  const basisLabel = m.basis === "revenue" ? "revenue" : "contribution";
  $("fileInfo").innerHTML = `<strong>${m.customers}</strong> customers · <strong>${eur(m.blendedLtv)}</strong> avg LTV (${basisLabel}) · <strong>${eur(m.blendedCac)}</strong> avg CAC · blended <strong>${ratio(m.blendedLtvCac)}</strong> LTV:CAC <span style="color:var(--muted)">(shared-data)</span>`;
  renderMetrics(m);
  renderBars(rep);
  renderTable(rep);

  // keep or default the selected segment
  const keys = rep.sorted.map((s) => s.key);
  if (!keys.includes(selectedSeg)) selectedSeg = keys[0];
  $("segSelect").innerHTML = rep.sorted.map((s) => `<option value="${esc(s.key)}">${esc(labelFor(rep, s.key))}</option>`).join("");
  $("segSelect").value = selectedSeg;
  renderDetail();
  renderInsight(rep);
}
let currentRep = null;

function renderMetrics(m) {
  const cards = [
    ["Customers", m.customers.toLocaleString("en-US"), ""],
    [`Avg LTV (${m.basis === "revenue" ? "rev" : "contrib"})`, eur(m.blendedLtv), m.basis === "revenue" ? "warn" : "good", true],
    ["Avg CAC", eur(m.blendedCac), ""],
    ["Blended LTV:CAC", ratio(m.blendedLtvCac), m.blendedLtvCac >= THRESHOLDS.ltvCacHealthy ? "good" : "warn"],
    ["Net profit / cohort", eur(m.netProfit), m.netProfit >= 0 ? "good" : "bad"],
    ["Repeat rate", pct(m.repeatRate), "accent"],
    ["At-risk segments", String(m.atRiskSegments + m.lossSegments), (m.atRiskSegments + m.lossSegments) ? "warn" : "good", true],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls, sm]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd class="${sm ? "sm" : ""}">${esc(String(v))}</dd></div>`).join("");
}

function renderBars(rep) {
  $("barsTitle").textContent = `LTV:CAC by ${rep.groupBy === "channel" ? "acquisition channel" : rep.groupBy === "tier" ? "loyalty tier" : "country"}`;
  const rows = rep.sorted;
  const finite = rows.map((r) => (r.ltvCac === Infinity ? 0 : r.ltvCac));
  const max = Math.max(...finite, THRESHOLDS.ltvCacHealthy * 1.5, 6);
  const threshX = (THRESHOLDS.ltvCacHealthy / max) * 100;

  $("bars").innerHTML = rows.map((r) => {
    const v = VERDICTS[r.verdict];
    const val = r.ltvCac === Infinity ? max : r.ltvCac;
    const w = Math.min((val / max) * 100, 100);
    return `<div class="bar-row">
      <span class="bar-ch" title="${esc(labelFor(rep, r.key))}">${esc(labelFor(rep, r.key))}</span>
      <span class="bar-track">
        <span class="bar-fill ${v.cls}" style="width:${w}%"></span>
        <span class="bar-thresh" style="left:${threshX}%"></span>
      </span>
      <span class="bar-val">${ratio(r.ltvCac)} <div class="sub">${eur(r.avgLtv)} / ${eur(r.cac)} · n=${r.customers}</div></span>
    </div>`;
  }).join("");
}

function renderTable(rep) {
  const sc = (k) => (k === options.sort ? " sorted" : "");
  $("table").innerHTML = `<thead><tr>
      <th>Segment</th><th class="${sc("customers").trim()}">Customers</th><th>Avg orders</th><th>Repeat</th><th>Avg LTV</th><th>CAC</th><th class="${sc("ltvCac").trim()}">LTV:CAC</th><th class="${sc("payback").trim()}">Payback</th><th>Verdict</th>
    </tr></thead><tbody>${rep.sorted.map((r) => {
    const v = VERDICTS[r.verdict];
    return `<tr>
      <td class="ch">${esc(labelFor(rep, r.key))}</td>
      <td>${r.customers}</td>
      <td>${r.avgOrders}</td>
      <td>${pct(r.repeatRate)}</td>
      <td>${eur(r.avgLtv)}</td>
      <td>${eur(r.cac)}</td>
      <td style="color:${r.ltvCac >= THRESHOLDS.ltvCacHealthy ? "var(--good)" : r.ltvCac >= 1 ? "var(--warn)" : "var(--bad)"};font-weight:700">${ratio(r.ltvCac)}</td>
      <td>${months(r.paybackMonths)}</td>
      <td><span class="pill ${v.cls}">${esc(v.label)}</span></td>
    </tr>`;
  }).join("")}</tbody>`;
}

function renderDetail() {
  if (!currentRep) return;
  const s = currentRep.sorted.find((x) => x.key === selectedSeg) || currentRep.sorted[0];
  const curve = paybackCurve(s, 18);
  drawCurve(curve, s);

  const v = VERDICTS[s.verdict];
  $("segKv").innerHTML = `
    <dt>Customers</dt><dd>${s.customers}</dd>
    <dt>Avg LTV (${currentRep.basis === "revenue" ? "revenue" : "contribution"})</dt><dd>${eur(s.avgLtv)}</dd>
    <dt>CAC</dt><dd>${eur(s.cac)}</dd>
    <dt>LTV:CAC</dt><dd style="color:${s.ltvCac >= 3 ? "var(--good)" : s.ltvCac >= 1 ? "var(--warn)" : "var(--bad)"}">${ratio(s.ltvCac)}</dd>
    <dt>Payback</dt><dd>${months(s.paybackMonths)}</dd>
    <dt>Repeat rate</dt><dd>${pct(s.repeatRate)}</dd>`;

  const msg = {
    healthy: `<b>Healthy.</b> Clears the 3:1 rule and earns CAC back in <b>${months(s.paybackMonths)}</b>. Scale acquisition here — as far as the channel's volume allows.`,
    marginal: `<b>Marginal.</b> LTV:CAC of <b>${ratio(s.ltvCac)}</b> is below the 3:1 rule — there's little margin for a bad quarter or rising CPMs. Improve retention/AOV or cap the spend.`,
    slow: `<b>Slow payback.</b> The ratio is fine but it takes <b>${months(s.paybackMonths)}</b> to recover CAC — a cash-flow drag when you're scaling.`,
    loss: `<b>Acquired at a loss.</b> Average LTV is below CAC — every customer from this segment costs more than they return. Fix the economics before spending more.`,
  }[s.verdict];
  $("segCallout").innerHTML = `<div class="callout ${v.cls}"><span class="pill ${v.cls}">${esc(v.label)}</span> &nbsp;${msg}</div>`;
}

function drawCurve(curve, s) {
  const W = 340, H = 170, padL = 40, padR = 12, padT = 12, padB = 26;
  const maxM = curve.points.length - 1;
  const maxY = Math.max(curve.cac * 1.4, curve.points[maxM].cumulative, 1);
  const x = (m) => padL + (m / maxM) * (W - padL - padR);
  const y = (val) => H - padB - (val / maxY) * (H - padT - padB);

  const line = curve.points.map((p, i) => `${i ? "L" : "M"}${x(p.month).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(" ");
  const cacY = y(curve.cac);
  const cross = curve.crossMonth;
  const crossValid = cross !== Infinity && cross <= maxM;

  const gridY = [0, curve.cac, maxY].map((val) =>
    `<line x1="${padL}" y1="${y(val).toFixed(1)}" x2="${W - padR}" y2="${y(val).toFixed(1)}" stroke="#2a3949" stroke-width="1"/>`).join("");

  $("curve").innerHTML = `
    ${gridY}
    <line x1="${padL}" y1="${cacY.toFixed(1)}" x2="${W - padR}" y2="${cacY.toFixed(1)}" stroke="var(--bad)" stroke-width="1.5" stroke-dasharray="4 3"/>
    <text x="${W - padR}" y="${(cacY - 4).toFixed(1)}" text-anchor="end" fill="var(--bad)" font-size="9">CAC ${eur(curve.cac)}</text>
    <path d="${line}" fill="none" stroke="var(--good)" stroke-width="2"/>
    ${crossValid ? `<line x1="${x(cross).toFixed(1)}" y1="${padT}" x2="${x(cross).toFixed(1)}" y2="${H - padB}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 3"/>
      <circle cx="${x(cross).toFixed(1)}" cy="${cacY.toFixed(1)}" r="3.5" fill="var(--accent)"/>
      <text x="${x(cross).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="var(--accent)" font-size="9">${months(cross)}</text>` : ""}
    <text x="${padL - 4}" y="${(y(0) + 3).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="9">€0</text>
    <text x="${padL - 4}" y="${(padT + 6).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="9">${eur(maxY)}</text>
    <text x="${x(0).toFixed(1)}" y="${H - 8}" text-anchor="start" fill="var(--muted)" font-size="9">mo 0</text>
    <text x="${x(maxM).toFixed(1)}" y="${H - 8}" text-anchor="end" fill="var(--muted)" font-size="9">mo ${maxM}</text>`;
}

function renderInsight(rep) {
  const m = rep.metrics;
  const rows = rep.sorted;
  const best = rows.slice().sort((a, b) => b.ltvCac - a.ltvCac)[0];
  const worst = rows.slice().sort((a, b) => a.ltvCac - b.ltvCac)[0];
  const revLift = (() => {
    const rev = buildReport(data, CAC, { ...options, basis: "revenue" }).metrics.blendedLtvCac;
    const con = buildReport(data, CAC, { ...options, basis: "contribution" }).metrics.blendedLtvCac;
    return con ? (rev - con) / con : 0;
  })();

  $("insight").innerHTML = `
    <p>Measured on <b>contribution margin</b>, the blended LTV:CAC is <b>${ratio(m.blendedLtvCac)}</b> on ${m.customers} customers with an <b>${pct(m.repeatRate)}</b> repeat rate. Switch the basis to revenue and the same cohort reads <b>${ratio(buildReport(data, CAC, { ...options, basis: "revenue" }).metrics.blendedLtvCac)}</b> — a <b>+${pct(revLift)}</b> flattering lift that ignores discounts, returns and cost of goods. Plan on the contribution number.</p>
    <p>By ${rep.groupBy === "channel" ? "acquisition channel" : rep.groupBy}, <b>${esc(labelFor(rep, worst.key))}</b> is the weakest at <b>${ratio(worst.ltvCac)}</b> (${eur(worst.avgLtv)} LTV on ${eur(worst.cac)} CAC${worst.verdict === "marginal" ? " — below the 3:1 rule" : ""}), while <b>${esc(labelFor(rep, best.key))}</b> leads at <b>${ratio(best.ltvCac)}</b>. But the cheap winners are usually capacity-limited: you can't buy more "direct" or "organic" on demand, so the real question is whether the paid channels clear the bar — and whether their LTV is <em>incremental</em> or just demand you'd have captured anyway (the holdout and POAS tools). The move: fund the paid channels that clear 3:1 with fast payback, fix or cap the marginal ones, and never let a revenue-based LTV justify the spend.</p>`;
}

init();
