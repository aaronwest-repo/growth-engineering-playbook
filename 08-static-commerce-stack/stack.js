// Static commerce stack simulator core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/stack.test.mjs). No DOM, no network, NO real infrastructure.
//
// This models the DECISIONS in a low-cost static deploy — build → object
// storage → CDN edge → invalidation → verified live — so the cache boundaries
// and failure modes are inspectable. It is a template/simulator, not a deploy
// tool: nothing here touches a real bucket, distribution, or account.

const TTL_LABEL = { 300: "5 minutes", 3600: "1 hour", 86400: "24 hours" };
const SITE_OBJECT_COUNT = 50; // illustrative total objects in the site

// Which paths a deploy touches (stable URLs — the non-content-hashed case,
// where invalidation actually matters; see README for the hashing mitigation).
const CHANGED_PATHS = {
  content: ["/", "/index.html", "/products.html"],
  assets: ["/index.html", "/assets/app.css", "/assets/app.js", "/assets/vendor.js"],
  full: ["/", "/index.html", "/products.html", "/assets/app.css", "/assets/app.js", "/assets/vendor.js", "/sitemap.xml", "/robots.txt"],
};

/**
 * Simulate one deploy.
 * options: {
 *   ttl: 300|3600|86400,
 *   deployType: 'content'|'assets'|'full',
 *   invalidation: 'none'|'changed'|'wildcard',
 *   imageMode: 'normalized'|'mixed'|'broken',
 *   rollback: boolean
 * }
 */
export function simulate(options) {
  const { ttl, deployType, invalidation, imageMode, rollback } = withDefaults(options);
  const changed = CHANGED_PATHS[deployType];

  // --- Invalidation plan -------------------------------------------------
  let invalidationPaths, objectsAffected, scopeNote;
  if (invalidation === "none") {
    invalidationPaths = []; objectsAffected = 0;
    scopeNote = "No invalidation requested — the edge keeps serving cached objects until TTL expiry.";
  } else if (invalidation === "changed") {
    invalidationPaths = changed.slice(); objectsAffected = changed.length;
    scopeNote = "Invalidate only the paths this deploy changed — smallest blast radius.";
  } else { // wildcard
    invalidationPaths = ["/*"]; objectsAffected = SITE_OBJECT_COUNT;
    scopeNote = "Wildcard invalidation refetches the whole site — simple, but maximum blast radius and origin load.";
  }

  // --- Stale-content risk -------------------------------------------------
  // With no invalidation, cached objects stay stale for the full TTL.
  const staleRiskSeconds = invalidation === "none" ? ttl : 0;
  let staleLevel;
  if (staleRiskSeconds === 0) staleLevel = invalidation === "wildcard" ? "low" : "none";
  else staleLevel = ttl >= 86400 ? "high" : ttl >= 3600 ? "medium" : "low";

  // --- Risk flags ---------------------------------------------------------
  const risks = [];
  if (invalidation === "none") {
    risks.push({ id: "stale_html", severity: deployType === "assets" ? "medium" : "high",
      text: `Visitors keep the old page for up to ${TTL_LABEL[ttl]} — no invalidation was requested.` });
    risks.push({ id: "missing_invalidation", severity: "high",
      text: "Missing invalidation: the deploy uploaded new objects but never told the CDN to drop the old ones." });
  }
  if ((deployType === "assets" || deployType === "full") && invalidation === "none") {
    risks.push({ id: "stale_assets_after_content", severity: "high",
      text: "Asset deploy with stale HTML: the new HTML/asset pairing isn't served together, so the live page can reference the wrong bundle." });
  }
  if (invalidation === "wildcard") {
    risks.push({ id: "over_broad_wildcard", severity: "medium",
      text: "Over-broad wildcard invalidation: every object is refetched from origin at once — higher cost and a possible cache stampede." });
  }
  if (imageMode === "broken") {
    risks.push({ id: "broken_image_paths", severity: "high",
      text: "Broken image paths: absolute paths like /media/posts/5//image.png don't resolve under the CDN prefix and 404." });
  } else if (imageMode === "mixed") {
    risks.push({ id: "mixed_image_paths", severity: "medium",
      text: "Mixed relative/absolute image paths: some images may 404 depending on the page's base URL." });
  }
  if (!rollback) {
    risks.push({ id: "no_rollback", severity: "medium",
      text: "No rollback artifact kept: a bad deploy has no fast, versioned undo." });
  }

  // --- Image path check ---------------------------------------------------
  const imagePathCheck = checkImagePaths(imageMode);

  // --- Cost estimate (illustrative, monthly) -----------------------------
  const cost = estimateCost({ ttl, invalidation, objectsAffected });

  // --- Deploy checklist ---------------------------------------------------
  const checklist = [
    { phase: "build", label: "Build static output", detail: `Generate ${deployType === "content" ? "updated HTML" : deployType === "assets" ? "new asset bundles + HTML" : "the full site"} into BUILD_DIR.` },
    { phase: "sync", label: "Sync to object storage", detail: syncSummary(deployType) },
    { phase: "invalidate", label: "Invalidate CDN cache", detail: scopeNote },
    { phase: "verify", label: "Verify live site", detail: "Fetch key URLs through the CDN and confirm the new version + working images." },
  ];

  // --- Sync plan ----------------------------------------------------------
  const syncPlan = buildSyncPlan(deployType, changed);

  // --- Cache timeline -----------------------------------------------------
  const cacheTimeline = buildTimeline({ ttl, invalidation });

  const rollbackNote = rollback
    ? "Previous build retained as a versioned artifact — roll back by re-pointing the alias to the prior version."
    : "No versioned artifact retained — you cannot quickly revert a bad deploy.";

  return {
    options: { ttl, deployType, invalidation, imageMode, rollback },
    checklist, syncPlan,
    cacheStatus: {
      ttl, ttlLabel: TTL_LABEL[ttl],
      staleRiskSeconds, staleLevel,
      note: staleRiskSeconds === 0
        ? "Edge is refreshed by the invalidation; visitors see the new version within seconds."
        : `Edge stays stale for up to ${TTL_LABEL[ttl]} until the cached objects expire.`,
    },
    invalidationPlan: { scope: invalidation, paths: invalidationPaths, objectsAffected, note: scopeNote },
    staleRisk: { seconds: staleRiskSeconds, level: staleLevel },
    cost, rollbackNote, cacheTimeline, risks, imagePathCheck,
  };
}

