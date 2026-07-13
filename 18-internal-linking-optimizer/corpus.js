// Sample content corpus for the internal-linking optimizer. Invented pages for
// the fictional Northstar Outfitters site — no real brands/PII. Each doc has a
// topic (its cluster), an optional pillar flag, keywords (for content-similarity
// scoring), and its existing internal outbound links. The linking is deliberately
// sparse and messy so the optimizer has real gaps to find:
//   - orphan pages (zero inbound internal links)
//   - pillars that their own cluster barely links to
//   - highly-related pages that aren't linked to each other
//   - a cross-cluster relationship (AEO structured-data <-> technical SEO) missed

export const CORPUS = [
  // --- Cluster: Answer Engine Optimization (AEO) --------------------------
  { url: "/blog/what-is-aeo", title: "What Is Answer Engine Optimization?", topic: "AEO", pillar: true, words: 1400,
    keywords: ["answer engine optimization", "aeo", "ai overviews", "quotable", "extract", "citation", "search"],
    links: ["/blog/writing-for-ai", "/blog/geo-vs-seo"] },
  { url: "/blog/writing-for-ai", title: "Writing Content AI Can Actually Quote", topic: "AEO", words: 1100,
    keywords: ["answer engine optimization", "quotable", "definitions", "answer-first", "extract", "content"],
    links: ["/blog/what-is-aeo"] },
  { url: "/blog/structured-data-for-aeo", title: "Structured Data for Answer Engines", topic: "AEO", words: 950,
    keywords: ["structured data", "schema", "json-ld", "answer engine optimization", "faq", "rich result"],
    links: [] }, // relates to AEO pillar AND technical SEO; linked to neither
  { url: "/blog/geo-vs-seo", title: "GEO vs SEO: What Actually Changes", topic: "AEO", words: 1000,
    keywords: ["geo", "seo", "answer engine optimization", "ranking", "search", "extract"],
    links: ["/blog/what-is-aeo"] },
  { url: "/blog/answer-first-structure", title: "Answer-First: Structuring Pages for AI", topic: "AEO", words: 900,
    keywords: ["answer-first", "structure", "headings", "quotable", "content", "aeo"],
    links: [] }, // orphan: zero inbound

  // --- Cluster: Technical SEO ---------------------------------------------
  { url: "/blog/technical-seo-fundamentals", title: "Technical SEO Fundamentals", topic: "Technical SEO", pillar: true, words: 1500,
    keywords: ["technical seo", "crawl", "index", "canonical", "redirect", "schema", "crawlability"],
    links: ["/blog/redirects-canonicals", "/blog/crawl-budget"] },
  { url: "/blog/redirects-canonicals", title: "Redirects, Canonicals and Crawl Budget", topic: "Technical SEO", words: 1050,
    keywords: ["redirect", "canonical", "301", "chain", "crawl", "technical seo"],
    links: ["/blog/technical-seo-fundamentals"] },
  { url: "/blog/orphan-pages-internal-linking", title: "Orphan Pages and Internal Linking", topic: "Technical SEO", words: 980,
    keywords: ["orphan", "internal linking", "links", "crawl", "topical authority", "technical seo"],
    links: [] }, // relates to pillar; under-linked
  { url: "/blog/crawl-budget", title: "What Is Crawl Budget?", topic: "Technical SEO", words: 870,
    keywords: ["crawl budget", "redirect", "index", "technical seo", "bots", "crawl"],
    links: ["/blog/technical-seo-fundamentals"] },
  { url: "/blog/site-architecture", title: "Site Architecture and URL Structure", topic: "Technical SEO", words: 1120,
    keywords: ["site architecture", "url structure", "internal linking", "hierarchy", "technical seo"],
    links: [] }, // orphan

  // --- Cluster: Jackets ----------------------------------------------------
  { url: "/guides/jackets-buying-guide", title: "Jackets Buying Guide", topic: "Jackets", pillar: true, words: 1300,
    keywords: ["jackets", "shell", "insulated", "rain", "waterproof", "buying guide"],
    links: ["/products/aurora-shell-jacket"] },
  { url: "/products/aurora-shell-jacket", title: "Aurora Shell Jacket", topic: "Jackets", words: 500,
    keywords: ["aurora", "shell", "jackets", "waterproof", "recycled"],
    links: ["/guides/jackets-buying-guide"] },
  { url: "/products/fjord-rain-jacket", title: "Fjord Rain Jacket", topic: "Jackets", words: 480,
    keywords: ["fjord", "rain", "jackets", "waterproof", "lightweight"],
    links: [] }, // product not linked to its pillar
  { url: "/blog/waterproof-vs-water-resistant", title: "Waterproof vs Water-Resistant", topic: "Jackets", words: 820,
    keywords: ["waterproof", "water-resistant", "jackets", "rain", "rating"],
    links: [] }, // orphan; highly related to jackets pillar + products

  // --- Cluster: Shipping & Returns ----------------------------------------
  { url: "/help/shipping-returns", title: "Shipping & Returns Explained", topic: "Shipping & Returns", pillar: true, words: 700,
    keywords: ["shipping", "returns", "delivery", "refund", "policy"],
    links: ["/blog/free-shipping-threshold"] },
  { url: "/blog/free-shipping-threshold", title: "The Free-Shipping Threshold", topic: "Shipping & Returns", words: 1000,
    keywords: ["free shipping", "threshold", "margin", "basket", "shipping"],
    links: ["/help/shipping-returns"] },
  { url: "/help/returns-policy", title: "Returns Policy", topic: "Shipping & Returns", words: 420,
    keywords: ["returns", "refund", "policy", "exchange", "shipping"],
    links: [] }, // orphan
];
