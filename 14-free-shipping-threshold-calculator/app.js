// UI for the Free-Shipping Threshold Calculator. All logic lives in threshold.js.
import { parseCsv, buildModel, evaluate, sweep, warningsFor } from "./threshold.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (x) => Number(x).toLocaleString("en-US");
const eur = (x) => (x < 0 ? "−€" : "€") + Math.abs(Math.round(x)).toLocaleString("en-US");
const eur1 = (x) => (x < 0 ? "−€" : "€") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let model = null;
let options = { threshold: 200, nudge: "med", conv: "8%", window: "€25", shipping: "€5" };

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }

async function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  $("thrRange").addEventListener("input", (e) => { options.threshold = Number(e.target.value); render(); });

  try {
    model = buildModel({ orders: parseCsv(await fetchText("../shared-data/customers/orders.csv")) });
    $("fileInfo").innerHTML = `Analysed <strong>${num(model.n)}</strong> orders · AOV <strong>${eur(model.aov)}</strong> · median <strong>${eur(model.median)}</strong> · contribution margin <strong>${Math.round(model.marginRate * 100)}%</strong> · avg shipping <strong>${eur1(model.avgShippingCost)}</strong> <span style="color:var(--muted)">(shared-data)</span>`;
    // Open on the recommended threshold for the current defaults.
    options.threshold = sweep(model, options).recommended;
    $("thrRange").value = options.threshold;
    render();
  } catch (e) {
    $("fileInfo").innerHTML = `Couldn't load data. Serve the repo from its <strong>root</strong> and open <code>/14-free-shipping-threshold-calculator/</code>.`;
  }
}

function setControl(control, value, seg, btn) {
  options[control] = value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  if (!model) return;
  const res = evaluate(model, options);
  const sw = sweep(model, options);
  $("thrVal").textContent = eur(options.threshold);
  $("thrRec").textContent = `· recommended ${eur(sw.recommended)}`;
  renderMetrics(res, sw);
  renderHist(res);
  renderSweep(sw);
  renderEcon(res);
  renderWrongRight(res);
  renderWarnings(res);
}

