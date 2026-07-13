// UI for the Attribution Model Comparator. All logic lives in attribution.js.
import { parseJsonl, analyze, journeyDetail, MODELS, MODEL_LABELS } from "./attribution.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => "€" + Math.round(Number(x)).toLocaleString("en-US");
const chLabel = (c) => c.replace(/_/g, " ");

let R = null;
let model = "last";
let selectedJourney = null;

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }

async function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => { model = b.dataset.value; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); render(); })));
  $("journeySelect").addEventListener("change", (e) => { selectedJourney = e.target.value; renderJourney(); });

  try {
    const [we, cv] = await Promise.all([
      fetchText("../shared-data/events/web-events.jsonl"),
      fetchText("../shared-data/events/conversions.jsonl"),
    ]);
    R = analyze({ webEvents: parseJsonl(we), conversions: parseJsonl(cv) });
    $("fileInfo").innerHTML = `Rebuilt <strong>${R.metrics.conversions}</strong> conversion journeys · <strong>${R.metrics.multiTouch}</strong> multi-touch · <strong>${R.metrics.channels}</strong> channels · <strong>${R.metrics.models}</strong> models <span style="color:var(--muted)">(shared-data)</span>`;
    $("revInline").textContent = R.metrics.revenue.toLocaleString("en-US");
    populateJourneys();
    render();
  } catch (e) {
    $("fileInfo").innerHTML = `Couldn't load event data. Serve the repo from its <strong>root</strong> and open <code>/19-attribution-model-comparator/</code>.`;
  }
}

function populateJourneys() {
  // Prefer multi-touch journeys (they show the divergence); then a few single-touch.
  const sorted = R.journeys.slice().sort((a, b) => (b.multiChannel - a.multiChannel) || (b.value - a.value));
  selectedJourney = sorted[0].id;
  $("journeySelect").innerHTML = sorted.slice(0, 40).map((j) =>
    `<option value="${esc(j.id)}">${esc(j.id)} · ${j.channels.map(chLabel).join(" → ")} · ${eur(j.value)}${j.multiChannel ? " · multi-touch" : ""}</option>`).join("");
}

function render() {
  if (!R) return;
  renderMetrics();
  renderCmp();
  renderWinners();
  renderBias();
  renderJourney();
}

function renderMetrics() {
  const m = R.metrics;
  const top = R.bias[0];
  const cards = [
    ["Conversions", m.conversions, ""],
    ["Attributed revenue", eur(m.revenue), ""],
    ["Multi-touch journeys", m.multiTouch, "warn"],
    ["Avg touches", m.avgPathLength, ""],
    ["Channels", m.channels, ""],
    ["Models", m.models, ""],
    ["Top last-click bias", `${chLabel(top.channel)} +${top.delta}pts`, "bad", true],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls, sm]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd class="${sm ? "sm" : ""}">${esc(String(v))}</dd></div>`).join("");
}

function renderCmp() {
  const cols = MODELS.map((m) => `<col class="${m === model ? "hi" : ""}" />`).join("");
  const head = `<thead><tr><th>Channel</th>${MODELS.map((m) => `<th class="${m === model ? "hi" : ""}">${esc(MODEL_LABELS[m])}</th>`).join("")}<th>Swing</th></tr></thead>`;
  const rows = R.channels.map((c) => {
    const vals = MODELS.map((m) => R.byModel[m].credit[c].value);
    const min = Math.min(...vals), max = Math.max(...vals);
    const swing = max - min;
    return `<tr><td class="ch">${esc(chLabel(c))}</td>${MODELS.map((m) => `<td class="${m === model ? "hi" : ""}">${eur(R.byModel[m].credit[c].value)}</td>`).join("")}<td>${swing > 1 ? `<span class="swing">±${eur(swing)}</span>` : "—"}</td></tr>`;
  }).join("");
  $("cmp").innerHTML = `<colgroup><col />${cols}<col /></colgroup>${head}<tbody>${rows}</tbody>`;
}

function renderWinners() {
  $("winModel").textContent = MODEL_LABELS[model];
  const credit = R.byModel[model].credit;
  const ranked = R.channels.slice().sort((a, b) => credit[b].value - credit[a].value);
  const max = Math.max(...ranked.map((c) => credit[c].value), 1);
  $("winners").innerHTML = ranked.map((c, i) => `
    <li><span>${i === 0 ? "🏆 " : ""}${esc(chLabel(c))}</span>
      <span class="bar"><span style="width:${(credit[c].value / max) * 100}%"></span></span>
      <span class="val">${eur(credit[c].value)} · ${credit[c].share}%</span></li>`).join("");
}

function renderBias() {
  const max = Math.max(...R.bias.map((b) => Math.abs(b.delta)), 1);
  $("bias").innerHTML = R.bias.map((b) => {
    const w = (Math.abs(b.delta) / max) * 50;
    const fill = b.delta >= 0 ? `<span class="fill pos" style="width:${w}%"></span>` : `<span class="fill neg" style="width:${w}%"></span>`;
    return `<li><span>${esc(chLabel(b.channel))}</span>
      <span class="track"><span class="mid"></span>${b.delta ? fill : ""}</span>
      <span class="d ${b.delta > 0 ? "pos" : b.delta < 0 ? "neg" : ""}">${b.delta > 0 ? "+" : ""}${b.delta}</span></li>`;
  }).join("");
  const closer = R.bias[0], intro = R.bias[R.bias.length - 1];
  $("biasNote").innerHTML = `Last-click over-credits <strong>${esc(chLabel(closer.channel))}</strong> by ${closer.delta} pts and under-credits <strong>${esc(chLabel(intro.channel))}</strong> by ${Math.abs(intro.delta)} pts vs first-click — budget shifted on the model alone.`;
}

function renderJourney() {
  const j = R.journeys.find((x) => x.id === selectedJourney);
  if (!j) { $("journeyPath").innerHTML = ""; $("journeyTable").innerHTML = ""; return; }
  $("journeySelect").value = selectedJourney;
  const n = j.channels.length;
  $("journeyPath").innerHTML = j.channels.map((c, i) => {
    const cls = i === 0 ? "first" : i === n - 1 ? "last" : "";
    return `<span class="chip ${cls}">${esc(chLabel(c))}</span>${i < n - 1 ? '<span class="arr">→</span>' : ""}`;
  }).join("") + ` &nbsp;<span class="section-sub">= ${eur(j.value)} conversion</span>`;

  const d = journeyDetail(j);
  const head = `<thead><tr><th>Model</th>${j.channels.map((c, i) => `<th>${esc(chLabel(c))}${i === 0 ? " (first)" : i === n - 1 ? " (last)" : ""}</th>`).join("")}</tr></thead>`;
  const body = d.rows.map((row) => `<tr><td>${esc(MODEL_LABELS[row.model])}</td>${row.splits.map((s) => `<td class="${s.value < 0.5 ? "z" : ""}">${s.value >= 0.5 ? eur(s.value) : "·"}</td>`).join("")}</tr>`).join("");
  $("journeyTable").innerHTML = head + `<tbody>${body}</tbody>`;
}

init();
