// UI for the UTM audit dashboard. All analysis lives in audit.js.
import { parseCsv, auditCampaigns } from "./audit.js";

const MESSY_URL = "../shared-data/marketing/campaigns-messy.csv";
const CLEAN_URL = "../shared-data/marketing/campaigns-clean.csv";

const $ = (id) => document.getElementById(id);
const euro = (x) => (x == null ? "—" : "€" + Math.round(x).toLocaleString("en-US"));
const x = (v, d = 2) => (v == null ? "—" : v.toFixed(d) + "×");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let state = { view: "channel", audit: null, cleanAudit: null };

// --- Loading ---------------------------------------------------------------
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + " " + url);
  return res.text();
}

async function loadDefault() {
  try {
    const text = await fetchText(MESSY_URL);
    setData(text, "campaigns-messy.csv (shared-data)");
  } catch (err) {
    $("verdicts").innerHTML =
      `<div class="verdict error"><span class="dot" style="background:var(--bad)"></span>
      <div>Couldn't load the bundled sample (<code>${esc(MESSY_URL)}</code>).
      Serve the repo from its <strong>root</strong> (<code>python3 -m http.server</code>) and open
      <code>/02-utm-audit-dashboard/</code>, or drop your own campaign CSV above.</div></div>`;
    ["auditGrid", "statCards", "metricsTable", "bars"].forEach((id) => ($(id).innerHTML = ""));
  }
}

function setData(text, label) {
  const rows = parseCsv(text);
  state.audit = auditCampaigns(rows);
  $("fileInfo").innerHTML = `Loaded: <strong>${esc(label)}</strong> · ${state.audit.totals.rowCount} rows`;
  if ($("baselineToggle").checked) loadBaseline();
  else { state.cleanAudit = null; renderBaselineNote(); }
  renderAll();
}

async function loadBaseline() {
  try {
    const text = await fetchText(CLEAN_URL);
    state.cleanAudit = auditCampaigns(parseCsv(text));
  } catch {
    state.cleanAudit = null;
  }
  renderBaselineNote();
}

// --- Rendering -------------------------------------------------------------
function renderAll() {
  renderVerdicts();
  renderAudit();
  renderMetrics();
}

function renderVerdicts() {
  const a = state.audit;
  $("verdicts").innerHTML = a.verdicts
    .map((v) => `<div class="verdict sev-${v.severity}"><span class="dot"></span><div>${esc(v.text)}</div></div>`)
    .join("");
}

function issueCard(title, count, okWhenZero, bodyHtml) {
  const cls = count === 0 && okWhenZero ? "count ok" : "count";
  const label = count === 0 && okWhenZero ? "clean" : count;
  return `<article class="panel issue">
    <h3>${esc(title)} <span class="${cls}">${label}</span></h3>${bodyHtml}</article>`;
}

function renderAudit() {
  const i = state.audit.issues;

  const sources = i.sourceInconsistencies.length
    ? `<p>Channels reporting under more than one raw <code>source</code> label:</p>` +
      i.sourceInconsistencies
        .map((s) => `<div class="collide-row"><b>${esc(s.channel)}</b>: <span class="chips">` +
          s.labels.map((l) => `<span class="chip">${esc(l)}</span>`).join("") + `</span></div>`)
        .join("")
    : `<p>Every channel uses a single consistent source label.</p>`;

  const mediums = i.mediumInconsistencies.length
    ? `<p>Intended mediums spelled inconsistently:</p>` +
      i.mediumInconsistencies
        .map((m) => `<div class="collide-row"><b>${esc(m.canonical)}</b> <span class="chips">` +
          m.labels.map((l) => `<span class="chip">${esc(l)}</span>`).join("") + `</span></div>`)
        .join("")
    : `<p>Every medium uses a single consistent label.</p>`;

  const mc = i.missingCampaign;
  const missing = mc.rows
    ? `<p><b>${mc.rows}</b> rows have no campaign tag, hiding <b>${euro(mc.spend)}</b>
       (${(mc.pctSpend * 100).toFixed(1)}% of spend) from any campaign-level decision.</p>`
    : `<p>Every row carries a campaign tag.</p>`;

  const collisions = i.namingCollisions.length
    ? `<p>One campaign, several spellings — each splits into its own reporting row:</p>` +
      i.namingCollisions.slice(0, 4)
        .map((c) => `<div class="collide-row"><b>${esc(c.normalized)}</b> — ${c.variants.length} spellings` +
          (c.sources.length > 1 ? `, across ${esc(c.sources.join(" + "))}` : "") +
          `<div class="chips" style="margin-top:5px">` +
          c.variants.map((v) => `<span class="chip">${esc(JSON.stringify(v))}</span>`).join("") + `</div></div>`)
        .join("") +
      (i.namingCollisions.length > 4 ? `<p style="margin-top:6px">…and ${i.namingCollisions.length - 4} more.</p>` : "")
    : `<p>No campaign naming collisions detected.</p>`;

  $("auditGrid").innerHTML = [
    issueCard("Inconsistent sources", i.sourceInconsistencies.length, true, sources),
    issueCard("Inconsistent mediums", i.mediumInconsistencies.length, true, mediums),
    issueCard("Missing campaign tags", mc.rows, true, missing),
    issueCard("Naming collisions", i.namingCollisions.length, true, collisions),
  ].join("");
}

