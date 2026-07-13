// UI for the Server-side vs Client-side Tracking model. All logic in tracking.js.
import { SCENARIOS } from "./scenarios.js";
import { buildReport, analyzeSegment, ARCHITECTURES } from "./tracking.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (x) => Math.round(Number(x)).toLocaleString("en-US");
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
const pctSigned = (x, d = 0) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";

let options = { arch: "hybrid", sort: "recovery" };
let selectedSeg = SCENARIOS[0].id;

function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));

  const sel = $("segSelect");
  sel.innerHTML = SCENARIOS.map((s) => `<option value="${s.id}">${esc(s.segment)}</option>`).join("");
  sel.value = selectedSeg;
  sel.addEventListener("change", () => { selectedSeg = sel.value; renderWaterfall(); });

  render();
}

function setControl(control, value, seg, btn) {
  options[control] = value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  const rep = buildReport(SCENARIOS, options);
  const m = rep.metrics;
  const archPct = { client: m.clientPct, server: m.serverPct, hybrid: m.hybridPct, naive: m.naivePct }[options.arch];
  $("fileInfo").innerHTML = `<strong>${m.segments}</strong> segments · <strong>${num(m.trueEvents)}</strong> true events · <strong>${ARCHITECTURES[options.arch].label}</strong> captures <strong>${pct(archPct)}</strong> · consent ceiling <strong>${pct(m.ceilingPct)}</strong> <span style="color:var(--muted)">(scenarios.js)</span>`;
  renderMetrics(m);
  renderBars(rep);
  renderTable(rep);
  renderWaterfall();
  renderInsight(rep);
}

function renderMetrics(m) {
  const cards = [
    ["True events", num(m.trueEvents), ""],
    ["Client-side", pct(m.clientPct), "bad"],
    ["Server-side", pct(m.serverPct), "warn"],
    ["Hybrid (deduped)", pct(m.hybridPct), "good"],
    ["Server recovery", pctSigned(m.serverRecoveryPct), "accent"],
    ["Consent ceiling", pct(m.ceilingPct), "warn"],
    ["Naive over-count", pctSigned(m.overcountPct), "bad", true],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls, sm]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd class="${sm ? "sm" : ""}">${esc(String(v))}</dd></div>`).join("");
}

function renderBars(rep) {
  const arch = options.arch;
  $("barsTitle").textContent = `${ARCHITECTURES[arch].label}: captured vs what actually happened`;
  $("barsSub").innerHTML = arch === "naive"
    ? `Blue = real captured events. <span style="color:var(--bad)">Hatched red = phantom events double-counted</span> because client and server aren't deduped. Amber line = consent ceiling.`
    : `Blue = captured under ${esc(ARCHITECTURES[arch].label.toLowerCase())}. Amber line = the consent ceiling (the most any stack can legally see).`;

  const rows = rep.sorted;
  const max = Math.max(...rows.map((r) => r.trueEvents), 1);

  $("bars").innerHTML = rows.map((r) => {
    const cap = r.captured[arch];
    const capW = Math.min((cap / max) * 100, 100);
    const trueW = (r.trueEvents / max) * 100;
    const ceilLeft = (r.ceiling / max) * 100;
    // Naive over-count: split fill into real (≤ceiling) + phantom (over).
    const realCap = arch === "naive" ? Math.min(cap, r.ceiling) : cap;
    const realW = Math.min((realCap / max) * 100, 100);
    const overW = arch === "naive" ? Math.max((cap - r.ceiling) / max * 100, 0) : 0;
    const overStr = overW > 0 ? `<span class="bar-fill over" style="left:${realW}%;width:${Math.min(overW, 100 - realW)}%;border-radius:0 5px 5px 0"></span>` : "";
    return `<div class="bar-row">
      <span class="bar-ch" title="${esc(r.segment)}">${esc(r.segment)}</span>
      <span class="bar-track" style="width:${trueW}%; min-width:60px">
        <span class="bar-fill" style="width:${realW / trueW * 100}%"></span>
        ${overW > 0 ? `<span class="bar-fill over" style="left:${realW / trueW * 100}%;width:${overW / trueW * 100}%"></span>` : ""}
        <span class="bar-ceiling" style="left:${ceilLeft / trueW * 100}%"></span>
      </span>
      <span class="bar-val">${pct(r.capturePct[arch])} <div class="sub">${num(cap)} / ${num(r.trueEvents)}</div></span>
    </div>`;
  }).join("");
}

