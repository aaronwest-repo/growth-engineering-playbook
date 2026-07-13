// Product recommendation rules engine core.
//
// Dependency-free ES module, imported by the browser UI (app.js) and the Node
// smoke test (tests/rec.test.mjs). No DOM, no network, no PII — everything is
// derived from the catalog and behavioural event streams.
//
// This is NOT a black-box "customers also bought" widget. Recommendations here
// are a *rules and governance* problem: legible strategies (complementary,
// similar, upsell, bought-together, trending, brand) blended by an objective,
// then filtered by business guardrails (in-stock, margin floor, return-risk
// suppression from support signals, diversity), with every recommendation
// explaining which rules fired and on what evidence. Deterministic keyword/rule
// logic — not an ML model.

export function parseCsv(text) {
  const rows = [];
  let field = "", record = [], q = false;
  const pf = () => { record.push(field); field = ""; };
  const pr = () => { rows.push(record); record = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") pf();
    else if (c === "\n") { pf(); pr(); }
    else if (c !== "\r") field += c;
  }
  if (field.length || record.length) { pf(); pr(); }
  const raw = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  const header = raw[0].map((h) => h.trim());
  return raw.slice(1).map((cells) => { const o = {}; header.forEach((h, i) => (o[h] = (cells[i] || "").trim())); return o; });
}
export function parseJsonl(text) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round = (n) => Math.round(n * 100) / 100;

// Merchandising complement rules — legible, hand-authored cross-category logic.
export const COMPLEMENTS = {
  "Jackets": ["Base layers", "Outdoor accessories"],
  "Base layers": ["Jackets", "Outdoor accessories"],
  "Shoes": ["Outdoor accessories", "Base layers"],
  "Backpacks": ["Travel gear", "Reusable bottles"],
  "Travel gear": ["Backpacks", "Reusable bottles"],
  "Reusable bottles": ["Backpacks", "Travel gear", "Outdoor accessories"],
  "Outdoor accessories": ["Jackets", "Shoes", "Backpacks"],
};

// Objective -> per-strategy weight. The control that reshapes the whole slate.
export const OBJECTIVES = {
  balanced:   { complementary: 1.0, behavior: 1.1, similar: 0.8, upsell: 0.8, trending: 0.7, brand: 0.5 },
  cross_sell: { complementary: 1.5, behavior: 1.3, similar: 0.4, upsell: 0.4, trending: 0.5, brand: 0.4 },
  upsell:     { complementary: 0.5, behavior: 0.6, similar: 0.7, upsell: 1.7, trending: 0.5, brand: 0.5 },
  trending:   { complementary: 0.6, behavior: 1.0, similar: 0.6, upsell: 0.5, trending: 1.7, brand: 0.3 },
  behavior:   { complementary: 0.7, behavior: 1.9, similar: 0.5, upsell: 0.5, trending: 0.7, brand: 0.3 },
};
export const MARGIN_FLOORS = { off: 0, "45%": 0.45, "50%": 0.50 };
const RETURN_RISK_MIN = 3;   // support returns/exchange/damaged tickets to flag a product
const PRICE_BAND = 0.35;     // "similar" price tolerance
export const STRATEGY_LABELS = {
  complementary: "Complementary", behavior: "Bought together", similar: "Similar",
  upsell: "Upsell", trending: "Trending", brand: "Same brand",
};

const groupIdOf = (p) => p.parent_id || p.product_id;

function addPair(adj, a, b, kind) {
  if (a === b) return;
  for (const [x, y] of [[a, b], [b, a]]) {
    let m = adj.get(x); if (!m) { m = new Map(); adj.set(x, m); }
    let e = m.get(y); if (!e) { e = { view: 0, cart: 0, purchase: 0 }; m.set(y, e); }
    e[kind]++;
  }
}

