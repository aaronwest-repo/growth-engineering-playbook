// Schema markup (JSON-LD) generator + validator core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/schema.test.mjs). No DOM, no network, no PII.
//
// Structured data is how a page tells search and AI answer engines exactly what
// it is — Product, Article, FAQPage, BreadcrumbList, Organization. It only helps
// if it is COMPLETE and VALID: the right required + recommended fields, correct
// formats, and the schema.org enums Google actually checks. This generates clean
// JSON-LD from real data and lints it — flagging the mistakes plugins quietly
// emit (a price with a currency symbol, "in stock" instead of the schema.org URL,
// a missing GTIN, HTML in a description) — so you ship rich-result-eligible markup
// instead of markup that gets ignored. Deterministic; nothing is sent anywhere.

export function parseCsv(text) {
  const rows = [];
  let field = "", record = [], q = false;
  const pf = () => { record.push(field); field = ""; };
  const pr = () => { rows.push(record); record = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") pf();
    else if (c === "\n") { pf(); pr(); }
    else if (c !== "\r") field += c;
  }
  if (field.length || record.length) { pf(); pr(); }
  const raw = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  const header = raw[0].map((h) => h.trim());
  return raw.slice(1).map((cells) => { const o = {}; header.forEach((h, i) => (o[h] = (cells[i] || "").trim())); return o; });
}

const stripHtml = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

// Parse a possibly-messy price into a number. Returns {value, raw, normalized}.
function parsePrice(raw) {
  const s = String(raw || "").trim();
  if (!s) return { value: null, raw: s, normalized: false };
  // strip currency symbols/letters, normalise comma decimals
  let cleaned = s.replace(/[^\d.,]/g, "");
  if (/,\d{2}$/.test(cleaned) && !cleaned.includes(".")) cleaned = cleaned.replace(",", ".");
  cleaned = cleaned.replace(/,/g, "");
  const v = parseFloat(cleaned);
  const normalized = Number.isFinite(v) && s !== v.toFixed(2) && s !== String(v);
  return { value: Number.isFinite(v) ? Math.round(v * 100) / 100 : null, raw: s, normalized };
}

const AVAILABILITY = {
  "in stock": "https://schema.org/InStock",
  "out of stock": "https://schema.org/OutOfStock",
  "preorder": "https://schema.org/PreOrder",
  "backorder": "https://schema.org/BackOrder",
};
const CONDITION = {
  new: "https://schema.org/NewCondition",
  used: "https://schema.org/UsedCondition",
  refurbished: "https://schema.org/RefurbishedCondition",
};
const isGtin = (g) => /^\d{8}$|^\d{12,14}$/.test(String(g || "").trim());
const STORE_URL = "https://northstar-outfitters.example";

// --- Builders -------------------------------------------------------------
// Each returns { jsonld, notes } where notes capture source-quality issues found
// while generating (things a naive generator would silently pass through).

export function buildProduct(row) {
  const notes = [];
  const jsonld = { "@context": "https://schema.org", "@type": "Product" };
  if (row.title_en) jsonld.name = row.title_en;
  if (row.brand) jsonld.brand = { "@type": "Brand", name: row.brand };
  if (row.sku) jsonld.sku = row.sku;
  if (isGtin(row.gtin)) jsonld.gtin13 = row.gtin;
  else if ((row.gtin || "").trim()) notes.push({ level: "warn", field: "gtin13", msg: `GTIN "${row.gtin}" isn't a valid 8/12/13/14-digit code — omitted.` });

  const descRaw = row.description_en || "";
  if (descRaw) {
    if (/<[^>]+>/.test(descRaw)) notes.push({ level: "info", field: "description", msg: "HTML tags stripped from the source description." });
    jsonld.description = stripHtml(descRaw);
  }
  if (row.image_url) jsonld.image = row.image_url;
  if (row.google_product_category || row.category) jsonld.category = row.google_product_category || row.category;

  // Offer
  const offer = { "@type": "Offer" };
  const p = parsePrice(row.price);
  if (p.value != null) {
    offer.price = p.value.toFixed(2);
    if (p.normalized) notes.push({ level: "warn", field: "offers.price", msg: `Source price "${p.raw}" was malformed — normalised to ${p.value.toFixed(2)}. Fix it at the source; a price must be a plain number.` });
  } else if (p.raw) notes.push({ level: "error", field: "offers.price", msg: `Price "${p.raw}" can't be parsed to a number.` });
  if (row.currency) offer.priceCurrency = row.currency;
  const av = AVAILABILITY[(row.availability || "").toLowerCase()];
  if (av) offer.availability = av;
  else if ((row.availability || "").trim()) notes.push({ level: "error", field: "offers.availability", msg: `Availability "${row.availability}" isn't a schema.org value — use e.g. https://schema.org/InStock.` });
  if (CONDITION[(row.condition || "").toLowerCase()]) offer.itemCondition = CONDITION[(row.condition || "").toLowerCase()];
  offer.url = `${STORE_URL}/products/${row.sku || row.product_id}`;
  jsonld.offers = offer;

  return { jsonld, notes };
}

