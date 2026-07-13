// Smoke test for the internal-linking optimizer core. Pure Node, no deps.
// Run: node tests/linking.test.mjs   (exits non-zero on any failure)

import { optimize, REASON_LABELS } from "../linking.js";
import { CORPUS } from "../corpus.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const r = optimize(CORPUS);
const sug = (from, to) => r.suggestions.find((s) => s.from === from && s.to === to);
const anyTo = (to) => r.suggestions.filter((s) => s.to === to);

// --- Graph + clusters ------------------------------------------------------
check("corpus loads and every page rolls up", CORPUS.length > 10 && r.pages.length === CORPUS.length);
check("clusters are formed by topic with a pillar",
  r.clusters.length >= 3 && r.clusters.every((c) => c.pillar && c.size > 0));
check("inbound counts are computed", r.pages.every((p) => typeof p.inbound === "number") && r.byUrl["/blog/what-is-aeo"].inbound === 2);
check("metrics are coherent",
  r.metrics.pages === CORPUS.length && r.metrics.clusters === r.clusters.length && r.metrics.suggestions === r.suggestions.length);

// --- Orphan detection ------------------------------------------------------
check("orphan pages (zero inbound) are detected",
  r.orphans.length > 0 && r.orphans.some((o) => o.url === "/blog/answer-first-structure") && r.orphans.some((o) => o.url === "/blog/site-architecture"));
check("orphans get a recommended source link",
  r.orphans.every((o) => o.recommendedFrom === null || typeof o.recommendedFrom === "string") &&
  r.orphans.some((o) => o.recommendedFrom));

// --- Suggestions -----------------------------------------------------------
check("link suggestions are generated", r.suggestions.length > 5);
check("every suggestion has from/to/reason/priority/strength/score",
  r.suggestions.every((s) => s.from && s.to && s.reason && s.priority && typeof s.strength === "number" && typeof s.score === "number"));
check("suggestions never point a page at itself or an existing link",
  r.suggestions.every((s) => s.from !== s.to) &&
  r.suggestions.every((s) => !(CORPUS.find((d) => d.url === s.from).links || []).includes(s.to)));
check("suggestions are ranked by priority then strength",
  r.suggestions.every((s, i, a) => i === 0 || a[i - 1].priority > s.priority || (a[i - 1].priority === s.priority && a[i - 1].strength >= s.strength)));

// --- Specific expert detections -------------------------------------------
check("recommends linking an orphan from a relevant page",
  anyTo("/blog/answer-first-structure").some((s) => s.reason === "orphan_fix"));
check("recommends linking an under-linked page to its pillar or fixing its orphan status",
  anyTo("/blog/orphan-pages-internal-linking").length > 0);
check("recommends the fjord product link up to the jackets buying guide (pillar)",
  !!sug("/products/fjord-rain-jacket", "/guides/jackets-buying-guide"));
check("high-similarity same-cluster pages are connected",
  r.suggestions.some((s) => s.reason === "related_content" && s.strength >= 0.22));
check("every reason has a human label", r.suggestions.every((s) => REASON_LABELS[s.reason]));

// --- Related-content dedup (no reciprocal A<->B duplicates) -----------------
const relatedKeys = r.suggestions.filter((s) => s.reason === "related_content").map((s) => [s.from, s.to].sort().join("|"));
check("related-content suggestions are de-duplicated by pair", new Set(relatedKeys).size === relatedKeys.length);

// --- Cluster health --------------------------------------------------------
const aeo = r.clusters.find((c) => c.topic === "AEO");
check("cluster health reflects pillar inbound + orphans",
  aeo && aeo.pillar === "/blog/what-is-aeo" && aeo.pillarInbound === 2 && typeof aeo.healthy === "boolean");
check("a cluster with orphans is flagged unhealthy",
  r.clusters.filter((c) => c.orphans.length > 0).every((c) => c.healthy === false));

// --- Per-page rollup -------------------------------------------------------
const fjord = r.byUrl["/products/fjord-rain-jacket"];
check("a page exposes its inbound, outlinks, and suggested links",
  fjord && fjord.inbound === 0 && Array.isArray(fjord.suggestionsOut) && fjord.suggestionsOut.length > 0);

// --- Leakage ---------------------------------------------------------------
check("no raw emails in output", !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(JSON.stringify(r)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll internal-linking optimizer checks passed.");
process.exit(failures ? 1 : 0);