export function buildModel({ products, webEvents = [], cartEvents = [], conversions = [], tickets = [] }) {
  // --- Group variants (S/M/L) into one recommendable product -------------
  const pidToGroup = {};
  const groupMap = new Map();
  products.forEach((p) => {
    const gid = groupIdOf(p);
    pidToGroup[p.product_id] = gid;
    if (!groupMap.has(gid)) groupMap.set(gid, []);
    groupMap.get(gid).push(p);
  });
  const groups = [];
  for (const [gid, variants] of groupMap) {
    // Representative: prefer in-stock, then most stock, then lowest id.
    const rep = variants.slice().sort((a, b) =>
      (Number(num(b.stock) > 0) - Number(num(a.stock) > 0)) || (num(b.stock) - num(a.stock)) || a.product_id.localeCompare(b.product_id))[0];
    const stock = variants.reduce((s, v) => s + num(v.stock), 0);
    groups.push({
      id: gid, rep: rep.product_id, title: rep.title_en, brand: rep.brand, category: rep.category,
      price: round(num(rep.price)), margin: round(num(rep.margin_rate)), material: rep.material,
      stock, inStock: stock > 0, variantCount: variants.length,
    });
  }
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]));

  // --- Behaviour co-signals (all keyed at group level) -------------------
  const adj = new Map();
  // co-cart: items appearing in the same basket
  cartEvents.forEach((c) => {
    const gs = [...new Set((c.product_ids || []).map((p) => pidToGroup[p]).filter(Boolean))];
    for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) addPair(adj, gs[i], gs[j], "cart");
  });
  // co-view / co-purchase: products touched by the same visitor
  const viewsByVisitor = {}, buysByVisitor = {};
  webEvents.forEach((e) => {
    const g = pidToGroup[e.product_id]; if (!g) return;
    if (e.event_type === "product_view") (viewsByVisitor[e.visitor_id] ||= new Set()).add(g);
    if (e.event_type === "purchase") (buysByVisitor[e.visitor_id] ||= new Set()).add(g);
  });
  conversions.forEach((c) => { const g = pidToGroup[c.product_id]; if (g) (buysByVisitor[c.visitor_id] ||= new Set()).add(g); });
  const pairsFrom = (byVisitor, kind) => {
    for (const set of Object.values(byVisitor)) {
      const gs = [...set];
      for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) addPair(adj, gs[i], gs[j], kind);
    }
  };
  pairsFrom(viewsByVisitor, "view");
  pairsFrom(buysByVisitor, "purchase");

  // --- Popularity (views + purchases per group) --------------------------
  const pop = {};
  groups.forEach((g) => (pop[g.id] = { views: 0, purchases: 0 }));
  webEvents.forEach((e) => {
    const g = pidToGroup[e.product_id]; if (!g || !pop[g]) return;
    if (e.event_type === "product_view") pop[g].views++;
    if (e.event_type === "purchase") pop[g].purchases++;
  });
  conversions.forEach((c) => { const g = pidToGroup[c.product_id]; if (g && pop[g]) pop[g].purchases++; });
  const maxPop = Math.max(1, ...groups.map((g) => pop[g.id].views + pop[g.id].purchases * 2));

  // --- Return-risk from support tickets (cross-case signal, case 12) ------
  const RET = new Set(["returns", "exchange", "damaged"]);
  const returnCount = {};
  tickets.forEach((t) => { const g = pidToGroup[t.product_id]; if (g && RET.has(t.theme)) returnCount[g] = (returnCount[g] || 0) + 1; });
  groups.forEach((g) => { g.returnTickets = returnCount[g.id] || 0; g.returnRisk = g.returnTickets >= RETURN_RISK_MIN; });

  const catalogAvgMargin = round(groups.reduce((s, g) => s + g.margin, 0) / (groups.length || 1));
  const behaviorPairs = [...adj.values()].reduce((s, m) => s + m.size, 0) / 2;

  return { groups, byId, adj, pop, maxPop, catalogAvgMargin, behaviorPairs, pidToGroup };
}

// Combined behaviour weight between the seed and a partner group.
function coSignal(model, seedId, partnerId) {
  const e = model.adj.get(seedId)?.get(partnerId);
  if (!e) return { w: 0, view: 0, cart: 0, purchase: 0 };
  return { w: e.view * 1 + e.cart * 2 + e.purchase * 3, ...e };
}

