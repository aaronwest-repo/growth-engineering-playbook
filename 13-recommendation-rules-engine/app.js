// UI for the Recommendation Rules Engine. All logic lives in rec.js.
import { parseCsv, parseJsonl, buildModel, recommend, coverage, STRATEGY_LABELS } from "./rec.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (x) => Number(x).toLocaleString("en-US");
const eur = (x) => "€" + Number(x).toLocaleString("en-US", { maximumFractionDigits: 0 });
const mpct = (x) => Math.round(x * 100) + "%";

let model = null;
let options = { objective: "balanced", marginFloor: "off", inStockOnly: true, suppressReturns: true, diversity: true, slots: 6 };
let seedId = null;
let selectedRec = null;
let current = null;

const boolFromValue = (v) => v === "on";

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }

async function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  $("seedSelect").addEventListener("change", (e) => { seedId = e.target.value; selectedRec = null; render(); });

  try {
    const [ps, we, ce, cv, ts] = await Promise.all([
      fetchText("../shared-data/catalog/products-clean.csv"),
      fetchText("../shared-data/events/web-events.jsonl"),
      fetchText("../shared-data/events/cart-events.jsonl"),
      fetchText("../shared-data/events/conversions.jsonl"),
      fetchText("../shared-data/customers/support-tickets.csv"),
    ]);
    model = buildModel({
      products: parseCsv(ps), webEvents: parseJsonl(we), cartEvents: parseJsonl(ce),
      conversions: parseJsonl(cv), tickets: parseCsv(ts),
    });
    $("fileInfo").innerHTML = `Catalog: <strong>${num(model.groups.length)}</strong> products (variants grouped) · <strong>${num(model.behaviorPairs)}</strong> behaviour pairs learned · <strong>${num(model.groups.filter((g) => g.returnRisk).length)}</strong> return-risk flagged <span style="color:var(--muted)">(shared-data)</span>`;
    populateSeeds();
    seedId = model.groups[0].id;
    render();
  } catch (e) {
    $("fileInfo").innerHTML = `Couldn't load data. Serve the repo from its <strong>root</strong> and open <code>/13-recommendation-rules-engine/</code>.`;
  }
}

function populateSeeds() {
  const byCat = {};
  model.groups.forEach((g) => (byCat[g.category] ||= []).push(g));
  $("seedSelect").innerHTML = Object.keys(byCat).sort().map((cat) =>
    `<optgroup label="${esc(cat)}">${byCat[cat].sort((a, b) => a.title.localeCompare(b.title)).map((g) =>
      `<option value="${esc(g.id)}">${esc(g.title)} — ${eur(g.price)}</option>`).join("")}</optgroup>`).join("");
}

function setControl(control, value, seg, btn) {
  if (control === "slots") options.slots = Number(value);
  else if (["inStockOnly", "suppressReturns", "diversity"].includes(control)) options[control] = boolFromValue(value);
  else options[control] = value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  selectedRec = null;
  render();
}

function render() {
  if (!model) return;
  current = recommend(model, seedId, options);
  const cov = coverage(model, options);
  if (!current.recommendations.some((r) => r.id === selectedRec)) selectedRec = current.recommendations[0]?.id || null;
  $("seedSelect").value = seedId;
  renderMetrics(cov);
  renderSeed(current.seed);
  renderSlate(current.recommendations);
  renderExplain();
  renderBreakdown(current.breakdown);
  renderGuardrails(current, cov);
}

