// Product catalog cleaning core for the "messy catalog in, clean feeds out" demo.
//
// Dependency-free ES module shared by the browser UI and Node smoke test. The
// "AI assist" here is deterministic: it proposes structured fixes from product
// family context and text patterns, then marks anything uncertain for review.

// --- CSV parsing / writing -------------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  const pushField = () => { record.push(field); field = ""; };
  const pushRecord = () => { rows.push(record); record = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      pushField(); pushRecord();
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) { pushField(); pushRecord(); }

  const rawRows = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  if (!rawRows.length) return [];
  const header = rawRows[0].map((h) => h.trim());
  return rawRows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i] !== undefined ? cells[i] : ""; });
    return obj;
  });
}

export function toCsv(rows, columns) {
  const escape = (value) => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((c) => escape(row[c])).join(","))].join("\n");
}

// --- Taxonomies ------------------------------------------------------------
export const BRAND_CANON = {
  "aurora gear": "Aurora Gear",
  northstar: "Northstar",
  trailforge: "TrailForge",
  "voyager co": "Voyager Co",
  fjordkit: "Fjordkit",
  "summit line": "Summit Line",
};

export const CATEGORY_CANON = {
  jackets: "Jackets",
  shoes: "Shoes",
  backpacks: "Backpacks",
  "outdoor accessories": "Outdoor accessories",
  "base layers": "Base layers",
  "reusable bottles": "Reusable bottles",
  "travel gear": "Travel gear",
};

export const SIZE_CANON = {
  s: "S",
  small: "S",
  m: "M",
  med: "M",
  medium: "M",
  l: "L",
  lg: "L",
  large: "L",
  "one size": "One Size",
};

export const BANNED_CLAIMS = [
  "best",
  "100% waterproof",
  "forever",
  "guaranteed for life",
  "scientifically proven",
  "any weather",
  "unbreakable",
  "lasts a lifetime",
  "never buy gear again",
];

const GOOGLE_FEED_COLUMNS = [
  "id", "item_group_id", "title", "description", "link", "image_link",
  "availability", "price", "brand", "gtin", "condition",
  "google_product_category", "size", "color", "material",
];

const AFFILIATE_FEED_COLUMNS = [
  "sku", "product_name", "brand", "category", "price_eur", "availability",
  "deeplink", "image_url", "margin_rate",
];

// --- Helpers ---------------------------------------------------------------
const key = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const titleCase = (value) => key(value).replace(/\b\w/g, (c) => c.toUpperCase());
const stripHtml = (value) => String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const hasHtml = (value) => /<[^>]+>/.test(String(value || ""));
const englishLooksGerman = (value) => /\b(gefertigt|fuer|zuverlaessige|rucksack|jacke|schuh)\b/i.test(String(value || ""));
const germanLooksEnglish = (value) => /\b(made with|reliable performance|trail and around town|backpack|jacket)\b/i.test(String(value || ""));

function parsePrice(value) {
  const raw = String(value || "").trim();
  if (!raw) return { value: "", changed: false, confidence: 0, issue: "missing_price" };
  const cleaned = raw.replace(/[€\s]/g, "").replace(",", ".");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return { value: raw, changed: false, confidence: 0, issue: "invalid_price" };
  return { value: n.toFixed(2), changed: raw !== n.toFixed(2), confidence: raw.includes("€") || raw.includes(",") ? 0.96 : 1 };
}

function normalizeBrand(value) {
  const canonical = BRAND_CANON[key(value)] || titleCase(value);
  return { value: canonical, changed: String(value || "").trim() !== canonical, confidence: BRAND_CANON[key(value)] ? 1 : 0.72 };
}

function normalizeCategory(value) {
  const canonical = CATEGORY_CANON[key(value)] || titleCase(value);
  return { value: canonical, changed: String(value || "").trim() !== canonical, confidence: CATEGORY_CANON[key(value)] ? 1 : 0.7 };
}

function normalizeSize(value) {
  const trimmed = String(value || "").trim();
  const lower = key(trimmed);
  const euMatch = lower.match(/^(?:eu\s*)?(\d{2})$/);
  const canonical = euMatch ? `EU ${euMatch[1]}` : (SIZE_CANON[lower] || trimmed);
  return { value: canonical, changed: trimmed !== canonical, confidence: euMatch || SIZE_CANON[lower] ? 1 : 0.75 };
}

function familyKey(row) {
  return row.parent_id || row.product_id;
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values.map((x) => String(x || "").trim()).filter(Boolean)) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
}

