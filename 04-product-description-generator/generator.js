// Governed product-copy generator core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/generator.test.mjs). No DOM, no network, no LLM calls.
//
// This is DETERMINISTIC generation, not a live model. It simulates the shape of
// an LLM copy workflow — facts in, brand-voice templating, then guardrails — so
// the demo stays fully inspectable on GitHub Pages without model downloads or
// API keys. The value on show is the workflow discipline, not the text volume.

// --- CSV parsing (quote-aware) ---------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let field = "", record = [], inQuotes = false;
  const pushField = () => { record.push(field); field = ""; };
  const pushRecord = () => { rows.push(record); record = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") pushField();
    else if (c === "\n") { pushField(); pushRecord(); }
    else if (c !== "\r") field += c;
  }
  if (field.length || record.length) { pushField(); pushRecord(); }
  const raw = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  if (!raw.length) return [];
  const header = raw[0].map((h) => h.trim());
  return raw.slice(1).map((cells) => {
    const o = {};
    header.forEach((h, i) => (o[h] = cells[i] !== undefined ? cells[i].trim() : ""));
    return o;
  });
}

// --- Guardrail configuration -----------------------------------------------
export const BANNED_CLAIMS = [
  "best", "guaranteed", "unbreakable", "100% waterproof",
  "scientifically proven", "lasts a lifetime", "forever", "never buy gear again",
];

// German function words used to confirm DE output isn't English-only, and to
// detect German bleed in EN output.
const GERMAN_MARKERS = ["und", "aus", "von", "für", "fuer", "die", "der", "das", "mit", "im", "zuverlaessige", "zuverlässige"];

export const VOICE_PROFILES = {
  premium: {
    label: "Premium",
    lead: (n, brand) => `The ${n} is a considered ${brand} piece`,
    close: "A refined addition to the Northstar Outfitters range.",
    metaLead: "Considered design.",
    deLead: (t) => `Die ${t} von Northstar Outfitters — mit Sinn für Details.`,
  },
  practical: {
    label: "Practical",
    lead: (n, brand) => `The ${n} is a dependable ${brand} option`,
    close: "A straightforward pick from the Northstar Outfitters range.",
    metaLead: "Dependable everyday gear.",
    deLead: (t) => `Die ${t} von Northstar Outfitters — unkompliziert und alltagstauglich.`,
  },
  technical: {
    label: "Technical",
    lead: (n, brand) => `The ${n} is a ${brand} build`,
    close: "Part of the Northstar Outfitters technical lineup.",
    metaLead: "Spec-led build.",
    deLead: (t) => `Die ${t} von Northstar Outfitters — auf Funktion ausgelegt.`,
  },
};

const CATEGORY_NOUN = {
  "Jackets": "jacket",
  "Shoes": "shoe",
  "Backpacks": "backpack",
  "Outdoor accessories": "accessory",
  "Base layers": "base layer",
  "Reusable bottles": "bottle",
  "Travel gear": "travel piece",
};

const claimRegex = (claim) => new RegExp("\\b" + claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");

/** Find which banned claims appear in a piece of text. */
export function findBannedClaims(text) {
  const t = String(text || "");
  return BANNED_CLAIMS.filter((c) => claimRegex(c).test(t));
}

/** Remove banned claims from text (for sanitizing legacy copy). */
export function stripBannedClaims(text) {
  let out = String(text || "");
  for (const c of BANNED_CLAIMS) out = out.replace(new RegExp("\\b" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), "").trim();
  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,!])/g, "$1").replace(/([.!?])\1+/g, "$1");
}

const clampField = (s) => String(s || "").trim();

// --- Generation ------------------------------------------------------------
/**
 * Generate governed copy for one product under a brand-voice profile.
 * `opts.legacyCopy` (optional) is existing marketing text (e.g. from the messy
 * catalog) that guardrails sanitize to show what would be blocked.
 */