export function buildBreadcrumb(row) {
  const cat = row.category || "Products";
  const items = ["Home", cat, row.title_en || "Product"];
  const jsonld = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map((name, i) => ({
      "@type": "ListItem", position: i + 1, name,
      item: `${STORE_URL}/${i === 0 ? "" : encodeURIComponent(name.toLowerCase().replace(/\s+/g, "-"))}`,
    })),
  };
  return { jsonld, notes: [] };
}

const ARTICLE_SAMPLE = {
  headline: "What Is Answer Engine Optimization?",
  description: "How to structure content so AI answer engines can extract, quote, and cite it.",
  author: "Northstar Outfitters Editorial",
  datePublished: "2026-06-01",
  dateModified: "2026-07-10",
  image: `${STORE_URL}/img/aeo-explainer.jpg`,
};
export function buildArticle(sample = ARTICLE_SAMPLE) {
  const jsonld = {
    "@context": "https://schema.org", "@type": "Article",
    headline: sample.headline,
    description: sample.description,
    image: sample.image,
    datePublished: sample.datePublished,
    dateModified: sample.dateModified,
    author: { "@type": "Organization", name: sample.author },
    publisher: { "@type": "Organization", name: "Northstar Outfitters", logo: { "@type": "ImageObject", url: `${STORE_URL}/img/logo.png` } },
  };
  return { jsonld, notes: [] };
}

const FAQ_SAMPLE = [
  { q: "How long does shipping take?", a: "Standard shipping arrives in 3–5 business days across the DACH region; express options are available at checkout." },
  { q: "What is your returns policy?", a: "Unworn items can be returned within 30 days for a full refund; we provide a prepaid return label." },
  { q: "Are your jackets waterproof?", a: "Shell jackets like the Aurora Shell are rated for sustained rain; insulated jackets are water-resistant, not fully waterproof." },
];
export function buildFaq(pairs = FAQ_SAMPLE) {
  const jsonld = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: pairs.map((p) => ({ "@type": "Question", name: p.q, acceptedAnswer: { "@type": "Answer", text: p.a } })),
  };
  return { jsonld, notes: [] };
}

export function buildOrganization() {
  const jsonld = {
    "@context": "https://schema.org", "@type": "Organization",
    name: "Northstar Outfitters",
    url: STORE_URL,
    logo: `${STORE_URL}/img/logo.png`,
    sameAs: [`${STORE_URL}/social/instagram`, `${STORE_URL}/social/youtube`],
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", url: `${STORE_URL}/contact` },
  };
  return { jsonld, notes: [] };
}

// --- Field specs per type -------------------------------------------------
const SPECS = {
  Product: {
    required: [["name", (j) => !!j.name], ["image", (j) => !!j.image], ["offers.price", (j) => j.offers && j.offers.price != null], ["offers.priceCurrency", (j) => j.offers && !!j.offers.priceCurrency], ["offers.availability", (j) => j.offers && !!j.offers.availability]],
    recommended: [["brand", (j) => !!j.brand], ["sku", (j) => !!j.sku], ["gtin13", (j) => !!j.gtin13], ["description", (j) => (j.description || "").length >= 20], ["aggregateRating", (j) => !!j.aggregateRating]],
    richName: "Product rich result / merchant listing",
  },
  Article: {
    required: [["headline", (j) => !!j.headline], ["image", (j) => !!j.image], ["datePublished", (j) => !!j.datePublished]],
    recommended: [["author", (j) => !!j.author], ["dateModified", (j) => !!j.dateModified], ["publisher", (j) => !!j.publisher], ["description", (j) => !!j.description]],
    richName: "Article rich result",
  },
  FAQPage: {
    required: [["mainEntity", (j) => Array.isArray(j.mainEntity) && j.mainEntity.length >= 2], ["answers", (j) => (j.mainEntity || []).every((q) => q.acceptedAnswer && q.acceptedAnswer.text)]],
    recommended: [["3+ Q&A pairs", (j) => (j.mainEntity || []).length >= 3]],
    richName: "FAQ rich result",
  },
  BreadcrumbList: {
    required: [["itemListElement", (j) => Array.isArray(j.itemListElement) && j.itemListElement.length >= 2], ["positions", (j) => (j.itemListElement || []).every((e) => e.position && e.name)]],
    recommended: [["item URLs", (j) => (j.itemListElement || []).every((e) => !!e.item)]],
    richName: "Breadcrumb rich result",
  },
  Organization: {
    required: [["name", (j) => !!j.name], ["url", (j) => !!j.url]],
    recommended: [["logo", (j) => !!j.logo], ["sameAs", (j) => Array.isArray(j.sameAs) && j.sameAs.length > 0], ["contactPoint", (j) => !!j.contactPoint]],
    richName: "Organization / knowledge panel",
  },
};

