// Technical-SEO auditor core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/seo.test.mjs). No DOM, no network, no PII — it audits a
// bundled sample crawl (site.js), the way a crawler's report would.
//
// This is the plumbing layer beneath content and schema: crawlability and
// indexability. The expert move isn't listing every nit — it's knowing which
// issues actually block ranking (broken internal links, redirect chains, a
// noindex on a money page, a canonical to a 404, orphan pages, duplicate titles)
// and prioritising by severity, not by count. Deterministic; nothing is fetched.

const SEV = { error: 5, warning: 2, notice: 0.5 };
const REDIRECT = new Set([301, 302, 307, 308]);
const isBrokenStatus = (s) => s >= 400;

// Follow a redirect chain from a url; returns {finalUrl, finalStatus, hops, brokenAt}.
function follow(byUrl, url, maxHops = 5) {
  let cur = url, hops = 0;
  const seen = new Set();
  while (hops < maxHops) {
    const p = byUrl[cur];
    if (!p) return { finalUrl: cur, finalStatus: 404, hops, missing: true };
    if (!REDIRECT.has(p.status)) return { finalUrl: cur, finalStatus: p.status, hops };
    if (seen.has(cur)) return { finalUrl: cur, finalStatus: 508, hops, loop: true };
    seen.add(cur);
    cur = p.redirectTo;
    hops++;
  }
  return { finalUrl: cur, finalStatus: (byUrl[cur] || {}).status || 404, hops };
}

const MONEY = new Set(["product", "category"]);
const CONTENT = new Set(["product", "category", "blog"]);
const THIN_WORDS = 120;