export function generateCopy(product, opts = {}) {
  const profileKey = opts.profile && VOICE_PROFILES[opts.profile] ? opts.profile : "practical";
  const v = VOICE_PROFILES[profileKey];

  const facts = {
    title_en: clampField(product.title_en),
    title_de: clampField(product.title_de),
    brand: clampField(product.brand),
    category: clampField(product.category),
    color: clampField(product.color),
    material: clampField(product.material),
    size: clampField(product.size),
    price: clampField(product.price),
    currency: clampField(product.currency) || "EUR",
  };
  const noun = CATEGORY_NOUN[facts.category] || (facts.category ? facts.category.toLowerCase() : "product");
  const missingFacts = [];
  ["color", "material"].forEach((f) => { if (!facts[f]) missingFacts.push(f); });

  // --- English description: assemble ONLY from present facts ---------------
  const enParts = [];
  enParts.push(`${v.lead(facts.title_en, facts.brand)} in the ${facts.category.toLowerCase()} range.`);
  if (facts.material && facts.color) enParts.push(`Finished in ${facts.color.toLowerCase()} ${facts.material}.`);
  else if (facts.material) enParts.push(`Made from ${facts.material}.`);
  else if (facts.color) enParts.push(`Available in ${facts.color.toLowerCase()}.`);
  if (facts.size && facts.size.toLowerCase() !== "one size") enParts.push(`Offered in size ${facts.size}.`);
  if (profileKey === "technical" && product.weight_grams) enParts.push(`Listed weight ${clampField(product.weight_grams)} g.`);
  enParts.push(v.close);
  const en = enParts.join(" ");

  // --- German description: template-assisted -------------------------------
  const deParts = [v.deLead(facts.title_de || facts.title_en)];
  if (facts.material && facts.color) deParts.push(`Aus ${facts.material} in ${facts.color}.`);
  else if (facts.material) deParts.push(`Aus ${facts.material}.`);
  else if (facts.color) deParts.push(`In ${facts.color}.`);
  if (facts.size && facts.size.toLowerCase() !== "one size") deParts.push(`Größe ${facts.size}.`);
  const de = deParts.join(" ");

  // --- Bullets: present facts only -----------------------------------------
  const bullets = [];
  bullets.push(`Brand: ${facts.brand}`);
  bullets.push(`Category: ${facts.category}`);
  if (facts.material) bullets.push(`Material: ${facts.material}`);
  if (facts.color) bullets.push(`Color: ${facts.color}`);
  if (facts.size && facts.size.toLowerCase() !== "one size") bullets.push(`Size: ${facts.size}`);
  if (facts.price) bullets.push(`Price: ${facts.price} ${facts.currency}`);

  // --- Meta title (<=60) ---------------------------------------------------
  const metaCandidates = [
    `${facts.title_en} – ${facts.brand} | ${facts.category}`,
    `${facts.title_en} – ${facts.brand}`,
    facts.title_en,
  ];
  let metaTitle = metaCandidates.find((c) => c.length <= 60) || metaCandidates[metaCandidates.length - 1];
  if (metaTitle.length > 60) metaTitle = metaTitle.slice(0, 59).trimEnd() + "…";

  // --- Meta description (<=160) --------------------------------------------
  const descBits = [`${v.metaLead} ${facts.title_en}`];
  if (facts.color && facts.material) descBits.push(`in ${facts.color.toLowerCase()} ${facts.material}`);
  else if (facts.material) descBits.push(`in ${facts.material}`);
  let metaDescription = `${descBits.join(" ")}. ${facts.price ? facts.price + " " + facts.currency + " at " : "At "}Northstar Outfitters.`;
  if (metaDescription.length > 160) metaDescription = metaDescription.slice(0, 159).trimEnd() + "…";

  // --- Marketplace-short ---------------------------------------------------
  const msBits = [facts.title_en];
  if (facts.material && facts.color) msBits.push(`— ${facts.material} ${noun} in ${facts.color.toLowerCase()}`);
  else if (facts.material) msBits.push(`— ${facts.material} ${noun}`);
  let marketplaceShort = msBits.join(" ") + `. ${facts.price ? facts.price + " " + facts.currency : ""}`.trimEnd() + ".";
  marketplaceShort = marketplaceShort.replace(/\.\.$/, ".");

  const guardrail = runGuardrails({ en, de, metaTitle, metaDescription, bullets, missingFacts, legacyCopy: opts.legacyCopy });

  return { profile: profileKey, en, de, bullets, metaTitle, metaDescription, marketplaceShort, guardrail };
}

// --- Guardrails ------------------------------------------------------------
function hasGerman(text) {
  const t = " " + String(text).toLowerCase() + " ";
  return GERMAN_MARKERS.some((w) => t.includes(" " + w + " ")) || /[äöüß]/.test(text);
}

function runGuardrails({ en, de, metaTitle, metaDescription, bullets, missingFacts, legacyCopy }) {
  const passed = [], warnings = [], blocked = [];

  // 1. No banned claims in generated copy.
  const generatedClaims = findBannedClaims([en, de, metaDescription, marketplaceJoin(bullets)].join(" "));
  if (generatedClaims.length === 0) passed.push("No banned claims in generated copy");
  else warnings.push(`Generated copy contained banned claim(s): ${generatedClaims.join(", ")}`);

  // 2. Sanitize legacy copy (demonstrates what guardrails would remove).
  if (legacyCopy) {
    const found = findBannedClaims(legacyCopy);
    found.forEach((c) => blocked.push(c));
  }

  // 3. Missing facts -> warn, never invent.
  if (missingFacts.length) missingFacts.forEach((f) => warnings.push(`${f[0].toUpperCase() + f.slice(1)} missing in source data — omitted from copy, not invented`));
  else passed.push("All referenced attributes exist in the product data");

  // 4. Length checks.
  const metaTitleOk = metaTitle.length <= 60;
  const metaDescOk = metaDescription.length <= 160;
  (metaTitleOk ? passed : warnings).push(`Meta title ${metaTitle.length}/60 chars`);
  (metaDescOk ? passed : warnings).push(`Meta description ${metaDescription.length}/160 chars`);

  // 5. Language integrity.
  if (hasGerman(de)) passed.push("German output contains German text");
  else warnings.push("German output looks English-only");
  if (!hasGerman(en)) passed.push("English output free of German field bleed");
  else warnings.push("English output shows German field bleed");

  return {
    passed, warnings, blocked, missingFacts,
    lengthChecks: {
      metaTitle: { len: metaTitle.length, limit: 60, ok: metaTitleOk },
      metaDescription: { len: metaDescription.length, limit: 160, ok: metaDescOk },
    },
  };
}

const marketplaceJoin = (bullets) => bullets.join(" ");
