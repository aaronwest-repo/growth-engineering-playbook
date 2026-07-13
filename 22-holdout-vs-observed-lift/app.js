// UI for the Holdout-vs-Observed Lift tool. All logic lives in lift.js.
import { EXPERIMENTS } from "./experiments.js";
import { buildReport, analyzeExperiment, VERDICTS, CONFIDENCE } from "./lift.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => (x < 0 ? "−€" : "€") + Math.abs(Math.round(Number(x))).toLocaleString("en-US");
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
const pctSigned = (x, d = 0) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";

let options = { conf: 95, view: "conversions", sort: "incrementality" };
let selectedExp = EXPERIMENTS[0].id;

function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));

  const sel = $("expSelect");
  sel.innerHTML = EXPERIMENTS.map((e) => `<option value="${e.id}">${esc(e.channel)}</option>`).join("");
  sel.value = selectedExp;
  sel.addEventListener("change", () => { selectedExp = sel.value; renderDetail(); });

  render();
}

function setControl(control, value, seg, btn) {
  options[control] = control === "conf" ? Number(value) : value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  const rep = buildReport(EXPERIMENTS, options);
  const m = rep.metrics;
  $("fileInfo").innerHTML = `<strong>${m.experiments}</strong> holdout tests · <strong>${eur(m.spend)}</strong> spend · reported <strong>${m.reportedRoas}×</strong> ROAS vs incremental <strong>${m.incrementalRoas}×</strong> · tested at <strong>${m.confidence}</strong> confidence <span style="color:var(--muted)">(experiments.js)</span>`;
  renderMetrics(m);
  renderBars(rep);
  renderTable(rep);
  renderDetail();
  renderInsight(rep);
}

function renderMetrics(m) {
  const cards = [
    ["Ad spend", eur(m.spend), ""],
    ["Reported ROAS", m.reportedRoas + "×", "good"],
    ["Incremental ROAS", m.incrementalRoas + "×", m.incrementalRoas >= 1 ? "good" : "bad"],
    ["Reported revenue", eur(m.reportedRevenue), ""],
    ["Incremental revenue", eur(m.incrementalRevenue), m.incrementalRevenue >= m.spend ? "good" : "bad"],
    ["True incrementality", pct(m.incrementalityPct), m.incrementalityPct >= 0.5 ? "good" : "warn"],
    ["Overstatement", pctSigned(m.overstatementPct), "bad", true],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls, sm]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd class="${sm ? "sm" : ""}">${esc(String(v))}</dd></div>`).join("");
}

function renderBars(rep) {
  const revenue = options.view === "revenue";
  $("barsTitle").textContent = revenue ? "Reported revenue vs what the spend caused" : "What the spend actually caused";
  $("barsSub").innerHTML = revenue
    ? `Hatched = baseline revenue the control group generated anyway. Solid = true incremental revenue.`
    : `Hatched = baseline the control group converted anyway. Solid green = true incremental lift.`;

  const rows = rep.sorted;
  const total = (r) => revenue ? r.reportedRevenue : r.reportedConversions;
  const incr = (r) => revenue ? r.incrementalRevenue : r.incrementalConversions;
  const max = Math.max(...rows.map((r) => total(r)), 1);
  const fmt = (v) => revenue ? eur(v) : Math.round(v).toLocaleString("en-US");

  $("bars").innerHTML = rows.map((r) => {
    const tot = total(r), inc = Math.max(incr(r), 0), base = Math.max(tot - inc, 0);
    const wTot = (tot / max) * 100;
    const basePart = tot > 0 ? (base / tot) * wTot : 0;
    const incPart = tot > 0 ? (inc / tot) * wTot : 0;
    const incNeg = incr(r) < 0;
    return `<div class="bar-row">
      <span class="bar-ch" title="${esc(r.channel)}">${esc(r.channel)}</span>
      <span class="bar-track">
        <span class="bar-base" style="width:${basePart}%"></span>
        <span class="bar-inc ${incNeg ? "neg" : ""}" style="width:${incPart}%"></span>
      </span>
      <span class="bar-val">${fmt(inc)} <span style="color:var(--muted);font-weight:400">/ ${fmt(tot)}</span></span>
    </div>`;
  }).join("");
}

function renderTable(rep) {
  $("table").innerHTML = `<thead><tr>
      <th>Channel</th><th>Spend</th><th>Rep. ROAS</th><th>Incr. ROAS</th><th>Incrementality</th><th>p-value</th><th>Verdict</th>
    </tr></thead><tbody>${rep.sorted.map((r) => {
    const v = VERDICTS[r.verdict];
    const gap = r.reportedRoas > 0 && r.incrementalRoas < r.reportedRoas / 2;
    return `<tr>
      <td class="ch">${esc(r.channel)}<div style="font-size:10.5px;color:var(--muted);font-weight:400">${esc(r.source)}</div></td>
      <td>${eur(r.spend)}</td>
      <td style="color:${gap ? "var(--warn)" : "var(--text)"}">${r.reportedRoas}×</td>
      <td style="color:${r.incrementalRoas >= 1 ? "var(--good)" : "var(--bad)"}">${r.incrementalRoas}×</td>
      <td>${pct(r.incrementalityPct)}</td>
      <td>${r.pValue < 0.001 ? "&lt;0.001" : r.pValue.toFixed(3)}</td>
      <td><span class="pill ${v.cls}">${esc(v.label)}</span></td>
    </tr>`;
  }).join("")}</tbody>`;
}

function renderDetail() {
  const exp = EXPERIMENTS.find((e) => e.id === selectedExp);
  const r = analyzeExperiment(exp, options.conf);
  const v = VERDICTS[r.verdict];
  const maxRate = Math.max(r.treatmentRate, r.controlRate, 0.001);
  const tW = (r.treatmentRate / maxRate) * 100, cW = (r.controlRate / maxRate) * 100;

  $("detail").innerHTML = `
    <dt>Treatment rate</dt><dd style="color:var(--accent)">${pct(r.treatmentRate, 2)}</dd>
    <div style="grid-column:1/-1"><div class="rate-viz">
      <span class="rate-bar treat" style="width:${tW}%"></span>
      <span class="rate-bar ctrl" style="width:${cW}%"></span>
    </div><div class="rate-lab"><span style="color:var(--accent)">■</span> treatment ${pct(r.treatmentRate,2)} &nbsp; <span style="color:var(--muted)">■</span> control ${pct(r.controlRate,2)}</div></div>
    <dt>Control rate (baseline)</dt><dd style="color:var(--muted)">${pct(r.controlRate, 2)}</dd>
    <dt>Absolute lift</dt><dd>${pctSigned(r.lift, 2)}</dd>
    <dt>${CONFIDENCE[options.conf].label} confidence interval</dt><dd>${pctSigned(r.ciLow, 2)} … ${pctSigned(r.ciHigh, 2)}</dd>
    <dt>Two-proportion z</dt><dd>${r.z}</dd>
    <dt>p-value</dt><dd>${r.pValue < 0.001 ? "<0.001" : r.pValue.toFixed(3)}</dd>
    <dt>Incremental conversions</dt><dd>${Math.round(r.incrementalConversions)} of ${r.reportedConversions}</dd>
    <dt>Reported → incremental ROAS</dt><dd>${r.reportedRoas}× → <b style="color:${r.incrementalRoas >= 1 ? "var(--good)" : "var(--bad)"}">${r.incrementalRoas}×</b></dd>`;

  const cls = v.cls === "good" ? "good" : v.cls === "bad" ? "bad" : v.cls === "warn" ? "warn" : "muted";
  const msg = {
    incremental: `<b>Genuinely incremental.</b> The holdout gap is real at ${CONFIDENCE[options.conf].label} confidence — about <b>${pct(r.incrementalityPct)}</b> of these conversions wouldn't have happened without the spend. Scale it.`,
    harvesting: `<b>Mostly harvesting.</b> The lift is real but small — only <b>${pct(r.incrementalityPct)}</b> is incremental; the rest was coming anyway. The reported <b>${r.reportedRoas}×</b> ROAS is really <b>${r.incrementalRoas}×</b>.`,
    "no-lift": `<b>No measurable lift.</b> Treatment and control converted about the same (p=${r.pValue < 0.001 ? "<0.001" : r.pValue.toFixed(3)}). The reported <b>${r.reportedRoas}×</b> ROAS is demand you already had — incremental ROAS is <b>${r.incrementalRoas}×</b>.`,
    inconclusive: `<b>Inconclusive.</b> The holdout was too small — the interval (${pctSigned(r.ciLow,2)} … ${pctSigned(r.ciHigh,2)}) still spans a real effect and none. You can't act on this yet; run a bigger control group.`,
  }[r.verdict];
  $("detailCallout").innerHTML = `<div class="callout ${cls}"><span class="pill ${v.cls}">${esc(v.label)}</span> &nbsp;${msg}<div style="margin-top:8px;color:var(--muted);font-size:12px">${esc(r.note)}</div></div>`;
}

