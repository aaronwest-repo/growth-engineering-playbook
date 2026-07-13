// Smoke test for the schema markup generator + validator core. Pure Node, no deps.
// Run: node tests/schema.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCsv, generate, buildProduct, lint, TYPES } from "../schema.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const rd = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const clean = parseCsv(rd("../../shared-data/catalog/products-clean.csv"));
const messy = parseCsv(rd("../../shared-data/catalog/products-messy.csv"));

// --- Loading ---------------------------------------------------------------
check("clean + messy catalogs load", clean.length > 0 && messy.length === clean.length);

// --- Product from clean data ----------------------------------------------
const cg = generate("Product", { product: clean[0] });
check("clean product generates valid JSON-LD",
  cg.jsonld["@context"] === "https://schema.org" && cg.jsonld["@type"] === "Product" && cg.jsonld.name && cg.jsonld.offers.price);
check("availability is mapped to a schema.org enum",
  cg.jsonld.offers.availability && cg.jsonld.offers.availability.startsWith("https://schema.org/"),
  cg.jsonld.offers.availability);
check("clean product is rich-result eligible", cg.report.richEligible, cg.report.richReason);
check("clean product has zero errors", cg.report.counts.error === 0, JSON.stringify(cg.report.issues.error));

// --- Product from messy data catches problems ------------------------------
// find a messy product with a malformed price (e.g., "€179,00")
const messyPrice = messy.find((r) => /[^\d.]/.test(r.price.replace(/^\d+\.\d+$/, "")) && /[€,]/.test(r.price));
check("a malformed messy price exists to test", !!messyPrice, "no messy price found");
const mp = buildProduct(messyPrice);
check("messy price is normalised with a warning note",
  mp.jsonld.offers.price && mp.notes.some((n) => n.field === "offers.price" && n.level === "warn"),
  JSON.stringify(mp.notes));
check("normalised price is a plain number", /^\d+\.\d{2}$/.test(String(mp.jsonld.offers.price)));

// missing GTIN → warning
const noGtin = messy.find((r) => !r.gtin.trim());
if (noGtin) {
  const r = generate("Product", { product: noGtin });
  check("missing GTIN surfaces a recommended-field warning",
    r.report.issues.warning.some((w) => /gtin/i.test(w.field)) && !r.jsonld.gtin13);
} else check("missing GTIN case (skipped — none in sample)", true);

// HTML in description → stripped + info
const htmlDesc = messy.find((r) => /<[^>]+>/.test(r.description_en || ""));
if (htmlDesc) {
  const r = buildProduct(htmlDesc);
  check("HTML is stripped from description with an info note",
    !/<[^>]+>/.test(r.jsonld.description) && r.notes.some((n) => n.field === "description" && n.level === "info"));
} else check("HTML description case (skipped — none in sample)", true);

// --- Availability enum error ----------------------------------------------
const badAvail = buildProduct({ ...clean[0], availability: "available soon" });
check("an unknown availability value raises an error note",
  badAvail.notes.some((n) => n.field === "offers.availability" && n.level === "error") && !badAvail.jsonld.offers.availability);

// --- Completeness reflects field coverage ---------------------------------
const bare = generate("Product", { product: { title_en: "Nameless", price: "10.00", currency: "EUR", availability: "in stock" } });
check("a sparse product scores lower completeness than a full one",
  bare.report.completeness < cg.report.completeness,
  `bare=${bare.report.completeness} full=${cg.report.completeness}`);
check("missing image makes a product rich-ineligible",
  !bare.report.richEligible && bare.report.issues.error.some((e) => /image/i.test(e.field)));

// --- Other types generate + validate --------------------------------------
const article = generate("Article");
check("Article generates and is rich-eligible", article.jsonld["@type"] === "Article" && article.report.richEligible);
const faq = generate("FAQPage");
check("FAQPage has >=2 Q&A with answers and is eligible",
  faq.jsonld.mainEntity.length >= 2 && faq.jsonld.mainEntity.every((q) => q.acceptedAnswer.text) && faq.report.richEligible);
const bc = generate("BreadcrumbList", { product: clean[0] });
check("BreadcrumbList builds positioned items", bc.jsonld.itemListElement.length >= 2 && bc.jsonld.itemListElement[0].position === 1 && bc.report.richEligible);
const org = generate("Organization");
check("Organization generates with name + url and is eligible", org.jsonld.name && org.jsonld.url && org.report.richEligible);

// --- FAQ with one bad pair fails ------------------------------------------
const badFaq = lint("FAQPage", { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "" } }] });
check("FAQ with <2 answered questions is not eligible", !badFaq.richEligible);

// --- All types dispatch ----------------------------------------------------
check("every type dispatches to a builder", TYPES.every((t) => { const r = generate(t, { product: clean[0] }); return r.jsonld["@type"] === t && typeof r.report.completeness === "number"; }));

// --- Report shape ----------------------------------------------------------
check("report exposes required/recommended coverage + counts",
  cg.report.required.length > 0 && cg.report.recommended.length > 0 && typeof cg.report.counts.reqPresent === "number");

// --- Leakage ---------------------------------------------------------------
// JSON-LD legitimately uses @context/@type, so test for actual email addresses.
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
check("no raw email addresses in any generated output",
  TYPES.every((t) => !EMAIL.test(JSON.stringify(generate(t, { product: clean[0] })))));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll schema markup generator checks passed.");
process.exit(failures ? 1 : 0);
