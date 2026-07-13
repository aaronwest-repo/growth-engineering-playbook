// UI for the Schema Markup Generator + Validator. All logic lives in schema.js.
import { parseCsv, generate, TYPES } from "./schema.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let catalogs = { clean: [], messy: [] };
let state = { type: "Product", source: "clean", productId: null };
let lastJson = "";

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }

async function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  $("productSelect").addEventListener("change", (e) => { state.productId = e.target.value; render(); });
  $("copyBtn").addEventListener("click", copy);

  try {
    const [c, m] = await Promise.all([
      fetchText("../shared-data/catalog/products-clean.csv"),
      fetchText("../shared-data/catalog/products-messy.csv"),
    ]);
    catalogs.clean = parseCsv(c);
    catalogs.messy = parseCsv(m);
    state.productId = catalogs.clean[0].product_id;
    populateProducts();
    render();
  } catch (e) {
    $("jsonld").textContent = "Couldn't load the catalog. Serve the repo from its root and open /16-schema-markup-generator/.";
  }
}

function populateProducts() {
  const list = catalogs[state.source];
  $("productSelect").innerHTML = list.map((p) => `<option value="${esc(p.product_id)}">${esc(p.title_en)} · ${esc(p.product_id)}${p.size ? " · " + esc(p.size) : ""}</option>`).join("");
  if (!list.some((p) => p.product_id === state.productId)) state.productId = list[0].product_id;
  $("productSelect").value = state.productId;
}

function setControl(control, value, seg, btn) {
  state[control] = value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  if (control === "source") populateProducts();
  if (control === "type") toggleProductControls();
  render();
}

function toggleProductControls() {
  const usesProduct = state.type === "Product" || state.type === "BreadcrumbList";
  $("productCtrl").style.display = usesProduct ? "" : "none";
  $("sourceCtrl").style.display = state.type === "Product" ? "" : "none";
}

function currentProduct() {
  return catalogs[state.source].find((p) => p.product_id === state.productId) || catalogs.clean[0];
}

function render() {
  if (!catalogs.clean.length) return;
  toggleProductControls();
  const { jsonld, report } = generate(state.type, { product: currentProduct() });
  lastJson = JSON.stringify(jsonld, null, 2);
  renderMetrics(report);
  renderCode(lastJson);
  renderReport(report);
  renderCoverage(report);
  renderEligibility(report);
}

function renderMetrics(r) {
  const c = r.counts;
  const cards = [
    ["Type", r.type, ""],
    ["Completeness", r.completeness + "%", r.completeness >= 85 ? "good" : r.completeness >= 60 ? "warn" : "bad"],
    ["Rich-eligible", r.richEligible ? "Yes" : "No", r.richEligible ? "good" : "bad"],
    ["Errors", c.error, c.error ? "bad" : "good"],
    ["Warnings", c.warning, c.warning ? "warn" : "good"],
    ["Required", `${c.reqPresent}/${c.reqTotal}`, c.reqPresent === c.reqTotal ? "good" : "bad"],
    ["Recommended", `${c.recPresent}/${c.recTotal}`, c.recPresent === c.recTotal ? "good" : "warn"],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
}

// Lightweight JSON syntax highlighting.
function highlight(json) {
  return esc(json)
    .replace(/&quot;(@?\w+)&quot;:/g, '<span class="k">"$1"</span>:')
    .replace(/: &quot;(.*?)&quot;/g, ': <span class="s">"$1"</span>')
    .replace(/: (\d+\.?\d*)(,?)$/gm, ': <span class="n">$1</span>$2');
}

function renderCode(json) {
  $("codeType").textContent = `${state.type} · ${state.type === "Product" ? state.source + " catalog" : "sample data"}`;
  $("jsonld").innerHTML = highlight(json);
}

function renderReport(r) {
  const all = [
    ...r.issues.error.map((x) => ({ ...x, level: "error" })),
    ...r.issues.warning.map((x) => ({ ...x, level: "warning" })),
    ...r.issues.info.map((x) => ({ ...x, level: "info" })),
  ];
  if (!all.length) { $("report").innerHTML = `<p class="rep-ok">✓ Clean — no errors, warnings, or notes. This markup is well-formed and complete.</p>`; return; }
  $("report").innerHTML = `<ul class="rep">${all.map((x) => `
    <li><span class="lvl ${x.level}">${x.level}</span><span>${esc(x.msg)}<br><span class="field">${esc(x.field)}</span></span></li>`).join("")}</ul>`;
}

function renderCoverage(r) {
  const list = (items) => `<ul>${items.map((f) => `<li><span class="tick ${f.present ? "y" : "n"}">${f.present ? "✓" : "✕"}</span>${esc(f.field)}</li>`).join("")}</ul>`;
  $("coverage").innerHTML = `
    <h4>Required (${r.counts.reqPresent}/${r.counts.reqTotal})</h4>${list(r.required)}
    <h4>Recommended (${r.counts.recPresent}/${r.counts.recTotal})</h4>${list(r.recommended)}`;
}

function renderEligibility(r) {
  $("eligibility").innerHTML = `
    <span class="badge ${r.richEligible ? "y" : "n"}">${r.richEligible ? "✓ Eligible" : "✕ Not eligible"} — ${esc(r.richName)}</span>
    <div class="bar"><span style="width:${r.completeness}%"></span></div>
    <p class="section-sub" style="margin:0">Completeness ${r.completeness}% (required weighted 2×)</p>
    <p class="rich-why">${esc(r.richReason)}</p>`;
}

function copy() {
  navigator.clipboard?.writeText(lastJson).then(() => {
    $("copyBtn").textContent = "Copied ✓";
    setTimeout(() => ($("copyBtn").textContent = "Copy"), 1400);
  }).catch(() => {});
}

init();
