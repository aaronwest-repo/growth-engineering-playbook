// path-normalization-example.js — ILLUSTRATIVE TEMPLATE.
//
// Example-level helper for the classic "broken image path after deploy" bug:
// absolute CMS paths, double slashes, and localhost URLs that resolve locally
// but 404 once the site is behind a CDN at a real domain.
//
// This is a teaching example, NOT a full site crawler or build plugin.
// Dependency-free; run with `node path-normalization-example.js`.

// Normalize a single image src to a portable, page-relative path.
export function normalizeImagePath(src, { basePrefix = "assets/img/" } = {}) {
  let out = String(src).trim();

  // Drop localhost / dev origins — they never work in production.
  out = out.replace(/^https?:\/\/localhost(?::\d+)?/i, "");

  // Rewrite common absolute CMS roots to the static asset prefix.
  out = out.replace(/^\/(media|wp-content\/uploads)\//i, basePrefix);

  // Collapse accidental double slashes (e.g. /media/posts/5//image.png).
  out = out.replace(/([^:])\/{2,}/g, "$1/");

  // Strip a leading slash so the path is relative to the page, not the root.
  out = out.replace(/^\//, "");

  return out;
}

// Report whether a path is safe, and why (for a pre-deploy check).
export function classify(src) {
  if (/^https?:\/\/localhost/i.test(src)) return { ok: false, reason: "localhost URL" };
  if (/[^:]\/{2,}/.test(src)) return { ok: false, reason: "double slash" };
  if (/^\/(media|wp-content)\//i.test(src)) return { ok: false, reason: "absolute CMS path" };
  return { ok: true, reason: "portable" };
}

// Demo when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const samples = [
    "/media/posts/5//image.png",
    "http://localhost/img/hero.jpg",
    "/wp-content/uploads/logo.png",
    "assets/img/product-01.jpg",
  ];
  for (const s of samples) {
    console.log(`${s}\n  -> ${normalizeImagePath(s)}  (${classify(s).reason})`);
  }
}