// Each strategy returns candidate groups with a base score (0..1) + evidence.
function candidatesFor(model, seed) {
  const out = { complementary: [], similar: [], upsell: [], behavior: [], trending: [], brand: [] };
  const others = model.groups.filter((g) => g.id !== seed.id);
  const comp = new Set(COMPLEMENTS[seed.category] || []);
  const maxCo = Math.max(1, ...others.map((g) => coSignal(model, seed.id, g.id).w));

  for (const g of others) {
    // complementary
    if (comp.has(g.category)) out.complementary.push({ id: g.id, base: 0.75, reason: `Complements ${seed.category.toLowerCase()}`, tag: "complementary" });
    // similar (same category, close price)
    if (g.category === seed.category && seed.price > 0) {
      const delta = Math.abs(g.price - seed.price) / seed.price;
      if (delta <= PRICE_BAND) out.similar.push({ id: g.id, base: 0.6 * (1 - delta / PRICE_BAND) + 0.2, reason: `Same category, similar price`, tag: "similar" });
    }
    // upsell (same category, pricier + at least as profitable)
    if (g.category === seed.category && seed.price > 0) {
      const up = (g.price - seed.price) / seed.price;
      if (up >= 0.08 && up <= 0.8 && g.margin >= seed.margin) {
        out.upsell.push({ id: g.id, base: 0.55 + Math.min(0.35, (g.margin - seed.margin)), reason: `Premium upsell: +${Math.round(up * 100)}% price, +${Math.round((g.margin - seed.margin) * 100)} pts margin`, tag: "upsell" });
      }
    }
    // behaviour (co-signal)
    const co = coSignal(model, seed.id, g.id);
    if (co.w > 0) {
      const ev = co.cart ? `co-carted in ${co.cart} basket(s)` : co.purchase ? `co-purchased ${co.purchase}×` : `co-viewed ${co.view}×`;
      out.behavior.push({ id: g.id, base: 0.5 + 0.5 * (co.w / maxCo), reason: `Bought together — ${ev}`, tag: "behavior", ev: co });
    }
    // brand affinity
    if (g.brand === seed.brand) out.brand.push({ id: g.id, base: 0.5, reason: `More from ${seed.brand}`, tag: "brand" });
  }
  // trending (global popularity)
  out.trending = others
    .map((g) => ({ g, score: (model.pop[g.id].views + model.pop[g.id].purchases * 2) / model.maxPop }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => ({ id: x.g.id, base: 0.4 + 0.5 * x.score, reason: `Trending — ${model.pop[x.g.id].views} views, ${model.pop[x.g.id].purchases} purchases`, tag: "trending" }));

  return out;
}

export function recommend(model, seedId, opts = {}) {
  const objective = opts.objective && OBJECTIVES[opts.objective] ? opts.objective : "balanced";
  const weights = OBJECTIVES[objective];
  const marginFloor = MARGIN_FLOORS[opts.marginFloor] ?? 0;
  const suppressReturns = opts.suppressReturns !== false; // default on
  const diversity = opts.diversity !== false;             // default on
  const inStockOnly = opts.inStockOnly !== false;         // default on
  const slots = opts.slots || 6;

  const seed = model.byId[seedId] || model.groups[0];
  const cand = candidatesFor(model, seed);

  // Merge candidates across strategies into one scored pool.
  const pool = new Map();
  for (const [strat, list] of Object.entries(cand)) {
    for (const c of list) {
      let m = pool.get(c.id);
      if (!m) { m = { id: c.id, score: 0, strategies: new Set(), reasons: [], contrib: {} }; pool.set(c.id, m); }
      const contribution = (weights[strat] || 0) * c.base;
      m.contrib[strat] = round(contribution);
      m.score += contribution;
      m.strategies.add(strat);
      m.reasons.push({ strat, text: c.reason });
    }
  }
  // Small margin + popularity boosts (margin-aware merchandising).
  for (const m of pool.values()) {
    const g = model.byId[m.id];
    m.score += 0.15 * g.margin + 0.06 * ((model.pop[g.id].views + model.pop[g.id].purchases * 2) / model.maxPop);
    m.score = round(m.score);
  }

  // --- Guardrails (sequential attribution for the panel) -----------------
  const removed = { in_stock: 0, margin_floor: 0, return_risk: 0, diversity: 0 };
  let items = [...pool.values()].map((m) => ({ ...m, g: model.byId[m.id] }));
  const kept = [];
  for (const it of items) {
    if (inStockOnly && !it.g.inStock) { removed.in_stock++; continue; }
    if (marginFloor > 0 && it.g.margin < marginFloor) { removed.margin_floor++; continue; }
    if (suppressReturns && it.g.returnRisk) { removed.return_risk++; continue; }
    kept.push(it);
  }
  kept.sort((a, b) => b.score - a.score);

  // Diversity: cap 2 per category, keeping highest scored.
  let ranked = kept;
  if (diversity) {
    const perCat = {}; const keep = [];
    for (const it of kept) {
      const c = it.g.category; perCat[c] = (perCat[c] || 0);
      if (perCat[c] >= 2) { removed.diversity++; continue; }
      perCat[c]++; keep.push(it);
    }
    ranked = keep;
  }

  const recommendations = ranked.slice(0, slots).map((it) => {
    const primary = Object.entries(it.contrib).sort((a, b) => b[1] - a[1])[0]?.[0] || "similar";
    return {
      id: it.id, title: it.g.title, category: it.g.category, brand: it.g.brand,
      price: it.g.price, margin: it.g.margin, stock: it.g.stock, returnRisk: it.g.returnRisk,
      score: round(it.score), primary, primaryLabel: STRATEGY_LABELS[primary],
      strategies: [...it.strategies], strategyLabels: [...it.strategies].map((s) => STRATEGY_LABELS[s]),
      reasons: it.reasons, contrib: it.contrib,
      views: model.pop[it.id].views, purchases: model.pop[it.id].purchases,
    };
  });

  const breakdown = Object.keys(STRATEGY_LABELS).map((s) => ({
    strategy: s, label: STRATEGY_LABELS[s], weight: weights[s],
    surfaced: [...pool.values()].filter((m) => m.strategies.has(s)).length,
    inSlate: recommendations.filter((r) => r.primary === s).length,
  }));

  const recAvgMargin = recommendations.length ? round(recommendations.reduce((s, r) => s + r.margin, 0) / recommendations.length) : 0;

  return {
    seed, objective, recommendations,
    guardrails: { inStockOnly, marginFloor, suppressReturns, diversity, removed, candidatePool: pool.size },
    breakdown, recAvgMargin,
    marginLift: round(recAvgMargin - model.catalogAvgMargin),
  };
}

// Catalog-wide coverage under the current options (cold-start detection).
export function coverage(model, opts = {}) {
  let withRecs = 0; const cold = [];
  for (const g of model.groups) {
    const r = recommend(model, g.id, opts);
    if (r.recommendations.length > 0) withRecs++;
    else cold.push({ id: g.id, title: g.title, category: g.category });
  }
  const total = model.groups.length || 1;
  return { total, withRecs, pct: Math.round((withRecs / total) * 100), coldStart: cold };
}
