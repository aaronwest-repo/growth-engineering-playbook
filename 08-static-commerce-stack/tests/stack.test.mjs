// Smoke test for the static commerce stack simulator. Pure Node, no deps.
// Run: node tests/stack.test.mjs   (exits non-zero on any failure)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { simulate, checkImagePaths } from "../stack.js";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${extra}`); }
}
const base = { ttl: 3600, deployType: "full", invalidation: "changed", imageMode: "normalized", rollback: true };

// --- Cache TTL affects stale-risk duration --------------------------------
const noInval = { ...base, invalidation: "none" };
const t5 = simulate({ ...noInval, ttl: 300 }).staleRisk.seconds;
const t1h = simulate({ ...noInval, ttl: 3600 }).staleRisk.seconds;
const t24 = simulate({ ...noInval, ttl: 86400 }).staleRisk.seconds;
check("cache TTL affects stale-risk duration", t5 < t1h && t1h < t24, `${t5} ${t1h} ${t24}`);

// --- Invalidation scope ----------------------------------------------------
const wildcard = simulate({ ...base, invalidation: "wildcard" });
const changed = simulate({ ...base, invalidation: "changed" });
const none = simulate({ ...base, invalidation: "none" });
check("wildcard invalidation reduces stale risk vs none", wildcard.staleRisk.seconds < none.staleRisk.seconds);
check("wildcard increases cost / blast radius vs changed",
  wildcard.cost.total > changed.cost.total && wildcard.invalidationPlan.objectsAffected > changed.invalidationPlan.objectsAffected);
check("changed-path invalidation is a smaller plan than wildcard",
  changed.invalidationPlan.objectsAffected < wildcard.invalidationPlan.objectsAffected);
check("no invalidation leaves stale HTML risk",
  none.risks.some((r) => r.id === "stale_html") && none.risks.some((r) => r.id === "missing_invalidation"));

// --- Asset deploy with stale HTML flagged ---------------------------------
check("asset deploy with stale HTML is flagged",
  simulate({ ...base, deployType: "assets", invalidation: "none" }).risks.some((r) => r.id === "stale_assets_after_content"));

// --- Image paths -----------------------------------------------------------
check("broken image paths are detected", simulate({ ...base, imageMode: "broken" }).imagePathCheck.brokenCount > 0);
check("normalized image paths pass", simulate({ ...base, imageMode: "normalized" }).imagePathCheck.ok === true);
check("broken image paths raise a risk", simulate({ ...base, imageMode: "broken" }).risks.some((r) => r.id === "broken_image_paths"));

// --- Rollback --------------------------------------------------------------
check("rollback unavailable creates a warning",
  simulate({ ...base, rollback: false }).risks.some((r) => r.id === "no_rollback"));
check("rollback available creates no rollback warning",
  !simulate({ ...base, rollback: true }).risks.some((r) => r.id === "no_rollback"));

// --- Cost ------------------------------------------------------------------
for (const inv of ["none", "changed", "wildcard"]) {
  check(`cost is non-negative (${inv})`, simulate({ ...base, invalidation: inv }).cost.total >= 0);
}
check("cost changes with invalidation scope",
  none.cost.total !== changed.cost.total && changed.cost.total !== wildcard.cost.total);

// --- Deploy checklist ------------------------------------------------------
const phases = simulate(base).checklist.map((c) => c.phase);
check("deploy checklist includes build, sync, invalidate, verify",
  ["build", "sync", "invalidate", "verify"].every((p) => phases.includes(p)), JSON.stringify(phases));

// --- Cache timeline --------------------------------------------------------
check("cache timeline has before → refresh → browser steps",
  simulate(base).cacheTimeline.length >= 4);

// --- checkImagePaths unit --------------------------------------------------
check("checkImagePaths flags a double-slash path",
  checkImagePaths("broken").results.some((r) => !r.ok && /\/\//.test(r.src)));

// --- Template files: placeholders only, no real identifiers ---------------
const tplDir = fileURLToPath(new URL("../templates/", import.meta.url));
const tplFiles = readdirSync(tplDir);
check("template folder has the 4 expected files",
  ["deploy-static-site.sh", ".env.example", "cache-policy.json", "path-normalization-example.js"].every((f) => tplFiles.includes(f)),
  JSON.stringify(tplFiles));
const tplBlob = tplFiles.map((f) => readFileSync(tplDir + f, "utf8")).join("\n");
check("templates use placeholders (STATIC_BUCKET_NAME / CDN_DISTRIBUTION_ID)",
  /STATIC_BUCKET_NAME/.test(tplBlob) && /CDN_DISTRIBUTION_ID/.test(tplBlob));
check("templates contain no AWS-account-like 12-digit numbers", !/\b\d{12}\b/.test(tplBlob));
check("templates contain no cloudfront/real-bucket identifiers",
  !/cloudfront\.net|s3\.amazonaws\.com|E[A-Z0-9]{13}|AKIA/.test(tplBlob), "found a real-looking identifier");
check("deploy template is marked illustrative and dry-run",
  /template|illustrative|dry-run|DRY_RUN/i.test(readFileSync(tplDir + "deploy-static-site.sh", "utf8")));

console.log("");
if (failures > 0) { console.error(`stack.test: ${failures} check(s) FAILED`); process.exit(1); }
console.log("stack.test: all checks passed");