function renderBaselineNote() {
  const note = $("baselineNote");
  const c = state.cleanAudit;
  if (!c) { note.hidden = true; note.className = "baseline-note"; return; }
  const ci = c.issues;
  const issues = ci.sourceInconsistencies.length + ci.mediumInconsistencies.length +
    (ci.missingCampaign.rows ? 1 : 0) + ci.namingCollisions.length;
  note.hidden = false;
  note.className = "baseline-note on";
  note.innerHTML = `✓ Clean baseline (<code>campaigns-clean.csv</code>): ${issues} hygiene issues, ` +
    `${ci.missingCampaign.rows} missing tags — same ${euro(c.totals.spend)} spend, correctly attributed across ` +
    `${c.channels.length} channels. Governed tracking makes the mess above disappear.`;
}

function renderMetrics() {
  const a = state.audit;
  const t = a.totals;

  $("statCards").innerHTML = [
    ["Total spend", euro(t.spend)],
    ["Blended ROAS", x(t.roas)],
    ["Blended POAS", x(t.poas)],
    ["Blended CPA", euro(t.cpa)],
  ].map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`).join("");

  const rows = state.view === "blended"
    ? []
    : a.channels.map((c) => {
        const poasCls = c.poas != null && c.poas < 1 ? "val-bad" : "val-good";
        const split = c.rawLabelCount > 1 ? `<span class="badge-split">${c.rawLabelCount} labels</span>` : "";
        return `<tr>
          <td>${esc(c.name)}${split}</td>
          <td>${euro(c.spend)}</td>
          <td>${euro(c.revenue)}</td>
          <td>${x(c.roas)}</td>
          <td class="${poasCls}">${x(c.poas)}</td>
          <td>${euro(c.cpa)}</td>
        </tr>`;
      }).join("");

  $("metricsTable").innerHTML =
    `<thead><tr><th>Channel</th><th>Spend</th><th>Revenue</th><th>ROAS</th><th>POAS</th><th>CPA</th></tr></thead>
     <tbody>${rows}
       <tr class="blended"><td>Blended (all)</td><td>${euro(t.spend)}</td><td>${euro(t.revenue)}</td>
       <td>${x(t.roas)}</td><td>${x(t.poas)}</td><td>${euro(t.cpa)}</td></tr>
     </tbody>`;

  renderBars();
}

function renderBars() {
  const bars = $("bars");
  if (state.view === "blended") { bars.innerHTML = ""; return; }
  const chans = state.audit.channels;
  // Scale to channels with material spend so a near-zero-spend owned channel
  // (e.g. newsletter at 235x ROAS) doesn't flatten every paid channel's bar.
  // Outliers still render full-width with their real value in the label.
  const material = chans.filter((c) => c.spend >= state.audit.totals.spend * 0.01);
  const max = Math.max(...(material.length ? material : chans).map((c) => c.roas || 0), 2);
  const pctOf = (v) => Math.max(2, Math.min(100, (v / max) * 100));
  const breakevenLeft = Math.min(100, (1 / max) * 100);

  bars.innerHTML = chans.map((c) => {
    const under = c.poas != null && c.poas < 1;
    return `<div class="barrow">
      <span class="name">${esc(c.name)}</span>
      <div class="bar-pair">
        <div class="bar"><span class="fill-roas" style="width:${pctOf(c.roas || 0)}%"></span><b>${x(c.roas)} ROAS</b></div>
        <div class="bar">
          <span class="fill-poas ${under ? "under" : ""}" style="width:${pctOf(c.poas || 0)}%"></span>
          <span class="breakeven" style="left:${breakevenLeft}%"></span>
          <b>${x(c.poas)} POAS</b>
        </div>
      </div>
    </div>`;
  }).join("");
}

// --- Interactions ----------------------------------------------------------
function setView(view) {
  state.view = view;
  $("viewChannel").setAttribute("aria-pressed", String(view === "channel"));
  $("viewBlended").setAttribute("aria-pressed", String(view === "blended"));
  $("channelView").hidden = view === "blended";
  renderMetrics();
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => setData(String(reader.result), file.name + " (uploaded)");
  reader.readAsText(file);
}

function init() {
  $("viewChannel").addEventListener("click", () => setView("channel"));
  $("viewBlended").addEventListener("click", () => setView("blended"));

  const dz = $("dropzone");
  $("fileInput").addEventListener("change", (e) => { if (e.target.files[0]) readFile(e.target.files[0]); });
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });

  $("baselineToggle").addEventListener("change", (e) => {
    if (e.target.checked) loadBaseline();
    else { state.cleanAudit = null; renderBaselineNote(); }
  });

  loadDefault();
}

init();
