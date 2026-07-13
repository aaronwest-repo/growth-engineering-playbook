// UI for the Technical SEO Auditor. All logic lives in seo.js.
import { audit, CATEGORY_LABELS } from "./seo.js";
import { SITE } from "./site.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const R = audit(SITE);
let severity = "all";
let selectedCategory = null;
let selectedUrl = null;

function statusClass(s) { return s >= 400 ? "err" : s >= 300 ? "redir" : "ok"; }
function indexable(p) { return p.status === 200 && !p.noindex; }

function init() {
  document.querySelectorAll(".seg").forEach((seg) =>
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => { severity = b.dataset.value; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); render(); })));
  selectedUrl = R.pages.find((p) => p.issues.length)?.url || R.pages[0].url;
  render();
}

function matchesSeverity(page) {
  if (severity === "all") return true;
  return page.issues.some((i) => i.severity === severity);
}
function matchesCategory(page) {
  if (!selectedCategory) return true;
  return page.issues.some((i) => i.category === selectedCategory);
}

function render() {
  renderMetrics();
  renderCategories();
  renderFixes();
  renderCrawl();
  renderDetail();
  renderFilterNote();
}

function renderMetrics() {
  const m = R.metrics;
  const cards = [
    ["Pages crawled", m.pagesCrawled, ""],
    ["Health score", m.healthScore, m.healthScore >= 80 ? "good" : m.healthScore >= 50 ? "warn" : "bad"],
    ["Errors", m.errors, m.errors ? "bad" : "good"],
    ["Warnings", m.warnings, m.warnings ? "warn" : "good"],
    ["Broken links", m.brokenLinks, m.brokenLinks ? "bad" : "good"],
    ["Orphan pages", m.orphanPages, m.orphanPages ? "warn" : "good"],
    ["Indexable", m.indexablePages, ""],
  ];
  $("metrics").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("");
}

function renderCategories() {
  $("categories").innerHTML = R.categories.map((c) => `
    <li data-cat="${esc(c.category)}" aria-selected="${c.category === selectedCategory}">
      <span class="dot ${c.severity}"></span>
      <span>${esc(CATEGORY_LABELS[c.category] || c.category)} <span style="color:var(--muted)">· ${c.pages} page(s)</span></span>
      <span class="cat-count">${c.count}</span>
    </li>`).join("");
  $("categories").querySelectorAll("li").forEach((li) =>
    li.addEventListener("click", () => { selectedCategory = selectedCategory === li.dataset.cat ? null : li.dataset.cat; render(); }));
}

function renderFixes() {
  $("fixes").innerHTML = R.fixes.map((f) => `
    <li><span class="imp ${f.severity}">${f.impact}</span><span>${esc(f.text)}<br><span style="color:var(--muted);font-size:11.5px">${esc(CATEGORY_LABELS[f.category] || f.category)} · ${f.count} page(s)</span></span></li>`).join("");
}

function renderCrawl() {
  const rows = R.pages.filter((p) => matchesSeverity(p) && matchesCategory(p));
  $("crawlTitle").textContent = `Crawl — ${rows.length} URL${rows.length === 1 ? "" : "s"}${selectedCategory ? " · " + (CATEGORY_LABELS[selectedCategory] || selectedCategory) : ""}`;
  $("crawl").innerHTML = `<thead><tr>
      <th>URL</th><th class="n">Status</th><th>Type</th><th>Indexable</th><th class="n">In-links</th><th class="n">Issues</th>
    </tr></thead><tbody>${rows.map((p) => `
      <tr data-url="${esc(p.url)}" aria-selected="${p.url === selectedUrl}">
        <td class="url">${esc(p.url)}</td>
        <td class="n"><span class="st ${statusClass(p.status)}">${p.status}${p.redirectTo ? "→" : ""}</span></td>
        <td>${esc(p.type)}</td>
        <td>${p.status === 200 ? `<span class="pill ${indexable(p) ? "y" : "n"}">${indexable(p) ? "yes" : "noindex"}</span>` : "—"}</td>
        <td class="n">${p.inbound}</td>
        <td class="n"><span class="iss ${p.issues.length ? "has" : ""}">${p.issues.length || "·"}</span></td>
      </tr>`).join("")}</tbody>`;
  $("crawl").querySelectorAll("tbody tr").forEach((tr) =>
    tr.addEventListener("click", () => { selectedUrl = tr.dataset.url; render(); }));
}

function renderDetail() {
  const p = R.byUrl[selectedUrl];
  if (!p) { $("detail").innerHTML = "<p class='section-sub'>Select a URL above.</p>"; return; }
  const meta = [
    ["URL", p.url], ["Status", p.redirectTo ? `${p.status} → ${p.redirectTo}` : p.status], ["Type", p.type],
    ...(p.status === 200 ? [
      ["Title", p.title || "<em style='color:var(--bad)'>missing</em>"],
      ["Meta", p.meta || "<em style='color:var(--warn)'>missing</em>"],
      ["Canonical", p.canonical || "<em style='color:var(--warn)'>missing</em>"],
      ["H1", p.h1 || "<em style='color:var(--warn)'>missing</em>"],
      ["Words", p.words], ["Noindex", p.noindex ? "yes" : "no"],
      ["Schema", (p.schema || []).join(", ") || "<em style='color:var(--muted)'>none</em>"],
      ["Inbound links", p.inbound],
    ] : []),
  ];
  const issues = p.issues.length
    ? `<ul class="pd-issues">${p.issues.map((i) => `<li><span class="sev ${i.severity}">${i.severity}</span>${esc(i.detail)}<p class="fix">Fix: ${esc(i.fix)}</p></li>`).join("")}</ul>`
    : `<p class="section-sub" style="color:var(--good)">✓ No issues on this URL.</p>`;
  $("detail").innerHTML = `
    <dl class="pd-meta">${meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>
    <h4 style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">Issues (${p.issues.length})</h4>
    ${issues}`;
}

function renderFilterNote() {
  $("filterNote").innerHTML = selectedCategory
    ? `Filtered to <strong>${esc(CATEGORY_LABELS[selectedCategory] || selectedCategory)}</strong> · <a id="clearFilter">clear</a>`
    : "";
  const clr = $("clearFilter");
  if (clr) clr.addEventListener("click", () => { selectedCategory = null; render(); });
}

init();