function buildFamilyContext(rows) {
  const byFamily = new Map();
  for (const row of rows) {
    const id = familyKey(row);
    if (!byFamily.has(id)) byFamily.set(id, []);
    byFamily.get(id).push(row);
  }
  const context = new Map();
  for (const [id, group] of byFamily) {
    context.set(id, {
      color: mostCommon(group.map((r) => r.color)),
      material: mostCommon(group.map((r) => r.material)),
      stock: mostCommon(group.map((r) => r.stock)),
    });
  }
  return context;
}

function claimMatches(text) {
  const lower = String(text || "").toLowerCase();
  return BANNED_CLAIMS.filter((claim) => lower.includes(claim));
}

function safeDescription(row, field) {
  const original = String(row[field] || "");
  let description = stripHtml(original);
  const claims = claimMatches(description);
  let changed = description !== original;

  if (claims.length) {
    // Deterministic fallback copy from trusted structured fields.
    const color = row.color || "core color";
    const material = row.material || "selected materials";
    description = `${row.title_en} in ${String(color).toLowerCase()}. Made with ${String(material).toLowerCase()} for reliable performance on the trail and around town.`;
    changed = true;
  }

  return { value: description, changed, claims };
}

function productLink(row) {
  return `https://northstar-outfitters.example/products/${String(row.sku || row.product_id).toLowerCase()}`;
}

function confidenceFromIssues(issues) {
  if (issues.some((i) => ["missing_gtin", "duplicate_sku", "banned_claim", "missing_stock"].includes(i.code))) return 0.62;
  if (issues.some((i) => ["missing_color_inferred", "missing_material_inferred", "language_bleed"].includes(i.code))) return 0.78;
  if (issues.length) return 0.9;
  return 0.99;
}

function addIssue(issues, code, severity, message, fix = "") {
  issues.push({ code, severity, message, fix });
}

// --- Main cleaning ---------------------------------------------------------
export function cleanCatalog(rows) {
  const familyContext = buildFamilyContext(rows);
  const skuCounts = new Map();
  rows.forEach((row) => skuCounts.set(row.sku, (skuCounts.get(row.sku) || 0) + 1));

  const products = rows.map((row) => {
    const clean = { ...row };
    const issues = [];
    const changes = [];

    const brand = normalizeBrand(row.brand);
    if (brand.changed) {
      clean.brand = brand.value;
      changes.push({ field: "brand", from: row.brand, to: brand.value, confidence: brand.confidence });
    }

    const category = normalizeCategory(row.category);
    if (category.changed) {
      clean.category = category.value;
      changes.push({ field: "category", from: row.category, to: category.value, confidence: category.confidence });
    }

    const price = parsePrice(row.price);
    if (price.changed) {
      clean.price = price.value;
      changes.push({ field: "price", from: row.price, to: price.value, confidence: price.confidence });
      addIssue(issues, "localized_price", "fix", "Localized price converted to feed-safe decimal format.", `${row.price} -> ${price.value}`);
    } else if (price.issue) {
      addIssue(issues, price.issue, "review", "Price is missing or invalid.", "Manual price required");
    }

    const size = normalizeSize(row.size);
    if (size.changed) {
      clean.size = size.value;
      changes.push({ field: "size", from: row.size, to: size.value, confidence: size.confidence });
    }

    const context = familyContext.get(familyKey(row)) || {};
    if (!String(row.color || "").trim()) {
      clean.color = context.color || "";
      addIssue(issues, "missing_color_inferred", context.color ? "review" : "blocker", "Color is missing; suggested from sibling variants.", context.color || "Manual color required");
      changes.push({ field: "color", from: "", to: clean.color, confidence: context.color ? 0.68 : 0 });
    }
    if (!String(row.material || "").trim()) {
      clean.material = context.material || "";
      addIssue(issues, "missing_material_inferred", context.material ? "review" : "blocker", "Material is missing; suggested from sibling variants.", context.material || "Manual material required");
      changes.push({ field: "material", from: "", to: clean.material, confidence: context.material ? 0.72 : 0 });
    }
    if (!String(row.stock || "").trim()) {
      clean.stock = "";
      addIssue(issues, "missing_stock", "blocker", "Stock is missing; cannot infer reliable availability.", "Confirm stock before export");
    }

    if (!String(row.gtin || "").trim()) {
      addIssue(issues, "missing_gtin", "review", "GTIN is missing. Some channels accept this only for exempt products.", "Confirm GTIN or mark as identifier_exists=no");
    }
    if (skuCounts.get(row.sku) > 1) {
      addIssue(issues, "duplicate_sku", "blocker", `SKU ${row.sku} appears ${skuCounts.get(row.sku)} times.`, "Fix SKU before feed export");
    }

    const descEn = safeDescription({ ...clean, title_en: row.title_en }, "description_en");
    if (descEn.changed) {
      clean.description_en = descEn.value;
      changes.push({ field: "description_en", from: row.description_en, to: descEn.value, confidence: descEn.claims.length ? 0.74 : 0.97 });
    }
    if (descEn.claims.length) {
      addIssue(issues, "banned_claim", "review", `Description contains unsupported claim(s): ${descEn.claims.join(", ")}.`, "Replace with fact-based copy");
    }

    const descDe = stripHtml(row.description_de);
    if (descDe !== row.description_de) {
      clean.description_de = descDe;
      changes.push({ field: "description_de", from: row.description_de, to: descDe, confidence: 0.97 });
    }

    if (englishLooksGerman(clean.description_en)) {
      addIssue(issues, "language_bleed", "review", "English description appears to contain German text.", "Review EN/DE field mapping");
    }
    if (germanLooksEnglish(clean.description_de)) {
      addIssue(issues, "language_bleed", "review", "German description appears to contain English text.", "Review EN/DE field mapping");
    }

    const confidence = confidenceFromIssues(issues);
    const status = issues.some((i) => i.severity === "blocker") ? "blocked"
      : issues.some((i) => i.severity === "review") ? "review"
      : "export_ready";

    return { original: row, clean, issues, changes, confidence, status };
  });

  return {
    products,
    summary: summarize(products),
    googleFeed: buildGoogleFeed(products),
    affiliateFeed: buildAffiliateFeed(products),
  };
}

