import {
  AFFILIATE_FEED_EXPORT_COLUMNS,
  GOOGLE_FEED_EXPORT_COLUMNS,
  cleanCatalog,
  googleFeedXml,
  parseCsv,
  toCsv,
} from "./cleaner.js";

const SAMPLE_MESSY = "../shared-data/catalog/products-messy.csv";

const state = {
  rows: [],
  result: null,
  fileName: "products-messy.csv (shared-data)",
  view: "review",
};

const $ = (id) => document.getElementById(id);
const fmtPct = (n) => `${(n * 100).toFixed(0)}%`;
const fmtCount = (n) => Number(n || 0).toLocaleString("en-US");

const issueLabels = {
  missing_gtin: "Missing GTIN",
  missing_color_inferred: "Missing color",
  missing_material_inferred: "Missing material",
  missing_stock: "Missing stock",
  localized_price: "Localized price",
  duplicate_sku: "Duplicate SKU",
  banned_claim: "Unsupported claim",
  language_bleed: "Language bleed",
};

const issueOrder = [
  "missing_gtin",
  "missing_color_inferred",
  "missing_material_inferred",
  "missing_stock",
  "localized_price",
  "duplicate_sku",
  "banned_claim",
  "language_bleed",
];

function euro(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? `€${n.toFixed(2)}` : value || "-";
}

function statusLabel(status) {
  return status === "export_ready" ? "Export-ready"
    : status === "blocked" ? "Blocked"
    : "Review";
}

function statusClass(status) {
  return status === "export_ready" ? "good"
    : status === "blocked" ? "bad"
    : "warn";
}

async function loadSample() {
  const response = await fetch(SAMPLE_MESSY);
  if (!response.ok) throw new Error(`Could not load ${SAMPLE_MESSY}`);
  loadCsv(await response.text(), "products-messy.csv (shared-data)");
}

function loadCsv(text, fileName) {
  state.rows = parseCsv(text);
  state.result = cleanCatalog(state.rows);
  state.fileName = fileName;
  render();
}

function render() {
  if (!state.result) return;
  const { summary } = state.result;

  $("fileInfo").innerHTML = `Loaded: <strong>${state.fileName}</strong>  -  ${fmtCount(summary.rowCount)} rows`;
  $("statCards").innerHTML = [
    ["Catalog rows", summary.rowCount],
    ["Products changed", summary.changedProducts],
    ["Need review", summary.statusCounts.review],
    ["Blocked from export", summary.statusCounts.blocked],
    ["Exportable feed rows", summary.exportableRows],
    ["Avg. confidence", fmtPct(summary.averageConfidence)],
  ].map(([label, value]) => `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`).join("");

  renderVerdict();
  renderIssueBars();
  renderTabs();
  renderCurrentView();
}

function renderVerdict() {
  const { summary } = state.result;
  const verdicts = [
    {
      severity: "bad",
      text: `${summary.statusCounts.blocked} products are blocked from feeds because the demo refuses to guess on duplicate SKUs or missing stock.`,
    },
    {
      severity: "warn",
      text: `${summary.statusCounts.review} products need human review. The cleaner can suggest fixes, but GTINs, claims, and inferred attributes still need an owner.`,
    },
    {
      severity: "info",
      text: `${summary.changedProducts} rows were normalized with deterministic rules: casing, sizes, localized prices, HTML cleanup, and feed-safe descriptions.`,
    },
    {
      severity: "good",
      text: `${summary.exportableRows} rows can be exported to Google Shopping XML and affiliate CSV after the blockers are resolved.`,
    },
  ];
  $("verdicts").innerHTML = verdicts.map((v) => `
    <div class="verdict sev-${v.severity}">
      <span class="dot"></span>
      <span>${v.text}</span>
    </div>
  `).join("");
}

function renderIssueBars() {
  const counts = state.result.summary.issueCounts;
  const max = Math.max(...issueOrder.map((code) => counts[code] || 0), 1);
  $("issueBars").innerHTML = issueOrder.map((code) => {
    const count = counts[code] || 0;
    const width = Math.max(4, count / max * 100);
    return `
      <div class="issue-row">
        <span>${issueLabels[code]}</span>
        <div class="track"><i style="width:${width}%"></i></div>
        <b>${count}</b>
      </div>
    `;
  }).join("");
}

function renderTabs() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
  });
}

function renderCurrentView() {
  const title = {
    review: "Human Review Queue",
    diff: "Before / After Diff",
    google: "Google Shopping Feed Preview",
    affiliate: "Affiliate Feed Preview",
  }[state.view];
  $("viewTitle").textContent = title;

  if (state.view === "review") renderReviewQueue();
  if (state.view === "diff") renderDiffTable();
  if (state.view === "google") renderGooglePreview();
  if (state.view === "affiliate") renderAffiliatePreview();
}