function renderInsight(rep) {
  const m = rep.metrics;
  const rows = rep.rows;
  const best = rows.slice().sort((a, b) => b.incrementalRoas - a.incrementalRoas)[0];
  const worst = rows.slice().filter((r) => r.verdict === "no-lift" || r.verdict === "harvesting")
    .sort((a, b) => (b.reportedRoas - b.incrementalRoas) - (a.reportedRoas - a.incrementalRoas))[0];
  const inconclusive = rows.filter((r) => r.verdict === "inconclusive").map((r) => r.channel);

  $("insight").innerHTML = `
    <p>Add up the seven reported numbers and the program looks like a <b>${m.reportedRoas}× ROAS</b> machine. Withhold each campaign from a control group and the truth is a <b>${m.incrementalRoas}× incremental ROAS</b> — reported revenue overstates what the spend actually caused by <b>${pctSigned(m.overstatementPct)}</b>. Only <b>${pct(m.incrementalityPct)}</b> of the conversions were genuinely incremental.</p>
    <p>The move: stop paying to harvest demand you already own. <b>${esc(worst.channel)}</b> reports <b>${worst.reportedRoas}×</b> but its holdout proves <b>${worst.incrementalRoas}×</b> — the classic ${worst.verdict === "no-lift" ? "no-lift" : "harvesting"} trap. Reallocate toward <b>${esc(best.channel)}</b>, where the control group clearly loses (${best.incrementalRoas}× incremental).${inconclusive.length ? ` And don't touch <b>${esc(inconclusive.join(", "))}</b> yet — the holdout is too small to conclude anything; fix the experiment before the budget.` : ""} This is the same demand-harvesting bias the attribution, consent-mode, and POAS tools each expose from a different angle — a holdout is the only one that actually proves causation.</p>`;
}

init();
