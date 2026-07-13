// Smoke test for the technical-SEO auditor core. Pure Node, no deps.
// Run: node tests/seo.test.mjs   (exits non-zero on any failure)

import { audit, CATEGORY_LABELS } from "../seo.js";
import { SITE } from "../site.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const r = audit(SITE);
const cats = new Set(r.issues.map((i) => i.category));
const hasCat = (c) => cats.has(c);

// --- Crawl + rollup --------------------------------------------------------
check("crawl fixture loads and audits", SITE.length > 10 && r.pages.length === SITE.length);
check("issues are found", r.issues.length > 5);
check("every issue has category, severity, url, detail, fix",
  r.issues.every((i) => i.category && i.severity && i.url && i.detail && i.fix));
check("metrics are coherent",
  r.metrics.pagesCrawled === SITE.length && r.metrics.healthScore >= 0 && r.metrics.healthScore <= 100 &&
  r.metrics.errors + r.metrics.warnings + r.metrics.notices === r.issues.length);

// --- Specific detections ---------------------------------------------------
check("detects broken internal links (link to a 404)",
  r.issues.some((i) => i.category === "broken-link" && /\/gone/.test(i.detail)));
check("detects a redirect chain (2+ hops)", hasCat("redirect-chain"));
check("detects a redirect that ends at a dead page", hasCat("broken-redirect"));
check("detects a duplicate title", hasCat("duplicate-title") && r.issues.some((i) => i.category === "duplicate-title" && /Trail Shoe/.test(i.detail)));
check("detects a missing title", r.issues.some((i) => i.category === "missing-title" && i.url === "/size-guide"));
check("detects a missing meta description", r.issues.some((i) => i.category === "missing-meta" && i.url === "/products/basecamp-approach-shoe"));
check("detects a missing canonical", r.issues.some((i) => i.category === "missing-canonical" && i.url === "/shipping"));
check("detects a canonical pointing at a 404", r.issues.some((i) => i.category === "canonical-broken" && i.url === "/products/voyager-30l-backpack"));
check("detects noindex on a money page", r.issues.some((i) => i.category === "noindex-money" && i.url === "/products/fjord-rain-jacket"));
check("detects an orphan page", r.issues.some((i) => i.category === "orphan" && i.url === "/blog/draft-post"));
check("detects thin content", r.issues.some((i) => i.category === "thin-content" && i.url === "/blog/free-shipping"));
check("detects a product missing Product schema", r.issues.some((i) => i.category === "missing-schema" && i.url === "/products/ridgeline-insulated-jacket"));

// --- Severity model --------------------------------------------------------
check("broken links are errors, thin content is a warning",
  r.issues.filter((i) => i.category === "broken-link").every((i) => i.severity === "error") &&
  r.issues.filter((i) => i.category === "thin-content").every((i) => i.severity === "warning"));
check("health score is penalised below 100 by the issues", r.metrics.healthScore < 100);

// --- Categories + prioritisation ------------------------------------------
check("categories roll up with counts + affected page counts",
  r.categories.length > 0 && r.categories.every((c) => c.count > 0 && typeof c.pages === "number"));
check("categories are prioritised by severity × count (desc)",
  r.categories.every((c, i, a) => i === 0 || (({ error: 5, warning: 2, notice: 0.5 })[a[i - 1].severity] * a[i - 1].count) >= (({ error: 5, warning: 2, notice: 0.5 })[c.severity] * c.count)));
check("every category has a human label", r.categories.every((c) => CATEGORY_LABELS[c.category]));
check("prioritised fixes are impact-sorted", r.fixes.every((f, i, a) => i === 0 || a[i - 1].impact >= f.impact) && r.fixes.every((f) => f.text));

// --- Per-page rollup -------------------------------------------------------
const withIssues = r.pages.filter((p) => p.issues.length > 0);
check("issues attach to their pages with inbound counts",
  withIssues.length > 0 && r.pages.every((p) => typeof p.inbound === "number"));
check("the home page has inbound links; the orphan has zero",
  r.byUrl["/"].inbound > 0 && r.byUrl["/blog/draft-post"].inbound === 0);

// --- Clean site scores 100 -------------------------------------------------
const cleanSite = [
  { url: "/", status: 200, type: "home", title: "Home", meta: "m", canonical: "/", h1: "Home", words: 300, noindex: false, schema: ["Organization"], outLinks: ["/p"] },
  { url: "/p", status: 200, type: "product", title: "P", meta: "m", canonical: "/p", h1: "P", words: 300, noindex: false, schema: ["Product"], outLinks: ["/"] },
];
check("a clean site scores 100 with no issues", audit(cleanSite).metrics.healthScore === 100 && audit(cleanSite).issues.length === 0);

// --- Leakage ---------------------------------------------------------------
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(r)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll technical-SEO auditor checks passed.");
process.exit(failures ? 1 : 0);