function renderReviewQueue() {
  const rows = state.result.products
    .filter((p) => p.status !== "export_ready")
    .sort((a, b) => a.status.localeCompare(b.status) || a.confidence - b.confidence)
    .slice(0, 12);

  $("viewBody").innerHTML = `
    <p class="view-note">
      This is the point of the demo: automation prepares the decision, but does not
      silently invent GTINs, stock, or legally risky product claims.
    </p>
    <div class="review-list">
      ${rows.map((p) => `
        <article class="review-card">
          <div class="review-head">
            <div>
              <h3>${p.clean.title_en}</h3>
              <p>${p.clean.sku}  -  ${p.clean.brand}  -  ${p.clean.category}</p>
            </div>
            <span class="status ${statusClass(p.status)}">${statusLabel(p.status)}</span>
          </div>
          <div class="confidence">
            <span>Confidence</span>
            <div><i style="width:${Math.round(p.confidence * 100)}%"></i></div>
            <b>${fmtPct(p.confidence)}</b>
          </div>
          <ul>
            ${p.issues.map((issue) => `<li><strong>${issueLabels[issue.code] || issue.code}:</strong> ${issue.message} <em>${issue.fix}</em></li>`).join("")}
          </ul>
        </article>
      `).join("")}
    </div>
  `;
}

function renderDiffTable() {
  const rows = state.result.products.filter((p) => p.changes.length).slice(0, 14);
  $("viewBody").innerHTML = `
    <p class="view-note">Representative field-level changes. Low-confidence fixes stay visible instead of disappearing into the output file.</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Product</th><th>Field</th><th>Before</th><th>After</th><th>Confidence</th></tr>
        </thead>
        <tbody>
          ${rows.flatMap((p) => p.changes.slice(0, 3).map((change) => `
            <tr>
              <td><strong>${p.clean.product_id}</strong><br><span>${p.clean.title_en}</span></td>
              <td>${change.field}</td>
              <td>${escapeHtml(shorten(change.from || "-", 72))}</td>
              <td>${escapeHtml(shorten(change.to || "-", 72))}</td>
              <td>${fmtPct(change.confidence)}</td>
            </tr>
          `)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderGooglePreview() {
  const rows = state.result.googleFeed.slice(0, 7);
  $("viewBody").innerHTML = `
    <p class="view-note">Preview of the channel-ready Google Shopping export. Blocked products are intentionally excluded.</p>
    ${feedActions("google")}
    <pre class="code-preview">${escapeHtml(googleFeedXml(rows))}</pre>
  `;
}

function renderAffiliatePreview() {
  const csv = toCsv(state.result.affiliateFeed.slice(0, 10), AFFILIATE_FEED_EXPORT_COLUMNS);
  $("viewBody").innerHTML = `
    <p class="view-note">Preview of a generic affiliate CSV feed. Same cleaned catalog, different channel contract.</p>
    ${feedActions("affiliate")}
    <pre class="code-preview">${escapeHtml(csv)}</pre>
  `;
}

function feedActions(kind) {
  const count = kind === "google" ? state.result.googleFeed.length : state.result.affiliateFeed.length;
  const label = kind === "google" ? "Google XML" : "Affiliate CSV";
  return `<div class="feed-meta"><span>${count} exportable rows</span><button type="button" data-download="${kind}">Download ${label}</button></div>`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shorten(value, max) {
  const s = String(value);
  return s.length > max ? `${s.slice(0, max - 1)}...` : s;
}

function download(kind) {
  const isGoogle = kind === "google";
  const content = isGoogle
    ? googleFeedXml(state.result.googleFeed)
    : toCsv(state.result.affiliateFeed, AFFILIATE_FEED_EXPORT_COLUMNS);
  const blob = new Blob([content], { type: isGoogle ? "application/xml" : "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = isGoogle ? "google-shopping-feed.xml" : "affiliate-feed.csv";
  link.click();
  URL.revokeObjectURL(url);
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    renderTabs();
    renderCurrentView();
  });
});

$("viewBody").addEventListener("click", (event) => {
  const button = event.target.closest("[data-download]");
  if (button) download(button.dataset.download);
});

$("fileInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  loadCsv(await file.text(), file.name);
});

$("dropzone").addEventListener("click", () => $("fileInput").click());
$("dropzone").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("dropzone").classList.add("drag");
});
$("dropzone").addEventListener("dragleave", () => $("dropzone").classList.remove("drag"));
$("dropzone").addEventListener("drop", async (event) => {
  event.preventDefault();
  $("dropzone").classList.remove("drag");
  const file = event.dataTransfer.files?.[0];
  if (file) loadCsv(await file.text(), file.name);
});

loadSample().catch((error) => {
  $("fileInfo").textContent = error.message;
  $("fileInfo").classList.add("error");
});
