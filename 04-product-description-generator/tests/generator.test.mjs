// Smoke test for the product-copy generator core. Pure Node, no dependencies.
// Run: node tests/generator.test.mjs   (exits non-zero on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseCsv, generateCopy, findBannedClaims, stripBannedClaims, VOICE_PROFILES,
} from "../generator.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}

const cleanPath = fileURLToPath(new URL("../../shared-data/catalog/products-clean.csv", import.meta.url));
const messyPath = fileURLToPath(new URL("../../shared-data/catalog/products-messy.csv", import.meta.url));
const clean = parseCsv(readFileSync(cleanPath, "utf8"));
const messy = parseCsv(readFileSync(messyPath, "utf8"));

// --- Parsing ---------------------------------------------------------------
check("parses 46 clean catalog products", clean.length === 46, `got ${clean.length}`);
check("products expose expected fields",
  ["product_id", "sku", "title_en", "title_de", "brand", "category", "price", "color", "material", "gtin"]
    .every((k) => k in clean[0]));

// --- Generation on a real product -----------------------------------------
const product = clean.find((p) => p.product_id === "NSP-0001");
const out = generateCopy(product, { profile: "premium" });
check("generates an English description", out.en.length > 20 && out.en.includes("Aurora Shell Jacket"));
check("generates a German description", out.de.length > 10);
check("German output is not English-only", /[äöüß]|\b(die|von|aus|und|für)\b/i.test(out.de), out.de);
check("English output has no German field bleed", !/Hardshell|zuverlaessige|\bfuer\b/i.test(out.en), out.en);
check("generates bullets", Array.isArray(out.bullets) && out.bullets.length >= 3);
check("meta title <= 60 chars", out.metaTitle.length <= 60, `len ${out.metaTitle.length}`);
check("meta description <= 160 chars", out.metaDescription.length <= 160, `len ${out.metaDescription.length}`);
check("marketplace-short is produced", out.marketplaceShort.length > 10);

// --- Grounding: only reference known facts ---------------------------------
check("copy references the real color from data", out.en.toLowerCase().includes(product.color.toLowerCase()));
const missing = generateCopy({ ...product, color: "", material: "" }, { profile: "premium" });
check("missing color/material produces warnings, not invented values",
  missing.guardrail.warnings.some((w) => /color missing/i.test(w)) &&
  missing.guardrail.warnings.some((w) => /material missing/i.test(w)));
check("missing material is not invented into the copy",
  !/recycled polyester|nylon|merino|leather|steel/i.test(missing.en),
  missing.en);

// --- Banned claims ---------------------------------------------------------
check("findBannedClaims flags hype text",
  findBannedClaims("The best jacket, 100% waterproof forever, guaranteed for life").length >= 3);
check("generated copy contains no banned claims", findBannedClaims(out.en + " " + out.de + " " + out.metaDescription).length === 0);
check("stripBannedClaims removes hype", findBannedClaims(stripBannedClaims("simply the best and unbreakable")).length === 0);

// legacy copy from the messy catalog gets sanitized -> blocked list populated
const messyRow = messy.find((p) => p.product_id === "NSP-0001");
const withLegacy = generateCopy(product, { profile: "practical", legacyCopy: messyRow.description_en });
check("banned claims from legacy catalog copy are blocked",
  withLegacy.guardrail.blocked.length >= 2, `blocked=${JSON.stringify(withLegacy.guardrail.blocked)}`);

// --- Guardrail report shape ------------------------------------------------
check("guardrail report has passed checks", out.guardrail.passed.length >= 3);
check("guardrail report has length checks", out.guardrail.lengthChecks.metaTitle.ok && out.guardrail.lengthChecks.metaDescription.ok);

// --- Profile changes tone --------------------------------------------------
const prem = generateCopy(product, { profile: "premium" }).en;
const prac = generateCopy(product, { profile: "practical" }).en;
const tech = generateCopy(product, { profile: "technical" }).en;
check("Premium and Practical produce different copy", prem !== prac);
check("Technical profile differs from Premium", tech !== prem);
check("all three profiles are available", Object.keys(VOICE_PROFILES).length === 3);

// --- Every product generates without throwing ------------------------------
let allOk = true;
for (const p of clean) {
  try {
    const r = generateCopy(p, { profile: "technical" });
    if (r.metaTitle.length > 60 || r.metaDescription.length > 160) allOk = false;
  } catch { allOk = false; }
}
check("all 46 products generate within length limits", allOk);

console.log("");
if (failures > 0) { console.error(`generator.test: ${failures} check(s) FAILED`); process.exit(1); }
console.log("generator.test: all checks passed");
