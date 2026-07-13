// Internal-linking optimizer core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/linking.test.mjs). No DOM, no network, no PII — it analyses a
// bundled content corpus (corpus.js).
//
// Internal linking is topical-authority engineering, not "add related posts". This
// builds the link graph, clusters pages by topic, finds the gaps that matter —
// orphan pages, pillars their own cluster barely links to, and highly-related
// pages that aren't connected — and recommends specific links with a reason and a
// strength. Similarity is keyword overlap (Jaccard), so every suggestion is
// inspectable, not a black-box embedding score.

const REASON_PRIORITY = { orphan_fix: 3, link_to_pillar: 2, pillar_to_member: 2, related_content: 1 };
const SIM_THRESHOLD = 0.22;

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? inter / uni : 0;
}
function shared(a, b) { const B = new Set(b); return a.filter((x) => B.has(x)); }
const round = (n) => Math.round(n * 100) / 100;

export function optimize(corpus) {
  const byUrl = Object.fromEntries(corpus.map((d) => [d.url, d]));

  // Inbound / outbound internal link counts.
  const inbound = {}; corpus.forEach((d) => (inbound[d.url] = 0));
  corpus.forEach((d) => (d.links || []).forEach((l) => { if (l in inbound) inbound[l]++; }));

  // Clusters by topic, with pillar detection.
  const clusterMap = {};
  corpus.forEach((d) => (clusterMap[d.topic] ||= []).push(d));
  const clusters = Object.entries(clusterMap).map(([topic, members]) => {
    const pillar = members.find((m) => m.pillar) || members.slice().sort((a, b) => inbound[b.url] - inbound[a.url])[0];
    // internal links that stay within the cluster
    const memberUrls = new Set(members.map((m) => m.url));
    let internalLinks = 0;
    members.forEach((m) => (m.links || []).forEach((l) => { if (memberUrls.has(l)) internalLinks++; }));
    const orphans = members.filter((m) => inbound[m.url] === 0).map((m) => m.url);
    const pillarInbound = pillar ? inbound[pillar.url] : 0;
    // interlink density: internal links / (possible sensible links ≈ members)
    const density = members.length > 1 ? round(internalLinks / members.length) : 0;
    return { topic, pillar: pillar ? pillar.url : null, pillarTitle: pillar ? pillar.title : "—",
      members: members.map((m) => m.url), size: members.length, internalLinks, orphans, pillarInbound, density,
      healthy: !!pillar && pillarInbound >= 1 && orphans.length === 0 };
  });
  const topicOf = Object.fromEntries(corpus.map((d) => [d.url, d.topic]));
  const pillarOf = Object.fromEntries(clusters.map((c) => [c.topic, c.pillar]));

  // --- Suggestions --------------------------------------------------------
  const suggestions = [];
  corpus.forEach((from) => {
    const outset = new Set(from.links || []);
    corpus.forEach((to) => {
      if (to.url === from.url || outset.has(to.url)) return;
      const sim = jaccard(from.keywords, to.keywords);
      const sameTopic = from.topic === to.topic;
      const toIsOrphan = inbound[to.url] === 0;
      const toIsPillar = pillarOf[to.topic] === to.url;
      const fromIsPillar = pillarOf[from.topic] === from.url;

      let reason = null;
      if (toIsOrphan && (sameTopic || sim >= SIM_THRESHOLD)) reason = "orphan_fix";
      else if (sameTopic && toIsPillar) reason = "link_to_pillar";
      else if (sameTopic && fromIsPillar) reason = "pillar_to_member";
      else if (sim >= SIM_THRESHOLD) reason = "related_content";
      if (!reason) return;

      suggestions.push({
        from: from.url, to: to.url, fromTitle: from.title, toTitle: to.title,
        reason, priority: REASON_PRIORITY[reason], strength: round(sim),
        crossCluster: !sameTopic, shared: shared(from.keywords, to.keywords),
        score: round(REASON_PRIORITY[reason] + sim),
      });
    });
  });
  suggestions.sort((a, b) => b.priority - a.priority || b.strength - a.strength);

  // De-duplicate reciprocal orphan/related pairs so we don't recommend A->B and
  // B->A for the same relationship (keep the higher-scoring direction), except
  // pillar links where direction is meaningful.
  const seen = new Set();
  const deduped = [];
  for (const s of suggestions) {
    if (s.reason === "related_content") {
      const key = [s.from, s.to].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
    }
    deduped.push(s);
  }

  // --- Orphans with a recommended source ----------------------------------
  const orphans = corpus.filter((d) => inbound[d.url] === 0).map((d) => {
    const best = deduped.filter((s) => s.to === d.url).sort((a, b) => b.score - a.score)[0];
    return { url: d.url, title: d.title, topic: d.topic, recommendedFrom: best ? best.from : (pillarOf[d.topic] !== d.url ? pillarOf[d.topic] : null) };
  });

  // --- Per-page rollup ----------------------------------------------------
  const pages = corpus.map((d) => ({
    url: d.url, title: d.title, topic: d.topic, pillar: !!d.pillar, words: d.words,
    outLinks: d.links || [], inbound: inbound[d.url],
    suggestionsOut: deduped.filter((s) => s.from === d.url),
    suggestionsIn: deduped.filter((s) => s.to === d.url),
  }));
  const byUrlPage = Object.fromEntries(pages.map((p) => [p.url, p]));

  // --- Metrics ------------------------------------------------------------
  const totalLinks = corpus.reduce((s, d) => s + (d.links || []).length, 0);
  const metrics = {
    pages: corpus.length,
    clusters: clusters.length,
    internalLinks: totalLinks,
    orphanPages: orphans.length,
    suggestions: deduped.length,
    avgOutLinks: round(totalLinks / corpus.length),
    pillars: clusters.filter((c) => c.pillar).length,
  };

  return { pages, byUrl: byUrlPage, clusters, suggestions: deduped, orphans, metrics, topicOf };
}

export const REASON_LABELS = {
  orphan_fix: "Fix orphan",
  link_to_pillar: "Link to pillar",
  pillar_to_member: "Pillar → member",
  related_content: "Related content",
};
