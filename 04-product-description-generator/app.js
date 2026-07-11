// UI for the Product Description Generator. All logic lives in generator.js.
import { parseCsv, generateCopy, findBannedClaims } from "./generator.js";

const CLEAN_URL = "../shared-data/catalog/products-clean.csv";
const MESSY_URL = "../shared-data/catalog/products-messy.csv";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let state = { products: [], messyById: {}, profile: "premium", productId: null };

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status + " " + url);
  return r.text();
}

async function init() {
  document.querySelectorAll(".voice button").forEach((b) =>
    b.addEventListener("click", () => setProfile(b.dataset.profile)));
  $("productSelect").addEventListener("change", (e) => { state.productId = e.target.value; render(); });

  try {
    const [cleanText, messyText] = await Promise.all([fetchText(CLEAN_URL), fetchText(MESSY_URL)]);
    state.products = parseCsv(cleanText);
    parseCsv(messyText).forEach((r) => (state.messyById[r.product_id] = r));
    $("fileInfo").innerHTML = `Loaded: <strong>products-clean.csv (shared-data)</strong> · ${state.products.length} products`;
    populateSelect();
    state.productId = state.products[0].product_id;
    $("productSelect").value = state.productId;
    render();
  } catch (err) {
    $("fileInfo").innerHTML = `Couldn't load the sample catalog (<code>${esc(CLEAN_URL)}</code>). Serve the repo from its <strong>root</strong> and open <code>/04-product-description-generator/</code>.`;
  }
}

function populateSelect() {
  $("productSelect").innerHTML = state.products
    .map((p) => `<option value="${esc(p.product_id)}">${esc(p.title_en)} — ${esc(p.sku)}</option>`)
    .join("");
}

function setProfile(profile) {
  state.profile = profile;
  document.querySelectorAll(".voice button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.profile === profile)));
  render();
}

const FACT_FIELDS = [
  ["product_id", "Product ID"], ["sku", "SKU"], ["title_en", "Title (EN)"], ["title_de", "Title (DE)"],
  ["brand", "Brand"], ["category", "Category"], ["price", "Price"], ["currency", "Currency"],
  ["size", "Size"], ["color", "Color"], ["material", "Material"], ["gtin", "GTIN"],
];

function render() {
  const product = state.products.find((p) => p.product_id === state.productId);
  if (!product) return;
  const legacy = state.messyById[product.product_id];
  const result = generateCopy(product, { profile: state.profile, legacyCopy: legacy ? legacy.description_en : "" });

  renderFacts(product);
  renderOutput(result, legacy);
  renderReport(result.guardrail, legacy);
}

function renderFacts(product) {
  $("facts").innerHTML = FACT_FIELDS.map(([k, label]) => {
    const v = (product[k] || "").trim();
    const dd = v ? `<dd>${esc(v)}</dd>` : `<dd class="empty">— missing —</dd>`;
    return `<dt>${label}</dt>${dd}`;
  }).join("") +
    `<dt>Desc (EN)</dt><dd>${esc(product.description_en || "—")}</dd>` +
    `<dt>Desc (DE)</dt><dd>${esc(product.description_de || "—")}</dd>`;
}

function copyCard(title, len, bodyHtml, copyText) {
  const lenHtml = len != null ? `<span class="len">${len} chars</span>` : "";
  const btn = copyText != null
    ? `<button class="copy-btn" data-copy="${esc(copyText)}">Copy</button>`
    : lenHtml;
  return `<div class="out"><h3>${esc(title)} ${len != null ? lenHtml : ""}${copyText != null ? btn : ""}</h3>${bodyHtml}</div>`;
}

function renderOutput(r, legacy) {
  const cards = [];
  cards.push(copyCard("English description", null, `<p>${esc(r.en)}</p>`, r.en));
  cards.push(copyCard("German description", null, `<p>${esc(r.de)}</p>`, r.de));
  cards.push(copyCard("Bullet points", null, `<ul>${r.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`, r.bullets.join("\n")));
  cards.push(copyCard("Meta title", r.metaTitle.length, `<p>${esc(r.metaTitle)}</p>`, r.metaTitle));
  cards.push(copyCard("Meta description", r.metaDescription.length, `<p>${esc(r.metaDescription)}</p>`, r.metaDescription));
  cards.push(copyCard("Marketplace short", null, `<p>${esc(r.marketplaceShort)}</p>`, r.marketplaceShort));

  // Legacy copy demo: show what guardrails would strip from existing catalog copy.
  if (legacy && legacy.description_en && findBannedClaims(legacy.description_en).length) {
    const claims = findBannedClaims(legacy.description_en);
    let marked = esc(legacy.description_en);
    claims.forEach((c) => { marked = marked.replace(new RegExp("(" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi"), "<del>$1</del>"); });
    cards.push(copyCard("Legacy catalog copy → sanitized", null,
      `<p class="legacy">${marked}</p><p style="margin-top:8px"><strong>Governed replacement (from facts):</strong> ${esc(r.en)}</p>`, null));
  }

  $("output").innerHTML = cards.join("");
  $("output").querySelectorAll(".copy-btn").forEach((b) =>
    b.addEventListener("click", () => {
      navigator.clipboard?.writeText(b.dataset.copy);
      const t = b.textContent; b.textContent = "Copied"; setTimeout(() => (b.textContent = t), 1200);
    }));
}

function renderReport(g, legacy) {
  const groups = [];

  if (g.blocked.length) {
    groups.push(`<div class="rep-group"><p class="rep-h">Blocked claims (removed from legacy copy)</p>
      <div>${g.blocked.map((c) => `<span class="claim-chip">${esc(c)}</span>`).join("")}</div></div>`);
  }

  if (g.warnings.length) {
    groups.push(`<div class="rep-group"><p class="rep-h">Warnings</p>${g.warnings
      .map((w) => `<div class="rep-item warn"><span class="ic">!</span><span>${esc(w)}</span></div>`).join("")}</div>`);
  }

  groups.push(`<div class="rep-group"><p class="rep-h">Passed checks</p>${g.passed
    .map((p) => `<div class="rep-item ok"><span class="ic">✓</span><span>${esc(p)}</span></div>`).join("")}</div>`);

  const total = g.passed.length + g.warnings.length + g.blocked.length;
  $("report").innerHTML = `<div class="rep-h">Guardrail report — ${g.passed.length} passed · ${g.warnings.length} warnings · ${g.blocked.length} blocked</div>` + groups.join("");
}

init();