const DATE_OK = (d) => /^\d{4}-\d{2}-\d{2}/.test(String(d || ""));
const ABS_URL = (u) => /^https?:\/\//.test(String(u || ""));

// --- Validator ------------------------------------------------------------
export function lint(type, jsonld, notes = []) {
  const spec = SPECS[type];
  const issues = { error: [], warning: [], info: [] };
  const add = (level, field, msg) => issues[level === "error" ? "error" : level === "warn" || level === "warning" ? "warning" : "info"].push({ field, msg });

  // structural: @context / @type
  if (jsonld["@context"] !== "https://schema.org") add("error", "@context", 'Missing or wrong @context — must be "https://schema.org".');
  if (jsonld["@type"] !== type) add("error", "@type", `@type should be "${type}".`);

  const required = spec.required.map(([field, ok]) => ({ field, present: ok(jsonld) }));
  const recommended = spec.recommended.map(([field, ok]) => ({ field, present: ok(jsonld) }));
  required.filter((r) => !r.present).forEach((r) => add("error", r.field, `Required field "${r.field}" is missing or invalid — ${spec.richName} won't be eligible.`));
  recommended.filter((r) => !r.present).forEach((r) => add("warning", r.field, `Recommended field "${r.field}" is missing — add it to strengthen eligibility.`));

  // format checks
  if (type === "Product" && jsonld.offers) {
    if (jsonld.offers.price != null && !/^\d+(\.\d{1,2})?$/.test(String(jsonld.offers.price))) add("error", "offers.price", "Price must be a plain number (no currency symbol or comma decimal).");
    if (jsonld.offers.priceCurrency && !/^[A-Z]{3}$/.test(jsonld.offers.priceCurrency)) add("warning", "offers.priceCurrency", "priceCurrency should be a 3-letter ISO code, e.g. EUR.");
    if (jsonld.offers.availability && !String(jsonld.offers.availability).startsWith("https://schema.org/")) add("error", "offers.availability", "availability must be a schema.org URL enum.");
    if (jsonld.image && !ABS_URL(jsonld.image)) add("warning", "image", "image should be an absolute URL.");
  }
  if (type === "Article") {
    if (jsonld.datePublished && !DATE_OK(jsonld.datePublished)) add("error", "datePublished", "datePublished must be ISO-8601 (YYYY-MM-DD).");
    if (jsonld.image && !ABS_URL(jsonld.image)) add("warning", "image", "image should be an absolute URL.");
  }
  if (type === "Organization" && jsonld.url && !ABS_URL(jsonld.url)) add("error", "url", "Organization url must be absolute.");

  // fold in generation-time notes
  notes.forEach((n) => add(n.level, n.field, n.msg));

  const reqPresent = required.filter((r) => r.present).length;
  const recPresent = recommended.filter((r) => r.present).length;
  const completeness = Math.round(((reqPresent * 2 + recPresent) / (required.length * 2 + recommended.length)) * 100);
  const richEligible = required.every((r) => r.present) && issues.error.length === 0;
  const richReason = richEligible
    ? `Meets the minimum for a ${spec.richName}.`
    : `Not eligible for the ${spec.richName}: ${issues.error.length ? issues.error[0].msg : "required fields incomplete."}`;

  return { type, required, recommended, issues, completeness, richEligible, richReason, richName: spec.richName,
    counts: { error: issues.error.length, warning: issues.warning.length, info: issues.info.length, reqPresent, reqTotal: required.length, recPresent, recTotal: recommended.length } };
}

// Convenience: build + lint in one call.
export function generate(type, opts = {}) {
  let built;
  if (type === "Product") built = buildProduct(opts.product || {});
  else if (type === "BreadcrumbList") built = buildBreadcrumb(opts.product || {});
  else if (type === "Article") built = buildArticle(opts.article);
  else if (type === "FAQPage") built = buildFaq(opts.faq);
  else if (type === "Organization") built = buildOrganization();
  else throw new Error("Unknown type " + type);
  return { jsonld: built.jsonld, report: lint(type, built.jsonld, built.notes) };
}

export const TYPES = ["Product", "Article", "FAQPage", "BreadcrumbList", "Organization"];
