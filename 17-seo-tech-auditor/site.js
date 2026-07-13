// Sample crawl fixture for the technical-SEO auditor. A small fictional Northstar
// Outfitters site (invented — no real domains/brands/PII) with deliberately
// injected technical-SEO problems so the audit has something to find:
//   - broken internal links (links to 404s)
//   - a redirect chain (/shop -> /catalog -> /jackets)
//   - a 301 that points at a 404 (broken redirect)
//   - duplicate + missing <title>
//   - missing meta descriptions
//   - a missing canonical and a canonical pointing at a 404
//   - a noindex on a money (product) page
//   - an orphan page (indexable, zero inbound internal links)
//   - thin content
//   - product pages missing Product schema
//
// Each page: url, status, redirectTo?, type, title, meta, canonical, h1, words,
// noindex, schema[], outLinks[]. All links are internal paths.

export const BASE = "https://northstar-outfitters.example";

export const SITE = [
  { url: "/", status: 200, type: "home", title: "Northstar Outfitters — Outdoor & Travel Gear", meta: "Jackets, shoes, backpacks and travel gear for everyday adventures.", canonical: "/", h1: "Gear for everyday adventures", words: 320, noindex: false, schema: ["Organization", "WebSite"],
    outLinks: ["/jackets", "/shoes", "/backpacks", "/blog", "/shipping", "/returns", "/products/aurora-shell-jacket", "/products/trailforge-hiker", "/shop", "/products/old-fjord-jacket"] },

  { url: "/jackets", status: 200, type: "category", title: "Jackets | Northstar Outfitters", meta: "Shell, insulated and rain jackets for the trail and the city.", canonical: "/jackets", h1: "Jackets", words: 240, noindex: false, schema: ["BreadcrumbList"],
    outLinks: ["/", "/products/aurora-shell-jacket", "/products/ridgeline-insulated-jacket", "/products/fjord-rain-jacket", "/products/retired-pack"] },

  { url: "/shoes", status: 200, type: "category", title: "Shoes | Northstar Outfitters", meta: "Hiking and trail shoes built to last.", canonical: "/shoes", h1: "Shoes", words: 210, noindex: false, schema: ["BreadcrumbList"],
    outLinks: ["/", "/products/trailforge-hiker", "/products/cascade-trail-runner", "/products/basecamp-approach-shoe"] },

  { url: "/backpacks", status: 200, type: "category", title: "Backpacks | Northstar Outfitters", meta: "Daypacks and expedition packs.", canonical: "/backpacks", h1: "Backpacks", words: 180, noindex: false, schema: ["BreadcrumbList"],
    outLinks: ["/", "/products/voyager-30l-backpack"] },

  // Products
  { url: "/products/aurora-shell-jacket", status: 200, type: "product", title: "Aurora Shell Jacket | Northstar Outfitters", meta: "A protective recycled-polyester shell for wet-weather trails.", canonical: "/products/aurora-shell-jacket", h1: "Aurora Shell Jacket", words: 340, noindex: false, schema: ["Product", "BreadcrumbList"],
    outLinks: ["/jackets", "/products/ridgeline-insulated-jacket", "/size-guide"] },

  { url: "/products/ridgeline-insulated-jacket", status: 200, type: "product", title: "Ridgeline Insulated Jacket | Northstar Outfitters", meta: "Warm insulated jacket for cold days.", canonical: "/products/ridgeline-insulated-jacket", h1: "Ridgeline Insulated Jacket", words: 300, noindex: false, schema: [], // missing Product schema
    outLinks: ["/jackets", "/products/aurora-shell-jacket"] },

  { url: "/products/fjord-rain-jacket", status: 200, type: "product", title: "Fjord Rain Jacket | Northstar Outfitters", meta: "A light, lower-priced rain shell.", canonical: "/products/fjord-rain-jacket", h1: "Fjord Rain Jacket", words: 280, noindex: true, schema: ["Product"], // noindex on a money page (accidental)
    outLinks: ["/jackets"] },

  { url: "/products/trailforge-hiker", status: 200, type: "product", title: "Trail Shoe | Northstar Outfitters", meta: "Sturdy hiking shoe.", canonical: "/products/trailforge-hiker", h1: "TrailForge Hiker", words: 260, noindex: false, schema: ["Product"],
    outLinks: ["/shoes", "/products/cascade-trail-runner"] },

  { url: "/products/cascade-trail-runner", status: 200, type: "product", title: "Trail Shoe | Northstar Outfitters", meta: "Lightweight trail runner.", canonical: "/products/cascade-trail-runner", h1: "Cascade Trail Runner", words: 250, noindex: false, schema: ["Product"], // duplicate title with trailforge
    outLinks: ["/shoes"] },

  { url: "/products/basecamp-approach-shoe", status: 200, type: "product", title: "Basecamp Approach Shoe | Northstar Outfitters", meta: "", canonical: "/products/basecamp-approach-shoe", h1: "Basecamp Approach Shoe", words: 240, noindex: false, schema: ["Product"], // missing meta
    outLinks: ["/shoes"] },

  { url: "/products/voyager-30l-backpack", status: 200, type: "product", title: "Voyager 30L Backpack | Northstar Outfitters", meta: "A versatile 30-litre daypack.", canonical: "/products/voyager", h1: "Voyager 30L Backpack", words: 230, noindex: false, schema: ["Product"], // canonical points to a 404
    outLinks: ["/backpacks"] },

  // Redirects
  { url: "/products/old-fjord-jacket", status: 301, redirectTo: "/products/fjord-rain-jacket", type: "redirect", outLinks: [] }, // linked from home; target is noindex
  { url: "/shop", status: 301, redirectTo: "/catalog", type: "redirect", outLinks: [] },   // chain start
  { url: "/catalog", status: 301, redirectTo: "/jackets", type: "redirect", outLinks: [] }, // chain hop
  { url: "/products/legacy-pack", status: 301, redirectTo: "/products/retired-pack", type: "redirect", outLinks: [] }, // 301 -> 404
  { url: "/old-home", status: 301, redirectTo: "/", type: "redirect", outLinks: [] },

  // Errors
  { url: "/products/retired-pack", status: 404, type: "error", outLinks: [] },
  { url: "/gone", status: 404, type: "error", outLinks: [] },

  // Content
  { url: "/blog", status: 200, type: "blog", title: "Blog | Northstar Outfitters", meta: "Guides on gear, sizing and sustainability.", canonical: "/blog", h1: "Blog", words: 160, noindex: false, schema: ["Blog"],
    outLinks: ["/", "/blog/aeo", "/blog/free-shipping"] },

  { url: "/blog/aeo", status: 200, type: "blog", title: "What Is Answer Engine Optimization? | Northstar", meta: "How to structure content so AI answer engines can quote it.", canonical: "/blog/aeo", h1: "What Is Answer Engine Optimization?", words: 420, noindex: false, schema: ["Article", "FAQPage"],
    outLinks: ["/blog", "/products/aurora-shell-jacket", "/gone"] }, // broken link to /gone

  { url: "/blog/free-shipping", status: 200, type: "blog", title: "The Free-Shipping Threshold | Northstar", meta: "Where to set free shipping without losing margin.", canonical: "/blog/free-shipping", h1: "The Free-Shipping Threshold", words: 90, noindex: false, schema: ["Article"], // thin content
    outLinks: ["/blog"] },

  { url: "/blog/draft-post", status: 200, type: "blog", title: "Draft: Winter Layering Guide | Northstar", meta: "How to layer for cold-weather hikes.", canonical: "/blog/draft-post", h1: "Winter Layering Guide", words: 260, noindex: false, schema: ["Article"], // orphan: nobody links here
    outLinks: ["/blog"] },

  // Policy / utility
  { url: "/shipping", status: 200, type: "policy", title: "Shipping | Northstar Outfitters", meta: "Delivery times and costs.", canonical: "", h1: "Shipping", words: 200, noindex: false, schema: [], // missing canonical
    outLinks: ["/", "/returns"] },

  { url: "/returns", status: 200, type: "policy", title: "Returns | Northstar Outfitters", meta: "Our 30-day returns policy.", canonical: "/returns", h1: "Returns", words: 190, noindex: false, schema: [],
    outLinks: ["/", "/shipping"] },

  { url: "/size-guide", status: 200, type: "policy", title: "", meta: "Find your size across jackets and shoes.", canonical: "/size-guide", h1: "Size Guide", words: 210, noindex: false, schema: [], // missing title
    outLinks: ["/"] },
];