function withDefaults(o = {}) {
  return {
    ttl: [300, 3600, 86400].includes(o.ttl) ? o.ttl : 3600,
    deployType: ["content", "assets", "full"].includes(o.deployType) ? o.deployType : "content",
    invalidation: ["none", "changed", "wildcard"].includes(o.invalidation) ? o.invalidation : "changed",
    imageMode: ["normalized", "mixed", "broken"].includes(o.imageMode) ? o.imageMode : "normalized",
    rollback: o.rollback !== false,
  };
}

function estimateCost({ ttl, invalidation, objectsAffected }) {
  const storage = 0.1;              // object storage, illustrative €/month
  const cdnBase = 0.35;             // CDN request/egress base
  const ttlOrigin = ttl === 300 ? 0.3 : ttl === 3600 ? 0.1 : 0.02; // shorter TTL = more origin fetches
  const invalidationCost =
    invalidation === "none" ? 0 :
    invalidation === "changed" ? round2(0.01 * objectsAffected) :
    0.5;                             // wildcard: whole-site origin refetch
  const total = round2(storage + cdnBase + ttlOrigin + invalidationCost);
  return { storage, cdnBase, ttlOrigin, invalidationCost, total, currency: "EUR", note: "Illustrative monthly estimate, not a quote." };
}

function syncSummary(deployType) {
  return deployType === "content" ? "Upload changed HTML; leave assets untouched."
    : deployType === "assets" ? "Upload new asset bundles and updated HTML; keep old assets until safe to prune."
      : "Upload the full build; prune deleted objects.";
}

function buildSyncPlan(deployType, changed) {
  const plan = changed.map((p) => ({ action: "upload", path: p }));
  if (deployType === "full") plan.push({ action: "prune", path: "objects removed from the build" });
  return plan;
}

function buildTimeline({ ttl, invalidation }) {
  const steps = [
    { step: "Before deploy", detail: "Edge serves version 1 from cache." },
    { step: "Upload complete", detail: "Object storage now holds version 2; the edge still serves version 1." },
  ];
  if (invalidation === "none") {
    steps.push({ step: "No invalidation", detail: "The CDN was never told the objects changed." });
    steps.push({ step: "Edge refreshes on TTL", detail: `Cached objects expire after ${TTL_LABEL[ttl]}, then the edge fetches version 2.` });
  } else {
    steps.push({ step: "Invalidation requested", detail: invalidation === "wildcard" ? "Wildcard /* — the whole site is marked stale." : "Only the changed paths are marked stale." });
    steps.push({ step: "Edge refreshed", detail: "Within seconds the edge fetches version 2 from origin." });
  }
  steps.push({ step: "Browser sees new version", detail: "After the edge refreshes (plus any browser cache), visitors get version 2." });
  return steps;
}

/** Example-level image path check (not a full site crawler). */
export function checkImagePaths(mode) {
  const samples = {
    normalized: ["assets/img/hero.jpg", "assets/img/product-01.jpg", "assets/img/logo.svg"],
    mixed: ["assets/img/hero.jpg", "/img/product-01.jpg", "../media/logo.svg"],
    broken: ["/media/posts/5//image.png", "http://localhost/img/hero.jpg", "/wp-content/uploads/x.png"],
  }[mode];
  const results = samples.map((src) => ({ src, ...classifyPath(src) }));
  return {
    mode,
    results,
    ok: results.every((r) => r.ok),
    brokenCount: results.filter((r) => !r.ok).length,
  };
}

function classifyPath(src) {
  if (/^https?:\/\/localhost/i.test(src)) return { ok: false, reason: "points at localhost, not the live domain" };
  if (/\/\//.test(src.replace(/^https?:\/\//, ""))) return { ok: false, reason: "double slash produces an unresolvable URL" };
  if (/^\/(media|wp-content)\//.test(src)) return { ok: false, reason: "absolute CMS path won't resolve under the static prefix" };
  if (/^\//.test(src)) return { ok: true, reason: "root-absolute — works only if served from the domain root", warn: true };
  if (/^\.\.\//.test(src)) return { ok: true, reason: "relative-parent — fragile if the page moves", warn: true };
  return { ok: true, reason: "relative to the page — portable" };
}

function round2(x) { return Math.round(x * 100) / 100; }