export function audit(site) {
  const byUrl = Object.fromEntries(site.map((p) => [p.url, p]));
  const issues = [];
  const add = (category, severity, url, detail, fix) => issues.push({ category, severity, url, detail, fix });

  // Inbound internal link counts (from any non-error page's outLinks).
  const inbound = {};
  site.forEach((p) => (inbound[p.url] = 0));
  site.forEach((p) => (p.outLinks || []).forEach((l) => { if (l in inbound) inbound[l] = (inbound[l] || 0) + 1; }));

  // Duplicate titles across indexable 200 pages.
  const titleMap = {};
  site.forEach((p) => { if (p.status === 200 && p.title) (titleMap[p.title] ||= []).push(p.url); });
  const dupTitles = new Set(Object.values(titleMap).filter((u) => u.length > 1).flat());

  // --- Link-level checks (broken links + redirect links/chains) -----------
  site.forEach((p) => {
    (p.outLinks || []).forEach((link) => {
      const t = byUrl[link];
      if (!t) { add("broken-link", "error", p.url, `Links to ${link}, which returns 404 (page not found).`, `Fix or remove the link to ${link} on ${p.url}.`); return; }
      if (isBrokenStatus(t.status)) { add("broken-link", "error", p.url, `Links to ${link} (HTTP ${t.status}).`, `Update the link on ${p.url} to a live URL.`); return; }
      if (REDIRECT.has(t.status)) {
        const f = follow(byUrl, link);
        if (f.finalStatus >= 400) add("broken-redirect", "error", p.url, `Links to ${link}, which redirects to a dead page (HTTP ${f.finalStatus}).`, `Point the link to a live destination.`);
        else if (f.hops >= 2) add("redirect-chain", "warning", p.url, `Links to ${link} → a ${f.hops}-hop redirect chain ending at ${f.finalUrl}.`, `Link directly to ${f.finalUrl} to remove ${f.hops - 1} extra hop(s).`);
        else add("redirect-link", "warning", p.url, `Links to ${link}, a redirect to ${f.finalUrl}.`, `Link directly to ${f.finalUrl}.`);
      }
    });
  });

  // --- Redirect target health --------------------------------------------
  site.filter((p) => REDIRECT.has(p.status)).forEach((p) => {
    const f = follow(byUrl, p.url);
    if (f.finalStatus >= 400) add("broken-redirect", "error", p.url, `Redirect target chain ends at a dead page (HTTP ${f.finalStatus}).`, `Repoint ${p.url} to a live URL.`);
    else if (f.hops >= 2) add("redirect-chain", "warning", p.url, `${p.url} is a ${f.hops}-hop redirect chain to ${f.finalUrl}.`, `Collapse to a single hop to ${f.finalUrl}.`);
  });

  // --- Page-level checks (indexable 200 pages) ---------------------------
  site.filter((p) => p.status === 200).forEach((p) => {
    if (!p.title) add("missing-title", "error", p.url, "No <title> — search engines have no headline for this page.", "Add a unique, descriptive <title>.");
    else if (dupTitles.has(p.url)) add("duplicate-title", "warning", p.url, `Title "${p.title}" is duplicated on another page.`, "Write a unique title per page.");
    if (!p.meta) add("missing-meta", "warning", p.url, "No meta description — search engines write their own snippet.", "Add a compelling meta description.");
    if (!p.h1) add("missing-h1", "warning", p.url, "No H1 heading.", "Add a single, descriptive H1.");

    // canonical
    if (!p.canonical) add("missing-canonical", "warning", p.url, "No canonical URL — risks duplicate-content ambiguity.", "Add a self-referencing canonical.");
    else if (p.canonical !== p.url) {
      const c = byUrl[p.canonical];
      if (!c || c.status >= 400) add("canonical-broken", "error", p.url, `Canonical points to ${p.canonical}, which is 404 — the page de-indexes itself.`, "Point the canonical at a live URL (usually itself).");
      else if (REDIRECT.has(c.status)) add("canonical-redirect", "warning", p.url, `Canonical points to a redirect (${p.canonical}).`, "Canonical should point at the final 200 URL.");
    }

    // indexability of money pages
    if (p.noindex && MONEY.has(p.type)) add("noindex-money", "error", p.url, `A ${p.type} page is set to noindex — it can't rank at all.`, "Remove noindex unless this page is intentionally hidden.");

    // thin content
    if (CONTENT.has(p.type) && (p.words || 0) < THIN_WORDS) add("thin-content", "warning", p.url, `Only ${p.words} words — likely too thin to rank.`, "Expand with useful, specific content.");

    // structured data on products
    if (p.type === "product" && !(p.schema || []).includes("Product")) add("missing-schema", "warning", p.url, "Product page without Product structured data — no rich result eligibility.", "Add Product JSON-LD (see the schema generator).");

    // orphan pages
    if (!p.noindex && p.url !== "/" && inbound[p.url] === 0) add("orphan", "warning", p.url, "Indexable page with no inbound internal links — crawlers may never find it.", "Link to it from a relevant hub/category page.");
  });

  // --- Rollups ------------------------------------------------------------
  const pagesByUrl = {};
  site.forEach((p) => (pagesByUrl[p.url] = { ...p, inbound: inbound[p.url] || 0, issues: [] }));
  issues.forEach((i) => pagesByUrl[i.url] && pagesByUrl[i.url].issues.push(i));

  const counts = { error: 0, warning: 0, notice: 0 };
  issues.forEach((i) => (counts[i.severity]++));

  const categories = {};
  issues.forEach((i) => {
    const c = (categories[i.category] ||= { category: i.category, severity: i.severity, count: 0, pages: new Set() });
    c.count++; c.pages.add(i.url);
    if (SEV[i.severity] > SEV[c.severity]) c.severity = i.severity;
  });
  const categoryList = Object.values(categories)
    .map((c) => ({ ...c, pages: c.pages.size }))
    .sort((a, b) => SEV[b.severity] * b.count - SEV[a.severity] * a.count);

  const pagesCrawled = site.length;
  const indexable = site.filter((p) => p.status === 200 && !p.noindex);
  const penalty = counts.error * 6 + counts.warning * 2 + counts.notice * 0.5;
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  const metrics = {
    pagesCrawled,
    healthScore,
    errors: counts.error, warnings: counts.warning, notices: counts.notice,
    brokenLinks: issues.filter((i) => i.category === "broken-link" || i.category === "broken-redirect").length,
    orphanPages: issues.filter((i) => i.category === "orphan").length,
    indexablePages: indexable.length,
  };

  // Prioritised fixes: one line per category, worst first.
  const fixes = categoryList.map((c) => ({
    category: c.category, severity: c.severity, count: c.count,
    text: (issues.find((i) => i.category === c.category) || {}).fix || "",
    impact: Math.round(SEV[c.severity] * c.count),
  }));

  return { pages: Object.values(pagesByUrl), byUrl: pagesByUrl, issues, categories: categoryList, metrics, fixes };
}

export const CATEGORY_LABELS = {
  "broken-link": "Broken internal links",
  "broken-redirect": "Redirects to dead pages",
  "redirect-chain": "Redirect chains",
  "redirect-link": "Links to redirects",
  "missing-title": "Missing titles",
  "duplicate-title": "Duplicate titles",
  "missing-meta": "Missing meta descriptions",
  "missing-h1": "Missing H1",
  "missing-canonical": "Missing canonical",
  "canonical-broken": "Canonical to dead page",
  "canonical-redirect": "Canonical to redirect",
  "noindex-money": "Noindex on key pages",
  "thin-content": "Thin content",
  "missing-schema": "Missing structured data",
  "orphan": "Orphan pages",
};
