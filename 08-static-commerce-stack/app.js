// UI for the Static Commerce Stack simulator. All logic lives in stack.js.
import { simulate } from "./stack.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (x) => "€" + Number(x).toFixed(2);

const REPO = "https://github.com/aaronwest-repo/growth-engineering-playbook/blob/main/08-static-commerce-stack/templates/";
const TEMPLATES = [
  ["deploy-static-site.sh", "Dry-run deploy template — build, sync, invalidate, verify"],
  [".env.example", "Placeholder environment variables"],
  ["cache-policy.json", "Cache-control policy (long-lived assets, short HTML)"],
  ["path-normalization-example.js", "Image-path normalizer + pre-deploy check"],
];

let options = { ttl: 3600, deployType: "content", invalidation: "changed", imageMode: "normalized", rollback: true };

function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setControl(seg.dataset.control, b.dataset.value, seg, b))));
  renderTemplates();
  loadTemplatePreview();
  render();
}

function setControl(control, value, seg, btn) {
  if (control === "ttl") options.ttl = Number(value);
  else if (control === "rollback") options.rollback = value === "yes";
  else options[control] = value;
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  render();
}

function render() {
  const r = simulate(options);
  renderPipeline(r);
  renderMetrics(r);
  renderChecklist(r.checklist);
  renderTimeline(r.cacheTimeline);
  renderRisks(r.risks);
  renderPlan(r);
  renderImgCheck(r.imagePathCheck);
}

function renderPipeline(r) {
  const stale = r.staleRisk.seconds > 0;
  const nodes = [
    { label: "Static source", sub: "Git repo", badge: "" },
    { label: "Build output", sub: "BUILD_DIR", badge: r.options.deployType + " deploy" },
    { label: "Object storage", sub: "STATIC_BUCKET_NAME", badge: "v2 uploaded" },
    { label: "CDN edge", sub: "CDN_DISTRIBUTION_ID", badge: stale ? "serving stale v1" : "refreshed → v2", edge: true, stale },
    { label: "Browser", sub: "SITE_DOMAIN", badge: stale ? "sees old version" : "sees new version", stale },
  ];
  $("pipeline").innerHTML = nodes.map((n, i) => `
    <div class="node ${n.edge ? "edge" : ""} ${n.stale ? "stale" : ""}">
      <span class="n-label">${esc(n.label)}</span>
      <span class="n-sub">${esc(n.sub)}</span>
      ${n.badge ? `<span class="n-badge">${esc(n.badge)}</span>` : ""}
    </div>${i < nodes.length - 1 ? '<span class="arrow">→</span>' : ""}`).join("");
}

function renderMetrics(r) {
  const lvl = r.staleRisk.level;
  const staleText = r.staleRisk.seconds === 0 ? "None" : r.cacheStatus.ttlLabel;
  const cards = [
    ["Stale-content risk", `${cap(lvl)}${r.staleRisk.seconds ? " · " + staleText : ""}`, `lvl-${lvl}`],
    ["Invalidation objects", r.invalidationPlan.objectsAffected === 0 ? "0" : String(r.invalidationPlan.objectsAffected), ""],
    ["Est. monthly cost", eur(r.cost.total), ""],
    ["Rollback", r.options.rollback ? "Available" : "None", r.options.rollback ? "lvl-none" : "lvl-high"],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
}

function renderChecklist(list) {
  $("checklist").innerHTML = list.map((c) => `
    <li><span class="phase">${esc(c.phase)}</span>
      <span><span class="label">${esc(c.label)}</span><br><span class="detail">${esc(c.detail)}</span></span></li>`).join("");
}

function renderTimeline(steps) {
  $("timeline").innerHTML = steps.map((s) => `
    <li><span class="dot"></span><span><span class="t-step">${esc(s.step)}</span><br><span class="t-detail">${esc(s.detail)}</span></span></li>`).join("");
}

function renderRisks(risks) {
  if (!risks.length) { $("risks").innerHTML = `<p class="no-risk">✓ No stale-content or deploy risks under the current choices.</p>`; return; }
  $("risks").innerHTML = risks.map((r) => `
    <div class="risk"><span class="sev sev-${r.severity}">${esc(r.severity)}</span><span>${esc(r.text)}</span></div>`).join("");
}

function renderPlan(r) {
  const inval = r.invalidationPlan.paths.length
    ? `<ul>${r.invalidationPlan.paths.map((p) => `<li><code>${esc(p)}</code></li>`).join("")}</ul>`
    : `<ul><li>None — nothing invalidated.</li></ul>`;
  const sync = `<ul>${r.syncPlan.map((s) => `<li>${esc(s.action)}: <code>${esc(s.path)}</code></li>`).join("")}</ul>`;
  const c = r.cost;
  $("plan").innerHTML = `
    <h4>Sync plan</h4>${sync}
    <h4>Invalidation (${esc(r.invalidationPlan.scope)}, ${r.invalidationPlan.objectsAffected} objects)</h4>${inval}
    <h4>Estimated monthly cost</h4>
    <div class="cost-row"><span>Object storage</span><span>${eur(c.storage)}</span></div>
    <div class="cost-row"><span>CDN base</span><span>${eur(c.cdnBase)}</span></div>
    <div class="cost-row"><span>Origin fetches (TTL)</span><span>${eur(c.ttlOrigin)}</span></div>
    <div class="cost-row"><span>Invalidation</span><span>${eur(c.invalidationCost)}</span></div>
    <div class="cost-row total"><span>Total</span><span>${eur(c.total)}</span></div>
    <p class="detail" style="color:var(--muted);font-size:12px;margin-top:8px">${esc(c.note)} ${esc(r.rollbackNote)}</p>`;
}

function renderImgCheck(ic) {
  $("imgcheck").innerHTML = ic.results.map((r) => {
    const cls = !r.ok ? "bad" : r.warn ? "warn" : "ok";
    const mark = !r.ok ? "✗" : r.warn ? "!" : "✓";
    return `<li><code>${esc(r.src)}</code><span class="${cls}">${mark} ${esc(r.reason)}</span></li>`;
  }).join("");
}

function renderTemplates() {
  $("tplList").innerHTML = TEMPLATES.map(([f, d]) =>
    `<li><a href="${REPO}${f}" target="_blank" rel="noopener"><code>templates/${esc(f)}</code></a><span style="color:var(--muted)">${esc(d)}</span></li>`).join("");
}

async function loadTemplatePreview() {
  try {
    const text = await (await fetch("templates/deploy-static-site.sh")).text();
    $("tplPreview").textContent = text;
  } catch {
    $("tplPreview").textContent = "Preview unavailable — view the file on GitHub.";
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

init();