function renderMetrics(res, sw) {
  const be = Number.isFinite(res.breakEvenConv) ? Math.round(res.breakEvenConv * 100) + "%" : "n/a";
  const cards = [
    ["Orders", num(model.n), ""],
    ["AOV (baseline)", eur(model.aov), ""],
    ["Recommended", eur(sw.recommended), "good"],
    ["Net Δ @ selected", eur(res.netDelta), res.netDelta >= 0 ? "good" : "bad"],
    ["Qualifying", res.pctQualify + "%", ""],
    ["Break-even conv lift", be, res.breakEvenConv <= res.convLift ? "good" : "warn"],
    ["AOV after", eur(res.aovAfter) + (res.aovLift ? ` (+${eur1(res.aovLift)})` : ""), res.aovLift ? "good" : ""],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
}

function renderHist(res) {
  const t = options.threshold, w = res.window;
  const max = model.binMax || 1;
  $("hist").innerHTML = model.histogram.map((b) => {
    const mid = (b.from + b.to) / 2;
    const zone = mid >= t ? "qual" : mid >= t - w ? "nudge" : "far";
    const h = Math.round((b.count / max) * 120) + 4;
    return `<div class="col" title="€${b.from}–${b.to}: ${b.count} orders">
      <div class="cnt">${b.count}</div>
      <div class="bar ${zone}" style="height:${h}px"></div>
      <div class="lab">${b.from}</div>
    </div>`;
  }).join("");
}

function renderSweep(sw) {
  const maxAbs = Math.max(1, ...sw.rows.map((r) => Math.abs(r.netDelta)));
  $("sweep").innerHTML = sw.rows.map((r) => {
    const pos = r.netDelta >= 0;
    const h = Math.round((Math.abs(r.netDelta) / maxAbs) * 62);
    return `<div class="col ${r.threshold === sw.recommended ? "recommended" : ""}" data-t="${r.threshold}" aria-selected="${r.threshold === options.threshold}" title="€${r.threshold}: net ${eur(r.netDelta)}">
      <div class="top">${pos ? `<div class="b pos" style="height:${h}px"></div>` : ""}</div>
      <div class="axis"></div>
      <div class="bot">${!pos ? `<div class="b neg" style="height:${h}px"></div>` : ""}</div>
      <div class="lab">${r.threshold}</div>
    </div>`;
  }).join("");
  $("sweep").querySelectorAll(".col").forEach((el) =>
    el.addEventListener("click", () => { options.threshold = Number(el.dataset.t); $("thrRange").value = options.threshold; render(); }));
  const rec = sw.rows.find((r) => r.threshold === sw.recommended);
  $("sweepNote").innerHTML = `Peak net contribution at <strong style="color:var(--good)">${eur(sw.recommended)}</strong> (${eur(rec.netDelta)} vs baseline). Green = profitable, red = net-negative.`;
}

function renderEcon(res) {
  const row = (label, val, cls = "", muted = false) => `<tr class="${cls}"><td class="${muted ? "muted" : ""}">${esc(label)}</td><td class="${val < 0 ? "neg" : val > 0 ? "pos" : "muted"}">${eur1(val)}</td></tr>`;
  $("econ").innerHTML = `
    <tr><td class="muted">Orders qualifying (≥ ${eur(res.threshold)})</td><td>${res.counts.above} · ${res.pctQualify}%</td></tr>
    <tr><td class="muted">Within reach / expected nudgers</td><td>${res.counts.reach} · ${res.expectedNudgers}</td></tr>
    <tr><td class="muted">Conversion-lift orders</td><td>${res.convOrders}</td></tr>
    ${row("Shipping subsidy (qualifying orders)", -res.subsidyCost)}
    ${row("Basket-nudge contribution", res.nudgeGain)}
    ${row("Conversion-lift contribution", res.convGain)}
    <tr class="net"><td><strong>Net contribution vs baseline</strong></td><td class="${res.netDelta < 0 ? "neg" : "pos"}"><strong>${eur1(res.netDelta)}</strong></td></tr>
    <tr><td class="muted">Per-nudger average</td><td class="${res.perNudgerAvg < 0 ? "neg" : "pos"}">${eur1(res.perNudgerAvg)}</td></tr>`;
}

function renderWrongRight(res) {
  $("wrongRight").innerHTML = `
    <div class="card wrong">
      <div class="h">"Revenue uplift"</div>
      <div class="num">${eur(res.naiveUplift)}</div>
      <div class="exp">Nudged basket + full revenue of free-shipping orders — ignores the subsidy and the cost of goods.</div>
    </div>
    <div class="card right">
      <div class="h">Real net contribution</div>
      <div class="num">${eur(res.netDelta)}</div>
      <div class="exp">Margin from nudging + conversion, minus the shipping you now absorb on qualifying orders.</div>
    </div>`;
  const be = Number.isFinite(res.breakEvenConv) ? `${Math.round(res.breakEvenConv * 100)}%` : "an impossible";
  $("wrFoot").innerHTML = `The vanity number is <strong>${res.netDelta !== 0 ? Math.round(res.naiveUplift / (res.netDelta || 1)) + "×" : "far"}</strong> the real one. This threshold needs a <strong>${be}</strong> conversion lift to break even — you're at <strong>${Math.round(res.convLift * 100)}%</strong>.`;
}

function renderWarnings(res) {
  const w = warningsFor(res);
  if (!w.length) { $("warnings").innerHTML = `<p class="warn-none">✓ No red flags at this threshold and these assumptions — the policy pays for itself.</p>`; return; }
  $("warnings").innerHTML = `<ul class="warn-list">${w.map((x) =>
    `<li><span class="wtag ${esc(x.type)}">${esc(x.type)}</span><span>${esc(x.text)}</span></li>`).join("")}</ul>`;
}

init();