function renderMetrics(cov) {
  const rr = model.groups.filter((g) => g.returnRisk).length;
  const cards = [
    ["Products", num(model.groups.length), ""],
    ["Coverage", cov.pct + "%", cov.pct >= 90 ? "good" : "warn"],
    ["Behaviour pairs", num(model.behaviorPairs), ""],
    ["Return-risk products", num(rr), rr ? "bad" : "good"],
    ["Catalog avg margin", mpct(model.catalogAvgMargin), ""],
    ["Slate avg margin", mpct(current.recAvgMargin) + (current.marginLift >= 0 ? ` (+${Math.round(current.marginLift * 100)})` : ` (${Math.round(current.marginLift * 100)})`), current.marginLift >= 0 ? "good" : "warn"],
    ["Suppressed (seed)", num(Object.values(current.guardrails.removed).reduce((a, b) => a + b, 0)), "warn"],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
}

function renderSeed(s) {
  $("seedPanel").innerHTML = `
    <div class="thumb">${esc(s.category[0])}</div>
    <div class="meta">
      <h3>${esc(s.title)}${s.returnRisk ? '<span class="badge risk">return-risk</span>' : ""}</h3>
      <div class="sub">${esc(s.category)} · ${esc(s.brand)} · ${eur(s.price)} · margin ${mpct(s.margin)} · ${s.stock} in stock · ${model.pop[s.id].views} views</div>
    </div>`;
}

function renderSlate(recs) {
  if (!recs.length) { $("slate").innerHTML = "<p class='section-sub'>No recommendations pass the current guardrails. Loosen a rule above.</p>"; return; }
  $("slate").innerHTML = recs.map((r, i) => `
    <div class="rec" data-id="${esc(r.id)}" aria-selected="${r.id === selectedRec}">
      <div class="rank">${i + 1}</div>
      <div>
        <div class="title">${esc(r.title)}${r.returnRisk ? '<span class="badge risk">risk</span>' : ""}</div>
        <div class="tags">${r.strategies.map((s) => `<span class="rtag ${s}">${esc(STRATEGY_LABELS[s])}</span>`).join("")}</div>
      </div>
      <div class="right"><div class="score">${r.score.toFixed(2)}</div><div class="price">${esc(r.category)} · ${eur(r.price)}</div></div>
    </div>`).join("");
  $("slate").querySelectorAll(".rec").forEach((el) =>
    el.addEventListener("click", () => { selectedRec = el.dataset.id; render(); }));
}

function renderExplain() {
  const r = current.recommendations.find((x) => x.id === selectedRec);
  if (!r) { $("explain").innerHTML = "<p class='section-sub'>Select a recommendation.</p>"; return; }
  const contribs = Object.entries(r.contrib).sort((a, b) => b[1] - a[1]);
  const maxC = Math.max(...contribs.map(([, v]) => v), 0.01);
  const rows = contribs.map(([s, v]) => `
    <div class="row"><span>${esc(STRATEGY_LABELS[s])}</span>
      <span class="bar"><span style="width:${(v / maxC) * 100}%"></span></span>
      <span class="val">${v.toFixed(2)}</span></div>`).join("");
  const seed = current.seed;
  const priceDelta = seed.price > 0 ? Math.round(((r.price - seed.price) / seed.price) * 100) : 0;
  $("explain").innerHTML = `
    <h3>${esc(r.title)}</h3>
    <div class="sub">${esc(r.category)} · ${esc(r.brand)} · ${eur(r.price)} · margin ${mpct(r.margin)} · score <b style="color:var(--accent)">${r.score.toFixed(2)}</b></div>
    <div class="contrib">${rows}</div>
    <ul class="reasons">
      ${r.reasons.map((x) => `<li><b>${esc(STRATEGY_LABELS[x.strat])}:</b> ${esc(x.text)}</li>`).join("")}
      <li><b>Margin:</b> ${mpct(r.margin)} vs seed ${mpct(seed.margin)} · <b>Price:</b> ${priceDelta >= 0 ? "+" : ""}${priceDelta}% vs seed · <b>Popularity:</b> ${r.views} views, ${r.purchases} purchases</li>
    </ul>`;
}

function renderBreakdown(breakdown) {
  const rows = breakdown.map((b) => `<tr>
    <td>${esc(b.label)}</td>
    <td>${b.weight.toFixed(1)}</td>
    <td>${b.surfaced}</td>
    <td>${b.inSlate}</td>
  </tr>`).join("");
  $("breakdown").innerHTML = `<thead><tr><th>Strategy</th><th>Weight</th><th>Surfaced</th><th>In slate</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderGuardrails(res, cov) {
  const g = res.guardrails;
  const rows = [
    ["In-stock only", g.inStockOnly, g.removed.in_stock],
    ["Margin floor" + (g.marginFloor !== "off" ? ` (${g.marginFloor})` : ""), g.marginFloor !== "off", g.removed.margin_floor],
    ["Suppress return-risk", g.suppressReturns, g.removed.return_risk],
    ["Category diversity (max 2)", g.diversity, g.removed.diversity],
  ];
  $("guardrails").innerHTML = `
    <ul class="gr">
      ${rows.map(([label, on, rm]) => `<li>
        <span>${esc(label)} <span class="state ${on ? "on" : "off"}">${on ? "ON" : "off"}</span></span>
        <span>${on && rm ? `<span class="rm">−${rm} removed</span>` : `<span style="color:var(--muted)">${on ? "0 removed" : "—"}</span>`}</span>
      </li>`).join("")}
    </ul>
    <p class="cov">Candidate pool: <b style="color:var(--text)">${g.candidatePool}</b> → <b style="color:var(--text)">${res.recommendations.length}</b> shown.
    Catalog coverage: <b>${cov.pct}%</b> (${cov.withRecs}/${cov.total} products get recommendations${cov.coldStart.length ? `; cold-start: ${cov.coldStart.length}` : ", no cold-start"}).</p>`;
}

init();