function renderTable(rep) {
  const arch = options.arch;
  const sc = (k) => (k === options.sort ? " sorted" : "");
  $("table").innerHTML = `<thead><tr>
      <th>Segment</th><th>True</th><th class="${sc("loss").trim()}">Client-side</th><th class="${sc("recovery").trim()}">Server-side</th><th>Hybrid</th><th>Consent ceiling</th><th>Naive over-count</th>
    </tr></thead><tbody>${rep.sorted.map((r) => `
      <tr>
        <td class="ch">${esc(r.segment)}</td>
        <td>${num(r.trueEvents)}</td>
        <td style="color:var(--bad)">${pct(r.capturePct.client)}</td>
        <td style="color:var(--warn)">${pct(r.capturePct.server)} <span style="color:var(--accent);font-size:11px">(+${num(r.serverRecovery)})</span></td>
        <td style="color:var(--good)">${pct(r.capturePct.hybrid)}</td>
        <td>${pct(r.ceilingPct)}</td>
        <td style="color:var(--bad)">+${num(r.overcount)}</td>
      </tr>`).join("")}</tbody>`;
  // reflect selected architecture with a subtle header emphasis
  const map = { client: 2, server: 3, hybrid: 4, naive: 6 };
  const ths = $("table").querySelectorAll("thead th");
  if (ths[map[arch]]) ths[map[arch]].classList.add("sorted");
}

function renderWaterfall() {
  const s = analyzeSegment(SCENARIOS.find((x) => x.id === selectedSeg));
  const max = s.trueEvents;
  $("waterfall").innerHTML = s.waterfall.map((w, i) => {
    const keep = i === s.waterfall.length - 1;
    const width = (w.value / max) * 100;
    return `<div class="wf-row">
      <span class="wf-lab ${keep ? "keep" : ""}">${esc(w.cause)}</span>
      <span class="wf-track"><span class="wf-fill ${keep ? "keep" : "step"}" style="width:${width}%"></span></span>
      <span class="wf-val">${num(w.value)}${w.lost ? ` <span class="wf-lost ${w.recoverable ? "rec" : ""}">−${num(w.lost)}</span>` : ""}</span>
    </div>`;
  }).join("");

  const recPct = (s.trueEvents - s.captured.client) ? s.recoverable / (s.trueEvents - s.captured.client) : 0;
  $("wfCallout").innerHTML = `<div class="callout ${recPct >= 0.5 ? "warn" : "bad"}">
    Client-side captures <b>${pct(s.capturePct.client)}</b> of this segment. Of the <b>${num(s.clientLoss)}</b> lost events,
    <b style="color:var(--warn)">${num(s.recoverable)}</b> are recoverable server-side (ad-block, ITP, beacon) but
    <b style="color:var(--bad)">${num(s.unrecoverable)}</b> are consent — gone for every architecture.
    <div style="margin-top:8px;color:var(--muted);font-size:12px">${esc(s.note)}</div>
  </div>`;
}

function renderInsight(rep) {
  const m = rep.metrics;
  const worst = rep.rows.slice().sort((a, b) => a.capturePct.client - b.capturePct.client)[0];
  const bestRecovery = rep.rows.slice().sort((a, b) => b.serverRecovery - a.serverRecovery)[0];
  const consentBound = rep.rows.slice().sort((a, b) => a.ceilingPct - b.ceilingPct)[0];

  $("insight").innerHTML = `
    <p>Client-side alone captures just <b>${pct(m.clientPct)}</b> of ${num(m.trueEvents)} real events — and the gap isn't uniform: <b>${esc(worst.segment)}</b> loses down to <b>${pct(worst.capturePct.client)}</b>, so any channel heavy in that segment looks worse than it is. Server-side lifts capture to <b>${pct(m.serverPct)}</b> (<b>${pctSigned(m.serverRecoveryPct)}</b>), most of it in <b>${esc(bestRecovery.segment)}</b>.</p>
    <p>But server-side is not a magic recovery: <b>${pct(m.recoverableShare)}</b> of the client loss is recoverable tech loss, the rest is <b>consent</b> — and no architecture crosses the <b>${pct(m.ceilingPct)}</b> consent ceiling (only <b>${pct(consentBound.ceilingPct)}</b> in <b>${esc(consentBound.segment)}</b>). The trap is the other direction: run client + server without <b>event-id dedup</b> and you report <b>${pct(m.naivePct)}</b> of reality — a <b>${pctSigned(m.overcountPct)}</b> phantom inflation that flatters every conversion and ROAS number. The move: deploy server-side for the volume, dedup on a shared event id, and treat the consent ceiling as a fact of measurement — the same honesty the consent-mode (20), attribution (19) and holdout (22) tools each demand.</p>`;
}

init();