export function summarize(products) {
  const issueCounts = {};
  const statusCounts = { export_ready: 0, review: 0, blocked: 0 };
  let changedProducts = 0;
  let totalIssues = 0;

  for (const product of products) {
    statusCounts[product.status]++;
    if (product.changes.length) changedProducts++;
    for (const issue of product.issues) {
      issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
      totalIssues++;
    }
  }

  return {
    rowCount: products.length,
    changedProducts,
    totalIssues,
    statusCounts,
    issueCounts,
    exportableRows: products.filter((p) => p.status !== "blocked").length,
    averageConfidence: products.reduce((sum, p) => sum + p.confidence, 0) / products.length,
  };
}

export function buildGoogleFeed(products) {
  return products
    .filter((p) => p.status !== "blocked")
    .map(({ clean }) => ({
      id: clean.sku,
      item_group_id: clean.parent_id || clean.product_id,
      title: clean.title_en,
      description: clean.description_en,
      link: productLink(clean),
      image_link: clean.image_url,
      availability: clean.availability,
      price: `${clean.price} ${clean.currency}`,
      brand: clean.brand,
      gtin: clean.gtin,
      condition: clean.condition,
      google_product_category: clean.google_product_category,
      size: clean.size,
      color: clean.color,
      material: clean.material,
    }));
}

export function buildAffiliateFeed(products) {
  return products
    .filter((p) => p.status !== "blocked")
    .map(({ clean }) => ({
      sku: clean.sku,
      product_name: clean.title_en,
      brand: clean.brand,
      category: clean.category,
      price_eur: clean.price,
      availability: clean.availability,
      deeplink: productLink(clean),
      image_url: clean.image_url,
      margin_rate: clean.margin_rate,
    }));
}

export function googleFeedXml(rows) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>Northstar Outfitters product feed</title>\n    <link>https://northstar-outfitters.example</link>\n    <description>Cleaned sample feed generated by the Growth Engineering Playbook.</description>\n${rows.map((r) => `    <item>\n      <g:id>${esc(r.id)}</g:id>\n      <g:item_group_id>${esc(r.item_group_id)}</g:item_group_id>\n      <title>${esc(r.title)}</title>\n      <description>${esc(r.description)}</description>\n      <link>${esc(r.link)}</link>\n      <g:image_link>${esc(r.image_link)}</g:image_link>\n      <g:availability>${esc(r.availability)}</g:availability>\n      <g:price>${esc(r.price)}</g:price>\n      <g:brand>${esc(r.brand)}</g:brand>\n      <g:gtin>${esc(r.gtin)}</g:gtin>\n      <g:condition>${esc(r.condition)}</g:condition>\n      <g:google_product_category>${esc(r.google_product_category)}</g:google_product_category>\n      <g:size>${esc(r.size)}</g:size>\n      <g:color>${esc(r.color)}</g:color>\n      <g:material>${esc(r.material)}</g:material>\n    </item>`).join("\n")}\n  </channel>\n</rss>`;
}

export const GOOGLE_FEED_EXPORT_COLUMNS = GOOGLE_FEED_COLUMNS;
export const AFFILIATE_FEED_EXPORT_COLUMNS = AFFILIATE_FEED_COLUMNS;
